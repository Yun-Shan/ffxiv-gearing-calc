import type { ExactRatio } from "./joint-types.ts";

export const ratioAtOrBelowThreshold = (
  ratio: ExactRatio,
  numerator: bigint,
  denominator: bigint,
) =>
  ratio.numerator > ratio.denominator
    ? denominator <= numerator
    : ratio.numerator * denominator <= ratio.denominator * numerator;
export const cannotBeatThreshold = (
  ratios: readonly (ExactRatio | undefined)[],
  numerator: bigint,
  denominator: bigint,
) =>
  ratios.some(
    (ratio) =>
      ratio !== undefined &&
      ratioAtOrBelowThreshold(ratio, numerator, denominator),
  );
const bigintGcd = (left: bigint, right: bigint) => {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};
export const sumCappedRatios = (
  ratios: readonly (ExactRatio | undefined)[],
): ExactRatio | undefined => {
  if (ratios.some((ratio) => ratio === undefined || ratio.denominator <= 0n))
    return undefined;
  let sumNumerator = 0n;
  let sumDenominator = 1n;
  for (const entry of ratios) {
    const candidate = entry!;
    const ratio =
      candidate.numerator > candidate.denominator
        ? { numerator: 1n, denominator: 1n }
        : candidate;
    const sharedDivisor = bigintGcd(sumDenominator, ratio.denominator);
    sumNumerator =
      sumNumerator * (ratio.denominator / sharedDivisor) +
      ratio.numerator * (sumDenominator / sharedDivisor);
    sumDenominator *= ratio.denominator / sharedDivisor;
    const reduction = bigintGcd(sumNumerator, sumDenominator);
    if (reduction > 1n) {
      sumNumerator /= reduction;
      sumDenominator /= reduction;
    }
  }
  return { numerator: sumNumerator, denominator: sumDenominator };
};
export const compareCappedRatioSums = (
  left: ExactRatio | undefined,
  right: ExactRatio | undefined,
) => {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
export const ratioSumAtOrBelowThreshold = (
  ratios: readonly (ExactRatio | undefined)[],
  numerator: bigint,
  denominator: bigint,
) => {
  if (ratios.some((ratio) => ratio === undefined || ratio.denominator <= 0n))
    return false;
  let sumNumerator = 0n;
  let sumDenominator = 1n;
  for (const entry of ratios) {
    const candidate = entry!;
    const ratio =
      candidate.numerator > candidate.denominator
        ? { numerator: 1n, denominator: 1n }
        : candidate;
    const sharedDivisor = bigintGcd(sumDenominator, ratio.denominator);
    sumNumerator =
      sumNumerator * (ratio.denominator / sharedDivisor) +
      ratio.numerator * (sumDenominator / sharedDivisor);
    sumDenominator *= ratio.denominator / sharedDivisor;
    const reduction = bigintGcd(sumNumerator, sumDenominator);
    if (reduction > 1n) {
      sumNumerator /= reduction;
      sumDenominator /= reduction;
    }
  }
  return sumNumerator * denominator <= numerator * sumDenominator;
};
