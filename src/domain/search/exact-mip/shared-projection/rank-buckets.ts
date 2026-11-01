import { ProjectionLimit, type ProjectionJob } from "./types.ts";

interface Move {
  w: number;
  m: number;
  s: number;
  min: number;
  max: number;
}
interface Cell {
  min: number;
  max: number;
}
export interface BucketInput {
  readonly slots: readonly (readonly Move[])[];
  readonly maxCapacity: number;
  readonly maxW: number;
  readonly maxM: number;
  readonly maxS: number;
  readonly coarse: boolean;
}
interface CapacityQuery {
  minimumRequired(w: number, m: number, s: number): number;
  speedCoefficient(food: number, s: number): number;
}

const maxLayer = 650_000;
const maxStates = 1_600_000;
const maxTransitions = 80_000_000;

export function safeNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProjectionLimit("Rank capacity exceeds safe integer range");
  }
  return value;
}

/** Physical choices sharing W/M/S contribute conservative T extrema. */
export function prepareBucketInput(
  job: ProjectionJob,
  check: () => void,
): BucketInput {
  let work = 0;
  const tick = () => {
    if ((++work & 1023) === 0) check();
  };
  check();
  let maxW = 0,
    maxM = 0,
    maxS = 0,
    maxCapacity = 0;
  let lowW = 0n,
    lowM = 0n,
    lowS = 0n,
    highW = 0n,
    highM = 0n,
    highS = 0n;
  let boxes = 1n;
  const slots = job.slots.map((slot) => {
    check();
    const grouped = new Map<string, Move>();
    for (const choice of slot.choices) {
      tick();
      if (choice.values.length !== 7)
        throw new ProjectionLimit("Rank slot coordinate domain");
      for (const value of choice.values) safeNumber(value);
      const [w, m, det, , crt, dht, s] = choice.values;
      const t = safeNumber(det + crt + dht);
      const key = `${w}/${m}/${s}`;
      const before = grouped.get(key);
      if (before) {
        before.min = Math.min(before.min, t);
        before.max = Math.max(before.max, t);
      } else {
        if (grouped.size >= maxLayer)
          throw new ProjectionLimit("Rank slot bucket limit");
        grouped.set(key, { w, m, s, min: t, max: t });
      }
    }
    if (!grouped.size)
      throw new ProjectionLimit("Rank capacity requires nonempty slots");
    let w = 0,
      m = 0,
      s = 0,
      t = 0;
    let lw = Infinity,
      lm = Infinity,
      ls = Infinity;
    for (const move of grouped.values()) {
      tick();
      w = Math.max(w, move.w);
      m = Math.max(m, move.m);
      s = Math.max(s, move.s);
      t = Math.max(t, move.max);
      lw = Math.min(lw, move.w);
      lm = Math.min(lm, move.m);
      ls = Math.min(ls, move.s);
    }
    maxW = safeNumber(maxW + w);
    maxM = safeNumber(maxM + m);
    maxS = safeNumber(maxS + s);
    maxCapacity = safeNumber(maxCapacity + t);
    lowW += BigInt(lw);
    lowM += BigInt(lm);
    lowS += BigInt(ls);
    highW += BigInt(w);
    highM += BigInt(m);
    highS += BigInt(s);
    boxes += (highW - lowW + 1n) * (highM - lowM + 1n) * (highS - lowS + 1n);
    return [...grouped.values()];
  });
  if (!slots.length)
    throw new ProjectionLimit("Rank capacity requires physical slots");
  return {
    slots,
    maxCapacity,
    maxW,
    maxM,
    maxS,
    coarse: boxes > BigInt(maxStates),
  };
}

