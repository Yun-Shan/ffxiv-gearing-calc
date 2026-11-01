import type { RankCapacity } from "./rank-capacity.ts";
import {
  refineRankBits,
  type RankBitBudget,
  type RankBitLimits,
  type RankBits,
} from "./rank-bitset.ts";
import { makeRankGraph, prepareRankCodec } from "./rank-graph.ts";
import type { ProjectionJob } from "./types.ts";

/** Necessary-row support only. Other original constraints remain relaxed and
 * the original MIP and result validation retain all completion authority.
 */
export function prepareRankSupport(
  job: ProjectionJob,
  capacity: RankCapacity,
  check: () => void,
  limits?: RankBitLimits,
): {
  has(depth: number, raw: readonly number[]): boolean;
  bytes: number;
  wordWork: number;
} {
  check();
  const codec = prepareRankCodec(job, check);
  const budget: RankBitBudget = { bytes: 0, work: 0 };
  const coarse = refineRankBits(
    makeRankGraph(job, capacity, codec, 1, undefined, check),
    (cell) => capacity.forCell(cell.w, cell.m, cell.s, cell.t),
    check,
    budget,
    limits,
  );
  const support: RankBits = refineRankBits(
    makeRankGraph(job, capacity, codec, 2, coarse, check),
    (cell) => capacity.exactForCell(cell.w, cell.m, cell.s, cell.t, cell.c),
    check,
    budget,
    limits,
  );
  check();
  return {
    bytes: budget.bytes,
    wordWork: budget.work,
    has(depth, raw) {
      const query = codec.query(depth, raw);
      return query !== null && support.has(depth, query.key, query.det);
    },
  };
}
