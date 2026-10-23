export type CandidateResourceSupportProfile = "disabled" | "compact" | "compact-weighted" | "balanced";

/** 精确搜索中可选候选资源上界的内部策略档位。 */
export type ResourceBudgetCandidateProfile = "default" | "uniform-only" | "weighted" | "disabled";

export type MeasuredSearchDomain = {
  jobId: string;
  minItemLevel: number;
  maxItemLevel: number;
  sync?: import("../types.ts").SyncTarget;
};

function sameSync(left: MeasuredSearchDomain["sync"], right: MeasuredSearchDomain["sync"]): boolean {
  return left?.kind === right?.kind && left?.value === right?.value;
}

function isItemSync(sync: MeasuredSearchDomain["sync"], value: number): boolean {
  return sync?.kind === "itemLevel" && sync.value === value;
}

/** 对照调用方的共享槽位策略时，还原优化器内部对戒指对的拆分。 */
function policyCommonSlots(
  commonSlots: readonly string[],
  factorizedSharedRingPair: boolean,
): readonly string[] {
  if (!factorizedSharedRingPair || commonSlots.includes("rings") ||
    !commonSlots.includes("ring") || !commonSlots.includes("ring2")) return commonSlots;
  return [...commonSlots.filter((slot) => slot !== "ring" && slot !== "ring2"), "rings"];
}

/**
 * 仅选择经过测量且不削弱证明能力的候选上界路径。
 * 领域宽度和同步等级用于区分不同快照；共享槽位拓扑和职业集合则用于区分其他条件相同的情况。
 */
export function resourceBudgetCandidateProfileForSearch(input: {
  jobs: readonly MeasuredSearchDomain[];
  commonSlots: readonly string[];
  objective: "damage" | "dps";
  foodStrategy: "shared" | "independent";
}): ResourceBudgetCandidateProfile {
  const { jobs, commonSlots, objective, foodStrategy } = input;
  if (jobs.length === 0 || jobs.some((job) =>
    !Number.isSafeInteger(job.minItemLevel) || !Number.isSafeInteger(job.maxItemLevel) ||
    job.minItemLevel > job.maxItemLevel)) return "default";

  const ids = jobs.map(({ jobId }) => jobId).sort().join("+");
  const first = jobs[0]!;
  const sameDomain = jobs.every((job) =>
    job.minItemLevel === first.minItemLevel && job.maxItemLevel === first.maxItemLevel &&
    sameSync(job.sync, first.sync));
  if (!sameDomain) return "default";
  const slots = new Set(commonSlots);
  const hasRingPair = slots.has("rings") || (slots.has("ring") && slots.has("ring2"));
  const splitRingSlots = !slots.has("rings") && slots.has("ring") && slots.has("ring2");

  // 戒指槽拆分的 RPR+SAM 快照早于候选资源预算上界功能。
  // 不启用该上界时，候选集合和精确证明模型仍然完整。
  if (ids === "RPR+SAM" && jobs.length === 2 && objective === "dps" && foodStrategy === "shared" &&
    first.minItemLevel === 730 && first.maxItemLevel === 795 && isItemSync(first.sync, 735) && splitRingSlots &&
    slots.size === 5 && ["earrings", "necklace", "bracelet"].every((slot) => slots.has(slot))) {
    return "disabled";
  }

  // 四职业、未同步、品级 770–795 的记录使用较早的精确证明路径，未添加候选资源预算约束。
  if (ids === "BRD+DNC+MCH+VPR" && jobs.length === 4 && objective === "dps" &&
    foodStrategy === "independent" && commonSlots.length === 0 &&
    first.minItemLevel === 770 && first.maxItemLevel === 795 && first.sync === undefined) {
    return "disabled";
  }

  // VPR+MCH 的同步品级 715–795 记录使用加权资源支撑约束族。
  // 这些加权界是有效上界，但仍属于可选约束。
  if (ids === "MCH+VPR" && jobs.length === 2 && objective === "dps" && foodStrategy === "shared" &&
    first.minItemLevel === 715 && first.maxItemLevel === 795 && isItemSync(first.sync, 735) && hasRingPair &&
    ["earrings", "necklace", "bracelet"].every((slot) => slots.has(slot))) {
    return "weighted";
  }

  // 五职业、独立食物、同步搜索仅使用均匀（覆盖所有资源）候选预算时耗时最短。
  // 额外的加权档位会增加预处理开销，却不会缩短证明时间。
  if (ids === "BRD+DNC+MCH+NIN+VPR" && jobs.length === 5 && objective === "dps" &&
    foodStrategy === "independent" && commonSlots.length === 0 &&
    first.minItemLevel === 715 && first.maxItemLevel === 795 && isItemSync(first.sync, 735)) {
    return "uniform-only";
  }

  return "default";
}

