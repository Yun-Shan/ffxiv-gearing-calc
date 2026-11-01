import { projectionClass } from "./factor-signature.ts";
import {
  PROJECTION_AXES,
  ProjectionLimit,
  type ProjectionJob,
  type ProjectionModel,
  type ProjectionSlot,
} from "./types.ts";

export type SharedSMCell = {
  speed: number;
  main: number;
  minZ: number;
  maxZ: number;
};
export type SharedSpeedDomain = {
  slots: readonly ProjectionSlot[];
  foods: readonly (readonly number[])[];
  cells: readonly SharedSMCell[];
  maxCapacity: number;
};
export function requireVariableDomain(
  condition: unknown,
  reason: string,
): asserts condition {
  if (!condition)
    throw new ProjectionLimit(`Variable shared projection: ${reason}`);
}
export function safeVariable(value: number, minimum = 0): number {
  requireVariableDomain(
    Number.isSafeInteger(value) && value >= minimum,
    "unsafe coordinate",
  );
  return value;
}
function add(a: number, b: number): number {
  return safeVariable(a + b);
}
export function resourceZ(values: readonly number[]): number {
  return [2, 3, 4, 5].reduce((sum, a) => add(sum, values[a]), 0);
}
export function variableFinal(
  job: ProjectionJob,
  food: number,
  axis: number,
  raw: number,
): bigint {
  const rule = job.foods[food].bonuses[axis];
  let value = BigInt(raw);
  if (rule) {
    const bonus =
      (value * BigInt(rule.numerator) + BigInt(rule.offset)) /
      BigInt(rule.denominator);
    value += bonus < BigInt(rule.cap) ? bonus : BigInt(rule.cap);
  }
  return value;
}
export function variableSpeedAllowed(
  job: ProjectionJob,
  food: number,
  raw: number,
): boolean {
  if (raw < job.axes[6].rawMin || raw > job.axes[6].rawMax) return false;
  const final = variableFinal(job, food, 6, raw);
  return (
    job.speedRanges!.some(
      (range) => BigInt(range.min) <= final && final <= BigInt(range.max),
    ) && projectionClass(job, food, 6, raw) !== undefined
  );
}

