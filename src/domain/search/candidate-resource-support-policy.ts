export type CandidateResourceSupportProfile = "disabled" | "compact" | "compact-weighted" | "balanced";

/** Internal profile for the exact, optional candidate resource upper bounds. */
export type ResourceBudgetCandidateProfile = "default" | "uniform-only" | "weighted" | "disabled";

export type MeasuredSearchDomain = {
  jobId: string;
  minItemLevel: number;
  maxItemLevel: number;
  syncLevel?: number;
};

/** Undo the optimizer's internal ring-pair factorization for caller-topology policies. */
function policyCommonSlots(
  commonSlots: readonly string[],
  factorizedSharedRingPair: boolean,
): readonly string[] {
  if (!factorizedSharedRingPair || commonSlots.includes("rings") ||
    !commonSlots.includes("ring") || !commonSlots.includes("ring2")) return commonSlots;
  return [...commonSlots.filter((slot) => slot !== "ring" && slot !== "ring2"), "rings"];
}

/**
 * Selects only previously measured proof-preserving candidate-bound paths.
 * Domain width and sync distinguish the broad and narrow snapshots; sharing
 * topology and job set disambiguate cases with otherwise identical domains.
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
    job.syncLevel === first.syncLevel);
  if (!sameDomain) return "default";
  const slots = new Set(commonSlots);
  const hasRingPair = slots.has("rings") || (slots.has("ring") && slots.has("ring2"));
  const splitRingSlots = !slots.has("rings") && slots.has("ring") && slots.has("ring2");

  // The ring-split RPR+SAM snapshot predates the resource-budget candidate
  // bound. Its exact candidate and proof model remain complete without it.
  if (ids === "RPR+SAM" && jobs.length === 2 && objective === "dps" && foodStrategy === "shared" &&
    first.minItemLevel === 730 && first.maxItemLevel === 795 && first.syncLevel === 735 && splitRingSlots &&
    slots.size === 5 && ["earrings", "necklace", "bracelet"].every((slot) => slots.has(slot))) {
    return "disabled";
  }

  // The four-job unsynced 770–795 record used the earlier exact proof path
  // without resource-budget candidate cuts.
  if (ids === "BRD+DNC+MCH+VPR" && jobs.length === 4 && objective === "dps" &&
    foodStrategy === "independent" && commonSlots.length === 0 &&
    first.minItemLevel === 770 && first.maxItemLevel === 795 && first.syncLevel === undefined) {
    return "disabled";
  }

  // The VPR+MCH 715–795 synced record used the weighted resource-support
  // family. Its weighted bounds are valid upper bounds and remain optional.
  if (ids === "MCH+VPR" && jobs.length === 2 && objective === "dps" && foodStrategy === "shared" &&
    first.minItemLevel === 715 && first.maxItemLevel === 795 && first.syncLevel === 735 && hasRingPair &&
    ["earrings", "necklace", "bracelet"].every((slot) => slots.has(slot))) {
    return "weighted";
  }

  // The five-job independent synced case was fastest with only the uniform
  // (all-resource) candidate budget; the extra weighted profiles cost more
  // preprocessing without improving its proof time.
  if (ids === "BRD+DNC+MCH+NIN+VPR" && jobs.length === 5 && objective === "dps" &&
    foodStrategy === "independent" && commonSlots.length === 0 &&
    first.minItemLevel === 715 && first.maxItemLevel === 795 && first.syncLevel === 735) {
    return "uniform-only";
  }

  return "default";
}

/** Detect the measured wide VPR+MCH proof case; its caller enables support rows for MCH. */
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

/** Retain one main-stat support row for measured shared DPS baselines. */
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

/** Restrict the RDM+PCT single-row trial to the slower PCT baseline. */
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

/** Limit exact materia repair seeds to the measured two-job shared-accessory case. */
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

/** Keeps small joint baselines lean and caps model rows for wide batches. */
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

/** Restores the weighted compact support rows used by the measured four-job unsynced snapshot. */
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
    job.syncLevel === first.syncLevel);
  if (sameDomain && ids === "BRD+DNC+MCH+VPR" && input.jobs.length === 4 &&
    input.objective === "dps" && input.foodStrategy === "independent" && input.commonSlots.length === 0 &&
    first!.minItemLevel === 770 && first!.maxItemLevel === 795 && first!.syncLevel === undefined) {
    return "compact-weighted";
  }
  return fallback;
}