/** W/M reachability with a relaxed Z=S+T capacity bounds wide W/M/S domains. */
function prepareCoarse(
  job: ProjectionJob,
  input: BucketInput,
  query: CapacityQuery,
  check: () => void,
) {
  interface CoarseMove {
    w: number;
    m: number;
    z: number;
    lo: number;
    hi: number;
    key: number;
  }
  interface CoarseCell {
    z: number;
    lo: number;
    hi: number;
  }
  const stride = safeNumber(input.maxM + 1);
  safeNumber((input.maxW + 1) * stride);
  const pack = (w: number, m: number) => w * stride + m;
  const unpack = (key: number) => {
    const m = key % stride;
    return [(key - m) / stride, m];
  };
  let states = 1,
    transitions = 0,
    queries = 0;
  let work = 0;
  const tick = () => {
    if ((++work & 1023) === 0) check();
  };
  const transition = () => {
    tick();
    if (++transitions > 5_000_000)
      throw new ProjectionLimit("Rank coarse transition limit");
  };
  const queryTick = () => {
    tick();
    if (++queries > 15_000_000)
      throw new ProjectionLimit("Rank coarse query limit");
  };
  const moves = input.slots.map((options) => {
    const grouped = new Map<number, CoarseMove>();
    for (const option of options) {
      tick();
      const key = pack(option.w, option.m),
        z = safeNumber(option.s + option.max);
      const before = grouped.get(key);
      if (before) {
        before.z = Math.max(before.z, z);
        before.lo = Math.min(before.lo, option.s);
        before.hi = Math.max(before.hi, option.s);
      } else {
        if (grouped.size >= 100_000)
          throw new ProjectionLimit("Rank coarse slot limit");
        grouped.set(key, {
          key,
          w: option.w,
          m: option.m,
          z,
          lo: option.s,
          hi: option.s,
        });
      }
    }
    return [...grouped.values()];
  });
  const layers: Map<number, CoarseCell>[] = [
    new Map([[0, { z: 0, lo: 0, hi: 0 }]]),
  ];
  for (let i = 0; i < moves.length; i++) {
    check();
    const next = new Map<number, CoarseCell>();
    for (const [key, cell] of layers[i])
      for (const move of moves[i]) {
        transition();
        const target = key + move.key,
          z = safeNumber(cell.z + move.z);
        const lo = cell.lo + move.lo,
          hi = cell.hi + move.hi;
        const before = next.get(target);
        if (before) {
          before.z = Math.max(before.z, z);
          before.lo = Math.min(before.lo, lo);
          before.hi = Math.max(before.hi, hi);
        } else {
          if (++states > 100_000)
            throw new ProjectionLimit("Rank coarse state limit");
          next.set(target, { z, lo, hi });
        }
      }
    layers.push(next);
  }
  const speed = job.axes[6];
  const runs: { lo: number; hi: number; possible: boolean }[] = [];
  let previous: number[] | undefined;
  for (let s = speed.rawMin; s <= speed.rawMax; s++) {
    const vector = job.foods.map((_, f) => {
      queryTick();
      return query.speedCoefficient(f, s);
    });
    if (!previous || vector.some((q, f) => q !== previous![f])) {
      if (runs.length >= 100_000)
        throw new ProjectionLimit("Rank coarse speed run limit");
      runs.push({
        lo: s,
        hi: s,
        possible: vector.some((q) => q !== -Infinity),
      });
    } else runs[runs.length - 1].hi = s;
    previous = vector;
    if (s === speed.rawMax) break;
  }
  const need: Map<number, number>[] = Array.from(
    { length: moves.length + 1 },
    () => new Map(),
  );
  const terminal = need[moves.length];
  for (const [key, cell] of layers[moves.length]) {
    check();
    const [w, m] = unpack(key),
      lo = Math.max(cell.lo, speed.rawMin),
      hi = Math.min(cell.hi, speed.rawMax);
    if (lo > hi) continue;
    let low = 0,
      high = runs.length;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (runs[mid].hi < lo) low = mid + 1;
      else high = mid;
    }
    let required = Infinity;
    for (let r = low; r < runs.length && runs[r].lo <= hi; r++) {
      queryTick();
      if (!runs[r].possible) continue;
      const s = Math.max(lo, runs[r].lo);
      const t = query.minimumRequired(w, m, s);
      if (t !== Infinity) required = Math.min(required, safeNumber(s + t));
    }
    if (required <= cell.z) terminal.set(key, required);
  }
  for (let i = moves.length - 1; i >= 0; i--) {
    check();
    for (const [key, required] of need[i + 1]) {
      const [w, m] = unpack(key);
      for (const move of moves[i]) {
        transition();
        if (w < move.w || m < move.m) continue;
        const prior = pack(w - move.w, m - move.m),
          cell = layers[i].get(prior);
        const threshold = Math.max(0, required - move.z);
        if (!cell || cell.z < threshold) continue;
        const before = need[i].get(prior);
        if (before === undefined || threshold < before)
          need[i].set(prior, threshold);
      }
    }
  }
  return { need, pack };
}

