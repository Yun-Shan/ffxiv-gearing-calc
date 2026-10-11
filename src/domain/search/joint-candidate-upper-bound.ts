export type JointExactRatio = {
  numerator: bigint;
  denominator: bigint;
};

/**
 * An improving joint sum requires every job ratio to exceed
 * incumbent - (jobCount - 1), because every other job is bounded by its
 * independently proved baseline ratio of one.
 */
export function candidateUpperBoundCannotImproveJointIncumbent(
  candidateUpperBound: JointExactRatio,
  incumbent: JointExactRatio,
  jobCount: number,
): boolean {
  if (!Number.isSafeInteger(jobCount) || jobCount < 1 ||
    candidateUpperBound.numerator < 0n || candidateUpperBound.denominator <= 0n ||
    incumbent.denominator <= 0n) return false;
  const thresholdNumerator = incumbent.numerator - BigInt(jobCount - 1) * incumbent.denominator;
  return thresholdNumerator > 0n &&
    candidateUpperBound.numerator * incumbent.denominator <=
      candidateUpperBound.denominator * thresholdNumerator;
}
