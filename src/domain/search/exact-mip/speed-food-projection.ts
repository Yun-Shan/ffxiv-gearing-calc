import { throwIfCancelled } from "../cancellation.ts";
import { addRows, addTerm } from "../core/model-builder.ts";
import type { ModelRow } from "../core/model-types.ts";
import type { GcdSpeedRange } from "../search-types.ts";
import type { AttributeFoodBonus, ExactMipOptions } from "./types.ts";

type ProjectionModel = {
  fixedEquipmentAttributes: readonly (readonly (readonly number[])[])[];
  resistanceAllocationVariables: readonly {
    slotIndex: number;
    candidateIndex: number;
    attributeIndex: number;
    maxValue: number;
  }[];
  foodVariables: readonly string[];
  rawVariables: readonly string[];
  foodBonuses: readonly AttributeFoodBonus[];
  idToIndex: ReadonlyMap<number, number>;
  ranges: ReadonlyMap<number, { min?: number; max?: number }>;
  gcdChoiceRanges: readonly GcdSpeedRange[];
};

export type SpeedFoodProjection = {
  /** Unique and multi-attribute allocation compatibility remain in the original model. */
  coverage: "slotwise-speed-relaxation";
  rawSpeeds: readonly number[];
  /** Indexes match options.foods; no-food searches have one virtual food. */
  rawSpeedsByFood: readonly (readonly number[])[];
  excludedFoodIndexes: readonly number[];
  rows: readonly ModelRow[];
  transitionWork: number;
  foodEvaluations: number;
};

type ProjectionLimits = {
  maxTransitionWork?: number;
  maxRawSpan?: number;
  maxFoodEvaluations?: number;
};

/**
 * T11: project the complete slotwise speed relaxation onto each food choice.
 * No rows are published until every speed and food has been covered. Dropping
 * ring uniqueness or correlations between allocation axes only enlarges this
 * relaxation; the original integer model still enforces those constraints.
 */
