import { jobSchemas } from "../jobs.ts";
import { createParallelBaselineExecutor } from "../search/parallel-baseline-executor.ts";
import {
  candidateResourceSupportProfileForSearch,
  resourceBudgetCandidateProfileForSearch,
} from "../search/candidate-resource-support-policy.ts";
import { markSharedAccessoryPairDominancePath } from "../search/shared-accessory-pair-dominance-policy.ts";
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

function normalizedCommonSlots(commonSlots: readonly CommonGearSlot[]): {
  slots: string[];
  projections: SharedSlotProjection[];
} {
  if (new Set(commonSlots).size !== commonSlots.length) {
    throw new RangeError("共享槽位列表包含重复项");
  }
  const hasSingleRing =
    commonSlots.includes("ring") || commonSlots.includes("ring2");
  const hasRingPair = commonSlots.includes("rings");
  if (hasSingleRing && hasRingPair) {
    throw new RangeError("共享戒指时请选择戒指1、戒指2或戒指对，不要混合选择");
  }
  const slots = [...commonSlots];
  const projections: SharedSlotProjection[] = [];
  for (const slot of commonSlots) {
    if (slot === "ring")
      projections.push({ commonSlot: slot, slotName: "rings", ringIndex: 0 });
    if (slot === "ring2")
      projections.push({ commonSlot: slot, slotName: "rings", ringIndex: 1 });
  }
  return { slots, projections };
}

