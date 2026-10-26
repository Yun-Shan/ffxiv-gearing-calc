import { createParallelBaselineExecutor } from "../search/parallel-baseline-executor.ts";
import {
  findBestJointLoadoutV3,
  type JointLoadoutV3Result,
} from "../search/loadout-finder-v3.ts";
import { isRingPairEquipInfo } from "../search/ring-pairs.ts";
import type { SharedSlotProjection } from "../search/types.ts";
import type { ExactMipResult } from "../search/loadout-finder-exact-mip.ts";
import type {
  CommonGearSlot,
  GearSlot,
  JobId,
  JointOptimizationConfig,
  JointOptimizationResult,
  MeldedGear,
  OptimizationResult,
  SearchOptions,
} from "../types.ts";
import { privateParetoSlots, prepareSearch } from "./search-preparation.ts";
import {
  assembleResult,
  candidateGearFromInfo,
  resultFood,
} from "./result-assembly.ts";
import {
  throwIfAborted,
  type PreparedSearch,
  type SolverGear,
} from "./context.ts";
import { assertJointOptimizationConfig, normalizeOptimizationConfig } from "../config-validation.ts";

function normalizedCommonSlots(commonSlots: readonly CommonGearSlot[], independentRings: boolean): {
  slots: string[];
  projections: SharedSlotProjection[];
} {
  const slots = [...commonSlots];
  const projections: SharedSlotProjection[] = [];
  for (const slot of commonSlots) {
    if (!independentRings && slot === "ring")
      projections.push({ commonSlot: slot, slotName: "rings", ringIndex: 0 });
    if (!independentRings && slot === "ring2")
      projections.push({ commonSlot: slot, slotName: "rings", ringIndex: 1 });
  }
  return { slots, projections };
}