export function prepareSpeedFoodProjection(
  options: ExactMipOptions,
  model: ProjectionModel,
  limits: ProjectionLimits = {},
): SpeedFoodProjection | undefined {
  const constraints = options.constraints;
  if (constraints === undefined ||
    (constraints.gcd === undefined && constraints.gcdChoices === undefined &&
      constraints.speedMin === undefined && constraints.speedMax === undefined) ||
    options.speedAttributeId === undefined) return undefined;
  const attribute = model.idToIndex.get(options.speedAttributeId);
  if (attribute === undefined || model.rawVariables[attribute] === undefined) return undefined;
  const maxTransitionWork = limits.maxTransitionWork ?? 1_000_000;
  const maxRawSpan = limits.maxRawSpan ?? 200_000;
  const maxFoodEvaluations = limits.maxFoodEvaluations ?? 1_000_000;
  if ([maxTransitionWork, maxRawSpan, maxFoodEvaluations].some((limit) =>
    !Number.isSafeInteger(limit) || limit < 1)) return undefined;
  throwIfCancelled(options.isCancelled);

  const range = model.ranges.get(attribute);
  const minimumFinal = range?.min === undefined ? undefined : Math.ceil(range.min);
  const maximumFinal = range?.max === undefined ? undefined : Math.floor(range.max);
  if ([minimumFinal, maximumFinal].some((value) =>
    value !== undefined && !Number.isSafeInteger(value)) ||
    model.gcdChoiceRanges.some(({ min, max }) =>
      !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max)) return undefined;
  if (model.fixedEquipmentAttributes.length !== options.slots.length ||
    model.foodVariables.length !== options.foods.length) return undefined;

  const allocationByCandidate = new Map<string, number>();
  for (const allocation of model.resistanceAllocationVariables) {
    if (allocation.attributeIndex !== attribute) continue;
    const key = `${allocation.slotIndex}:${allocation.candidateIndex}`;
    const maximum = (allocationByCandidate.get(key) ?? 0) + allocation.maxValue;
    if (!Number.isSafeInteger(allocation.maxValue) || allocation.maxValue < 0 ||
      !Number.isSafeInteger(maximum)) return undefined;
    allocationByCandidate.set(key, maximum);
  }

  let transitionWork = 0;
  const checkpoint = () => throwIfCancelled(options.isCancelled);
  const slotValues: number[][] = [];
  for (let slotIndex = 0; slotIndex < model.fixedEquipmentAttributes.length; slotIndex++) {
    checkpoint();
    const slot = model.fixedEquipmentAttributes[slotIndex]!;
    if (slot.length === 0 || slot.length !== options.slots[slotIndex]!.length) return undefined;
    const values = new Set<number>();
    for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
      const fixed = slot[candidateIndex]![attribute];
      const maximum = allocationByCandidate.get(`${slotIndex}:${candidateIndex}`) ?? 0;
      if (!Number.isSafeInteger(fixed) || fixed! < 0 ||
        !Number.isSafeInteger(fixed! + maximum) ||
        maximum + 1 > maxTransitionWork - transitionWork) return undefined;
      for (let increment = 0; increment <= maximum; increment++) {
        if ((transitionWork++ & 255) === 0) checkpoint();
        values.add(fixed! + increment);
      }
    }
    slotValues.push([...values]);
  }

  let minimum = 0;
  let maximum = 0;
  let reachableCount = 1;
  let reachable = Uint8Array.of(1);
  for (const values of slotValues) {
    checkpoint();
    const layerWork = reachable.length + reachableCount * values.length;
    if (!Number.isSafeInteger(layerWork) || layerWork > maxTransitionWork - transitionWork) return undefined;
    const nextMinimum = minimum + values.reduce((best, value) => Math.min(best, value), Infinity);
    const nextMaximum = maximum + values.reduce((best, value) => Math.max(best, value), -Infinity);
    const width = nextMaximum - nextMinimum + 1;
    if (!Number.isSafeInteger(nextMinimum) || !Number.isSafeInteger(nextMaximum) ||
      !Number.isSafeInteger(width) || width <= 0 || width > maxRawSpan) return undefined;
    const next = new Uint8Array(width);
    let nextCount = 0;
    for (let index = 0; index < reachable.length; index++) {
      if ((transitionWork++ & 255) === 0) checkpoint();
      if (reachable[index] !== 1) continue;
      for (const value of values) {
        if ((transitionWork++ & 255) === 0) checkpoint();
        const target = minimum + index + value - nextMinimum;
        if (next[target] === 0) {
          next[target] = 1;
          nextCount++;
        }
      }
    }
    reachable = next;
    reachableCount = nextCount;
    minimum = nextMinimum;
    maximum = nextMaximum;
  }
  const rawSpeeds: number[] = [];
  for (let index = 0; index < reachable.length; index++) {
    if ((index & 255) === 0) checkpoint();
    if (reachable[index] === 1) rawSpeeds.push(minimum + index);
  }
  const foodCount = Math.max(1, options.foods.length);
  if (rawSpeeds.length > Math.floor(maxFoodEvaluations / foodCount)) return undefined;

  let foodEvaluations = 0;
  const rawSpeedsByFood: number[][] = [];
  const excludedFoodIndexes: number[] = [];
  for (let foodIndex = 0; foodIndex < foodCount; foodIndex++) {
    checkpoint();
    const parameters = options.foods[foodIndex]?.baseParams.filter((param) =>
      param.baseParamId === options.speedAttributeId) ?? [];
    const bonuses = model.foodBonuses.filter((bonus) =>
      bonus.foodIndex === foodIndex && bonus.attribute === attribute);
    if (parameters.length > 1 || bonuses.length > 1) return undefined;
    const parameter = parameters[0];
    const bonus = bonuses[0];
    const hasBonus = parameter !== undefined && parameter.multiplier > 1 && parameter.maxValue > 0;
    if (hasBonus !== (bonus !== undefined)) return undefined;
    const baseValue = parameter?.baseValue ?? 0;
    if (!Number.isSafeInteger(baseValue) || baseValue < 0 ||
      (bonus !== undefined &&
        (!Number.isSafeInteger(bonus.numerator) || bonus.numerator < 0 ||
          !Number.isSafeInteger(bonus.denominator) || bonus.denominator <= 0 ||
          !Number.isSafeInteger(bonus.cap) || bonus.cap < 0))) return undefined;
    const retained: number[] = [];
    for (const raw of rawSpeeds) {
      if ((foodEvaluations++ & 255) === 0) checkpoint();
      const exactBonus = bonus === undefined ? 0n :
        (BigInt(raw) + BigInt(baseValue)) * BigInt(bonus.numerator) / BigInt(bonus.denominator);
      const cappedBonus = bonus === undefined ? 0n :
        exactBonus < BigInt(bonus.cap) ? exactBonus : BigInt(bonus.cap);
      const final = raw + Number(cappedBonus);
      if (!Number.isSafeInteger(final)) return undefined;
      if ((minimumFinal !== undefined && final < minimumFinal) ||
        (maximumFinal !== undefined && final > maximumFinal) ||
        (model.gcdChoiceRanges.length > 0 && !model.gcdChoiceRanges.some(({ min, max }) =>
          final >= min && final <= max))) continue;
      retained.push(raw);
    }
    if (retained.length === 0) excludedFoodIndexes.push(foodIndex);
    rawSpeedsByFood.push(retained);
  }
  checkpoint();

  const rows: ModelRow[] = [];
  const rawVariable = model.rawVariables[attribute]!;
  if (options.foods.length === 0) {
    const values = rawSpeedsByFood[0]!;
    if (values.length === 0) addRows(rows, "speed_food_empty", [], "=", 1);
    else {
      addRows(rows, "speed_food_raw_min", [[rawVariable, 1]], ">=", values[0]!);
      addRows(rows, "speed_food_raw_max", [[rawVariable, 1]], "<=", values.at(-1)!);
    }
  } else {
    const lower = new Map<string, number>([[rawVariable, 1]]);
    const upper = new Map<string, number>([[rawVariable, 1]]);
    rawSpeedsByFood.forEach((values, foodIndex) => {
      const variable = model.foodVariables[foodIndex]!;
      if (values.length === 0) addRows(rows, `speed_food_exclude_${foodIndex}`, [[variable, 1]], "=", 0);
      else {
        addTerm(lower, variable, -values[0]!);
        addTerm(upper, variable, -values.at(-1)!);
      }
    });
    addRows(rows, "speed_food_raw_min", lower, ">=", 0);
    addRows(rows, "speed_food_raw_max", upper, "<=", 0);
  }
  return {
    coverage: "slotwise-speed-relaxation",
    rawSpeeds,
    rawSpeedsByFood,
    excludedFoodIndexes,
    rows,
    transitionWork,
    foodEvaluations,
  };
}
