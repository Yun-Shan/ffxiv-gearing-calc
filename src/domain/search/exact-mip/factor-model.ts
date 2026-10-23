import type { FactorClass } from "./types.ts";
import { roundedLog } from "../core/exact-arithmetic.ts";
import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { FactorGroup } from "./types.ts";

export function buildFactorClasses(
  groupName: string,
  values: readonly { value: number; auxiliary?: number }[],
  firstValue = 0,
): FactorClass[] {
  if (values.length === 0) throw new Error(`因子组 ${groupName} 没有可达值`);
  const result: FactorClass[] = [];
  let start = firstValue;
  for (let index = 1; index <= values.length; index++) {
    const previous = values[index - 1]!;
    const current = values[index];
    if (
      current !== undefined &&
      current.value === previous.value &&
      current.auxiliary === previous.auxiliary
    ) continue;
    result.push({
      min: start,
      max: firstValue + index - 1,
      value: previous.value,
      auxiliary: previous.auxiliary,
      variable: `${groupName}_${result.length}`,
      q: roundedLog(previous.value),
    });
    start = firstValue + index;
  }
  return result;
}

export function factorValue(
  factors: IntegerDamageFactors,
  name: "mainStat" | "determination" | "tenacity" | "critical" | "directHit" | "gcdCentiseconds",
): number {
  return factors[name];
}

export function makeVector(length: number, index: number, value: number): number[] {
  const result = new Array<number>(length).fill(0);
  result[index] = value;
  return result;
}

export function exactProduct(factors: IntegerDamageFactors): bigint {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
    BigInt(factors.determination) * BigInt(factors.tenacity) *
    BigInt(factors.critical) * BigInt(factors.directHit);
}

export function factorObjectiveLogScore(factors: IntegerDamageFactors, useDps: boolean): number {
  return roundedLog(factors.weaponDamage) + roundedLog(factors.mainStat) +
    roundedLog(factors.determination) + roundedLog(factors.tenacity) +
    roundedLog(factors.critical) + roundedLog(factors.directHit) -
    (useDps ? roundedLog(factors.gcdCentiseconds) : 0);
}

export function betterFactors(
  candidate: IntegerDamageFactors,
  incumbent: IntegerDamageFactors | undefined,
  useDps: boolean,
): boolean {
  if (incumbent === undefined) return true;
  const candidateProduct = exactProduct(candidate);
  const incumbentProduct = exactProduct(incumbent);
  if (!useDps) return candidateProduct > incumbentProduct;
  return candidateProduct * BigInt(incumbent.gcdCentiseconds) >
    incumbentProduct * BigInt(candidate.gcdCentiseconds);
}

export function factorGroupsForAttribute(
  name: string,
  attributeIndex: number | undefined,
  maximum: number,
  vectorLength: number,
  evaluator: (attributes: readonly number[]) => IntegerDamageFactors | undefined,
  field: "mainStat" | "determination" | "tenacity" | "critical" | "directHit" | "gcdCentiseconds",
  withBluAddition = false,
  weaponBase = 0,
  minimum = 0,
): FactorGroup {
  const values: { value: number; auxiliary?: number }[] = [];
  const firstValue = attributeIndex === undefined ? 0 : minimum;
  for (let value = firstValue; value <= (attributeIndex === undefined ? 0 : maximum); value++) {
    const attributes = attributeIndex === undefined
      ? new Array<number>(vectorLength).fill(0)
      : makeVector(vectorLength, attributeIndex, value);
    const factors = evaluator(attributes);
    if (factors === undefined) throw new Error("当前职业没有可用的整数伤害因子公式");
    values.push({
      value: factorValue(factors, field),
      auxiliary: withBluAddition
        ? factors.weaponDamage - weaponBase
        : undefined,
    });
  }
  const classes = buildFactorClasses(name, values, firstValue);
  for (let index = 1; index < classes.length; index++) {
    const previous = classes[index - 1]!;
    const current = classes[index]!;
    const decreases = field === "gcdCentiseconds"
      ? current.value > previous.value
      : current.value < previous.value;
    if (decreases) {
      throw new Error(`因子 ${name} 非单调递增，无法压缩成线性区间`);
    }
  }
  return { name, classes };
}

export function retainReachableFactorClasses(group: FactorGroup, reachableValues: readonly number[]): number {
  const retained: FactorClass[] = [];
  let valueIndex = 0;
  for (const factorClass of group.classes) {
    while (valueIndex < reachableValues.length && reachableValues[valueIndex]! < factorClass.min) valueIndex++;
    const firstIndex = valueIndex;
    while (valueIndex < reachableValues.length && reachableValues[valueIndex]! <= factorClass.max) valueIndex++;
    if (valueIndex > firstIndex) retained.push({
      ...factorClass,
      min: reachableValues[firstIndex]!,
      max: reachableValues[valueIndex - 1]!,
    });
  }
  if (retained.length === 0) return 0;
  const removed = group.classes.length - retained.length;
  group.classes = retained;
  return removed;
}
