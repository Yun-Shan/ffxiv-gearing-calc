const trustedPolicyOptions = new WeakSet<object>();
const expectedJobGroups = [
  ["BRD", "DNC", "MCH", "VPR"],
  ["BRD", "DNC", "MCH", "NIN", "VPR"],
] as const;
const expectedSharedSlots = ["bracelet", "earrings", "necklace", "ring", "ring2"] as const;

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
  const jobGroup = expectedJobGroups.find((group) => group.length === input.jobs.length &&
    [...input.jobs.map(({ id }) => id)].sort().join("\u0000") === [...group].sort().join("\u0000"));
  if (!input.trustedPolicyPath || !input.requested ||
    input.objective !== "dps" || !input.sharedFood || !input.canonicalSharedRingPair ||
    input.hasCommonSlotProjections ||
    jobGroup === undefined ||
    input.commonSlots.length !== expectedSharedSlots.length ||
    [...input.commonSlots].sort().join("\u0000") !== [...expectedSharedSlots].sort().join("\u0000") ||
    input.jobs.length !== jobGroup.length) return false;

  return input.jobs.every(({ id, job, objective, hasCanonicalEvaluator, hasCustomAttributeExtractor, hasConstraints }) =>
    job === id &&
    objective === "dps" &&
    hasCanonicalEvaluator &&
    !hasCustomAttributeExtractor &&
    !hasConstraints);
}

/** Internal capability marker; only the narrowly gated optimizer path may issue this policy. */
export function markSharedAccessoryPairDominancePath<T extends object>(options: T): T {
  trustedPolicyOptions.add(options);
  return options;
}

export function hasSharedAccessoryPairDominancePath(options: object): boolean {
  return trustedPolicyOptions.has(options);
}
