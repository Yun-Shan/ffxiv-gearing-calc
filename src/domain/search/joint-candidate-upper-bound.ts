export type JointExactRatio = {
  numerator: bigint;
  denominator: bigint;
};

/**
 * 要让联合总和有所提升，每个职业的比值都必须超过“当前最优联合比值 - (职业数量 - 1)”。
 * 这是因为其余每个职业的比值都受各自已证明的基线比值 1 限制。
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