export async function runJointOptimizationLocally(
  input: JointOptimizationConfig,
  options: SearchOptions = {},
): Promise<JointOptimizationResult | undefined> {
  const startedAt = performance.now();
  assertJointOptimizationConfig(input);
  const config = { ...input, jobs: input.jobs.map(normalizeOptimizationConfig) };
  throwIfAborted(options.signal);
  const objective = config.objective;
  const hasSharedRing = config.commonSlots.some((slot) => slot === "ring" || slot === "ring2");
  const factorizedSharedRingPair =
    config.commonSlots.includes("ring") && config.commonSlots.includes("ring2") &&
    config.jobs.every(
      (job) =>
        job.forcedGear.ring === undefined && job.forcedGear.ring2 === undefined,
    );
  const sharedSlots = normalizedCommonSlots(config.commonSlots, factorizedSharedRingPair);
  const jointCommonSlots = factorizedSharedRingPair
    ? sharedSlots.slots.flatMap((slot) =>
        slot === "rings" ? ["ring", "ring2"] : [slot],
      )
    : sharedSlots.slots;
  const preparedByJob = new Map<JobId, PreparedSearch>();
  const jobs = config.jobs.map((jobConfig) => {
    const normalized = {
      ...jobConfig,
      ...(config.maxSearchMs !== undefined &&
      jobConfig.maxSearchMs === undefined
        ? { maxSearchMs: config.maxSearchMs }
        : {}),
      objective,
    };
    const prepared = prepareSearch(
      normalized,
      options,
      sharedSlots.projections.length > 0,
      !hasSharedRing || factorizedSharedRingPair,
      privateParetoSlots(normalized, jointCommonSlots),
      !hasSharedRing,
    );
    preparedByJob.set(jobConfig.jobId, prepared);
    return {
      id: jobConfig.jobId,
      slotNames: prepared.slots.map((slot) => slot.name),
      options: prepared.options,
    };
  });
  if (
    [...preparedByJob.values()].some(
      (prepared) =>
        !prepared.foods.length ||
        prepared.slots.some((slot) => slot.candidates.length === 0),
    )
  ) {
    return undefined;
  }
  const baselineExecutor = await createParallelBaselineExecutor();
  let result: JointLoadoutV3Result | undefined;
  try {
    throwIfAborted(options.signal);
    const jobCount = jobs.length;
    options.onProgress?.(
      `联合候选准备完成；职业数=${jobCount}；装备方案=${[...preparedByJob.values()].reduce((sum, prepared) => sum + prepared.searchedCandidates, 0)}；食物候选=${[...preparedByJob.values()].reduce((sum, prepared) => sum + prepared.foods.length, 0)}；正在求解配装`,
    );
    const v3Options = {
      jobs,
      commonSlots: jointCommonSlots,
      ...(sharedSlots.projections.length > 0
        ? { commonSlotProjections: sharedSlots.projections }
        : {}),
      ...(factorizedSharedRingPair ? { factorizedSharedRingPair: true } : {}),
      foodStrategy: config.foodStrategy,
      objective,
      ...(config.maxSearchMs !== undefined
        ? { maxSearchMs: config.maxSearchMs }
        : {}),
      ...(config.cacheLimit !== undefined
        ? { cacheLimit: config.cacheLimit }
        : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.onSolverProgress
        ? { onSolverProgress: options.onSolverProgress }
        : {}),
      ...(options.onSolverCallback
        ? { onSolverCallback: options.onSolverCallback }
        : {}),
      ...(baselineExecutor === undefined ? {} : { baselineExecutor }),
      isCancelled: () => options.signal?.aborted === true,
    };
    const pendingResult = findBestJointLoadoutV3(v3Options);
    // V3 会同步复制职业包装对象，并在首次 await 前用精确剪枝后的候选域替换各输入槽。
    // 此处只保留重建最终界面结果所需的槽名和身份映射。
    jobs.length = 0;
    for (const prepared of preparedByJob.values()) {
      prepared.options.slots = [];
      prepared.slots = prepared.slots.map(({ name }) => ({
        name,
        candidates: [],
      }));
    }
    result = await pendingResult;
  } finally {
    await baselineExecutor?.dispose?.();
  }
  throwIfAborted(options.signal);
  if (!result) return undefined;

  options.onProgress?.("联合求解完成，正在还原并复核结果");

  const convertByJob = (items: Record<string, ExactMipResult>) => {
    const converted: Partial<Record<JobId, OptimizationResult>> = {};
    for (const [jobId, exactResult] of Object.entries(items) as [
      JobId,
      ExactMipResult,
    ][]) {
      const prepared = preparedByJob.get(jobId);
      const jobConfig = config.jobs.find(
        (candidate) => candidate.jobId === jobId,
      );
      if (!prepared || !jobConfig)
        throw new Error(`联合搜索返回了未知职业：${jobId}`);
      converted[jobId] = assembleResult(
        exactResult,
        { ...jobConfig, objective },
        prepared,
      );
    }
    return converted;
  };

  const commonGear: Partial<Record<CommonGearSlot, MeldedGear[]>> = {};
  const factorizedRings: (MeldedGear | undefined)[] = [undefined, undefined];
  for (const [slotName, equipment] of Object.entries(result.commonEquipments)) {
    const prepared = preparedByJob.values().next().value as
      PreparedSearch | undefined;
    if (!prepared) continue;
    if (slotName === "rings") {
      if (!isRingPairEquipInfo(equipment))
        throw new Error("联合结果缺少共享戒指对");
      commonGear.ring = [candidateGearFromInfo(equipment.ringEquips[0], "ring", prepared)];
      commonGear.ring2 = [candidateGearFromInfo(equipment.ringEquips[1], "ring2", prepared)];
    } else if (slotName === "ring" || slotName === "ring2") {
      const candidate = candidateGearFromInfo(equipment, slotName, prepared);
      if (factorizedSharedRingPair) {
        factorizedRings[slotName === "ring" ? 0 : 1] = candidate;
      } else {
        commonGear[slotName] = [candidate];
      }
    } else {
      commonGear[slotName as GearSlot] = [
        candidateGearFromInfo(equipment, slotName as GearSlot, prepared),
      ];
    }
  }
  if (factorizedSharedRingPair) {
    const [ring, ring2] = factorizedRings;
    if (ring === undefined || ring2 === undefined) {
      throw new Error("联合结果缺少共享戒指对");
    }
    commonGear.ring = [ring];
    commonGear.ring2 = [ring2];
  }
  const firstResult = Object.values(result.jobResults)[0];
  const firstPrepared = preparedByJob.values().next().value as
    PreparedSearch | undefined;
  const commonFood =
    config.foodStrategy === "shared" && firstResult && firstPrepared
      ? resultFood(firstResult, firstPrepared)
      : undefined;
  const completed = {
    jobResults: convertByJob(result.jobResults),
    optima: convertByJob(result.optima),
    commonGear,
    ...(commonFood !== undefined ? { commonFood } : {}),
    objective,
    value: result.value,
    proof: result.proof,
    statistics: { ...result.statistics },
  };
  const jobResults = [...Object.values(completed.jobResults), ...Object.values(completed.optima)];
  const elapsedMs = performance.now() - startedAt;
  completed.statistics.elapsedMs = elapsedMs;
  for (const jobResult of jobResults) {
    jobResult.statistics = { ...jobResult.statistics, elapsedMs };
  }
  return completed;
}
