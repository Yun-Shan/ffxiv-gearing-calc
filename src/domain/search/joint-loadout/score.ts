import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { JobContext, Rational } from "./types.ts";
import { applyFood, buildRawAttributes } from "./attributes.ts";

function bigintGcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

export function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new RangeError("联合配装评分分母不能为零");
  if (denominator < 0n) return rational(-numerator, -denominator);
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const divisor = bigintGcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function addRational(left: Rational, right: Rational): Rational {
  const common = bigintGcd(left.denominator, right.denominator);
  const leftScale = right.denominator / common;
  const rightScale = left.denominator / common;
  return rational(
    left.numerator * leftScale + right.numerator * rightScale,
    left.denominator * leftScale,
  );
}

export function compareRational(left: Rational, right: Rational): number {
  const a = left.numerator * right.denominator;
  const b = right.numerator * left.denominator;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function integerDamageProduct(factors: IntegerDamageFactors): bigint {
  const values = [
    factors.weaponDamage,
    factors.mainStat,
    factors.determination,
    factors.tenacity,
    factors.critical,
    factors.directHit,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(`伤害因子不是正安全整数：${values.join(",")}`);
  }
  return values.reduce((product, value) => product * BigInt(value), 1n);
}

export function factorsForResult(context: JobContext, result: ExactMipResult): IntegerDamageFactors {
  const raw = buildRawAttributes(context, result.selection);
  const final = applyFood(raw, result.food, context.attributeIndexes);
  const factors = context.factorEvaluator(final);
  if (factors === undefined) throw new Error(`职业 ${context.job.id} 的正式伤害因子无法计算`);
  return factors;
}

export function createExactScorer(contexts: readonly JobContext[], objective: "damage" | "dps") {
  const exactScore = (results: readonly ExactMipResult[]): Rational => {
    let total = rational(0n, 1n);
    for (let index = 0; index < contexts.length; index++) {
      const context = contexts[index]!;
      if (!context.active) continue;
      const factors = factorsForResult(context, results[index]!);
      const product = integerDamageProduct(factors);
      const normalized = objective === "dps"
        ? rational(
            product * BigInt(context.optimumGcd),
            BigInt(factors.gcdCentiseconds) * context.optimumProduct,
          )
        : rational(product, context.optimumProduct);
      total = addRational(total, normalized);
    }
    return total;
  };

  return exactScore;
}
