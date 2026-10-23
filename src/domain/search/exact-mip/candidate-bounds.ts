import type { EquipInfo } from "../types.ts";
import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { ExactMipOptions } from "./types.ts";
import type { buildLinearAttributeModel } from "./attribute-model.ts";
import { gameData } from "../../data.ts";
import type { Stat } from "../../types.ts";
import { parseRationalRate } from "./attributes.ts";
import { canonicalFoodBonusAtRawWithRate } from "../exact-mip-candidate-upper-bound.ts";
import type { IntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import type { GreedyMipStart } from "./initial-solution.ts";
import { hasCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { getAttributeVector } from "./attributes.ts";
import { candidateUpperBoundIsStrictlyWorse } from "../exact-mip-candidate-upper-bound.ts";
import type { PreparedFactorResourceBudgetUpperBound } from "../factor-resource-budget-upper-bound.ts";
import type { FactorGroup } from "./types.ts";
import { prepareFactorResourceBudgetUpperBound } from "../factor-resource-budget-upper-bound.ts";
import { factorResourceWeightVectors } from "./resource-support.ts";

export type CandidateUpperBoundResult = {
  slots: readonly (readonly EquipInfo[])[];
  candidateUpperFactorsBySlot: readonly ReadonlyMap<EquipInfo, IntegerDamageFactors>[];
  candidatesBefore: number;
  candidatesAfter: number;
  elapsedMs: number;
};

export function candidateUpperBoundAttributeIndexes(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
): number[] | undefined {
  const schema = gameData.jobSchemas[options.job];
  if (schema?.mainStat === undefined) return undefined;
  const mainStat: Stat = schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const requiredStats = new Set<Stat>([mainStat, weaponStat, speedStat]);
  const relevantStats = new Set<Stat>([
    mainStat, weaponStat, speedStat, "CRT", "DET", "TEN", "DHT",
  ]);
  const indexes = new Set<number>();
  for (const stat of relevantStats) {
    const vectorIndex = options.statIndexes.get(stat);
    if (vectorIndex === undefined) {
      if (requiredStats.has(stat)) return undefined;
      continue;
    }
    const attributeId = options.attributeIds[vectorIndex];
    const modelIndex = attributeId === undefined ? undefined : model.idToIndex.get(attributeId);
    if (modelIndex === undefined || options.attributeIds[modelIndex] !== attributeId) {
      if (requiredStats.has(stat)) return undefined;
      continue;
    }
    indexes.add(modelIndex);
  }
  return [...indexes];
}

export function maximumFoodBonusTables(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  attributeIndexes: readonly number[],
  deadline: number,
  isCancelled: () => boolean,
): Map<number, Float64Array> | undefined {
  const maxFoodEvaluations = 20_000_000;
  let foodEvaluations = 0;
  const tables = new Map<number, Float64Array>();
  if (options.foods.length === 0) return tables;
  for (const attribute of attributeIndexes) {
    const maximumRaw = model.rawMaximums[attribute];
    const attributeId = options.attributeIds[attribute];
    if (!Number.isSafeInteger(maximumRaw) || maximumRaw! < 0 || attributeId === undefined ||
      maximumRaw! >= 2_000_000) return undefined;
    const parameters = options.foods.map((food) => {
      const matches = food.baseParams.filter((param) => param.baseParamId === attributeId);
      if (matches.length > 1) return undefined;
      const param = matches[0];
      if (param === undefined) return null;
      const baseValue = param.baseValue ?? 0;
      if (!Number.isSafeInteger(baseValue) || baseValue < 0 ||
        !Number.isFinite(param.multiplier) || param.multiplier < 1 ||
        !Number.isSafeInteger(param.maxValue) || param.maxValue < 0) return undefined;
      try {
        const { numerator, denominator } = parseRationalRate(param.multiplier - 1);
        return { baseValue, multiplier: param.multiplier, maxValue: param.maxValue, numerator, denominator };
      } catch {
        return undefined;
      }
    });
    if (parameters.some((parameter) => parameter === undefined)) return undefined;
    const requiredEvaluations = (maximumRaw! + 1) * parameters.length;
    if (!Number.isSafeInteger(requiredEvaluations) || requiredEvaluations > maxFoodEvaluations - foodEvaluations) {
      return undefined;
    }
    foodEvaluations += requiredEvaluations;
    const table = new Float64Array(maximumRaw! + 1);
    for (let raw = 0; raw <= maximumRaw!; raw++) {
      if ((raw & 1023) === 0 && (isCancelled() || performance.now() >= deadline)) return undefined;
      let maximumBonus = 0;
      for (const parameter of parameters) {
        if (parameter === null || parameter === undefined) continue;
        const bonus = canonicalFoodBonusAtRawWithRate(raw, parameter);
        if (bonus === undefined) return undefined;
        maximumBonus = Math.max(maximumBonus, bonus);
      }
      table[raw] = maximumBonus;
    }
    tables.set(attribute, table);
  }
  return tables;
}

export function safeDamageFactors(factors: IntegerDamageFactors | undefined): factors is IntegerDamageFactors {
  if (factors === undefined) return false;
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

export function pruneCandidatesByIncumbentUpperBound(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  factorEvaluator: IntegerDamageFactorEvaluator,
  useDps: boolean,
  incumbent: GreedyMipStart,
  deadline: number,
  isCancelled: () => boolean,
): CandidateUpperBoundResult | undefined {
  if (!hasCanonicalEvaluatorCandidateUpperBound(options) ||
    options.equipmentAttributeExtractor !== undefined ||
    options.constraints?.maxToughnessMode === true ||
    incumbent.selection.length !== options.slots.length) return undefined;
  const startedAt = performance.now();
  const incumbentAttributes = getAttributeVector(
    incumbent.selection,
    incumbent.food,
    options.attributeIds,
    options.equipmentAttributeExtractor,
    options.statIndexes,
  );
  const incumbentFactors = factorEvaluator(incumbentAttributes);
  if (!safeDamageFactors(incumbentFactors)) return undefined;
  const attributeIndexes = candidateUpperBoundAttributeIndexes(options, model);
  if (attributeIndexes === undefined) return undefined;
  const foodBonusTables = maximumFoodBonusTables(options, model, attributeIndexes, deadline, isCancelled);
  if (foodBonusTables === undefined) return undefined;

  let maximumsProcessed = 0;
  const slotMaximums = options.slots.map((_, slotIndex) => {
    const maximums = new Array<number>(attributeIndexes.length).fill(0);
    for (const candidate of model.equipmentAttributes[slotIndex] ?? []) {
      if ((maximumsProcessed++ & 255) === 0 &&
        (isCancelled() || performance.now() >= deadline)) return undefined;
      for (let index = 0; index < attributeIndexes.length; index++) {
        const value = candidate[attributeIndexes[index]!]!;
        if (!Number.isSafeInteger(value)) return undefined;
        maximums[index] = Math.max(maximums[index]!, value);
      }
    }
    return maximums;
  });
  if (slotMaximums.some((maximums) => maximums === undefined)) return undefined;
  const totalMaximums = new Array<number>(attributeIndexes.length).fill(0);
  for (const maximums of slotMaximums) {
    for (let index = 0; index < attributeIndexes.length; index++) {
      totalMaximums[index] += maximums![index]!;
      if (!Number.isSafeInteger(totalMaximums[index]!)) return undefined;
    }
  }

  let candidatesBefore = 0;
  let candidatesAfter = 0;
  const prunedSlots: EquipInfo[][] = [];
  const candidateUpperFactorsBySlot: Map<EquipInfo, IntegerDamageFactors>[] = [];
  let processed = 0;
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    const slot = options.slots[slotIndex]!;
    const equipmentVectors = model.equipmentAttributes[slotIndex];
    const kept: EquipInfo[] = [];
    const upperFactorsByCandidate = new Map<EquipInfo, IntegerDamageFactors>();
    candidatesBefore += slot.length;
    for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
      const candidate = slot[candidateIndex]!;
      if ((processed++ & 63) === 0 && (isCancelled() || performance.now() >= deadline)) {
        kept.push(...slot.slice(candidateIndex));
        break;
      }
      const isInitialIncumbent = candidate === incumbent.selection[slotIndex];
      const upperAttributes = new Array<number>(options.attributeIds.length).fill(0);
      let canBound = true;
      for (let attributeIndex = 0; attributeIndex < attributeIndexes.length; attributeIndex++) {
        const modelAttribute = attributeIndexes[attributeIndex]!;
        const rawUpper = equipmentVectors?.[candidateIndex]?.[modelAttribute]! +
          totalMaximums[attributeIndex]! - slotMaximums[slotIndex]![attributeIndex]!;
        const rawMaximum = model.rawMaximums[modelAttribute];
        if (!Number.isSafeInteger(rawUpper) || rawUpper < 0 || rawUpper > rawMaximum!) {
          canBound = false;
          break;
        }
        const foodBonuses = foodBonusTables.get(modelAttribute);
        const foodBonus = foodBonuses === undefined ? 0 : foodBonuses[rawUpper];
        const finalUpper = rawUpper + (foodBonus ?? 0);
        if (!Number.isSafeInteger(finalUpper) || finalUpper < 0) {
          canBound = false;
          break;
        }
        upperAttributes[modelAttribute] = finalUpper;
      }
      let upperFactors: IntegerDamageFactors | undefined;
      if (canBound) {
        try {
          upperFactors = factorEvaluator(upperAttributes);
        } catch {
          canBound = false;
        }
      }
      if (upperFactors !== undefined && safeDamageFactors(upperFactors)) {
        upperFactorsByCandidate.set(candidate, upperFactors);
      }
      if (isInitialIncumbent || !canBound || upperFactors === undefined || !safeDamageFactors(upperFactors) ||
        !candidateUpperBoundIsStrictlyWorse(incumbentFactors, upperFactors, useDps)) {
        kept.push(candidate);
      }
    }
    candidatesAfter += kept.length;
    prunedSlots.push(kept);
    candidateUpperFactorsBySlot.push(upperFactorsByCandidate);
  }
  return {
    slots: prunedSlots,
    candidateUpperFactorsBySlot,
    candidatesBefore,
    candidatesAfter,
    elapsedMs: performance.now() - startedAt,
  };
}

export type ResourceBudgetCandidateQuery = {
  weights: readonly number[];
  attributes: readonly number[];
  budget: PreparedFactorResourceBudgetUpperBound;
};

export type ResourceBudgetCandidateBoundResult = {
  bySlot: readonly ReadonlyMap<EquipInfo, bigint>[];
  budget: PreparedFactorResourceBudgetUpperBound;
  queryBudgets: readonly ResourceBudgetCandidateQuery[];
  additionalBudgetCount: number;
  candidateCount: number;
  supportCount: number;
  elapsedMs: number;
};

export function prepareResourceBudgetCandidateBounds(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  groups: readonly FactorGroup[],
  resourceAttributeIndexes: ReadonlyMap<string, number | undefined>,
  deadline: number,
  isCancelled: () => boolean,
  includeAllCandidates = false,
): ResourceBudgetCandidateBoundResult | undefined {
  const startedAt = performance.now();
  const profile = options.resourceBudgetCandidateProfile ?? "default";
  if (profile === "disabled") return undefined;
  const resourceAxes = (["main", "weapon", "det", "ten", "crt", "dht", "gcd"] as const).flatMap((name) => {
    const attribute = resourceAttributeIndexes.get(name);
    return attribute === undefined ? [] : [[name, attribute] as const];
  });
  if (resourceAxes.length === 0 || model.equipmentAttributes.length !== options.slots.length) return undefined;

  const outsidePriorRanges = (equipment: EquipInfo): boolean => {
    if (!Number.isSafeInteger(equipment.itemLevel)) return false;
    const ranges = options.candidateItemLevelRanges;
    return ranges === undefined || ranges.length === 0 ||
      !ranges.some(({ min, max }) => equipment.itemLevel! >= min && equipment.itemLevel! <= max);
  };
  const includeCandidate = (equipment: EquipInfo) => includeAllCandidates || outsidePriorRanges(equipment);
  let candidateCount = 0;
  for (const slot of options.slots) for (const equipment of slot) {
    if (includeCandidate(equipment)) candidateCount++;
  }
  if (!Number.isSafeInteger(candidateCount) || candidateCount === 0) return undefined;

  const bluAdditionMaximum = options.job === "BLU"
    ? Math.max(0, ...(groups.find((group) => group.name === "main")?.classes
      .map((factorClass) => factorClass.auxiliary ?? 0) ?? [0]))
    : 0;
  const pricedGroups = groups.map((group) => ({
    classes: group.classes.map((factorClass) => ({
      min: group.name === "weapon"
        ? Math.max(0, factorClass.min - bluAdditionMaximum)
        : factorClass.min,
      // `prepareExactMipModel` 已将 GCD 的 q 转换为有符号 DPS 贡献（伤害模式下为零），
      // 因此这里保留精确的目标 q 值。
      score: factorClass.q,
    })),
  }));
  const budget = prepareFactorResourceBudgetUpperBound(pricedGroups, { maxWork: 250_000 });
  if (budget === undefined) return undefined;
  if (candidateCount * budget.supportCount > 500_000) return undefined;

  const maximumFoodResource = Math.max(0, ...options.foods.map((food) => {
    let total = 0;
    for (const [, attribute] of resourceAxes) {
      const attributeId = options.attributeIds[attribute];
      if (attributeId === undefined) return Number.NaN;
      const matching = food.baseParams.filter((parameter) => parameter.baseParamId === attributeId);
      if (matching.length > 1) return Number.NaN;
      const cap = matching[0]?.maxValue ?? 0;
      if (!Number.isSafeInteger(cap) || cap < 0 || !Number.isSafeInteger(total + cap)) return Number.NaN;
      total += cap;
    }
    return total;
  }));
  if (!Number.isSafeInteger(maximumFoodResource) || maximumFoodResource < 0) return undefined;

  const resourcesBySlot: number[][] = [];
  const slotMaximums: number[] = [];
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    const vectors = model.equipmentAttributes[slotIndex];
    const candidates = options.slots[slotIndex]!;
    if (vectors === undefined || vectors.length !== candidates.length) return undefined;
    const resources = vectors.map((vector) => {
      let total = 0;
      for (const [, attribute] of resourceAxes) {
        const value = vector[attribute];
        if (!Number.isSafeInteger(value) || value! < 0 || !Number.isSafeInteger(total + value!)) return undefined;
        total += value!;
      }
      return total;
    });
    if (resources.length === 0 || resources.some((value) => value === undefined)) return undefined;
    resourcesBySlot.push(resources as number[]);
    slotMaximums.push((resources as number[]).reduce((maximum, value) => Math.max(maximum, value), 0));
  }
  const maximumGearResource = slotMaximums.reduce((total, maximum) => total + maximum, 0);
  const maximumResource = maximumGearResource + maximumFoodResource;
  if (!Number.isSafeInteger(maximumGearResource) || !Number.isSafeInteger(maximumResource)) return undefined;

  type WeightedCandidateBudget = {
    weights: readonly number[];
    budget: PreparedFactorResourceBudgetUpperBound;
    maximumFoodResource: number;
    resourcesBySlot: readonly (readonly number[])[];
    slotMaximums: readonly number[];
    maximumGearResource: number;
  };
  const additionalBudgets: WeightedCandidateBudget[] = [];
  let supportCount = budget.supportCount;
  const hasCandidatesBelow730 = options.slots.some((slot) => slot.some((equipment) =>
    Number.isSafeInteger(equipment.itemLevel) && equipment.itemLevel! < 730));
  if (profile === "weighted" || (profile === "default" && hasCandidatesBelow730)) {
    const axes = resourceAxes.map(([name]) => name);
    const allOnes = axes.map(() => 1);
    const priceVectors = [
      axes.map((name) => name === "main" || name === "weapon" ? 1 : 0),
      ...factorResourceWeightVectors(groups, axes),
    ];
    const uniquePriceVectors = [...new Map(priceVectors
      .filter((weights) => weights.length === axes.length &&
        weights.every((weight) => Number.isSafeInteger(weight) && weight >= 0) &&
        weights.some((weight) => weight > 0))
      .map((weights) => [weights.join(":"), weights] as const))];
    uniquePriceVectors.splice(0, uniquePriceVectors.length,
      ...uniquePriceVectors.filter(([key]) => key !== allOnes.join(":")));
    let remainingQueryWork = 500_000 - candidateCount * budget.supportCount;
    for (const [, weights] of uniquePriceVectors) {
      if (isCancelled()) return undefined;
      if (performance.now() >= deadline) break;
      const pricedGroups = groups.map((group) => {
        const axisIndex = axes.findIndex((name) => name === group.name);
        const weight = axisIndex < 0 ? 0 : weights[axisIndex]!;
        return {
          classes: group.classes.map((factorClass) => ({
            min: (group.name === "weapon"
              ? Math.max(0, factorClass.min - bluAdditionMaximum)
              : factorClass.min) * weight,
            score: factorClass.q,
          })),
        };
      });
      if (pricedGroups.some((group) => group.classes.some((factorClass) =>
        !Number.isSafeInteger(factorClass.min) || factorClass.min < 0))) continue;
      const weightedBudget = prepareFactorResourceBudgetUpperBound(pricedGroups, { maxWork: 50_000 });
      if (weightedBudget === undefined) continue;
      const queryWork = candidateCount * weightedBudget.supportCount;
      if (!Number.isSafeInteger(queryWork) || queryWork > remainingQueryWork) continue;

      const weightedFoodMaximum = Math.max(0, ...options.foods.map((food) => {
        let total = 0;
        for (let axisIndex = 0; axisIndex < resourceAxes.length; axisIndex++) {
          const [, attribute] = resourceAxes[axisIndex]!;
          const attributeId = options.attributeIds[attribute];
          if (attributeId === undefined) return Number.NaN;
          const matching = food.baseParams.filter((parameter) => parameter.baseParamId === attributeId);
          if (matching.length > 1) return Number.NaN;
          const cap = matching[0]?.maxValue ?? 0;
          const contribution = cap * weights[axisIndex]!;
          if (!Number.isSafeInteger(cap) || cap < 0 || !Number.isSafeInteger(contribution) ||
              !Number.isSafeInteger(total + contribution)) return Number.NaN;
          total += contribution;
        }
        return total;
      }));
      if (!Number.isSafeInteger(weightedFoodMaximum) || weightedFoodMaximum < 0) continue;

      const weightedResourcesBySlot: number[][] = [];
      const weightedSlotMaximums: number[] = [];
      let validWeightedResources = true;
      for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
        const vectors = model.equipmentAttributes[slotIndex];
        const candidates = options.slots[slotIndex]!;
        if (vectors === undefined || vectors.length !== candidates.length) return undefined;
        const resources = vectors.map((vector) => {
          let total = 0;
          for (let axisIndex = 0; axisIndex < resourceAxes.length; axisIndex++) {
            const [, attribute] = resourceAxes[axisIndex]!;
            const value = vector[attribute];
            const contribution = value! * weights[axisIndex]!;
            if (!Number.isSafeInteger(value) || value! < 0 || !Number.isSafeInteger(contribution) ||
                !Number.isSafeInteger(total + contribution)) {
              validWeightedResources = false;
              return undefined;
            }
            total += contribution;
          }
          return total;
        });
        if (resources.length === 0) return undefined;
        if (resources.some((value) => value === undefined)) {
          validWeightedResources = false;
          break;
        }
        weightedResourcesBySlot.push(resources as number[]);
        weightedSlotMaximums.push((resources as number[]).reduce((maximum, value) => Math.max(maximum, value), 0));
      }
      if (!validWeightedResources) continue;
      const weightedGearMaximum = weightedSlotMaximums.reduce((total, maximum) => total + maximum, 0);
      if (!Number.isSafeInteger(weightedGearMaximum) ||
          !Number.isSafeInteger(weightedGearMaximum + weightedFoodMaximum)) continue;
      additionalBudgets.push({
        weights,
        budget: weightedBudget,
        maximumFoodResource: weightedFoodMaximum,
        resourcesBySlot: weightedResourcesBySlot,
        slotMaximums: weightedSlotMaximums,
        maximumGearResource: weightedGearMaximum,
      });
      supportCount += weightedBudget.supportCount;
      remainingQueryWork -= queryWork;
    }
  }

  const bySlot: Map<EquipInfo, bigint>[] = [];
  let found = 0;
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    if (isCancelled() || performance.now() >= deadline) return undefined;
    const candidates = options.slots[slotIndex]!;
    const outside = new Map<EquipInfo, bigint>();
    const otherGearMaximum = maximumGearResource - slotMaximums[slotIndex]!;
    if (!Number.isSafeInteger(otherGearMaximum) || otherGearMaximum < 0) return undefined;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      if ((candidateIndex & 31) === 0 && (isCancelled() || performance.now() >= deadline)) return undefined;
      const equipment = candidates[candidateIndex]!;
      if (!includeCandidate(equipment)) continue;
      const candidateResource = resourcesBySlot[slotIndex]![candidateIndex]!;
      const candidateBudget = candidateResource + otherGearMaximum + maximumFoodResource;
      if (!Number.isSafeInteger(candidateBudget) || candidateBudget > maximumResource) return undefined;
      let scoreUpper = budget.query(candidateBudget);
      for (const weighted of additionalBudgets) {
        const weightedOtherMaximum = weighted.maximumGearResource - weighted.slotMaximums[slotIndex]!;
        const weightedCandidateBudget = weighted.resourcesBySlot[slotIndex]![candidateIndex]! +
          weightedOtherMaximum + weighted.maximumFoodResource;
        if (!Number.isSafeInteger(weightedOtherMaximum) || weightedOtherMaximum < 0 ||
            !Number.isSafeInteger(weightedCandidateBudget) || weightedCandidateBudget >
              weighted.maximumGearResource + weighted.maximumFoodResource) return undefined;
        const weightedUpper = weighted.budget.query(weightedCandidateBudget);
        if (weightedUpper !== undefined && (scoreUpper === undefined || weightedUpper < scoreUpper)) {
          scoreUpper = weightedUpper;
        }
      }
      if (scoreUpper !== undefined) {
        outside.set(equipment, scoreUpper);
        found++;
      }
    }
    bySlot.push(outside);
  }
  if (performance.now() >= deadline || isCancelled()) return undefined;
  return {
    bySlot,
    budget,
    queryBudgets: [
      {
        weights: resourceAxes.map(() => 1),
        attributes: resourceAxes.map(([, attribute]) => attribute),
        budget,
      },
      ...additionalBudgets.map(({ weights, budget: weightedBudget }) => ({
        weights,
        attributes: resourceAxes.map(([, attribute]) => attribute),
        budget: weightedBudget,
      })),
    ],
    additionalBudgetCount: additionalBudgets.length,
    candidateCount: found,
    supportCount,
    elapsedMs: performance.now() - startedAt,
  };
}