export function prepareRankBuckets(
  job: ProjectionJob,
  input: BucketInput,
  query: CapacityQuery,
  check: () => void,
) {
  check();
  const speedStride = safeNumber(input.maxS + 1);
  const mainStride = safeNumber((input.maxM + 1) * speedStride);
  safeNumber((input.maxW + 1) * mainStride);
  const pack = (w: number, m: number, s: number) =>
    w * mainStride + m * speedStride + s;
  const unpack = (key: number) => {
    const lower = key % mainStride,
      s = lower % speedStride;
    return [(key - lower) / mainStride, (lower - s) / speedStride, s];
  };
  const coarse = input.coarse
    ? prepareCoarse(job, input, query, check)
    : undefined;
  const layers: Map<number, Cell>[] = [new Map([[0, { min: 0, max: 0 }]])];
  let states = 1,
    transitions = 0,
    work = 0;
  const tick = () => {
    if ((++work & 1023) === 0) check();
  };
  const transition = () => {
    tick();
    if (++transitions > maxTransitions)
      throw new ProjectionLimit("Rank bucket transition limit");
  };
  const moves = input.slots.map((options) =>
    options.map((o) => ({ ...o, key: pack(o.w, o.m, o.s) })),
  );
  for (let i = 0; i < moves.length; i++) {
    check();
    const next = new Map<number, Cell>();
    for (const [key, cell] of layers[i])
      for (const move of moves[i]) {
        transition();
        const target = key + move.key,
          high = cell.max + move.max,
          low = cell.min + move.min;
        if (coarse) {
          const [w, m, s] = unpack(target),
            threshold = coarse.need[i + 1].get(coarse.pack(w, m));
          if (threshold === undefined || safeNumber(high + s) < threshold)
            continue;
        }
        const before = next.get(target);
        if (before) {
          before.min = Math.min(before.min, low);
          before.max = Math.max(before.max, high);
        } else {
          if (next.size >= maxLayer || ++states > maxStates)
            throw new ProjectionLimit("Rank bucket state limit");
          next.set(target, { min: low, max: high });
        }
      }
    layers.push(next);
  }
  const need: Map<number, number>[] = Array.from(
    { length: moves.length + 1 },
    () => new Map(),
  );
  for (const [key, cell] of layers[moves.length]) {
    tick();
    const [w, m, s] = unpack(key),
      required = query.minimumRequired(w, m, s);
    if (required <= cell.max) need[moves.length].set(key, required);
  }
  for (let i = moves.length - 1; i >= 0; i--) {
    check();
    for (const [key, required] of need[i + 1]) {
      const [w, m, s] = unpack(key);
      for (const move of moves[i]) {
        transition();
        if (w < move.w || m < move.m || s < move.s) continue;
        const prior = pack(w - move.w, m - move.m, s - move.s),
          cell = layers[i].get(prior);
        const threshold = Math.max(0, required - move.max);
        if (!cell || cell.max < threshold) continue;
        const before = need[i].get(prior);
        if (before === undefined || threshold < before)
          need[i].set(prior, threshold);
      }
    }
  }
  let span = 0;
  for (let i = 0; i < need.length; i++)
    for (const [key, required] of need[i]) {
      tick();
      const cell = layers[i].get(key)!;
      span = safeNumber(span + cell.max - Math.max(cell.min, required) + 1);
    }
  check();
  return { span, pack, need };
}
