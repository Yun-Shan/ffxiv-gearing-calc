import { findBestLoadoutExactMip, type ExactMipOptions, type ExactMipResult } from "../loadout-finder-exact-mip.ts";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { shouldUseMainStatResourceSupportForBaselineJob } from "../candidate-resource-support-policy.ts";
import type { JobContext, JointLoadoutV3Options, MutableStatistics } from "./types.ts";
import { canonicalBaselineDamageAttributes, dedupeEquivalentBaselineRingCandidates, pruneInnerSlots } from "./candidate-dominance.ts";
import { factorsForResult, integerDamageProduct } from "./score.ts";
import { minimumTimeLimit } from "./job-options.ts";

/** Complete the independent optima before shared pruning or restricted solving. */
export async function solveBaselines({
  options, contexts, preserveCommonSlotIndexes, objective, mutable,
  assertWithinBudget, remainingTimeLimit, remainingWorkerTimeLimit, timeLimitMs,
  cancellationRequested, baselineConcurrency, usePrimaryResourceSupportBaselinePolicy,
  addMainStatResourceSupportToBaselines,
}: {
  options: JointLoadoutV3Options;
  contexts: readonly JobContext[];
  preserveCommonSlotIndexes: ReadonlyMap<JobContext, ReadonlySet<number>>;
  objective: "damage" | "dps";
  mutable: MutableStatistics;
  assertWithinBudget: (stage: string) => void;
  remainingTimeLimit: () => number | undefined;
  remainingWorkerTimeLimit: () => number;
  timeLimitMs: number | undefined;
  cancellationRequested: () => boolean;
  baselineConcurrency: number;
  usePrimaryResourceSupportBaselinePolicy: boolean;
  addMainStatResourceSupportToBaselines: boolean;
}): Promise<boolean> {
  assertWithinBudget("单职业最优基线");
  const baselineTasks: ExactMipOptions[] = [];
  const canParallelizeBaselines = options.baselineExecutor !== undefined &&
    contexts.every((context) => context.job.options.equipmentAttributeExtractor === undefined);
  const assignBaseline = (context: JobContext, optimum: ExactMipResult | undefined): boolean => {
    assertWithinBudget("单职业最优基线");
    if (optimum === undefined) return false;
    context.optimum = optimum;
    const optimumFactors = factorsForResult(context, optimum);
    context.optimumProduct = integerDamageProduct(optimumFactors);
    context.optimumGcd = optimumFactors.gcdCentiseconds;
    context.active = optimum.damage > 0;
    if (context.optimumProduct <= 0n || context.optimumGcd <= 0) {
      throw new Error(`职业 ${context.job.id} 的伤害基线无效`);
    }
    return true;
  };
  for (const context of contexts) {
    const remainingMs = remainingTimeLimit();
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（单职业最优基线）；未返回近似结果`);
    }
    mutable.innerSolves++;
    mutable.cacheMisses++;
    options.onProgress?.(`V3：正在计算 ${context.job.id} 的单职业最优伤害基线`);
    const onSolverCallback = options.onSolverCallback ?? context.job.options.onSolverCallback;
    // solverSlots 中的非共享槽位已经具有精确的帕累托前沿。
    // 直接复用它，只剪枝共享槽位；这些槽位的身份为联合交集而保留，
    // 但可能已被单职业基线剪掉。
    const commonIndexes = preserveCommonSlotIndexes.get(context)!;
    const preserveBaselineIndexes = new Set(context.solverSlots.flatMap((_, index) =>
      !commonIndexes.has(index) ? [index] : []));
    let baselineSlots = context.solverSlots;
    if (options.factorizedSharedRingPair) {
      baselineSlots = dedupeEquivalentBaselineRingCandidates(context, baselineSlots);
    }
    if (commonIndexes.size > 0) {
      baselineSlots = pruneInnerSlots(context, preserveBaselineIndexes, baselineSlots,
        options.factorizedSharedRingPair
          ? {
              maxDominanceChecks: 2_000_000,
              maxDurationMs: 500,
              ...(canonicalBaselineDamageAttributes(context) === undefined ? {} : {
                dominanceAttributeIndexes: canonicalBaselineDamageAttributes(context)!,
              }),
            }
          : undefined);
    }
    assertWithinBudget("单职业基线候选剪枝");
    const remainingAfterPruningMs = remainingTimeLimit();
    if (remainingAfterPruningMs !== undefined && remainingAfterPruningMs <= 0) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（单职业最优基线）；未返回近似结果`);
    }
    const exactMipTimeLimit = minimumTimeLimit(remainingAfterPruningMs, context.job.options.maxSearchMs);
    const baselineTaskTimeLimit = exactMipTimeLimit ??
      (canParallelizeBaselines ? Number.MAX_SAFE_INTEGER : undefined);
    const baselineOptions = inheritCanonicalEvaluatorCandidateUpperBound(context.job.options, {
      ...context.job.options,
      slots: baselineSlots,
      objective,
      // 为 MCH 保留经测量的支撑约束行；VPR 的基线保持精简，
      // 以减少并行模型的工作量，同时不改变候选集合。
      ...(context.job.id === "MCH" && usePrimaryResourceSupportBaselinePolicy
        ? { primaryResourceSupports: true }
        : {}),
      ...(addMainStatResourceSupportToBaselines && shouldUseMainStatResourceSupportForBaselineJob(
        options.jobs.map(({ id }) => id),
        context.job.id,
        options.commonSlots,
        objective,
        options.foodStrategy,
        options.factorizedSharedRingPair,
      ) ? { mainStatResourceSupport: true } : {}),
      ...(baselineTaskTimeLimit === undefined ? {} : { maxSearchMs: baselineTaskTimeLimit }),
      isCancelled: cancellationRequested,
      onProgress: options.onProgress === undefined
        ? context.job.options.onProgress
        : (message) => options.onProgress?.(`${context.job.id}: ${message}`),
      ...(context.job.options.onSolverProgress === undefined ? {} : {
        onSolverProgress: (event) => context.job.options.onSolverProgress?.({
          ...event,
          model: `${context.job.id}:${event.model}`,
        }),
      }),
      ...(onSolverCallback === undefined ? {} : {
        onSolverCallback: (event) => onSolverCallback({
          ...event,
          model: `${context.job.id}:${event.model}`,
        }),
      }),
    } satisfies ExactMipOptions);
    if (!canParallelizeBaselines) {
      const optimum = await findBestLoadoutExactMip(baselineOptions);
      if (!assignBaseline(context, optimum)) return false;
    } else {
      baselineTasks.push(baselineOptions);
    }
  }
  if (canParallelizeBaselines) {
    const baselineResults = await options.baselineExecutor!(baselineTasks, {
      remainingMs: remainingWorkerTimeLimit,
      isCancelled: cancellationRequested,
      maxConcurrency: Math.min(baselineConcurrency, contexts.length),
    });
    assertWithinBudget("单职业最优基线");
    if (baselineResults === undefined) return false;
    if (baselineResults.length !== contexts.length) {
      throw new Error("并发基线工作线程返回的职业数量不匹配");
    }
    for (let index = 0; index < contexts.length; index++) {
      if (!assignBaseline(contexts[index]!, baselineResults[index])) return false;
    }
  }

  return true;
}
