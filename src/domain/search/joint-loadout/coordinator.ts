import { findBestJointFactorMip, type ExactMipResult } from "../loadout-finder-exact-mip.ts";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { hasSharedAccessoryPairDominancePath, markSharedAccessoryPairDominancePath } from "../shared-accessory-pair-dominance-policy.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import { getMemoryUsageSnapshot } from "../memory-usage.ts";
import { throwIfCancelled } from "../cancellation.ts";
import type { HighsCallbackTrace, LinearMipProgress } from "../linear-mip.ts";
import { baselineWorkerLimit } from "../baseline-worker-policy.ts";
import {
  candidateResourceSupportProfile as chooseCandidateResourceSupportProfile,
  shouldUseMainStatResourceSupportForBaseline,
  shouldUsePrimaryResourceSupportsForBaseline,
  shouldUseSharedMateriaCompensation,
} from "../candidate-resource-support-policy.ts";
import type { CommonChoice, FoodChoice, JobContext, JointLoadoutJobResultV3, JointLoadoutV3Options, JointLoadoutV3Result, MutableStatistics, Rational } from "./types.ts";
import { commonSlotIdentity, commonSlotIndex, equipmentForCommonSlot, projectEquipment } from "./shared-equipment.ts";
import { compareRational, createExactScorer, factorsForResult, integerDamageProduct, rational } from "./score.ts";
import { pruneCommonChoices, pruneCommonRingChoices } from "./candidate-dominance.ts";
import { foodIdentity, foodIdentityForOptional, pruneSharedFoods } from "./shared-foods.ts";
import { makeJobOptions } from "./job-options.ts";
import { statisticsSnapshot } from "./statistics.ts";
import { prepareCandidates } from "./candidate-preparation.ts";
import { solveBaselines } from "./baselines.ts";
import { createRestrictedSearch } from "./restricted-search.ts";
import { createSeedResults } from "./warm-start.ts";

const MAX_ACCEPTANCE_SEARCH_MS = 235_000;

const RSS_LIMIT_BYTES = 3.5 * 1024 * 1024 * 1024;

