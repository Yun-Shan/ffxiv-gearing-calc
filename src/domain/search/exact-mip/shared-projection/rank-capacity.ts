import {
  prepareBucketInput,
  prepareRankBuckets,
  safeNumber,
} from "./rank-buckets.ts";
import { ProjectionLimit, type ProjectionJob } from "./types.ts";

export interface RankCapacity {
  readonly span: number;
  readonly need: readonly ReadonlyMap<number, number>[];
  pack(w: number, m: number, s: number): number;
  forCell(w: number, m: number, s: number, t: number): (crt: number) => boolean;
  exactForCell(
    w: number,
    m: number,
    s: number,
    t: number,
    crt: number,
  ): (det: number) => boolean;
}
interface Option {
  raw: number;
  q: number;
}
interface Segment {
  low: number;
  high: number;
  q: number;
}
interface HeapEntry {
  end: number;
  q: number;
}
const resources = [4, 2, 5] as const;
const maxCells = 16_000_000;
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

/** Necessary-row relaxation: a shared food and one CRT+DET+DHT raw-sum cap. */
export function prepareRankCapacity(
  job: ProjectionJob,
  check: () => void,
): RankCapacity {
  check();
  let work = 0;
  const tick = () => {
    if ((++work & 4095) === 0) check();
    if (work > 250_000_000)
      throw new ProjectionLimit("Rank capacity work limit");
  };
  const input = prepareBucketInput(job, check);
  const maxCapacity = input.maxCapacity;
  if (maxCapacity > 100_000)
    throw new ProjectionLimit("Rank capacity table range limit");
  if (
    job.axes.length !== 7 ||
    job.axes[3].rawMin !== job.axes[3].rawMax ||
    !job.foods.length
  ) {
    throw new ProjectionLimit(
      "Rank capacity requires seven axes and fixed raw tenacity",
    );
  }
  const names = ["weapon", "main", "det", "ten", "crt", "dht", "gcd"];
  let absoluteBound = 0n;
  const lengths = job.axes.map((axis, a) => {
    if (axis.name !== names[a])
      throw new ProjectionLimit("Rank capacity axis order");
    safeNumber(axis.rawMin);
    safeNumber(axis.rawMax);
    const length = safeNumber(axis.rawMax - axis.rawMin + 1);
    if (length > maxCells)
      throw new ProjectionLimit("Rank capacity axis range limit");
    let bound = 0n,
      previous = -1;
    for (const entry of axis.classes) {
      tick();
      safeNumber(entry.min);
      safeNumber(entry.max);
      if (
        entry.max < entry.min ||
        entry.min <= previous ||
        !Number.isSafeInteger(entry.q)
      ) {
        throw new ProjectionLimit("Rank capacity class domain");
      }
      previous = entry.max;
      const q = BigInt(entry.q),
        absolute = q < 0n ? -q : q;
      if (absolute > bound) bound = absolute;
    }
    absoluteBound += bound;
    return length;
  });
  if (!Number.isSafeInteger(job.rhs) || absoluteBound > maxSafe) {
    throw new ProjectionLimit("Rank capacity coefficient sum range");
  }
  // Include both the capacity envelope and the lazy exact-pair table.
  const cellBound =
    (lengths.reduce((sum, n) => sum + BigInt(n), 0n) +
      2n * BigInt(maxCapacity + 1)) *
    BigInt(job.foods.length);
  if (cellBound > BigInt(maxCells))
    throw new ProjectionLimit("Rank capacity table cell limit");
  const tableCache = new Map<string, Float64Array>();
  const tables = job.foods.map((food) =>
    job.axes.map((axis, a) => {
      const rule = food.bonuses[a];
      if (food.bonuses.length !== 7 || rule === undefined)
        throw new ProjectionLimit("Rank food axis domain");
      const identity = JSON.stringify([a, rule]);
      const cached = tableCache.get(identity);
      if (cached) return cached;
      if (rule !== null) {
        safeNumber(rule.numerator);
        safeNumber(rule.offset);
        safeNumber(rule.cap);
        if (!Number.isSafeInteger(rule.denominator) || rule.denominator < 1)
          throw new ProjectionLimit("Rank food denominator");
      }
      const table = new Float64Array(lengths[a]).fill(-Infinity);
      let c = 0;
      for (let offset = 0; offset < table.length; offset++) {
        tick();
        const raw = axis.rawMin + offset;
        let value = BigInt(raw);
        if (rule !== null) {
          const bonus =
            (value * BigInt(rule.numerator) + BigInt(rule.offset)) /
            BigInt(rule.denominator);
          value += bonus < BigInt(rule.cap) ? bonus : BigInt(rule.cap);
        }
        if (value > maxSafe)
          throw new ProjectionLimit("Rank food final attribute range");
        const final = Number(value);
        while (c < axis.classes.length && axis.classes[c].max < final) c++;
        if (c < axis.classes.length && axis.classes[c].min <= final)
          table[offset] = axis.classes[c].q;
      }
      tableCache.set(identity, table);
      return table;
    }),
  );
  const at = (f: number, a: number, raw: number): number => {
    const axis = job.axes[a];
    return !Number.isSafeInteger(raw) || raw < axis.rawMin || raw > axis.rawMax
      ? -Infinity
      : tables[f][a][raw - axis.rawMin];
  };
  const optionCache = new Map<Float64Array, readonly Option[]>();
  const options = (f: number, a: number): readonly Option[] => {
    const table = tables[f][a],
      cached = optionCache.get(table);
    if (cached) return cached;
    const lowest = new Map<number, number>();
    for (let offset = 0; offset < table.length; offset++) {
      tick();
      const q = table[offset];
      if (q !== -Infinity && !lowest.has(q))
        lowest.set(q, job.axes[a].rawMin + offset);
    }
    const ordered = [...lowest]
      .map(([q, raw]) => ({ q, raw }))
      .sort((a, b) => a.raw - b.raw);
    const result: Option[] = [];
    let best = -Infinity;
    for (const option of ordered) {
      if (option.q <= best) continue;
      best = option.q;
      result.push(option);
    }
    optionCache.set(table, result);
    return result;
  };
  const envelopeCache = new Map<string, Float64Array>();
  const envelopes = job.foods.map((food, f) => {
    check();
    const identity = JSON.stringify(resources.map((a) => food.bonuses[a]));
    const cached = envelopeCache.get(identity);
    if (cached) return cached;
    let previous = new Float64Array(maxCapacity + 1);
    for (const a of resources) {
      const next = new Float64Array(maxCapacity + 1).fill(-Infinity);
      for (const option of options(f, a))
        for (let t = option.raw; t <= maxCapacity; t++) {
          tick();
          const before = previous[t - option.raw];
          if (before !== -Infinity)
            next[t] = Math.max(next[t], before + option.q);
        }
      previous = next;
    }
    envelopeCache.set(identity, previous);
    return previous;
  });
  const fixed = (f: number, w: number, m: number, s: number) =>
    at(f, 3, job.axes[3].rawMin) + at(f, 0, w) + at(f, 1, m) + at(f, 6, s);
  const minimumRequired = (w: number, m: number, s: number): number => {
    tick();
    let best = Infinity;
    for (let f = 0; f < job.foods.length; f++) {
      const q = fixed(f, w, m, s),
        envelope = envelopes[f];
      if (
        q === -Infinity ||
        envelope[maxCapacity] === -Infinity ||
        q + envelope[maxCapacity] < job.rhs
      )
        continue;
      let low = 0,
        high = maxCapacity;
      while (low < high) {
        const mid = low + Math.floor((high - low) / 2);
        if (envelope[mid] !== -Infinity && q + envelope[mid] >= job.rhs)
          high = mid;
        else low = mid + 1;
      }
      best = Math.min(best, low);
    }
    return best;
  };
  const buckets = prepareRankBuckets(
    job,
    input,
    {
      minimumRequired,
      speedCoefficient: (f, s) => at(f, 6, s),
    },
    check,
  );

  // Exact sums require every constant-coefficient interval, including those
  // dominated in the <= capacity envelope. They are prepared only on first use.
  const segmentCache = new Map<Float64Array, readonly Segment[]>();
  const segments = (f: number, a: number): readonly Segment[] => {
    const table = tables[f][a],
      cached = segmentCache.get(table);
    if (cached) return cached;
    const result: Segment[] = [];
    for (let i = 0; i < table.length;) {
      tick();
      const start = i,
        q = table[i++];
      while (i < table.length && table[i] === q) {
        tick();
        i++;
      }
      if (q !== -Infinity)
        result.push({
          low: job.axes[a].rawMin + start,
          high: job.axes[a].rawMin + i - 1,
          q,
        });
    }
    segmentCache.set(table, result);
    return result;
  };
  let pairTables: readonly Float64Array[] | undefined;
  const pairIdentities = job.foods.map((food) =>
    JSON.stringify([food.bonuses[2], food.bonuses[5]]),
  );
  const preparePairs = (): readonly Float64Array[] => {
    if (pairTables) return pairTables;
    check();
    const cache = new Map<string, Float64Array>();
    let intervalPairs = 0;
    pairTables = job.foods.map((_, f) => {
      const identity = pairIdentities[f],
        cached = cache.get(identity);
      if (cached) return cached;
      const starts: HeapEntry[][] = Array.from(
        { length: maxCapacity + 1 },
        () => [],
      );
      for (const d of segments(f, 2))
        for (const h of segments(f, 5)) {
          tick();
          const low = safeNumber(d.low + h.low),
            high = Math.min(maxCapacity, safeNumber(d.high + h.high));
          if (low > maxCapacity) continue;
          if (++intervalPairs > 3_000_000)
            throw new ProjectionLimit("Rank exact pair interval limit");
          starts[low].push({ end: high, q: d.q + h.q });
        }
      const heap: HeapEntry[] = [];
      const insert = (entry: HeapEntry) => {
        let i = heap.length;
        heap.push(entry);
        while (i > 0) {
          const parent = Math.floor((i - 1) / 2);
          if (heap[parent].q >= entry.q) break;
          heap[i] = heap[parent];
          i = parent;
        }
        heap[i] = entry;
      };
      const remove = () => {
        const last = heap.pop()!;
        if (!heap.length) return;
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].q > heap[child].q)
            child++;
          if (heap[child].q <= last.q) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      };
      const table = new Float64Array(maxCapacity + 1).fill(-Infinity);
      for (let t = 0; t <= maxCapacity; t++) {
        tick();
        for (const entry of starts[t]) {
          tick();
          insert(entry);
        }
        while (heap.length && heap[0].end < t) {
          tick();
          remove();
        }
        if (heap.length) table[t] = heap[0].q;
      }
      cache.set(identity, table);
      return table;
    });
    check();
    return pairTables;
  };
  const allowedFoods = (w: number, m: number, s: number, crt?: number) => {
    check();
    const allowed: { f: number; q: number }[] = [],
      seen = new Set<string>();
    for (let f = 0; f < job.foods.length; f++) {
      tick();
      const q = fixed(f, w, m, s) + (crt === undefined ? 0 : at(f, 4, crt));
      if (q === -Infinity) continue;
      const identity = JSON.stringify([
        q,
        crt === undefined ? job.foods[f].bonuses[4] : null,
        pairIdentities[f],
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      allowed.push({ f, q });
    }
    return allowed;
  };
  check();
  return {
    ...buckets,
    forCell(w, m, s, t) {
      const allowed = allowedFoods(w, m, s),
        pairs = preparePairs();
      return (crt) => {
        tick();
        const rest = t - crt;
        if (
          !Number.isSafeInteger(crt) ||
          !Number.isSafeInteger(rest) ||
          rest < 0 ||
          rest > maxCapacity
        )
          return false;
        for (const { f, q } of allowed) {
          const c = at(f, 4, crt),
            pair = pairs[f][rest];
          if (c !== -Infinity && pair !== -Infinity && q + c + pair >= job.rhs)
            return true;
        }
        return false;
      };
    },
    exactForCell(w, m, s, t, crt) {
      const allowed = allowedFoods(w, m, s, crt),
        rest = t - crt;
      return (det) => {
        tick();
        const dht = rest - det;
        if (!Number.isSafeInteger(det) || !Number.isSafeInteger(dht) || dht < 0)
          return false;
        for (const { f, q } of allowed) {
          const d = at(f, 2, det),
            h = at(f, 5, dht);
          if (d !== -Infinity && h !== -Infinity && q + d + h >= job.rhs)
            return true;
        }
        return false;
      };
    },
  };
}
