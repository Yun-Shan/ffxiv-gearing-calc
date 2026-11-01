import type { AxisState, SupportAxis } from "./axis-support.ts";
import { projectionClass } from "./factor-signature.ts";
import { ProjectionLimit, type ProjectionJob } from "./types.ts";

const resources: readonly SupportAxis[] = ["crt", "det", "dht", "ten"];
const index: Readonly<Record<SupportAxis, number>> = {
  crt: 4,
  det: 2,
  dht: 5,
  ten: 3,
};
interface Option {
  raw: number;
  q: number;
}
interface Weapon {
  values: readonly number[];
  z: number;
}
interface CoreOption {
  q: number;
  offsets: readonly number[];
  otherZ: number;
}
interface LocalBound {
  base: readonly { q: number; offset: number; otherZ: number }[];
  axis: Float64Array;
  envelope: Float64Array;
  rhs: number;
}

export interface SharedAxisGate {
  minimum(speed: number, main: number, maxSharedZ: number): number | null;
  filter(
    states: readonly AxisState[],
    basis: readonly SupportAxis[],
    axis: SupportAxis,
  ): AxisState[];
}

/** Outer necessary-row bounds. Remaining substats share a <= raw-sum budget;
 * their physical allocation and cross-job correlations are deliberately relaxed.
 */