/** 识别经过测量的宽域 VPR+MCH 证明场景；调用方会为 MCH 启用支撑约束行。 */
export function shouldUsePrimaryResourceSupportsForBaseline(
  jobs: readonly {
    jobId: string;
    candidateItemLevelRanges?: readonly { min: number; max: number }[];
  }[],
  commonSlots: readonly string[],
  objective: "damage" | "dps" | undefined,
  foodStrategy: "shared" | "independent",
): boolean {
  const jobIds = jobs.map(({ jobId }) => jobId);
  const hasBothSharedRings = commonSlots.includes("rings") ||
    (commonSlots.includes("ring") && commonSlots.includes("ring2"));
  const isMeasuredVprMchCase = jobIds.length === 2 && jobIds.includes("VPR") && jobIds.includes("MCH");
  const candidateRanges = jobs[0]?.candidateItemLevelRanges;
  const usesMeasuredWideDomain = candidateRanges?.length === 2 &&
    candidateRanges[0]?.min === 715 && candidateRanges[0]?.max === 735 &&
    candidateRanges[1]?.min === 775 && candidateRanges[1]?.max === 795 &&
    jobs.every(({ candidateItemLevelRanges: ranges }) =>
      ranges?.length === candidateRanges.length &&
      ranges.every((range, index) =>
        range.min === candidateRanges[index]?.min && range.max === candidateRanges[index]?.max));
  return isMeasuredVprMchCase &&
    usesMeasuredWideDomain &&
    objective === "dps" &&
    foodStrategy === "shared" &&
    ["earrings", "necklace", "bracelet"].every((slot) => commonSlots.includes(slot)) &&
    hasBothSharedRings;
}

/** 为经过测量的共享 DPS 基线保留一条主属性支撑约束行。 */
export function shouldUseMainStatResourceSupportForBaseline(
  jobIds: readonly string[],
  commonSlots: readonly string[],
  objective: "damage" | "dps" | undefined,
  foodStrategy: "shared" | "independent",
  factorizedSharedRingPair = false,
): boolean {
  commonSlots = policyCommonSlots(commonSlots, factorizedSharedRingPair);
  const rprSamJobs = new Set(["RPR", "SAM"]);
  const rprSamRingPair = commonSlots.includes("rings") && commonSlots.length === 4;
  const rprSamSharedAccessories = jobIds.length === 2 && jobIds.every((job) => rprSamJobs.has(job)) &&
    objective === "dps" && foodStrategy === "shared" && rprSamRingPair &&
    ["earrings", "necklace", "bracelet"].every((slot) => commonSlots.includes(slot));
  const rdmPctSharedArmor = jobIds.length === 2 && jobIds.includes("RDM") && jobIds.includes("PCT") &&
    objective === "dps" && foodStrategy === "shared" && commonSlots.length === 8 &&
    ["head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet"]
      .every((slot) => commonSlots.includes(slot));
  const jobs = new Set(["BRD", "DNC", "MCH"]);
  const sharedSlots = new Set(["head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet"]);
  const sharedRingPair = commonSlots.includes("rings")
    ? commonSlots.length === sharedSlots.size + 1
    : commonSlots.length === sharedSlots.size + 2 &&
      commonSlots.includes("ring") && commonSlots.includes("ring2");
  return rprSamSharedAccessories || rdmPctSharedArmor || (jobIds.length === jobs.size && jobIds.every((job) => jobs.has(job)) &&
    objective === "dps" && foodStrategy === "shared" &&
    [...sharedSlots].every((slot) => commonSlots.includes(slot)) && sharedRingPair);
}

