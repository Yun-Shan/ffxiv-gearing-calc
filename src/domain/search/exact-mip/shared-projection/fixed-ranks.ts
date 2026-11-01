import { prepareRankCapacity, type RankCapacity } from "./rank-capacity.ts";
import { prepareRankSupport } from "./rank-support.ts";
import { qualifyingSignature } from "./factor-signature.ts";
import {
  ProjectionLimit,
  type ProjectionJob,
  type ProjectionModel,
  type ProjectionSlot,
} from "./types.ts";
import type { LinearMipRow } from "../../linear-mip.ts";

export type RankProjection = {
  closed: boolean;
  rows: LinearMipRow[];
  ranks: number;
  combinations: number;
  firstJob: number;
  pilots: number;
};

const zero = () => [0, 0, 0, 0, 0, 0, 0];
function addVector(a: readonly number[], b: readonly number[]): number[] {
  // The source model verifies finite nonnegative coordinate sums over all slots.
  return a.map((v, i) => v + b[i]!);
}

function restrictedJob(
  job: ProjectionJob,
  slots: ProjectionSlot[],
): ProjectionJob {
  const axes = job.axes.map((a, i) => {
    let rawMin = 0,
      rawMax = 0;
    for (const slot of slots) {
      let lo = Infinity,
        hi = -Infinity;
      for (const { values } of slot.choices) {
        lo = Math.min(lo, values[i]!);
        hi = Math.max(hi, values[i]!);
      }
      rawMin += lo;
      rawMax += hi;
    }
    return { ...a, rawMin, rawMax };
  });
  return { ...job, slots, axes };
}

function chooseFirst(jobs: readonly ProjectionJob[], check: () => void) {
  const order = jobs
    .map((job, index) => ({
      index,
      size: job.slots.reduce((n, s) => n * BigInt(s.choices.length), 1n),
    }))
    .sort((a, b) =>
      a.size < b.size ? -1 : a.size > b.size ? 1 : a.index - b.index,
    );
  let best: { index: number; capacity: RankCapacity } | undefined;
  let pilots = 0;
  for (const { index } of order) {
    check();
    let capacity;
    try {
      capacity = prepareRankCapacity(jobs[index]!, check);
    } catch (error) {
      // The same job may be cheap once earlier jobs have restricted its shared choices.
      if (!(error instanceof ProjectionLimit)) throw error;
      check();
      continue;
    }
    pilots++;
    if (!best || capacity.span < best.capacity.span) best = { index, capacity };
    if (best.capacity.span <= 2_097_152) break;
  }
  if (!best) throw new ProjectionLimit("共享容量试算超过预算");
  return {
    order: [
      best.index,
      ...order.map((j) => j.index).filter((i) => i !== best.index),
    ],
    capacity: best.capacity,
    pilots,
  };
}

function allProductsExcluded(
  ranks: ReadonlyMap<number, Map<string, string[]>[]>,
  restrictions: readonly LinearMipRow[],
  check: () => void,
) {
  let combinations = 0;
  let work = 0;
  for (const jobs of ranks.values()) {
    check();
    const volume = jobs.reduce((v, job) => v * BigInt(job.size), 1n);
    if (volume + BigInt(combinations) > 20_000n)
      return { closed: false, combinations };
    const selected: string[] = [];
    function excluded(index: number): boolean {
      if (index === jobs.length) {
        if ((++combinations & 63) === 0) check();
        return restrictions.some((row) => {
          let lhs = 0n;
          for (const name of selected) {
            if ((++work & 1023) === 0) check();
            lhs += BigInt(row.terms.get(name) ?? 0);
          }
          const rhs = BigInt(row.rhs);
          return row.sense === ">="
            ? lhs < rhs
            : row.sense === "<="
              ? lhs > rhs
              : lhs !== rhs;
        });
      }
      for (const signature of jobs[index]!.values()) {
        selected.push(...signature);
        const rejected = excluded(index + 1);
        selected.length -= signature.length;
        if (!rejected) return false;
      }
      return true;
    }
    if (!excluded(0)) return { closed: false, combinations };
  }
  return { closed: true, combinations };
}

/**
 * Each physical shared tuple has one common rank. Local support is a relaxation:
 * food and private choices may differ by job, but every feasible joint tuple
 * contributes its original selectors to the Cartesian product at its own rank.
 */