export async function runJointOptimizationLocally(
  config: JointOptimizationConfig,
  options: SearchOptions = {},
): Promise<JointOptimizationResult | undefined> {
  throwIfAborted(options.signal);
  if (config.jobs.length < 2)
    throw new RangeError("多职业联合搜索至少需要两个职业");
  const roleLabels = {
    tank: "防护",
    healer: "治疗",
    str: "力量 DPS",
    dex: "灵巧 DPS",
    int: "智力 DPS",
  } as const;
  const jobGroups = config.jobs.map(({ jobId }) => ({
    jobId,
    group: jobSchemas[jobId].role,
  }));
  if (new Set(jobGroups.map(({ group }) => group)).size > 1) {
    const jobs = jobGroups
      .map(({ jobId, group }) => `${jobId}=${roleLabels[group]}`)
      .join("、");
    throw new RangeError(
      `多职业联合搜索只接受同组职业（防护、治疗或同主属性 DPS）：${jobs}`,
    );
  }
  const objective = config.objective ?? config.jobs[0]?.objective ?? "damage";
  if (
    config.jobs.some(
      (job) => job.objective !== undefined && job.objective !== objective,
    )
  ) {
    throw new RangeError("联合搜索中所有职业必须使用相同的 damage 或 dps 目标");
  }
  const sharedSlots = normalizedCommonSlots(config.commonSlots);
  const hasSharedRing = config.commonSlots.some(
    (slot) => slot === "rings" || slot === "ring" || slot === "ring2",
  );
  const factorizedSharedRingPair =
    config.commonSlots.includes("rings") &&
    config.jobs.every(
      (job) =>
        job.forcedGear.ring === undefined && job.forcedGear.ring2 === undefined,
    );
  const vprMchNarrowSharedSlots: readonly CommonGearSlot[] = [
    "bracelet",
    "earrings",
    "necklace",
    "rings",
  ];
  const isVprMchNarrowSharedDps =
    objective === "dps" &&
    config.foodStrategy === "shared" &&
    config.jobs.length === 2 &&
    config.jobs
      .map((job) => job.jobId)
      .sort()
      .join("+") === "MCH+VPR" &&
    config.jobs.every(
      (job) =>
        job.minItemLevel === 730 &&
        job.maxItemLevel === 795 &&
        job.syncLevel === 735,
    ) &&
    config.commonSlots.length === vprMchNarrowSharedSlots.length &&
    vprMchNarrowSharedSlots.every((slot) =>
      config.commonSlots.includes(slot),
    ) &&
    config.jobs.every(
      (job) =>
        job.jobLevel === undefined &&
        job.gcdTarget === undefined &&
        (job.gcdChoices?.length ?? 0) === 0 &&
        job.speedMin === undefined &&
        job.speedMax === undefined &&
        job.minTenacity === undefined &&
        job.toughnessMin === undefined &&
        job.toughnessMinPercent === undefined &&
        !job.maximizeTenacity &&
        job.excludedSources.length === 0 &&
        (job.excludedGearIds?.length ?? 0) === 0 &&
        job.foodId === 0 &&
        Object.keys(job.forcedGear).length === 0,
    );
  const sharedWideAccessorySlots: readonly CommonGearSlot[] = [
    "bracelet",
    "earrings",
    "necklace",
    "rings",
  ];
  const isCanonicalSharedWideDpsFor = (jobIds: readonly JobId[]) =>
    objective === "dps" &&
    config.foodStrategy === "shared" &&
    config.jobs.length === jobIds.length &&
    config.jobs
      .map((job) => job.jobId)
      .sort()
      .join("+") === [...jobIds].sort().join("+") &&
    config.jobs.every(
      (job) =>
        job.minItemLevel === 715 &&
        job.maxItemLevel === 795 &&
        job.syncLevel === 735,
    ) &&
    config.commonSlots.length === sharedWideAccessorySlots.length &&
    sharedWideAccessorySlots.every((slot) =>
      config.commonSlots.includes(slot),
    ) &&
    config.jobs.every(
      (job) =>
        job.jobLevel === undefined &&
        job.gcdTarget === undefined &&
        (job.gcdChoices?.length ?? 0) === 0 &&
        job.speedMin === undefined &&
        job.speedMax === undefined &&
        job.minTenacity === undefined &&
        job.toughnessMin === undefined &&
        job.toughnessMinPercent === undefined &&
        !job.maximizeTenacity &&
        job.excludedSources.length === 0 &&
        (job.excludedGearIds?.length ?? 0) === 0 &&
        job.foodId === 0 &&
        Object.keys(job.forcedGear).length === 0,
    );
  const isFourJobSharedWideDps = isCanonicalSharedWideDpsFor([
    "BRD",
    "DNC",
    "MCH",
    "VPR",
  ]);
  const isFiveJobSharedWideDps = isCanonicalSharedWideDpsFor([
    "BRD",
    "DNC",
    "MCH",
    "NIN",
    "VPR",
  ]);
  const requiredSharedAccessoryPairSlots: readonly CommonGearSlot[] = [
    "bracelet",
    "earrings",
    "necklace",
    "rings",
  ];
  const isSharedAccessoryPairDominanceEligible =
    objective === "dps" &&
    config.foodStrategy === "shared" &&
    config.jobs.length >= 2 &&
    factorizedSharedRingPair &&
    requiredSharedAccessoryPairSlots.every((slot) =>
      config.commonSlots.includes(slot),
    ) &&
    config.jobs.every(
      (job) =>
        job.jobLevel === undefined &&
        job.gcdTarget === undefined &&
        (job.gcdChoices?.length ?? 0) === 0 &&
        job.speedMin === undefined &&
        job.speedMax === undefined &&
        job.minTenacity === undefined &&
        job.toughnessMin === undefined &&
        job.toughnessMinPercent === undefined &&
        !job.maximizeTenacity &&
        job.excludedSources.length === 0 &&
        (job.excludedGearIds?.length ?? 0) === 0 &&
        job.foodId === 0 &&
        Object.keys(job.forcedGear).length === 0,
    );
  // These proof-heavy cases regress with the optional pairwise relaxation rows.
  // Skipping them weakens only the relaxation; candidates and exact proof remain intact.
  const ratioUpperPairPolicy =
    factorizedSharedRingPair &&
    (isFiveJobSharedWideDps ||
      isFourJobSharedWideDps ||
      isVprMchNarrowSharedDps)
      ? ("disabled" as const)
      : undefined;
  const jointCommonSlots = factorizedSharedRingPair
    ? sharedSlots.slots.flatMap((slot) =>
        slot === "rings" ? ["ring", "ring2"] : [slot],
      )
    : sharedSlots.slots;
  const resourceBudgetCandidateProfile =
    resourceBudgetCandidateProfileForSearch({
      jobs: config.jobs.map(
        ({ jobId, minItemLevel, maxItemLevel, syncLevel }) => ({
          jobId,
          minItemLevel,
          maxItemLevel,
          ...(syncLevel === undefined ? {} : { syncLevel }),
        }),
      ),
      // Preserve the caller's ring-pair versus ring-slot topology for policy selection.
      commonSlots: config.commonSlots,
      objective,
      foodStrategy: config.foodStrategy,
    });
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
    prepared.options.resourceBudgetCandidateProfile =
      resourceBudgetCandidateProfile;
    preparedByJob.set(jobConfig.jobId, prepared);
    return {
      id: jobConfig.jobId,
      slotNames: prepared.slots.map((slot) => slot.name),
      options: prepared.options,
    };
  });
  const candidateResourceSupportProfile =
    candidateResourceSupportProfileForSearch({
      jobs: config.jobs.map(
        ({ jobId, minItemLevel, maxItemLevel, syncLevel }) => ({
          jobId,
          minItemLevel,
          maxItemLevel,
          ...(syncLevel === undefined ? {} : { syncLevel }),
        }),
      ),
      candidateCount: jobs.reduce(
        (total, job) =>
          total +
          job.options.slots.reduce(
            (slotTotal, slot) => slotTotal + slot.length,
            0,
          ),
        0,
      ),
      commonSlots: config.commonSlots,
      objective,
      foodStrategy: config.foodStrategy,
    });
  for (const job of jobs)
    job.options.candidateResourceSupportProfile =
      candidateResourceSupportProfile;
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
      ...(ratioUpperPairPolicy === undefined ? {} : { ratioUpperPairPolicy }),
      ...(isSharedAccessoryPairDominanceEligible
        ? { sharedAccessoryPairDominance: true }
        : {}),
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
    if (isSharedAccessoryPairDominanceEligible) {
      markSharedAccessoryPairDominancePath(v3Options);
    }
    const pendingResult = findBestJointLoadoutV3(v3Options);
    // V3 snapshots its job wrappers synchronously and replaces each input slot
    // with the exact pruned domain before its first await. Keep only the slot
    // names and identity maps needed to reconstruct the final UI result here.
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
      commonGear.rings = [
        candidateGearFromInfo(equipment.ringEquips[0], "ring", prepared),
        candidateGearFromInfo(equipment.ringEquips[1], "ring2", prepared),
      ];
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
    commonGear.rings = [ring, ring2];
  }
  const firstResult = Object.values(result.jobResults)[0];
  const firstPrepared = preparedByJob.values().next().value as
    PreparedSearch | undefined;
  const commonFood =
    config.foodStrategy === "shared" && firstResult && firstPrepared
      ? resultFood(firstResult, firstPrepared)
      : undefined;
  return {
    jobResults: convertByJob(result.jobResults),
    optima: convertByJob(result.optima),
    commonGear,
    ...(commonFood !== undefined ? { commonFood } : {}),
    objective,
    value: result.value,
    proof: result.proof,
    statistics: result.statistics,
  };
}
