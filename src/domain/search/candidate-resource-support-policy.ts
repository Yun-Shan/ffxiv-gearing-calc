export type CandidateResourceSupportProfile = "disabled" | "compact" | "balanced";

/** 精确搜索中可选候选资源上界的内部策略档位。 */
export type ResourceBudgetCandidateProfile = "default" | "uniform-only" | "weighted" | "disabled";

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
