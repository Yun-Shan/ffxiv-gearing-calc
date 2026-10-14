const trustedPolicyOptions = new WeakSet<object>();
const requiredSharedSlots = ["bracelet", "earrings", "necklace", "ring", "ring2"] as const;

export type SharedAccessoryPairDominanceLimits = {
  maxCandidates: number;
  maxComparisons: number;
  maxCuts: number;
  maxPreprocessingMs: number;
};

/** 职业数量较少时，根据共享装备对的候选域大小选择有上限的剪枝预算。 */
export function sharedAccessoryPairDominanceLimitsFor(
  jobCount: number,
  candidateUpperBound: bigint,
): SharedAccessoryPairDominanceLimits {
  if (!Number.isSafeInteger(jobCount) || jobCount < 2 ||
    typeof candidateUpperBound !== "bigint" || candidateUpperBound < 0n) {
    throw new RangeError("共享饰品对 Pareto 预算输入无效");
  }
  if (jobCount <= 3) {
    const largerPairDomain = candidateUpperBound > 1_500n;
    return {
      maxCandidates: 50_000,
      maxComparisons: largerPairDomain ? 150_000 : 75_000,
      maxCuts: largerPairDomain ? 128 : 64,
      maxPreprocessingMs: 100,
    };
  }
  return {
    maxCandidates: 50_000,
    maxComparisons: 300_000,
    maxCuts: 512,
    maxPreprocessingMs: 250,
  };
}

export type SharedAccessoryPairDominanceGateJob = {
  id: string;
  job: string;
  objective: "damage" | "dps" | undefined;
  hasCanonicalEvaluator: boolean;
  hasCustomAttributeExtractor: boolean;
  hasConstraints: boolean;
};

export type SharedAccessoryPairDominanceGateInput = {
  trustedPolicyPath: boolean;
  requested: boolean;
  jobs: readonly SharedAccessoryPairDominanceGateJob[];
  commonSlots: readonly string[];
  hasCommonSlotProjections: boolean;
  sharedFood: boolean;
  objective: "damage" | "dps";
  canonicalSharedRingPair: boolean;
};

export function canUseSharedAccessoryPairDominance(
  input: SharedAccessoryPairDominanceGateInput,
): boolean {
  if (!input.trustedPolicyPath || !input.requested ||
    input.objective !== "dps" || !input.sharedFood || !input.canonicalSharedRingPair ||
    input.hasCommonSlotProjections ||
    input.jobs.length < 2 ||
    !requiredSharedSlots.every((slot) => input.commonSlots.includes(slot))) return false;

  return input.jobs.every(({ id, job, objective, hasCanonicalEvaluator, hasCustomAttributeExtractor, hasConstraints }) =>
    job === id &&
    objective === "dps" &&
    hasCanonicalEvaluator &&
    !hasCustomAttributeExtractor &&
    !hasConstraints);
}

/** 内部能力标记；仅受严格条件限制的优化器路径可以签发此策略。 */
export function markSharedAccessoryPairDominancePath<T extends object>(options: T): T {
  trustedPolicyOptions.add(options);
  return options;
}

export function hasSharedAccessoryPairDominancePath(options: object): boolean {
  return trustedPolicyOptions.has(options);
}