/** Complete physical-key retention under the necessary shared-speed domain. */
export function prepareSharedSpeedDomain(
  model: ProjectionModel,
  check: () => void,
): SharedSpeedDomain {
  check();
  let work = 0;
  const tick = () => {
    if ((++work & 1023) === 0) check();
    requireVariableDomain(work <= 100_000_000, "speed-domain work budget");
  };
  const jobs = model.jobs,
    depth = model.blocks.length;
  requireVariableDomain(
    jobs.length >= 2 && jobs.length <= 16 && depth > 0 && depth <= 17,
    "job/shared-slot structure",
  );
  const empty = (
    foods: readonly (readonly number[])[] = [],
  ): SharedSpeedDomain => ({ slots: [], foods, cells: [], maxCapacity: 0 });
  const blockNames = new Set<string>();
  for (const block of model.blocks) {
    requireVariableDomain(!blockNames.has(block.name), "duplicate shared slot");
    blockNames.add(block.name);
    requireVariableDomain(
      block.keys.length <= 100_000 &&
        new Set(block.keys.map((key) => key.key)).size === block.keys.length,
      "shared physical-key domain",
    );
  }
  const foodMaps = jobs.map((job) => {
    requireVariableDomain(
      job.axes.length === 7 &&
        job.axes.every((axis, a) => axis.name === PROJECTION_AXES[a]) &&
        job.slots.length === depth + 1,
      "seven ordered axes and one private weapon required",
    );
    safeVariable(job.rhs, Number.MIN_SAFE_INTEGER);
    let magnitude = 0n;
    for (const axis of job.axes) {
      safeVariable(axis.rawMin);
      safeVariable(axis.rawMax, axis.rawMin);
      requireVariableDomain(
        axis.classes.length > 0 && axis.classes.length <= 100_000,
        "factor class domain",
      );
      let previous = -1,
        bound = 0n;
      for (const cls of axis.classes) {
        tick();
        safeVariable(cls.min);
        safeVariable(cls.max, cls.min);
        safeVariable(cls.q, Number.MIN_SAFE_INTEGER);
        safeVariable(cls.value, 1);
        requireVariableDomain(cls.min > previous, "ordered factor classes");
        previous = cls.max;
        const q = BigInt(cls.q),
          absolute = q < 0n ? -q : q;
        if (absolute > bound) bound = absolute;
      }
      magnitude += bound;
    }
    requireVariableDomain(
      magnitude <= BigInt(Number.MAX_SAFE_INTEGER) &&
        job.axes[6].classes.every((cls) => cls.q === 0),
      "damage coefficient range",
    );
    requireVariableDomain(
      job.speedRanges !== undefined && job.speedRanges.length <= 256,
      "finite original speed ranges required",
    );
    for (const range of job.speedRanges) {
      safeVariable(range.min);
      safeVariable(range.max, range.min);
      requireVariableDomain(
        range.max < Number.MAX_SAFE_INTEGER,
        "unbounded speed domain",
      );
    }
    const totals = Array<number>(7).fill(0);
    for (let s = 0; s < job.slots.length; s++) {
      const slot = job.slots[s],
        shared = s < depth;
      requireVariableDomain(
        slot.choices.length <= 100_000 &&
          new Set(slot.choices.map((choice) => choice.key)).size ===
            slot.choices.length,
        "physical candidate domain",
      );
      if (shared)
        requireVariableDomain(
          slot.name === model.blocks[s].name &&
            slot.choices.length === model.blocks[s].keys.length,
          "shared slot coverage",
        );
      const maximum = Array<number>(7).fill(0);
      for (let k = 0; k < slot.choices.length; k++) {
        tick();
        const choice = slot.choices[k];
        requireVariableDomain(
          choice.values.length === 7,
          "full upstream physical vector required",
        );
        choice.values.forEach((value) => safeVariable(value));
        resourceZ(choice.values);
        if (shared) {
          const source = jobs[0].slots[s].choices[k];
          requireVariableDomain(
            choice.key === model.blocks[s].keys[k].key &&
              choice.key === source.key &&
              choice.values[0] === 0 &&
              choice.values.every((value, a) => value === source.values[a]),
            "identical full shared vectors and zero shared weapon contribution required",
          );
        }
        for (let a = 0; a < 7; a++)
          maximum[a] = Math.max(maximum[a], choice.values[a]);
      }
      for (let a = 0; a < 7; a++) totals[a] = add(totals[a], maximum[a]);
    }
    resourceZ(totals);
    requireVariableDomain(job.foods.length <= 256, "food count budget");
    const foods = new Map<string, number>();
    job.foods.forEach((food, f) => {
      tick();
      requireVariableDomain(
        !foods.has(food.sharedKey) && food.bonuses.length === 7,
        "unique complete food identities required",
      );
      foods.set(food.sharedKey, f);
      for (const bonus of food.bonuses)
        if (bonus) {
          safeVariable(bonus.numerator);
          safeVariable(bonus.offset);
          safeVariable(bonus.cap);
          safeVariable(bonus.denominator, 1);
        }
    });
    return foods;
  });
  const foods: number[][] = [];
  for (const [key] of foodMaps[0]) {
    tick();
    if (foodMaps.every((map) => map.has(key)))
      foods.push(foodMaps.map((map) => map.get(key)!));
  }
  if (
    !foods.length ||
    jobs.some(
      (job) =>
        !job.speedRanges!.length ||
        job.slots.some((slot) => !slot.choices.length),
    )
  )
    return empty(foods);
  let cap = Number.MAX_SAFE_INTEGER;
  for (const job of jobs) {
    const finalMax = job.speedRanges!.reduce(
      (maximum, range) => Math.max(maximum, range.max),
      0,
    );
    const minimumWeaponSpeed = job.slots[depth].choices.reduce(
      (minimum, choice) => Math.min(minimum, choice.values[6]),
      Infinity,
    );
    cap = Math.min(cap, finalMax - minimumWeaponSpeed);
  }
  if (cap < 0) return empty(foods);
  requireVariableDomain(
    Number.isSafeInteger(cap) && cap <= 20_000,
    "shared speed cap budget",
  );
  const accepted = new Uint8Array(cap + 1);
  const privateSpeeds = jobs.map((job) => [
    ...new Set(job.slots[depth].choices.map((choice) => choice.values[6])),
  ]);
  for (let speed = 0; speed <= cap; speed++) {
    for (const food of foods) {
      tick();
      const supported = jobs.every((job, j) =>
        privateSpeeds[j].some((privateSpeed) => {
          tick();
          return variableSpeedAllowed(job, food[j], add(speed, privateSpeed));
        }),
      );
      if (supported) {
        accepted[speed] = 1;
        break;
      }
    }
  }
  const original = jobs[0].slots.slice(0, depth);
  const minima = original.map((slot) =>
    slot.choices.reduce(
      (minimum, choice) => Math.min(minimum, choice.values[6]),
      Infinity,
    ),
  );
  const minimumTotal = minima.reduce(add, 0);
  const bounded = original.map((slot, i): ProjectionSlot => ({
    name: slot.name,
    choices: slot.choices.filter((choice) => {
      tick();
      return choice.values[6] <= cap - (minimumTotal - minima[i]);
    }),
  }));
  if (bounded.some((slot) => !slot.choices.length)) return empty(foods);
  const increments = bounded.map((slot) => [
    ...new Set(slot.choices.map((choice) => choice.values[6])),
  ]);
  const prefix: Uint8Array[] = [new Uint8Array(cap + 1)];
  prefix[0][0] = 1;
  for (let i = 0; i < depth; i++) {
    const next = new Uint8Array(cap + 1);
    for (let s = 0; s <= cap; s++)
      if (prefix[i][s])
        for (const inc of increments[i]) {
          tick();
          if (inc <= cap - s) next[s + inc] = 1;
        }
    prefix.push(next);
  }
  // backward[i][s] says the exact prefix speed s can be completed by slots i..n.
  const backward: Uint8Array[] = [];
  backward[depth] = accepted;
  for (let i = depth - 1; i >= 0; i--) {
    const next = new Uint8Array(cap + 1);
    for (let s = 0; s <= cap; s++)
      for (const inc of increments[i]) {
        tick();
        if (inc <= cap - s && backward[i + 1][s + inc]) {
          next[s] = 1;
          break;
        }
      }
    backward[i] = next;
  }
  if (!backward[0][0]) return empty(foods);
  const slots = bounded.map((slot, i): ProjectionSlot => ({
    name: slot.name,
    choices: slot.choices.filter((choice) => {
      for (let s = 0; s <= cap - choice.values[6]; s++) {
        tick();
        if (prefix[i][s] && backward[i + 1][s + choice.values[6]]) return true;
      }
      return false;
    }),
  }));
  let layer = new Map<string, SharedSMCell>([
    ["0,0", { speed: 0, main: 0, minZ: 0, maxZ: 0 }],
  ]);
  for (let i = 0; i < slots.length; i++) {
    const unique = new Map<
      string,
      { speed: number; main: number; z: number }
    >();
    for (const choice of slots[i].choices) {
      tick();
      const speed = choice.values[6],
        main = choice.values[1],
        z = resourceZ(choice.values);
      unique.set(`${speed},${main},${z}`, { speed, main, z });
    }
    const next = new Map<string, SharedSMCell>();
    for (const parent of layer.values())
      for (const inc of unique.values()) {
        tick();
        const speed = parent.speed + inc.speed;
        if (speed > cap || !backward[i + 1][speed]) continue;
        const main = add(parent.main, inc.main),
          minZ = add(parent.minZ, inc.z),
          maxZ = add(parent.maxZ, inc.z);
        const key = `${speed},${main}`,
          old = next.get(key);
        if (old) {
          old.minZ = Math.min(old.minZ, minZ);
          old.maxZ = Math.max(old.maxZ, maxZ);
        } else {
          requireVariableDomain(
            next.size < 300_000,
            "shared SM projection state budget",
          );
          next.set(key, { speed, main, minZ, maxZ });
        }
      }
    layer = next;
  }
  const cells = [...layer.values()];
  const maxSharedZ = cells.reduce(
    (maximum, cell) => Math.max(maximum, cell.maxZ),
    0,
  );
  const maxWeaponZ = jobs.reduce(
    (maximum, job) =>
      job.slots[depth].choices.reduce(
        (largest, choice) => Math.max(largest, resourceZ(choice.values)),
        maximum,
      ),
    0,
  );
  const maxCapacity = add(maxSharedZ, maxWeaponZ);
  requireVariableDomain(
    maxCapacity <= 20_000,
    "shared plus private capacity budget",
  );
  check();
  return { slots, foods, cells, maxCapacity };
}
