import type { FoodInfo } from "../types.ts";
import type { FoodChoice, JobContext } from "./types.ts";
import { rawAttributeMaximums } from "./attributes.ts";
import { speedMustRemainEqual } from "./candidate-dominance.ts";

export function foodIdentity(food: FoodInfo): string {
  if (food.physicalKey !== undefined) return food.physicalKey;
  return JSON.stringify({
    itemId: food.itemId,
    itemLevel: food.itemLevel,
    baseParams: food.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [baseParamId, multiplier, maxValue] as const)
      .sort((left, right) => left[0] - right[0]),
  });
}

export function foodIdentityForOptional(food: FoodInfo | undefined): string {
  return food === undefined ? "no-food" : foodIdentity(food);
}

/** Physical identity alone does not determine the effect within a job's input domain. */
export function foodCandidateIdentity(food: FoodInfo): string {
  return JSON.stringify([foodIdentity(food), food.baseParams.map((param) => [
    param.baseParamId, param.multiplier, param.maxValue, param.baseValue ?? 0,
  ])]);
}

export function foodsForChoice(choice: FoodChoice, jobId: string): readonly FoodInfo[] {
  const variants = choice.foodVariants?.get(jobId);
  if (variants !== undefined) return variants;
  const representative = choice.foods.get(jobId);
  return representative === undefined ? [] : [representative];
}

export function foodChoiceContains(choice: FoodChoice, jobId: string, food: FoodInfo | undefined): boolean {
  const candidates = foodsForChoice(choice, jobId);
  if (food === undefined) return candidates.length === 0;
  const key = foodCandidateIdentity(food);
  return candidates.some((candidate) => foodCandidateIdentity(candidate) === key);
}

export function hasFoodVariants(choice: FoodChoice): boolean {
  return [...(choice.foodVariants?.values() ?? [])].some((foods) => foods.length > 1);
}

function foodBonus(food: FoodInfo | undefined, attributeId: number, raw: number): number {
  const param = food?.baseParams.find(entry => entry.baseParamId === attributeId);
  if (param === undefined) return 0;
  return Math.min(param.maxValue, Math.trunc((raw + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7));
}

function sharedFoodDominates(
  left: FoodChoice,
  right: FoodChoice,
  contexts: readonly JobContext[],
  rawMaximums: ReadonlyMap<string, readonly number[]>,
  checkBudget: () => void,
): boolean {
  let strict = false;
  for (const context of contexts) {
    const leftFood = left.foods.get(context.job.id);
    const rightFood = right.foods.get(context.job.id);
    const speedId = context.job.options.speedAttributeId;
    const maximums = rawMaximums.get(context.job.id)!;
    const attributeIds = new Set([
      ...(leftFood?.baseParams.map((param) => param.baseParamId) ?? []),
      ...(rightFood?.baseParams.map((param) => param.baseParamId) ?? []),
    ]);
    for (const attributeId of attributeIds) {
      const attribute = context.attributeIndexes.get(attributeId);
      if (attribute === undefined) continue;
      const maximum = maximums[attribute]!;
      for (let raw = 0; raw <= maximum; raw++) {
        if ((raw & 2047) === 0) checkBudget();
        const leftBonus = foodBonus(leftFood, attributeId, raw);
        const rightBonus = foodBonus(rightFood, attributeId, raw);
        if (speedMustRemainEqual(context) && attributeId === speedId && leftBonus !== rightBonus) {
          return false;
        }
        if (leftBonus < rightBonus) return false;
        if (leftBonus > rightBonus) strict = true;
      }
    }
  }
  return strict;
}

function sharedFoodsEquivalent(
  left: FoodChoice,
  right: FoodChoice,
  contexts: readonly JobContext[],
  rawMaximums: ReadonlyMap<string, readonly number[]>,
  checkBudget: () => void,
): boolean {
  for (const context of contexts) {
    const leftFood = left.foods.get(context.job.id);
    const rightFood = right.foods.get(context.job.id);
    const maximums = rawMaximums.get(context.job.id)!;
    const attributeIds = new Set([
      ...(leftFood?.baseParams.map((param) => param.baseParamId) ?? []),
      ...(rightFood?.baseParams.map((param) => param.baseParamId) ?? []),
    ]);
    for (const attributeId of attributeIds) {
      const attribute = context.attributeIndexes.get(attributeId);
      if (attribute === undefined) continue;
      for (let raw = 0; raw <= maximums[attribute]!; raw++) {
        if ((raw & 2047) === 0) checkBudget();
        if (foodBonus(leftFood, attributeId, raw) !== foodBonus(rightFood, attributeId, raw)) {
          return false;
        }
      }
    }
  }
  return true;
}

export function pruneSharedFoods(
  choices: readonly FoodChoice[],
  contexts: readonly JobContext[],
  checkBudget: () => void,
): FoodChoice[] {
  // Representative effects cannot prove dominance between physical-key domains.
  if (choices.some(hasFoodVariants)) return [...choices];
  if (choices.length < 2) return [...choices];
  const rawMaximums = new Map(contexts.map((context) => [
    context.job.id,
    rawAttributeMaximums(context, checkBudget),
  ]));
  const baselineMatches = choices.map((choice) => contexts.reduce((count, context) =>
    count + Number(choice.key === foodIdentityForOptional(context.optimum.food)), 0));
  return choices.filter((candidate, candidateIndex) => {
    if ((candidateIndex & 3) === 0) checkBudget();
    for (let otherIndex = 0; otherIndex < choices.length; otherIndex++) {
      if (candidateIndex === otherIndex) continue;
      if (sharedFoodDominates(choices[otherIndex]!, candidate, contexts, rawMaximums, checkBudget)) return false;
      const equalEffects = sharedFoodsEquivalent(choices[otherIndex]!, candidate, contexts, rawMaximums, checkBudget);
      if (
        equalEffects &&
        (baselineMatches[otherIndex]! > baselineMatches[candidateIndex]! ||
          (baselineMatches[otherIndex] === baselineMatches[candidateIndex] && otherIndex < candidateIndex))
      ) return false;
    }
    return true;
  });
}