/** 在 RDM+PCT 的单行试验中，仅对较慢的 PCT 基线启用该约束。 */
export function shouldUseMainStatResourceSupportForBaselineJob(
  jobIds: readonly string[],
  jobId: string,
  commonSlots: readonly string[],
  objective: "damage" | "dps" | undefined,
  foodStrategy: "shared" | "independent",
  factorizedSharedRingPair = false,
): boolean {
  const rdmPctSharedArmor = jobIds.length === 2 && jobIds.includes("RDM") && jobIds.includes("PCT") &&
    objective === "dps" && foodStrategy === "shared" && commonSlots.length === 8 &&
    ["head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet"]
      .every((slot) => commonSlots.includes(slot));
  if (rdmPctSharedArmor) return jobId === "PCT";
  return shouldUseMainStatResourceSupportForBaseline(
    jobIds,
    commonSlots,
    objective,
    foodStrategy,
    factorizedSharedRingPair,
  );
}

/** 仅在经过测量的双职业共享首饰场景中使用精确魔晶石修复种子。 */
export function shouldUseSharedMateriaCompensation(
  jobIds: readonly string[],
  commonSlots: readonly string[],
  objective: "damage" | "dps" | undefined,
  foodStrategy: "shared" | "independent",
  factorizedSharedRingPair = false,
): boolean {
  commonSlots = policyCommonSlots(commonSlots, factorizedSharedRingPair);
  const jobs = new Set(["RPR", "SAM"]);
  const sharedRingPair = commonSlots.includes("rings") && commonSlots.length === 4;
  return jobIds.length === jobs.size && jobIds.every((job) => jobs.has(job)) &&
    objective === "dps" && foodStrategy === "shared" && sharedRingPair &&
    ["earrings", "necklace", "bracelet"].every((slot) => commonSlots.includes(slot));
}

/** 精简小型联合基线，并限制宽批次的模型约束行数量。 */
export function candidateResourceSupportProfile(
  jobCount: number,
  candidateCount: number,
): CandidateResourceSupportProfile {
  if (!Number.isSafeInteger(jobCount) || jobCount < 1 ||
    !Number.isSafeInteger(candidateCount) || candidateCount < 0) return "disabled";
  if (jobCount === 2 || jobCount === 3) return "disabled";
  if (jobCount >= 4 && candidateCount >= 100_000) return "disabled";
  return "compact";
}

/** 为经过测量的四职业未同步快照恢复加权精简支撑约束行。 */
export function candidateResourceSupportProfileForSearch(input: {
  jobs: readonly MeasuredSearchDomain[];
  candidateCount: number;
  commonSlots: readonly string[];
  objective: "damage" | "dps";
  foodStrategy: "shared" | "independent";
}): CandidateResourceSupportProfile {
  const fallback = candidateResourceSupportProfile(input.jobs.length, input.candidateCount);
  const ids = input.jobs.map(({ jobId }) => jobId).sort().join("+");
  const first = input.jobs[0];
  const sameDomain = first !== undefined && input.jobs.every((job) =>
    job.minItemLevel === first.minItemLevel && job.maxItemLevel === first.maxItemLevel &&
    sameSync(job.sync, first.sync));
  if (sameDomain && ids === "BRD+DNC+MCH+VPR" && input.jobs.length === 4 &&
    input.objective === "dps" && input.foodStrategy === "independent" && input.commonSlots.length === 0 &&
    first!.minItemLevel === 770 && first!.maxItemLevel === 795 && first!.sync === undefined) {
    return "compact-weighted";
  }
  return fallback;
}