export function projectFixedRanks(
  model: ProjectionModel,
  restrictions: readonly LinearMipRow[],
  check: () => void,
): RankProjection {
  const { jobs, blocks } = model;
  const sizes = blocks.map((b) => b.keys.length);
  if (
    sizes.some((n) => !n) ||
    sizes.reduce((p, n) => p * BigInt(n), 1n) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ProjectionLimit("共享物理排名超出精确整数范围");
  const selectorNames = new Set(
    jobs.flatMap((j) =>
      j.axes.flatMap((a) => a.classes.map((c) => c.selector)),
    ),
  );
  const factorRows = restrictions.filter((row) =>
    [...row.terms].every(([v, c]) => c === 0 || selectorNames.has(v)),
  );
  const plan = chooseFirst(jobs, check);
  const decode = (rank: number) => {
    const indexes = Array<number>(sizes.length);
    for (let i = sizes.length - 1; i >= 0; i--) {
      const remainder = rank % sizes[i]!;
      indexes[i] = remainder;
      rank = (rank - remainder) / sizes[i]!;
    }
    return indexes;
  };
  const aggregate = (job: ProjectionJob, rank: number) =>
    decode(rank).reduce(
      (v, k, s) => addVector(v, job.slots[s]!.choices[k]!.values),
      zero(),
    );
  let visits = 0;
  const sharedVisit = () => {
    if (++visits > 2_000_000) throw new ProjectionLimit("共享排名访问超过预算");
    if ((visits & 1023) === 0) check();
  };
  let ranks: number[] | undefined;
  let bytes = 384 * 1024 ** 2,
    wordWork = 500_000_000;
  const views: {
    index: number;
    job: ProjectionJob;
    sharedDepth: number;
    support: ReturnType<typeof prepareRankSupport>;
  }[] = [];
  for (const index of plan.order) {
    check();
    const original = jobs[index]!;
    const compressed = ranks !== undefined && ranks.length <= 128;
    const job = compressed
      ? restrictedJob(original, [
          {
            name: "shared",
            choices: ranks!.map((rank) => ({
              key: String(rank),
              values: aggregate(original, rank),
            })),
          },
          ...original.slots.slice(sizes.length),
        ])
      : original;
    const sharedDepth = compressed ? 1 : sizes.length;
    const capacity =
      index === plan.order[0] ? plan.capacity : prepareRankCapacity(job, check);
    const support = prepareRankSupport(job, capacity, check, {
      bytes,
      wordWork,
    });
    bytes -= support.bytes;
    wordWork -= support.wordWork;
    views.push({ index, job, sharedDepth, support });
    if (ranks === undefined) {
      const retained: number[] = [];
      const visit = (depth: number, rank: number, raw: readonly number[]) => {
        if (depth === sharedDepth) {
          if (retained.length >= 200_000)
            throw new ProjectionLimit("共享排名输出超过预算");
          retained.push(rank);
          return;
        }
        for (const [i, choice] of job.slots[depth]!.choices.entries()) {
          sharedVisit();
          const next = addVector(raw, choice.values);
          if (support.has(depth + 1, next))
            visit(depth + 1, rank * sizes[depth]! + i, next);
        }
      };
      if (support.has(0, zero())) visit(0, 0, zero());
      ranks = retained;
    } else {
      ranks = ranks.filter((rank) => {
        sharedVisit();
        return support.has(sharedDepth, aggregate(original, rank));
      });
    }
    if (!ranks.length) break;
  }
  if (!ranks) throw new Error("共享排名缺少职业");
  const rows: LinearMipRow[] = [];
  const result = {
    rows,
    ranks: ranks.length,
    firstJob: plan.order[0]!,
    pilots: plan.pilots,
  };
  if (!ranks.length) return { ...result, closed: true, combinations: 0 };
  function addZeros(
    name: string,
    variables: Iterable<string>,
    kept: ReadonlySet<string>,
  ) {
    const terms = new Map<string, number>();
    for (const v of variables) if (!kept.has(v)) terms.set(v, 1);
    if (terms.size) rows.push({ name, terms, sense: "<=", rhs: 0 });
  }
  const shared = new Set<string>();
  for (const rank of ranks) {
    sharedVisit();
    decode(rank).forEach((k, s) =>
      blocks[s]!.keys[k]!.selectors.forEach((v) => shared.add(v)),
    );
  }
  blocks.forEach((b, i) =>
    addZeros(
      `rank_shared_${i}`,
      b.keys.flatMap((k) => k.selectors),
      shared,
    ),
  );
  const sharedRowCount = rows.length;
  const signatures = new Map<number, Map<string, string[]>[]>();
  let visitsPrivate = 0,
    leaves = 0,
    collect = ranks.length <= 128;
  function privateVisit() {
    if (++visitsPrivate > 2_000_000)
      throw new ProjectionLimit("私有候选支撑访问超过预算");
    if ((visitsPrivate & 255) === 0) check();
  }
  try {
    for (const { index, job, sharedDepth, support } of views) {
      const kept = new Set<string>();
      const selected: string[] = [];
      const visit = (rank: number, depth: number, raw: readonly number[]) => {
        privateVisit();
        if (depth === job.slots.length) {
          for (const [f, food] of job.foods.entries()) {
            privateVisit();
            const signature = qualifyingSignature(job, raw, f);
            if (!signature) continue;
            kept.add(food.key);
            selected.forEach((key) => kept.add(key));
            if (++leaves > 12_000) collect = false;
            if (collect) {
              let alternatives = signatures.get(rank);
              if (!alternatives)
                signatures.set(
                  rank,
                  (alternatives = jobs.map(() => new Map())),
                );
              alternatives[index]!.set(JSON.stringify(signature), signature);
            }
          }
          return;
        }
        for (const choice of job.slots[depth]!.choices) {
          privateVisit();
          const next = addVector(raw, choice.values);
          if (!support.has(depth + 1, next)) continue;
          selected.push(choice.key);
          visit(rank, depth + 1, next);
          selected.pop();
        }
      };
      for (const rank of ranks)
        visit(rank, sharedDepth, aggregate(jobs[index]!, rank));
      job.slots.slice(sharedDepth).forEach((s, i) =>
        addZeros(
          `rank_private_${index}_${i}`,
          s.choices.map((c) => c.key),
          kept,
        ),
      );
      addZeros(
        `rank_food_${index}`,
        job.foods.map((f) => f.key),
        kept,
      );
    }
  } catch (error) {
    if (!(error instanceof ProjectionLimit)) throw error;
    check();
    return {
      ...result,
      rows: rows.slice(0, sharedRowCount),
      closed: false,
      combinations: 0,
    };
  }
  check();
  if (!collect || signatures.size !== ranks.length)
    return { ...result, closed: false, combinations: 0 };
  return { ...result, ...allProductsExcluded(signatures, factorRows, check) };
}