/** 对给定的各职业候选执行精确联合搜索；超时时抛出错误，不返回未经证明的部分结果。 */
export async function findBestJointLoadoutV3(
  options: JointLoadoutV3Options,
): Promise<JointLoadoutV3Result | undefined> {
  const inputCandidateCount = options.jobs.reduce((total, job) => total +
    job.options.slots.reduce((slotTotal, slot) => slotTotal + slot.length, 0), 0);
  const candidateSupportProfile = chooseCandidateResourceSupportProfile(options.jobs.length, inputCandidateCount);
  const sharedAccessoryPairDominanceTrusted = hasSharedAccessoryPairDominancePath(options);
  // V3 领域自行持有职业包装对象，以便精确剪枝能释放完整候选数组，
  // 同时不修改调用方提供的对象。
  const ownedOptions: JointLoadoutV3Options = {
    ...options,
    jobs: options.jobs.map((job) => ({
      ...job,
      options: inheritCanonicalEvaluatorCandidateUpperBound(job.options, {
        ...job.options,
        candidateResourceSupportProfile: job.options.candidateResourceSupportProfile ?? candidateSupportProfile,
      }),
    })),
  };
  options = sharedAccessoryPairDominanceTrusted
    ? markSharedAccessoryPairDominancePath(ownedOptions)
    : ownedOptions;
  const startedAt = performance.now();
  const requestedMs = options.maxSearchMs;
  if (requestedMs !== undefined && (!Number.isFinite(requestedMs) || requestedMs <= 0)) {
    throw new RangeError("V3 maxSearchMs 必须是正有限数");
  }
  const timeLimitMs = requestedMs === undefined
    ? undefined
    : requestedMs === Number.MAX_SAFE_INTEGER
      ? requestedMs
      : Math.min(requestedMs, MAX_ACCEPTANCE_SEARCH_MS);
  const deadline = timeLimitMs === undefined ? Number.POSITIVE_INFINITY : startedAt + timeLimitMs;
  const remainingTimeLimit = () =>
    timeLimitMs === undefined ? undefined : Math.floor(deadline - performance.now());
  const remainingWorkerTimeLimit = () => remainingTimeLimit() ?? Number.MAX_SAFE_INTEGER;
  const objective = options.objective ?? "damage";
  if (objective !== "damage" && objective !== "dps") {
    throw new RangeError("V3 objective 必须是 damage 或 dps");
  }
  const usePrimaryResourceSupportBaselinePolicy = shouldUsePrimaryResourceSupportsForBaseline(
    options.jobs.map(({ id, options: jobOptions }) => ({
      jobId: id,
      candidateItemLevelRanges: jobOptions.candidateItemLevelRanges,
    })),
    options.commonSlots,
    objective,
    options.foodStrategy,
  );
  const addMainStatResourceSupportToBaselines = shouldUseMainStatResourceSupportForBaseline(
    options.jobs.map(({ id }) => id),
    options.commonSlots,
    objective,
    options.foodStrategy,
    options.factorizedSharedRingPair,
  ) && !usePrimaryResourceSupportBaselinePolicy;
  const enableSharedMateriaCompensation = shouldUseSharedMateriaCompensation(
    options.jobs.map(({ id }) => id),
    options.commonSlots,
    objective,
    options.foodStrategy,
    options.factorizedSharedRingPair,
  );
  if (options.foodStrategy !== "shared" && options.foodStrategy !== "independent") {
    throw new RangeError("V3 foodStrategy 必须是 shared 或 independent");
  }
  const cacheLimit = options.cacheLimit ?? 2048;
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 0 || cacheLimit > 50_000) {
    throw new RangeError("V3 cacheLimit 必须是 0 到 50000 之间的整数");
  }
  if (options.jobs.length === 0) throw new RangeError("V3 至少需要一个职业");
  const baselineConcurrency = baselineWorkerLimit(options.jobs.length, inputCandidateCount);
  const cancellationRequested = () => options.isCancelled?.() === true ||
    options.jobs.some((job) => job.options.isCancelled?.() === true);

  const mutable: MutableStatistics = {
    outerNodes: 0,
    completeNodes: 0,
    upperBoundPrunes: 0,
    relaxedOptimaAttained: 0,
    innerSolves: 0,
    parentResultReuses: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEntries: 0,
  };
  const assertWithinBudget = (stage: string) => {
    throwIfCancelled(cancellationRequested);
    if (timeLimitMs !== undefined && performance.now() >= deadline) {
      throw new Error(`V3 搜索超过 ${timeLimitMs}ms，未完成最优性证明（${stage}）；未返回近似结果`);
    }
    const memory = getMemoryUsageSnapshot();
    if (memory.rssBytes !== undefined && memory.rssBytes > RSS_LIMIT_BYTES) {
      throw new Error(`V3 RSS 达到 3.5 GiB 限制（${stage}）；未返回近似结果`);
    }
  };

  const prepared = prepareCandidates(options, assertWithinBudget);
  if (prepared === undefined) return undefined;
  const { contexts, commonSlotProjections, preserveCommonSlotIndexes, commonChoicesByName, foodChoices } = prepared;

  if (!await solveBaselines({
    options, contexts, preserveCommonSlotIndexes, objective, mutable,
    assertWithinBudget, remainingTimeLimit, remainingWorkerTimeLimit, timeLimitMs,
    cancellationRequested, baselineConcurrency, usePrimaryResourceSupportBaselinePolicy,
    addMainStatResourceSupportToBaselines,
  })) return undefined;

  if (options.factorizedSharedRingPair) {
    const ringChoices = commonChoicesByName.get("ring");
    const ring2Choices = commonChoicesByName.get("ring2");
    if (ringChoices !== undefined && ring2Choices !== undefined) {
      const prunedRingChoices = pruneCommonRingChoices(
        ringChoices,
        ring2Choices,
        contexts,
        () => assertWithinBudget("共享戒指 Pareto 剪枝"),
      );
      const prunedRing2Choices = pruneCommonRingChoices(
        ring2Choices,
        ringChoices,
        contexts,
        () => assertWithinBudget("共享戒指 Pareto 剪枝"),
      );
      commonChoicesByName.set("ring", prunedRingChoices);
      commonChoicesByName.set("ring2", prunedRing2Choices);
      const candidateCountBefore = ringChoices.length + ring2Choices.length;
      const candidateCountAfter = prunedRingChoices.length + prunedRing2Choices.length;
      if (candidateCountAfter < candidateCountBefore) {
        options.onProgress?.(
          `V3：共享戒指 Pareto 剪枝 ${candidateCountBefore}→${candidateCountAfter} 个槽位候选`,
        );
      }
    }
  }
  for (const [name, choices] of commonChoicesByName) {
    if (options.factorizedSharedRingPair && (name === "ring" || name === "ring2")) continue;
    commonChoicesByName.set(name, pruneCommonChoices(
      name,
      choices,
      contexts,
      commonSlotProjections,
      () => assertWithinBudget("通用装备等价剪枝"),
    ));
  }
  if (options.foodStrategy === "shared") {
    foodChoices.splice(0, foodChoices.length, ...pruneSharedFoods(
      foodChoices,
      contexts,
      () => assertWithinBudget("通用食物等价剪枝"),
    ));
    const matchingBaselineCount = (choice: FoodChoice) => contexts.reduce((count, context) =>
      count + Number(choice.key === foodIdentityForOptional(context.optimum.food)), 0);
    foodChoices.sort((left, right) => matchingBaselineCount(right) - matchingBaselineCount(left));
  }

  const slotOrder = [...options.commonSlots].sort((left, right) =>
    commonChoicesByName.get(left)!.length - commonChoicesByName.get(right)!.length ||
    options.commonSlots.indexOf(left) - options.commonSlots.indexOf(right));
  const slotOrderIndex = new Map(slotOrder.map((name, index) => [name, index]));
  for (const name of options.commonSlots) {
    const choices = commonChoicesByName.get(name)!;
    const baselineKeys = contexts.map((context) => commonSlotIdentity(
      context, context.optimum.selection, name, commonSlotProjections,
    ));
    choices.sort((left, right) => {
      const leftMatches = baselineKeys.reduce((count, key) => count + Number(left.key === key), 0);
      const rightMatches = baselineKeys.reduce((count, key) => count + Number(right.key === key), 0);
      return rightMatches - leftMatches;
    });
  }

  let best: {
    score: Rational;
    commonEquipments: Record<string, EquipInfo>;
    jobResults: Record<string, ExactMipResult>;
  } | undefined;
  let stopAtProvenCeiling = false;

  const { cache, refineSeedCandidates, refineSeedJobs } = createRestrictedSearch({
    options, contexts, commonSlotProjections, objective, mutable, cacheLimit,
    assertWithinBudget, remainingTimeLimit, remainingWorkerTimeLimit, timeLimitMs,
    cancellationRequested, baselineConcurrency,
    exactScore: (results) => exactScore(results),
    updateBest: (score, results) => updateBest(score, results),
    isAtProvenCeiling: () => stopAtProvenCeiling,
  });

  const exactScore = createExactScorer(contexts, objective);

  const updateBest = (
    score: Rational,
    results: readonly ExactMipResult[],
  ) => {
    if (best !== undefined && compareRational(score, best.score) <= 0) return;
    const commonEquipments: Record<string, EquipInfo> = {};
    for (const name of options.commonSlots) {
      const firstContext = contexts[0]!;
      const selected = equipmentForCommonSlot(firstContext, results[0]!.selection, name, commonSlotProjections);
      const selectedKey = equipmentIdentity(selected);
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        const other = equipmentForCommonSlot(context, results[index]!.selection, name, commonSlotProjections);
        if (equipmentIdentity(other) !== selectedKey) {
          throw new Error(`内部错误：共享槽位 ${name} 在候选结果中不一致`);
        }
      }
      commonEquipments[name] = selected;
    }
    best = {
      score,
      commonEquipments,
      jobResults: Object.fromEntries(contexts.map((context, index) => [context.job.id, results[index]!])),
    };
    const activeCount = contexts.reduce((count, context) => count + Number(context.active), 0);
    const ceiling = rational(BigInt(activeCount), 1n);
    if (options.onProgress !== undefined) {
      const approximate = Number(score.numerator) / Number(score.denominator);
      const scoreLabel = Number.isFinite(approximate)
        ? approximate.toPrecision(10)
        : `${score.numerator}/${score.denominator}`;
      options.onProgress(
        `V3 incumbent 更新：归一化目标=${scoreLabel}；外层节点=${mutable.outerNodes}；内层 MIP=${mutable.innerSolves}；耗时=${Math.round(performance.now() - startedAt)}ms`,
      );
    }
    if (compareRational(score, ceiling) === 0) stopAtProvenCeiling = true;
  };

  const seedResultsFor = createSeedResults({
    options, contexts, commonSlotProjections, objective,
    enableSharedMateriaCompensation, assertWithinBudget,
  });
  const scoreSeed = (
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
  ): Rational | undefined => {
    const results = seedResultsFor(fixed, foodChoice);
    return results === undefined ? undefined : exactScore(results);
  };

  let jointFactorProof = false;
  let jointInnerSolverStatus: "Optimal" | "DualBound" = "Optimal";
  let exactSharedDomainProof = false;
  const hasOnlyOneCommonAssignment = options.commonSlots.length > 0 &&
    options.commonSlots.every((name) => commonChoicesByName.get(name)!.length === 1);
  if (contexts.every((context) => context.active) && options.commonSlots.length > 0 &&
    !hasOnlyOneCommonAssignment) {
    const seedCandidates: {
      key: string;
      fixed: Map<string, CommonChoice>;
      foodChoice: FoodChoice | undefined;
      score: Rational | undefined;
      anchorId: string;
    }[] = [];
    const seedCandidateKeys = new Set<string>();
    const addSeedCandidate = (
      fixed: Map<string, CommonChoice>,
      foodChoice: FoodChoice | undefined,
      anchorId: string,
    ) => {
      const key = `${[...fixed].map(([name, choice]) => `${name}=${choice.key}`).join(";")}` +
        `|food=${foodChoice?.key ?? "independent"}`;
      if (seedCandidateKeys.has(key)) return;
      seedCandidateKeys.add(key);
      seedCandidates.push({ key, fixed, foodChoice, score: scoreSeed(fixed, foodChoice), anchorId });
    };
    for (const anchor of contexts) {
      assertWithinBudget("联合热启动评分");
      const initialFixed = new Map<string, CommonChoice>();
      for (const name of options.commonSlots) {
        const key = commonSlotIdentity(anchor, anchor.optimum.selection, name, commonSlotProjections);
        const choices = commonChoicesByName.get(name)!;
        initialFixed.set(name, choices.find((choice) => choice.key === key) ?? choices[0]!);
      }
      const initialFood = foodChoices.find((choice) =>
        choice.key === foodIdentityForOptional(anchor.optimum.food)) ?? foodChoices[0];
      const foodChoice = options.foodStrategy === "shared" ? initialFood : undefined;
      addSeedCandidate(initialFixed, foodChoice, anchor.job.id);
    }
    const fullSeedCandidateCount = options.commonSlots.reduce((product, name) =>
      product * BigInt(commonChoicesByName.get(name)!.length), 1n) *
      BigInt(options.foodStrategy === "shared" ? foodChoices.length : 1);
    const fullSeedCandidateLimit = 5_000n;
    if (fullSeedCandidateCount <= fullSeedCandidateLimit) {
      const current = new Map<string, CommonChoice>();
      let visited = 0;
      const visitSharedChoices = (slotIndex: number) => {
        if ((visited++ & 255) === 0) assertWithinBudget("联合热启动枚举");
        if (slotIndex === options.commonSlots.length) {
          const foods = options.foodStrategy === "shared" ? foodChoices : [undefined];
          for (const foodChoice of foods) addSeedCandidate(currentCopy(), foodChoice, "shared-choice-enumeration");
          return;
        }
        const name = options.commonSlots[slotIndex]!;
        for (const choice of commonChoicesByName.get(name)!) {
          current.set(name, choice);
          visitSharedChoices(slotIndex + 1);
        }
        current.delete(name);
      };
      const currentCopy = () => new Map(current);
      visitSharedChoices(0);
    }
    seedCandidates.sort((left, right) => {
      if (left.score !== undefined && right.score === undefined) return -1;
      if (left.score === undefined && right.score !== undefined) return 1;
      if (left.score !== undefined && right.score !== undefined) {
        const comparison = compareRational(right.score, left.score);
        if (comparison !== 0) return comparison;
      }
      return left.anchorId.localeCompare(right.anchorId);
    });
    const exactSharedAssignmentLimit = 8n;
    const canProveBySharedEnumeration = fullSeedCandidateCount <= exactSharedAssignmentLimit &&
      BigInt(seedCandidates.length) === fullSeedCandidateCount;
    const seedLimit = canProveBySharedEnumeration
      ? seedCandidates.length
      : Math.min(seedCandidates.length, 2);
    options.onProgress?.(
      `V3：共享候选组合估分 ${fullSeedCandidateCount.toString()} 个（枚举上限 ${fullSeedCandidateLimit}）；` +
      `热启动候选 ${seedCandidates.length} 个，精确尝试 ${seedLimit} 个` +
      (canProveBySharedEnumeration ? "；组合数较少，逐个精确求解并完成外层证明" : ""),
    );
    if (canProveBySharedEnumeration) {
      for (const seed of seedCandidates) {
        if (stopAtProvenCeiling) break;
        mutable.outerNodes++;
        const directResults = seedResultsFor(seed.fixed, seed.foodChoice, true);
        if (directResults !== undefined) updateBest(exactScore(directResults), directResults);
        if (!stopAtProvenCeiling) {
          const candidateResults = await refineSeedJobs(
            directResults,
            seed.fixed,
            seed.foodChoice,
            contexts.map((_, index) => index),
          );
          if (directResults !== undefined && candidateResults.some((result) => result === undefined)) {
            throw new Error("共享热启动与受限精确子问题的可行性不一致");
          }
          mutable.completeNodes++;
          if (candidateResults.every((result): result is ExactMipResult => result !== undefined)) {
            updateBest(exactScore(candidateResults), candidateResults);
          }
        }
      }
      exactSharedDomainProof = true;
    } else {
      const useDirectJointWarmStart = contexts.length >= 4;
      if (useDirectJointWarmStart) {
        for (const seed of seedCandidates.slice(0, seedLimit)) {
          const directResults = seedResultsFor(seed.fixed, seed.foodChoice, true);
          if (directResults !== undefined) {
            updateBest(exactScore(directResults), directResults);
            const weakestJobs = contexts.map((context, index) => {
              const factors = factorsForResult(context, directResults[index]!);
              const product = integerDamageProduct(factors);
              const ratio = objective === "dps"
                ? rational(product * BigInt(context.optimumGcd),
                    BigInt(factors.gcdCentiseconds) * context.optimumProduct)
                : rational(product, context.optimumProduct);
              return { context, index, ratio };
            }).sort((left, right) => compareRational(left.ratio, right.ratio));
            const refineCount = Math.min(4, contexts.length);
            if (!stopAtProvenCeiling) {
              const refinedResults = await refineSeedJobs(
                directResults,
                seed.fixed,
                seed.foodChoice,
                weakestJobs.slice(0, refineCount).map(({ index }) => index),
              );
              if (refinedResults.every((result): result is ExactMipResult => result !== undefined)) {
                updateBest(exactScore(refinedResults), refinedResults);
              }
            }
            continue;
          }
          const candidateResults = await refineSeedJobs(
            undefined,
            seed.fixed,
            seed.foodChoice,
            contexts.map((_, index) => index),
          );
          if (candidateResults.every((result): result is ExactMipResult => result !== undefined)) {
            updateBest(exactScore(candidateResults), candidateResults);
          }
          if (stopAtProvenCeiling) break;
        }
      } else {
        const seedsToRefine: {
          seed: (typeof seedCandidates)[number];
          directResults: ExactMipResult[] | undefined;
        }[] = [];
        for (const seed of seedCandidates.slice(0, seedLimit)) {
          const directResults = seedResultsFor(seed.fixed, seed.foodChoice, true);
          if (directResults !== undefined) updateBest(exactScore(directResults), directResults);
          seedsToRefine.push({ seed, directResults });
          if (stopAtProvenCeiling) break;
        }
        if (!stopAtProvenCeiling && seedsToRefine.length > 0) {
          const refinedBySeed = await refineSeedCandidates(seedsToRefine.map(({ seed, directResults }) => ({
            initialResults: directResults,
            fixed: seed.fixed,
            foodChoice: seed.foodChoice,
            jobIndexes: contexts.map((_, index) => index),
          })));
          for (const refinedResults of refinedBySeed) {
            if (refinedResults.every((result): result is ExactMipResult => result !== undefined)) {
              updateBest(exactScore(refinedResults), refinedResults);
            }
          }
        }
      }
    }
    const initialResults = best === undefined ? [] : contexts.map((context) => best!.jobResults[context.job.id]!);
    const remainingMs = remainingTimeLimit();
    const onSolverProgress = contexts[0]!.job.options.onSolverProgress;
    const onSolverCallback = options.onSolverCallback ?? contexts[0]!.job.options.onSolverCallback;
    const jointOptions = {
      jobs: contexts.map((context) => {
        const jobOptions = makeJobOptions(
          context, new Map(), commonSlotProjections, undefined, remainingMs, objective, cancellationRequested,
        );
        const slots = [...jobOptions.slots];
        for (const name of options.commonSlots) {
          const slotIndex = commonSlotIndex(context, name, commonSlotProjections);
          const slotCandidates = slots[slotIndex]!;
          const completeRingPairSlot = commonSlotProjections.get(name) === undefined &&
            slotCandidates.length > 0 &&
            slotCandidates.every((equipment) =>
              Array.isArray((equipment as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips));
          // 联合 MIP 可以将完整戒指对笛卡尔候选域拆分为两个单选槽位。
          // 保留完整输入域，使验证能先确认候选完整，再添加唯一物品约束行。
          if (completeRingPairSlot) continue;
          const allowedKeys = new Set(commonChoicesByName.get(name)!.map((choice) => choice.key));
          slots[slotIndex] = slotCandidates.filter((equipment) =>
            allowedKeys.has(equipmentIdentity(projectEquipment(equipment, commonSlotProjections.get(name)))));
        }
        const jointJobOptions = inheritCanonicalEvaluatorCandidateUpperBound(jobOptions, {
          ...jobOptions,
          slots,
          foods: options.foodStrategy === "shared"
            ? foodChoices.map((choice) => choice.foods.get(context.job.id)).filter((food): food is FoodInfo => food !== undefined)
            : jobOptions.foods,
        });
        return {
          id: context.job.id,
          slotNames: context.job.slotNames,
          baseline: factorsForResult(context, context.optimum),
          options: jointJobOptions,
        };
      }),
      commonSlots: options.commonSlots,
      ...(options.commonSlotProjections === undefined
        ? {}
        : { commonSlotProjections: options.commonSlotProjections }),
      sharedFood: options.foodStrategy === "shared",
      equipmentIdentity,
      foodIdentity,
      objective,
      ...(options.factorizedSharedRingPair ? { canonicalSharedRingPair: true } : {}),
      ...(options.ratioUpperPairPolicy === undefined
        ? {}
        : { ratioUpperPairPolicy: options.ratioUpperPairPolicy }),
      ...(options.sharedAccessoryPairDominance === true
        ? { sharedAccessoryPairDominance: true }
        : {}),
      ...(initialResults.length === contexts.length ? { initialResults } : {}),
      maxSearchMs: remainingMs,
      ...(onSolverProgress === undefined ? {} : {
        onSolverProgress: (event: LinearMipProgress) => onSolverProgress({ ...event, model: `joint:${event.model}` }),
      }),
      ...(onSolverCallback === undefined ? {} : {
        onSolverCallback: (event: HighsCallbackTrace) => onSolverCallback({ ...event, model: `joint:${event.model}` }),
      }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      isCancelled: cancellationRequested,
    };
    if (options.sharedAccessoryPairDominance === true &&
      hasSharedAccessoryPairDominancePath(options)) {
      markSharedAccessoryPairDominancePath(jointOptions);
    }
    const joint = stopAtProvenCeiling || exactSharedDomainProof
      ? undefined
      : await findBestJointFactorMip(jointOptions);
    assertWithinBudget("联合因子模型复核");
    if (joint !== undefined) {
      jointInnerSolverStatus = joint.innerSolverStatus;
      mutable.innerSolves += joint.solverRuns;
      mutable.completeNodes++;
      const results = joint.results.map((result, index) => ({ ...result,
        ...(contexts[index]!.optimum.maximumToughness === undefined ? {} : {
          maximumToughness: contexts[index]!.optimum.maximumToughness,
        }),
      }));
      updateBest(exactScore(results), results);
    }
    jointFactorProof = !exactSharedDomainProof;
  } else {
    for (const foodChoice of foodChoices) {
      if (stopAtProvenCeiling) break;
      const fixed = hasOnlyOneCommonAssignment
        ? new Map(options.commonSlots.map((name) => [name, commonChoicesByName.get(name)![0]!]))
        : new Map<string, CommonChoice>();
      await visit(fixed, foodChoice);
    }
  }

  assertWithinBudget("结果整理");
  if (best === undefined) return undefined;
  const stats = statisticsSnapshot(mutable, startedAt, timeLimitMs, cacheLimit, cache.size);
  const withMetrics = (context: JobContext, result: ExactMipResult): JointLoadoutJobResultV3 => {
    const factors = factorsForResult(context, result);
    const gcd = factors.gcdCentiseconds / 100;
    return {
      ...result,
      gcd,
      damagePerSecond: gcd > 0 ? result.damage / gcd : 0,
    };
  };
  return {
    value: {
      numerator: best.score.numerator.toString(),
      denominator: best.score.denominator.toString(),
      approximate: Number(best.score.numerator) / Number(best.score.denominator),
    },
    commonEquipments: best.commonEquipments,
    jobResults: Object.fromEntries(contexts.map((context) => [
      context.job.id,
      withMetrics(context, best!.jobResults[context.job.id]!),
    ])),
    optima: Object.fromEntries(contexts.map((context) => [context.job.id, withMetrics(context, context.optimum)])),
    statistics: stats,
    proof: {
      complete: true,
      objective,
      optimalityScope: "传入的每职业槽位候选（含两个独立戒指槽及跨槽 unique 约束）、完整装备身份交集、食物列表和约束范围",
      outerBound: jointFactorProof
        ? "单职业最优基线归一化后，每职业比例不超过 1；总和不超过职业数减 1 加比例乘积，乘积仅筛选可能改进的因子签名；最终总和使用 BigInt 有理数比较"
        : objective === "dps"
        ? "每个外层节点以各职业在已固定通用装备下独立重优化的 DPS 上界求和；product/GCD 归一化分数用 BigInt 有理数比较"
        : "每个外层节点以各职业在已固定通用装备下独立重优化的伤害上界求和；归一化分数用 BigInt 有理数比较",
      innerSolverStatus: jointInnerSolverStatus,
      formalCertificate: false,
      numericalLimitation: "HiGHS 报告 Optimal，或经保守取整的 MIP 对偶上界已不高于精确 BigInt incumbent；模型行与属性重建均已复核，但这些求解器结果不是独立形式化证书",
      terminationReason: stopAtProvenCeiling
        ? "已达到各职业单独最优基线之和这一全局上界"
        : jointFactorProof && jointInnerSolverStatus === "DualBound"
        ? "HiGHS MIP 对偶上界不高于当前精确 BigInt incumbent，已证明不存在严格改进解"
        : jointFactorProof
        ? "完整共享模型已穷尽归一化总和可能改进的因子签名；乘积仅用于必要条件筛选，最终比较精确有理数总和"
        : exactSharedDomainProof
        ? "已穷尽全部共享装备/食物组合，并对每个组合精确求得各职业条件最优；结果以 BigInt 有理数比较"
        : "所有未剪枝通用装备分支均已完成，剩余分支由精确有理数上界剪除",
    },
  };

  async function visit(
    fixed: Map<string, CommonChoice>,
    foodChoice: FoodChoice,
    parentResults?: readonly ExactMipResult[],
  ): Promise<void> {
    if (stopAtProvenCeiling) return;
    assertWithinBudget("外层分支定界");
    mutable.outerNodes++;
    if ((mutable.outerNodes & 31) === 0) {
      assertWithinBudget("外层分支定界");
      mutable.cacheEntries = cache.size;
      if (options.onProgress !== undefined) {
        const score = best === undefined
          ? "无 incumbent"
          : (() => {
              const approximate = Number(best.score.numerator) / Number(best.score.denominator);
              return Number.isFinite(approximate)
                ? approximate.toPrecision(10)
                : `${best.score.numerator}/${best.score.denominator}`;
            })();
        options.onProgress(
          `V3 搜索进度：外层节点=${mutable.outerNodes}；完成=${mutable.completeNodes}；上界剪枝=${mutable.upperBoundPrunes}；内层 MIP=${mutable.innerSolves}；父结果复用=${mutable.parentResultReuses}；incumbent=${score}；耗时=${Math.round(performance.now() - startedAt)}ms`,
        );
      }
    }

    const results = await refineSeedJobs(
      undefined,
      fixed,
      options.foodStrategy === "shared" ? foodChoice : undefined,
      contexts.map((_, index) => index),
      parentResults,
    );
    if (results.some((result) => result === undefined)) return;
    const completeResults = results as ExactMipResult[];
    const upperBound = exactScore(completeResults);
    if (best !== undefined && compareRational(upperBound, best.score) <= 0) {
      mutable.upperBoundPrunes++;
      return;
    }

    let allSharedChoicesAgree = true;
    for (const name of options.commonSlots) {
      const firstContext = contexts[0]!;
      const firstKey = commonSlotIdentity(firstContext, completeResults[0]!.selection, name, commonSlotProjections);
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        if (commonSlotIdentity(context, completeResults[index]!.selection, name, commonSlotProjections) !== firstKey) {
          allSharedChoicesAgree = false;
          break;
        }
      }
      if (!allSharedChoicesAgree) break;
    }
    if (allSharedChoicesAgree) {
      mutable.completeNodes++;
      mutable.relaxedOptimaAttained++;
      updateBest(upperBound, completeResults);
      return;
    }

    const relaxedKeysBySlot = new Map<string, string[]>();
    for (const name of options.commonSlots) {
      if (fixed.has(name)) continue;
      relaxedKeysBySlot.set(name, contexts.map((context, index) =>
        commonSlotIdentity(context, completeResults[index]!.selection, name, commonSlotProjections),
      ));
    }
    const disagreeingSlots = [...relaxedKeysBySlot.entries()]
      .filter(([, keys]) => keys.some((key) => key !== keys[0]))
      .sort(([left], [right]) =>
        commonChoicesByName.get(left)!.length - commonChoicesByName.get(right)!.length ||
        slotOrderIndex.get(left)! - slotOrderIndex.get(right)!);
    const branchSlot = disagreeingSlots[0]?.[0];
    if (branchSlot === undefined) {
      throw new Error("内部错误：松弛最优装备不一致，但没有可分支的通用槽位");
    }
    const relaxedKeys = relaxedKeysBySlot.get(branchSlot)!;
    const branchChoices = commonChoicesByName.get(branchSlot)!
      .map((choice, index) => ({
        choice,
        index,
        matches: relaxedKeys.reduce((count, key) => count + Number(choice.key === key), 0),
      }))
      .sort((left, right) => right.matches - left.matches || left.index - right.index);
    for (const { choice } of branchChoices) {
      fixed.set(branchSlot, choice);
      await visit(fixed, foodChoice, completeResults);
      fixed.delete(branchSlot);
      if (stopAtProvenCeiling) return;
    }
  }
}