export function prepareSharedAxisGate(
  jobs: readonly ProjectionJob[],
  sharedSlotCount: number,
  sharedFoods: readonly (readonly number[])[],
  maxCapacity: number,
  jointRhs: number,
  check: () => void,
): SharedAxisGate {
  let work = 0,
    phaseStart = 0,
    cells = 0,
    cacheEntries = 0,
    cachedOptions = 0;
  const requireLimit = (ok: boolean, reason: string): void => {
    if (!ok) throw new ProjectionLimit(`Shared axis gate: ${reason}`);
  };
  const nonnegative = (value: number): number => {
    requireLimit(
      Number.isSafeInteger(value) && value >= 0,
      "unsafe coordinate",
    );
    return value;
  };
  const add = (a: number, b: number): number => {
    const value = a + b;
    requireLimit(Number.isSafeInteger(value), "unsafe sum");
    return value;
  };
  const tick = () => {
    if ((++work & 1023) === 0) check();
    requireLimit(
      work - phaseStart <= 180_000_000 && work <= 1_500_000_000,
      "work budget",
    );
  };
  const allocate = (count: number) => {
    cells += count;
    requireLimit(cells <= 8_000_000, "table memory budget");
  };
  const cacheItem = (count = 0) => {
    cacheEntries++;
    cachedOptions += count;
    requireLimit(
      cacheEntries <= 20_000 && cachedOptions <= 1_000_000,
      "cache budget",
    );
  };
  check();
  nonnegative(maxCapacity);
  nonnegative(sharedSlotCount);
  requireLimit(
    maxCapacity <= 20_000 && jobs.length > 0 && jobs.length <= 16,
    "domain budget",
  );
  requireLimit(
    Number.isSafeInteger(jointRhs) && sharedFoods.length > 0,
    "joint row and foods required",
  );
  const jointThreshold = BigInt(jointRhs);
  const names = ["weapon", "main", "det", "ten", "crt", "dht", "gcd"];
  const weapons = jobs.map((job) => {
    requireLimit(
      job.axes.length === 7 && job.axes.every((a, i) => a.name === names[i]),
      "seven ordered axes required",
    );
    requireLimit(
      Number.isSafeInteger(job.rhs) && job.slots.length === sharedSlotCount + 1,
      "one private weapon required",
    );
    for (const range of job.speedRanges ?? []) {
      nonnegative(range.min);
      nonnegative(range.max);
      requireLimit(range.min <= range.max, "hard speed interval");
    }
    let absolute = 0n;
    for (const axis of job.axes) {
      nonnegative(axis.rawMin);
      nonnegative(axis.rawMax);
      requireLimit(axis.rawMin <= axis.rawMax, "raw domain");
      let magnitude = 0n,
        previous = -1;
      for (const cls of axis.classes) {
        tick();
        nonnegative(cls.min);
        nonnegative(cls.max);
        requireLimit(
          cls.min <= cls.max &&
            cls.min > previous &&
            Number.isSafeInteger(cls.q),
          "ordered coefficient classes",
        );
        previous = cls.max;
        const q = BigInt(cls.q),
          abs = q < 0n ? -q : q;
        if (abs > magnitude) magnitude = abs;
      }
      absolute += magnitude;
    }
    requireLimit(
      absolute <= BigInt(Number.MAX_SAFE_INTEGER),
      "local coefficient sum range",
    );
    const unique = new Map<string, Weapon>();
    for (const choice of job.slots[sharedSlotCount].choices) {
      tick();
      requireLimit(choice.values.length === 7, "complete weapon vector");
      choice.values.forEach(nonnegative);
      const z = resources.reduce(
        (sum, name) => add(sum, choice.values[index[name]]),
        0,
      );
      requireLimit(z <= maxCapacity, "private weapon capacity range");
      unique.set(choice.values.join(","), { values: choice.values, z });
      requireLimit(unique.size <= 500_000, "private weapon budget");
    }
    return [...unique.values()];
  });
  const maxWeaponZ = weapons.map((list) =>
    list.reduce((best, w) => Math.max(best, w.z), 0),
  );
  for (const food of sharedFoods) {
    tick();
    requireLimit(food.length === jobs.length, "common food coverage");
    food.forEach((f, j) => {
      nonnegative(f);
      requireLimit(f < jobs[j].foods.length, "local food index");
      const bonuses = jobs[j].foods[f].bonuses;
      requireLimit(bonuses.length === 7, "complete food vector");
      for (const bonus of bonuses)
        if (bonus) {
          nonnegative(bonus.numerator);
          nonnegative(bonus.offset);
          nonnegative(bonus.cap);
          requireLimit(
            Number.isSafeInteger(bonus.denominator) && bonus.denominator > 0,
            "food denominator",
          );
        }
    });
  }
  const coefficient = (
    f: number,
    j: number,
    a: number,
    raw: number,
  ): number => {
    tick();
    nonnegative(raw);
    const job = jobs[j],
      axis = job.axes[a],
      localFood = sharedFoods[f][j];
    if (raw < axis.rawMin || raw > axis.rawMax) return -Infinity;
    if (a === 6 && job.speedRanges) {
      const rule = job.foods[localFood].bonuses[a];
      let final = BigInt(raw);
      if (rule) {
        const bonus =
          (final * BigInt(rule.numerator) + BigInt(rule.offset)) /
          BigInt(rule.denominator);
        final += bonus < BigInt(rule.cap) ? bonus : BigInt(rule.cap);
      }
      if (
        !job.speedRanges.some(
          (range) => BigInt(range.min) <= final && final <= BigInt(range.max),
        )
      )
        return -Infinity;
    }
    return projectionClass(job, localFood, a, raw)?.q ?? -Infinity;
  };
  const rawCache = new Map<string, Float64Array>();
  const optionsCache = new Map<Float64Array, readonly Option[]>();
  const rawTables = sharedFoods.map((food, f) =>
    jobs.map((job, j) => {
      const result = new Map<SupportAxis, Float64Array>();
      for (const name of resources) {
        const a = index[name],
          key = JSON.stringify([j, a, job.foods[food[j]].bonuses[a]]);
        let table = rawCache.get(key);
        if (!table) {
          allocate(maxCapacity + 1);
          table = new Float64Array(maxCapacity + 1);
          const lowest = new Map<number, number>();
          for (let raw = 0; raw <= maxCapacity; raw++) {
            const q = coefficient(f, j, a, raw);
            table[raw] = q;
            if (q !== -Infinity && !lowest.has(q)) lowest.set(q, raw);
          }
          let peak = -Infinity;
          const options: Option[] = [];
          for (const [q, raw] of lowest) {
            if (q <= peak) continue;
            peak = q;
            options.push({ q, raw });
          }
          rawCache.set(key, table);
          optionsCache.set(table, options);
        }
        result.set(name, table);
      }
      return result;
    }),
  );
  const envelopeCache = new Map<string, Float64Array>();
  const envelope = (
    f: number,
    j: number,
    remaining: readonly SupportAxis[],
  ): Float64Array => {
    const list = remaining.map((name) =>
      optionsCache.get(rawTables[f][j].get(name)!)!,
    );
    const key = JSON.stringify(list),
      cached = envelopeCache.get(key);
    if (cached) return cached;
    // Charge one result plus both scratch arrays before allocation.
    allocate(3 * (maxCapacity + 1));
    cacheItem();
    let previous = new Float64Array(maxCapacity + 1);
    for (const options of list) {
      const next = new Float64Array(maxCapacity + 1).fill(-Infinity);
      for (const option of options)
        for (let capacity = option.raw; capacity <= maxCapacity; capacity++) {
          tick();
          const before = previous[capacity - option.raw];
          if (before !== -Infinity)
            next[capacity] = Math.max(next[capacity], add(before, option.q));
        }
      previous = next;
    }
    envelopeCache.set(key, previous);
    return previous;
  };
  const coreCache = new Map<string, readonly CoreOption[]>();
  const coreOptions = (
    speed: number,
    main: number,
    f: number,
    j: number,
    retained: readonly SupportAxis[],
    remaining: readonly SupportAxis[],
  ): readonly CoreOption[] => {
    const key = `${speed}:${main}:${f}:${j}:${retained.join(",")}`,
      cached = coreCache.get(key);
    if (cached) return cached;
    const groups = new Map<string, CoreOption>();
    for (const weapon of weapons[j]) {
      tick();
      const w = weapon.values;
      const qs = [
        coefficient(f, j, 0, w[0]),
        coefficient(f, j, 1, add(main, w[1])),
        coefficient(f, j, 6, add(speed, w[6])),
      ];
      if (qs.includes(-Infinity)) continue;
      const q = qs.reduce(add, 0),
        offsets = retained.map((name) => w[index[name]]);
      const otherZ = remaining.reduce(
        (sum, name) => add(sum, w[index[name]]),
        0,
      );
      const identity = `${offsets.join(",")}/${otherZ}`,
        old = groups.get(identity);
      if (!old || old.q < q) groups.set(identity, { q, offsets, otherZ });
    }
    const ordered = [...groups.values()].sort((a, b) => {
      for (let k = 0; k < a.offsets.length; k++)
        if (a.offsets[k] !== b.offsets[k]) return a.offsets[k] - b.offsets[k];
      return b.otherZ - a.otherZ || b.q - a.q;
    });
    // Identical exact offsets permit domination by both more relaxed capacity
    // and a no-smaller core Q. This never substitutes a physical weapon witness.
    const kept: CoreOption[] = [];
    let last: string | undefined,
      peak = -Infinity;
    for (const group of ordered) {
      tick();
      const identity = group.offsets.join(",");
      if (identity !== last) {
        last = identity;
        peak = -Infinity;
      }
      if (group.q <= peak) continue;
      peak = group.q;
      kept.push(group);
    }
    cacheItem(kept.length);
    coreCache.set(key, kept);
    return kept;
  };
  // The four-axis tables are shared with subsequent fixed-axis envelopes.
  const full = sharedFoods.map((_, f) =>
    jobs.map((_, j) => envelope(f, j, resources)),
  );
  const foodMinimums = new Map<
    string,
    { maximum: number; thresholds: readonly number[] }
  >();
  const capacityRange = (z: number) => {
    nonnegative(z);
    for (const largest of maxWeaponZ)
      requireLimit(
        add(z, largest) <= maxCapacity,
        "shared plus private capacity range",
      );
  };
  check();
  return {
    minimum(speed, main, maxSharedZ) {
      check();
      nonnegative(speed);
      nonnegative(main);
      capacityRange(maxSharedZ);
      let minimum: number | null = null;
      const thresholds = sharedFoods.map(() => Infinity);
      for (let f = 0; f < sharedFoods.length; f++) {
        const options = jobs.map((_, j) =>
          coreOptions(speed, main, f, j, [], resources),
        );
        const passes = (z: number): boolean => {
          let total = 0n;
          for (let j = 0; j < jobs.length; j++) {
            let best = -Infinity;
            for (const option of options[j]) {
              tick();
              const upper = full[f][j][z + option.otherZ];
              if (upper !== -Infinity)
                best = Math.max(best, add(option.q, upper));
            }
            if (best === -Infinity || best < jobs[j].rhs) return false;
            total += BigInt(best);
          }
          return total >= jointThreshold;
        };
        if (!passes(maxSharedZ)) continue;
        let low = 0,
          high = maxSharedZ;
        while (low < high) {
          tick();
          const mid = low + Math.floor((high - low) / 2);
          if (passes(mid)) high = mid;
          else low = mid + 1;
        }
        thresholds[f] = low;
        minimum = Math.min(minimum ?? low, low);
      }
      requireLimit(foodMinimums.size < 300_000, "speed/main threshold budget");
      foodMinimums.set(`${speed},${main}`, { maximum: maxSharedZ, thresholds });
      check();
      return minimum;
    },
    filter(states, basis, axis) {
      check();
      phaseStart = work;
      requireLimit(
        resources.includes(axis) &&
          basis.every((name) => resources.includes(name) && name !== axis) &&
          new Set(basis).size === basis.length,
        "distinct retained axes required",
      );
      requireLimit(states.length <= 300_000, "state budget");
      const retained = [axis, ...basis],
        remaining = resources.filter((name) => !retained.includes(name));
      const filteredEnvelopes: (Float64Array | undefined)[][] = sharedFoods.map(
        () => [],
      );
      const result: AxisState[] = [];
      let pairs = 0;
      for (const state of states) {
        check();
        nonnegative(state.speed);
        nonnegative(state.main);
        capacityRange(state.z);
        requireLimit(
          state.basis.length === basis.length &&
            typeof state.bits === "bigint" &&
            state.bits >= 0n,
          "state basis and bits",
        );
        const fixedSum = state.basis.reduce(
          (sum, value) => add(sum, nonnegative(value)),
          0,
        );
        requireLimit(fixedSum <= state.z, "fixed sum outside shared capacity");
        const maxX = state.z - fixedSum;
        requireLimit(
          state.bits >> BigInt(maxX + 1) === 0n,
          "bit outside shared capacity",
        );
        if (state.bits === 0n) continue;
        const candidates: LocalBound[][] = [];
        const prior = foodMinimums.get(`${state.speed},${state.main}`);
        for (let f = 0; f < sharedFoods.length; f++) {
          if (
            prior &&
            state.z <= prior.maximum &&
            state.z < prior.thresholds[f]!
          )
            continue;
          const locals = jobs.map((job, j): LocalBound => {
            const base: { q: number; offset: number; otherZ: number }[] = [];
            for (const group of coreOptions(
              state.speed,
              state.main,
              f,
              j,
              retained,
              remaining,
            )) {
              tick();
              let q = group.q;
              for (let k = 0; k < basis.length; k++) {
                const raw = add(state.basis[k], group.offsets[k + 1]);
                requireLimit(raw <= maxCapacity, "fixed raw table range");
                const exact = rawTables[f][j].get(basis[k])![raw];
                if (exact === -Infinity) {
                  q = -Infinity;
                  break;
                }
                q = add(q, exact);
              }
              if (q !== -Infinity)
                base.push({
                  q,
                  offset: group.offsets[0],
                  otherZ: group.otherZ,
                });
            }
            const upper = (filteredEnvelopes[f]![j] ??= envelope(
              f,
              j,
              remaining,
            ));
            return {
              base,
              axis: rawTables[f][j].get(axis)!,
              envelope: upper,
              rhs: job.rhs,
            };
          });
          if (locals.every((local) => local.base.length > 0))
            candidates.push(locals);
        }
        const words = new Uint32Array(Math.ceil((maxX + 1) / 32));
        let rest = state.bits,
          offset = 0;
        while (rest !== 0n) {
          tick();
          let word = Number(rest & 0xffffffffn);
          while (word) {
            tick();
            requireLimit(++pairs <= 5_000_000, "bit pair budget");
            const bit = word & -word,
              x = offset + 31 - Math.clz32(bit);
            let supported = false;
            for (const locals of candidates) {
              tick();
              let total = 0n,
                passes = true;
              for (const local of locals) {
                let best = -Infinity;
                for (const option of local.base) {
                  tick();
                  const raw = add(x, option.offset),
                    capacity = add(state.z - fixedSum - x, option.otherZ);
                  requireLimit(
                    raw <= maxCapacity && capacity <= maxCapacity,
                    "axis envelope range",
                  );
                  const exact = local.axis[raw],
                    upper = local.envelope[capacity];
                  if (exact !== -Infinity && upper !== -Infinity)
                    best = Math.max(best, add(add(option.q, exact), upper));
                }
                if (best === -Infinity || best < local.rhs) {
                  passes = false;
                  break;
                }
                total += BigInt(best);
              }
              if (passes && total >= jointThreshold) {
                supported = true;
                break;
              }
            }
            if (supported)
              words[x >>> 5] = (words[x >>> 5] | (1 << (x & 31))) >>> 0;
            word = (word & (word - 1)) >>> 0;
          }
          rest >>= 32n;
          offset += 32;
        }
        let bits = 0n;
        for (let k = words.length - 1; k >= 0; k--) {
          tick();
          bits = (bits << 32n) | BigInt(words[k]);
        }
        if (bits !== 0n) result.push({ ...state, bits });
      }
      check();
      return result;
    },
  };
}
