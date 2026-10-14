import type { IntegerDamageFactors } from "./equipped-effects.ts";
import type { FoodParam } from "./types.ts";

const canonicalEvaluatorOptions = new WeakSet<object>();
const MIN_CANDIDATES_FOR_UPPER_BOUND = 2_000;

/** 内部可信标记；有意不加入 ExactMipOptions 和公开搜索导出入口。 */
export function markCanonicalEvaluatorCandidateUpperBound<T extends object>(options: T): T {
  canonicalEvaluatorOptions.add(options);
  return options;
}

export function hasCanonicalEvaluatorCandidateUpperBound(options: object): boolean {
  return canonicalEvaluatorOptions.has(options);
}

export function inheritCanonicalEvaluatorCandidateUpperBound<T extends object>(
  source: object,
  target: T,
): T {
  return canonicalEvaluatorOptions.has(source)
    ? markCanonicalEvaluatorCandidateUpperBound(target)
    : target;
}

export function shouldEnableCanonicalCandidateUpperBound(
  options: {
    slots: readonly (readonly unknown[])[];
    equipmentAttributeExtractor?: unknown;
    constraints?: { maxToughnessMode?: boolean };
  },
  hasCanonicalEvaluatorMarker: boolean,
): boolean {
  if (!hasCanonicalEvaluatorMarker || options.equipmentAttributeExtractor !== undefined ||
      options.constraints?.maxToughnessMode === true) return false;
  const candidateCount = options.slots.reduce((total, slot) => total + slot.length, 0);
  return Number.isSafeInteger(candidateCount) && candidateCount >= MIN_CANDIDATES_FOR_UPPER_BOUND;
}

export type RationalFoodBonusInput = {
  baseValue: number;
  multiplier: number;
  maxValue: number;
  numerator: number;
  denominator: number;
};

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function parseRationalRate(rate: number): { numerator: number; denominator: number } | undefined {
  const numerator = Math.round(rate * 100);
  if (!Number.isSafeInteger(numerator) || numerator < 0) return undefined;
  const divisor = gcd(numerator, 100);
  return { numerator: numerator / divisor, denominator: 100 / divisor };
}

function foodBonusAtRawWithRate(raw: number, parameter: RationalFoodBonusInput): number | undefined {
  const { baseValue, multiplier, maxValue, numerator, denominator } = parameter;
  const offsetRaw = raw + baseValue;
  if (!Number.isSafeInteger(raw) || raw < 0 || !Number.isSafeInteger(offsetRaw) ||
      !Number.isFinite(multiplier) || multiplier < 1 || !Number.isSafeInteger(maxValue) || maxValue < 0 ||
      !Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
    return undefined;
  }
  const formulaBonus = Math.min(maxValue, Math.trunc(offsetRaw * (multiplier - 1) + 1e-7));
  const rationalBonus = Math.min(maxValue, Math.floor((offsetRaw * numerator) / denominator));
  if (!Number.isSafeInteger(formulaBonus) || !Number.isSafeInteger(rationalBonus) ||
      formulaBonus < 0 || formulaBonus !== rationalBonus) return undefined;
  return formulaBonus;
}

export function canonicalFoodBonusUpperBoundAtRaw(
  raw: number,
  parameter: FoodParam,
): number | undefined {
  const baseValue = parameter.baseValue ?? 0;
  if (!Number.isSafeInteger(baseValue) || baseValue < 0 || !Number.isFinite(parameter.multiplier) ||
      parameter.multiplier < 1 || !Number.isSafeInteger(parameter.maxValue) || parameter.maxValue < 0) {
    return undefined;
  }
  const rate = parseRationalRate(parameter.multiplier - 1);
  if (rate === undefined) return undefined;
  return foodBonusAtRawWithRate(raw, {
    baseValue,
    multiplier: parameter.multiplier,
    maxValue: parameter.maxValue,
    ...rate,
  });
}

function safeDamageFactors(factors: IntegerDamageFactors): boolean {
  return [
    factors.weaponDamage,
    factors.mainStat,
    factors.determination,
    factors.tenacity,
    factors.critical,
    factors.directHit,
    factors.gcdCentiseconds,
  ].every((value) => Number.isSafeInteger(value) && value > 0);
}

function exactProduct(factors: IntegerDamageFactors): bigint {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) * BigInt(factors.determination) *
    BigInt(factors.tenacity) * BigInt(factors.critical) * BigInt(factors.directHit);
}

/** 对候选上界执行精确比较；相等时有意保留候选。 */
export function candidateUpperBoundIsStrictlyWorse(
  incumbent: IntegerDamageFactors,
  upperBound: IntegerDamageFactors,
  useDps: boolean,
): boolean {
  if (!safeDamageFactors(incumbent) || !safeDamageFactors(upperBound)) return false;
  const incumbentProduct = exactProduct(incumbent);
  const upperProduct = exactProduct(upperBound);
  return useDps
    ? incumbentProduct * BigInt(upperBound.gcdCentiseconds) > upperProduct * BigInt(incumbent.gcdCentiseconds)
    : incumbentProduct > upperProduct;
}

/** 为仅搜索严格改进解的证明模型计算精确的当前最优界。 */
export function candidateUpperBoundCannotImproveIncumbent(
  incumbent: IntegerDamageFactors,
  upperBound: IntegerDamageFactors,
  useDps: boolean,
): boolean {
  if (!safeDamageFactors(incumbent) || !safeDamageFactors(upperBound)) return false;
  const incumbentProduct = exactProduct(incumbent);
  const upperProduct = exactProduct(upperBound);
  return useDps
    ? upperProduct * BigInt(incumbent.gcdCentiseconds) <=
      incumbentProduct * BigInt(upperBound.gcdCentiseconds)
    : upperProduct <= incumbentProduct;
}

export function canonicalFoodBonusAtRawWithRate(
  raw: number,
  parameter: RationalFoodBonusInput,
): number | undefined {
  return foodBonusAtRawWithRate(raw, parameter);
}

