import type { RankCapacity } from "./rank-capacity.ts";
import type { RankBits, RankCell, RankGraph } from "./rank-bitset.ts";
import { ProjectionLimit, type ProjectionJob } from "./types.ts";

type Point = {
  w: number;
  m: number;
  s: number;
  t: number;
  crt: number;
  det: number;
};
type Stage = 1 | 2;
const maxCells = 1_600_000;
const maxSteps = 80_000_000;
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

function natural(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ProjectionLimit("Rank coordinate integer limit");
  return value;
}
function fields(p: Point): number[] {
  return [p.w, p.m, p.s, p.t, p.crt];
}

/** Subtract per-slot minima before mixed-radix packing. Every prefix and move
 * fits the same complete box; addition therefore cannot carry across fields.
 * Each refinement checks only the key extent it actually uses.
 */
export function prepareRankCodec(job: ProjectionJob, check: () => void) {
  const extent = [1, 1, 1, 1, 1],
    origins = [[0, 0, 0, 0, 0]],
    highs = [[0, 0, 0, 0, 0]];
  const ten = [0];
  const slots = job.slots.map((slot, depth) => {
    check();
    if (slot.choices.length === 0 || slot.choices.length > 20_000)
      throw new ProjectionLimit("Rank slot choice limit");
    const low = Array<number>(5).fill(Infinity),
      high = Array<number>(5).fill(0);
    let fixedTen: number | undefined;
    const points = slot.choices.map(({ values }) => {
      if (values.length !== 7)
        throw new ProjectionLimit("Rank contribution dimension");
      values.forEach(natural);
      if (fixedTen !== undefined && fixedTen !== values[3])
        throw new ProjectionLimit("Variable rank tenacity");
      fixedTen = values[3];
      const point: Point = {
        w: values[0],
        m: values[1],
        s: values[6],
        t: natural(values[2] + values[4] + values[5]),
        crt: values[4],
        det: values[2],
      };
      fields(point).forEach((value, axis) => {
        low[axis] = Math.min(low[axis], value);
        high[axis] = Math.max(high[axis], value);
      });
      return point;
    });
    ten.push(natural(ten[depth] + fixedTen!));
    origins.push(
      low.map((value, axis) => natural(origins[depth][axis] + value)),
    );
    highs.push(high.map((value, axis) => natural(highs[depth][axis] + value)));
    extent.forEach((_, axis) => {
      extent[axis] = natural(
        highs[depth + 1][axis] - origins[depth + 1][axis] + 1,
      );
    });
    return { points, low };
  });
  function stageExtent(stage: Stage) {
    let size = 1n;
    for (let axis = 0; axis < stage + 3; axis++) size *= BigInt(extent[axis]);
    if (size > maxSafe)
      throw new ProjectionLimit("Rank refinement key integer limit");
  }
  function encode(
    values: readonly number[],
    origin: readonly number[],
    stage: Stage,
  ): number {
    let key = 0;
    for (let axis = 0; axis < stage + 3; axis++)
      key = key * extent[axis] + (values[axis] - origin[axis]);
    return key;
  }
  return {
    slots,
    stageExtent,
    key(depth: number, values: readonly number[], stage: Stage) {
      return encode(values, origins[depth], stage);
    },
    move(depth: number, point: Point, stage: Stage) {
      return encode(fields(point), slots[depth].low, stage);
    },
    query(depth: number, raw: readonly number[]) {
      if (
        !Number.isInteger(depth) ||
        depth < 0 ||
        depth > slots.length ||
        raw.length !== 7 ||
        raw.some((value) => !Number.isSafeInteger(value) || value < 0) ||
        raw[3] !== ten[depth]
      )
        return null;
      const values = [raw[0], raw[1], raw[6], raw[2] + raw[4] + raw[5], raw[4]];
      if (
        !Number.isSafeInteger(values[3]) ||
        values.some(
          (value, axis) =>
            value < origins[depth][axis] || value > highs[depth][axis],
        )
      )
        return null;
      return { key: encode(values, origins[depth], 2), det: raw[2] };
    },
  };
}

export function makeRankGraph(
  job: ProjectionJob,
  capacity: RankCapacity,
  codec: ReturnType<typeof prepareRankCodec>,
  stage: Stage,
  prior: RankBits | undefined,
  check: () => void,
): RankGraph {
  check();
  codec.stageExtent(stage);
  function cell(
    key: number,
    w: number,
    m: number,
    s: number,
    t: number,
    c: number,
    lo: number,
    hi: number,
  ): RankCell {
    return { key, w, m, s, t, c, lo, hi, offset: 0, words: 0, lastMask: 0 };
  }
  const graph: RankGraph = {
    layers: [
      { cells: [cell(0, 0, 0, 0, 0, 0, 0, 0)], byKey: new Map([[0, 0]]) },
    ],
    moves: [],
  };
  let total = 1,
    steps = 0;
  for (let depth = 0; depth < job.slots.length; depth++) {
    check();
    // Equal numerical transitions can be merged: physical key multiplicities
    // remain in the caller's slot domains and are queried independently.
    const unique = new Map<
      string,
      Point & { keyDelta: number; delta: number }
    >();
    for (const point of codec.slots[depth].points) {
      const keyDelta = codec.move(depth, point, stage),
        delta = stage === 1 ? point.crt : point.det;
      unique.set(`${keyDelta}/${delta}`, { ...point, keyDelta, delta });
    }
    const branch = [...unique.values()];
    graph.moves.push(
      branch.map(({ keyDelta, delta }) => ({ keyDelta, delta })),
    );
    const next = { cells: [] as RankCell[], byKey: new Map<number, number>() };
    const need = capacity.need[depth + 1];
    if (!need) throw new ProjectionLimit("Missing rank capacity layer");
    for (const source of graph.layers[depth].cells) {
      if ((steps & 4095) < branch.length) check();
      steps += branch.length;
      if (steps > maxSteps)
        throw new ProjectionLimit("Rank graph transition work limit");
      for (const point of branch) {
        const key = source.key + point.keyDelta;
        const index = next.byKey.get(key);
        if (index !== undefined) {
          const target = next.cells[index];
          target.lo = Math.min(target.lo, source.lo + point.delta);
          target.hi = Math.max(target.hi, source.hi + point.delta);
          continue;
        }
        const w = source.w + point.w,
          m = source.m + point.m,
          s = source.s + point.s;
        const t = source.t + point.t,
          crt = stage === 2 ? source.c + point.crt : 0;
        const gate = need.get(capacity.pack(w, m, s));
        if (gate === undefined || t < gate) continue;
        if (
          stage === 2 &&
          !prior?.has(depth + 1, codec.key(depth + 1, [w, m, s, t, 0], 1), crt)
        )
          continue;
        if (++total > maxCells)
          throw new ProjectionLimit("Rank graph cell limit");
        next.byKey.set(key, next.cells.length);
        next.cells.push(
          cell(
            key,
            w,
            m,
            s,
            t,
            crt,
            source.lo + point.delta,
            source.hi + point.delta,
          ),
        );
      }
    }
    graph.layers.push(next);
  }
  check();
  return graph;
}
