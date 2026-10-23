import { findBestLoadoutExactMip, type ExactMipOptions, type ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { SharedSlotProjection } from "../types.ts";
import { throwIfCancelled } from "../cancellation.ts";
import type { CommonChoice, FoodChoice, JobContext, JointLoadoutV3Options, MutableStatistics, Rational } from "./types.ts";
import { commonSlotIdentity } from "./shared-equipment.ts";
import { foodIdentityForOptional } from "./shared-foods.ts";
import { makeJobOptions } from "./job-options.ts";

/** Own the restricted-result cache and the serial/worker refinement lifecycle. */
export function createRestrictedSearch({
  options, contexts, commonSlotProjections, objective, mutable, cacheLimit,
  assertWithinBudget, remainingTimeLimit, remainingWorkerTimeLimit, timeLimitMs,
  cancellationRequested, baselineConcurrency, exactScore, updateBest, isAtProvenCeiling,
}: {
  options: JointLoadoutV3Options;
  contexts: readonly JobContext[];
  commonSlotProjections: ReadonlyMap<string, SharedSlotProjection>;
  objective: "damage" | "dps";
  mutable: MutableStatistics;
  cacheLimit: number;
  assertWithinBudget: (stage: string) => void;
  remainingTimeLimit: () => number | undefined;
  remainingWorkerTimeLimit: () => number;
  timeLimitMs: number | undefined;
  cancellationRequested: () => boolean;
  baselineConcurrency: number;
  exactScore: (results: readonly ExactMipResult[]) => Rational;
  updateBest: (score: Rational, results: readonly ExactMipResult[]) => void;
  isAtProvenCeiling: () => boolean;
}) {
  const cache = new Map<string, ExactMipResult | null>();
  const nodeCacheKey = (
    context: JobContext,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
  ) => {
    const foodKey = foodChoice?.key ?? "independent-food";
    const fixedKey = [...fixed]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, choice]) => `${name}=${choice.key}`)
      .join(";");
    return `${context.job.id}|${foodKey}|${fixedKey}`;
  };

  const rememberNode = (key: string, result: ExactMipResult | null): void => {
    if (cacheLimit === 0) return;
    cache.set(key, result);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
    mutable.cacheEntries = cache.size;
  };

  const makeRestrictedMipOptions = (
    context: JobContext,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
  ): ExactMipOptions => {
    assertWithinBudget("受限单职业求解");
    const remainingMs = remainingTimeLimit();
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（受限单职业求解）；未返回近似结果`);
    }
    const mipOptions = makeJobOptions(
      context,
      fixed,
      commonSlotProjections,
      foodChoice,
      remainingMs ?? (options.baselineExecutor === undefined ? undefined : Number.MAX_SAFE_INTEGER),
      objective,
      cancellationRequested,
    );
    if (options.jobs.length === 2) {
      // 每个槽位只加一条隐含的资源阈值约束，可缩小受限双职业模型，
      // 同时保留相同的候选集合和精确证明义务。
      mipOptions.candidateResourceSupportProfile = "compact";
    }
    if (options.onProgress !== undefined) {
      mipOptions.onProgress = (message) => options.onProgress?.(`${context.job.id}: ${message}`);
    }
    if (context.job.options.onSolverProgress !== undefined) {
      mipOptions.onSolverProgress = (event) => context.job.options.onSolverProgress?.({
        ...event,
        model: `${context.job.id}:${event.model}`,
      });
    }
    const onSolverCallback = options.onSolverCallback ?? context.job.options.onSolverCallback;
    if (onSolverCallback !== undefined) {
      mipOptions.onSolverCallback = (event) => onSolverCallback({
        ...event,
        model: `${context.job.id}:${event.model}`,
      });
    }
    return mipOptions;
  };

  const resultForNode = async (
    context: JobContext,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
    parentResult: ExactMipResult | undefined,
  ): Promise<ExactMipResult | undefined> => {
    const key = nodeCacheKey(context, fixed, foodChoice);
    const cached = cache.get(key);
    if (cached !== undefined || cache.has(key)) {
      mutable.cacheHits++;
      cache.delete(key);
      cache.set(key, cached ?? null);
      return cached ?? undefined;
    }

    if (parentResult !== undefined) {
      const satisfiesFixed = [...fixed].every(([name, choice]) =>
        commonSlotIdentity(context, parentResult.selection, name, commonSlotProjections) === choice.key);
      const chosenFood = foodChoice?.foods.get(context.job.id);
      const satisfiesFood = foodChoice === undefined ||
        foodIdentityForOptional(parentResult.food) === foodIdentityForOptional(chosenFood);
      if (satisfiesFixed && satisfiesFood) {
        mutable.parentResultReuses++;
        rememberNode(key, parentResult);
        return parentResult;
      }
    }

    for (const [name, choice] of fixed) {
      if (commonSlotIdentity(context, context.optimum.selection, name, commonSlotProjections) !== choice.key) {
        return solveAndRemember();
      }
    }
    if (foodChoice !== undefined) {
      const chosenFood = foodChoice.foods.get(context.job.id);
      if (foodIdentityForOptional(context.optimum.food) !== foodIdentityForOptional(chosenFood)) return solveAndRemember();
    }
    rememberNode(key, context.optimum);
    return context.optimum;

    async function solveAndRemember(): Promise<ExactMipResult | undefined> {
      const mipOptions = makeRestrictedMipOptions(context, fixed, foodChoice);
      mutable.innerSolves++;
      mutable.cacheMisses++;
      const result = await findBestLoadoutExactMip(mipOptions);
      assertWithinBudget("受限单职业求解");
      rememberNode(key, result ?? null);
      return result;
    }
  };

  type SeedRefinementRequest = {
    initialResults: readonly (ExactMipResult | undefined)[] | undefined;
    fixed: ReadonlyMap<string, CommonChoice>;
    foodChoice: FoodChoice | undefined;
    jobIndexes: readonly number[];
    parentResults?: readonly (ExactMipResult | undefined)[];
  };
  const refineSeedCandidates = async (
    requests: readonly SeedRefinementRequest[],
  ): Promise<(ExactMipResult | undefined)[][]> => {
    const resultsByRequest = requests.map(({ initialResults }) => initialResults === undefined
      ? new Array<ExactMipResult | undefined>(contexts.length).fill(undefined)
      : [...initialResults]);
    const pending: {
      requestIndex: number;
      index: number;
      key: string;
      task: ExactMipOptions;
      estimateMs: number;
    }[] = [];
    const remainingTasksByRequest = requests.map(() => 0);
    const completedTaskIndexes = new Set<number>();
    const recordCompletedTask = (taskIndex: number) => {
      if (completedTaskIndexes.has(taskIndex)) return;
      completedTaskIndexes.add(taskIndex);
      mutable.innerSolves++;
      mutable.cacheMisses++;
    };
    for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
      const request = requests[requestIndex]!;
      const results = resultsByRequest[requestIndex]!;
      for (const index of request.jobIndexes) {
        const context = contexts[index]!;
        const key = nodeCacheKey(context, request.fixed, request.foodChoice);
        const cached = cache.get(key);
        if (cached !== undefined || cache.has(key)) {
          mutable.cacheHits++;
          cache.delete(key);
          cache.set(key, cached ?? null);
          results[index] = cached ?? undefined;
          continue;
        }
        const parentResult = request.parentResults?.[index];
        if (parentResult !== undefined) {
          const satisfiesFixed = [...request.fixed].every(([name, choice]) =>
            commonSlotIdentity(context, parentResult.selection, name, commonSlotProjections) === choice.key);
          const chosenFood = request.foodChoice?.foods.get(context.job.id);
          const satisfiesFood = request.foodChoice === undefined ||
            foodIdentityForOptional(parentResult.food) === foodIdentityForOptional(chosenFood);
          if (satisfiesFixed && satisfiesFood) {
            mutable.parentResultReuses++;
            rememberNode(key, parentResult);
            results[index] = parentResult;
            continue;
          }
        }
        const satisfiesFixed = [...request.fixed].every(([name, choice]) =>
          commonSlotIdentity(context, context.optimum.selection, name, commonSlotProjections) === choice.key);
        const chosenFood = request.foodChoice?.foods.get(context.job.id);
        const satisfiesFood = request.foodChoice === undefined ||
          foodIdentityForOptional(context.optimum.food) === foodIdentityForOptional(chosenFood);
        if (satisfiesFixed && satisfiesFood) {
          rememberNode(key, context.optimum);
          results[index] = context.optimum;
          continue;
        }
        if (options.baselineExecutor === undefined) {
          const result = await resultForNode(context, request.fixed, request.foodChoice, parentResult);
          results[index] = result;
          continue;
        }
        pending.push({
          requestIndex,
          index,
          key,
          task: makeRestrictedMipOptions(context, request.fixed, request.foodChoice),
          estimateMs: context.optimum.statistics.elapsedMs,
        });
        remainingTasksByRequest[requestIndex] = remainingTasksByRequest[requestIndex]! + 1;
      }
    }
    if (pending.length === 0) return resultsByRequest;

    const scoreCompletedRequest = (requestIndex: number) => {
      if (remainingTasksByRequest[requestIndex] !== 0) return;
      if (requests[requestIndex]!.fixed.size !== options.commonSlots.length) return;
      const results = resultsByRequest[requestIndex]!;
      if (results.every((result): result is ExactMipResult => result !== undefined)) {
        updateBest(exactScore(results), results);
      }
    };

    for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
      scoreCompletedRequest(requestIndex);
    }
    if (isAtProvenCeiling()) return resultsByRequest;

    // 将种子分组，使每批先同时启动同一装备分配下的独立职业任务；
    // 每个种子内部则优先启动历史上耗时较长的职业。
    pending.sort((left, right) => left.requestIndex - right.requestIndex ||
      right.estimateMs - left.estimateMs || left.index - right.index);
    const solved = await options.baselineExecutor!(pending.map((entry) => entry.task), {
      remainingMs: remainingWorkerTimeLimit,
      isCancelled: cancellationRequested,
      maxConcurrency: Math.min(baselineConcurrency, contexts.length),
      onTaskComplete: (taskIndex, result) => {
        const entry = pending[taskIndex];
        if (entry === undefined) throw new Error("并发受限单职业工作线程返回了未知任务索引");
        if (completedTaskIndexes.has(taskIndex)) throw new Error("并发受限单职业工作线程重复完成任务");
        recordCompletedTask(taskIndex);
        rememberNode(entry.key, result ?? null);
        resultsByRequest[entry.requestIndex]![entry.index] = result;
        remainingTasksByRequest[entry.requestIndex] = remainingTasksByRequest[entry.requestIndex]! - 1;
        scoreCompletedRequest(entry.requestIndex);
        return isAtProvenCeiling();
      },
    });
    if (isAtProvenCeiling()) throwIfCancelled(cancellationRequested);
    else assertWithinBudget("并发受限单职业求解");
    if (solved === undefined || solved.length !== pending.length) {
      throw new Error("并发受限单职业工作线程未返回完整结果集");
    }
    for (let taskIndex = 0; taskIndex < pending.length; taskIndex++) {
      if (completedTaskIndexes.has(taskIndex)) continue;
      if (isAtProvenCeiling()) continue;
      const entry = pending[taskIndex]!;
      const result = solved[taskIndex];
      // 注入的执行器可能不实现完成回调；生产工作线程会在结果到达时立即上报，
      // 这样一旦证明达到上限，就能停止其他种子，而不必等待其余求解结束。
      rememberNode(entry.key, result ?? null);
      resultsByRequest[entry.requestIndex]![entry.index] = result;
      remainingTasksByRequest[entry.requestIndex] = remainingTasksByRequest[entry.requestIndex]! - 1;
      recordCompletedTask(taskIndex);
      scoreCompletedRequest(entry.requestIndex);
    }
    return resultsByRequest;
  };
  const refineSeedJobs = async (
    initialResults: readonly (ExactMipResult | undefined)[] | undefined,
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
    jobIndexes: readonly number[],
    parentResults?: readonly (ExactMipResult | undefined)[],
  ): Promise<(ExactMipResult | undefined)[]> => {
    const [results] = await refineSeedCandidates([{
      initialResults,
      fixed,
      foodChoice,
      jobIndexes,
      ...(parentResults === undefined ? {} : { parentResults }),
    }]);
    return results!;
  };

  return { cache, refineSeedCandidates, refineSeedJobs };
}
