import type { FactorGroup } from "./types.ts";
import type { ExactMipOptions } from "./types.ts";
import type { buildLinearAttributeModel } from "./attribute-model.ts";
import { hasRingPairProperty } from "./ring-domain.ts";
import { addTerm } from "../core/model-builder.ts";
import { addRows } from "../core/model-builder.ts";

export function factorResourceWeightVectors(
  groups: readonly FactorGroup[],
  axisNames: readonly string[],
): number[][] {
  const slopeAt = (name: string) => {
    const group = groups.find((entry) => entry.name === name);
    if (group === undefined || group.classes.length < 2) return 0;
    const first = group.classes[0]!;
    const last = group.classes[group.classes.length - 1]!;
    const span = last.max - first.min;
    const gain = last.q - first.q;
    return span > 0 && gain > 0 ? gain / span : 0;
  };

  const gcd = (left: number, right: number): number => {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b !== 0) [a, b] = [b, a % b];
    return a;
  };
  const vectors = new Map<string, number[]>();
  const slopes = axisNames.map(slopeAt);
  const maximumSlope = Math.max(0, ...slopes);
  if (maximumSlope === 0) return [];
  for (const scale of [16, 64, 256]) {
    const weights = slopes.map((slope) => slope <= 0
      ? 0
      : Math.max(1, Math.round((slope / maximumSlope) * scale)));
    const divisor = weights.reduce((value, weight) => weight === 0 ? value : gcd(value, weight), 0);
    if (divisor <= 0) continue;
    const normalized = weights.map((weight) => weight / divisor);
    const active = normalized.filter((weight) => weight > 0);
    if (active.length < 2 || active.every((weight) => weight === active[0])) continue;
    vectors.set(normalized.join(":"), normalized);
  }
  return [...vectors.values()];
}

export type ConditionalResourceSupportStats = {
  candidateBands: number;
  rowsAdded: number;
  weightedRowsAdded?: number;
  nonzerosAdded: number;
  weightedResourceWeights?: Readonly<Record<string, number>>;
  skipReason?: "disabled-by-policy" | "no-out-of-window-candidates" | "no-strictly-tighter-bands" | "ring-pair-candidates" | "model-budget";
};

export const CANDIDATE_LEVEL_BAND_SIZE = 20;

export const MAX_CONDITIONAL_BANDS_PER_SLOT = 12;

export const MAX_CONDITIONAL_RESOURCE_ROWS = 128;

export const MAX_CONDITIONAL_RESOURCE_NONZEROS = 250_000;

export const MAX_COMPACT_RESOURCE_THRESHOLDS_PER_SLOT = 1;

export function addCandidateLevelConditionalResourceSupports(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  groups: readonly FactorGroup[],
  foodMaximumBonuses: readonly (readonly number[])[],
  resourceAttributeIndexes: ReadonlyMap<string, number | undefined>,
): ConditionalResourceSupportStats | undefined {
  const profile = options.candidateResourceSupportProfile ?? "balanced";
  if (profile === "disabled") {
    return { candidateBands: 0, rowsAdded: 0, nonzerosAdded: 0, skipReason: "disabled-by-policy" };
  }
  const ranges = options.candidateItemLevelRanges;
  if (ranges === undefined || ranges.length === 0 || options.equipmentAttributeExtractor !== undefined ||
    ranges.some(({ min, max }) => !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max)) {
    return undefined;
  }
  if (options.slots.some((slot) => slot.some(hasRingPairProperty))) {
    return { candidateBands: 0, rowsAdded: 0, nonzerosAdded: 0, skipReason: "ring-pair-candidates" };
  }
  // 对所有与伤害相关的属性资源进行预算。尤其是品级较低但主属性或武器伤害更高的候选，
  // 在与暴击、信念或直击属性权衡时仍须保留这部分贡献。
  const resourceAxes = (["main", "weapon", "det", "ten", "crt", "dht", "gcd"] as const).flatMap((name) => {
    const attribute = resourceAttributeIndexes.get(name);
    const group = groups.find((candidate) => candidate.name === name);
    return attribute === undefined || group === undefined ? [] : [[name, attribute, group] as const];
  });
  if (resourceAxes.length === 0 || model.slotVariables.length !== options.slots.length ||
    model.equipmentAttributes.length !== options.slots.length) return undefined;

  const inPriorRanges = (itemLevel: number) => ranges.some(({ min, max }) => itemLevel >= min && itemLevel <= max);
  const outsidePriorCandidatesBySlot: number[][] = [];
  let candidateBands = 0;
  let exceedsPerSlotBudget = false;
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    const candidates = options.slots[slotIndex]!;
    const vectors = model.equipmentAttributes[slotIndex];
    const variables = model.slotVariables[slotIndex];
    if (vectors === undefined || variables === undefined ||
      vectors.length !== candidates.length || variables.length !== candidates.length) return undefined;
    const bands = new Set<number>();
    const outsidePriorCandidates: number[] = [];
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const equipment = candidates[candidateIndex]!;
      const vector = vectors[candidateIndex];
      if (!Number.isSafeInteger(equipment.itemLevel) || equipment.itemLevel < 0 ||
        vector === undefined || variables[candidateIndex] === undefined) return undefined;
      if (inPriorRanges(equipment.itemLevel)) continue;
      const band = Math.floor(equipment.itemLevel / CANDIDATE_LEVEL_BAND_SIZE);
      bands.add(band);
      outsidePriorCandidates.push(candidateIndex);
    }
    exceedsPerSlotBudget ||= bands.size > MAX_CONDITIONAL_BANDS_PER_SLOT;
    candidateBands += bands.size;
    outsidePriorCandidatesBySlot.push(outsidePriorCandidates);
  }
  if (candidateBands === 0) {
    return { candidateBands: 0, rowsAdded: 0, nonzerosAdded: 0, skipReason: "no-out-of-window-candidates" };
  }
  if (exceedsPerSlotBudget || candidateBands > MAX_CONDITIONAL_RESOURCE_ROWS) {
    return { candidateBands, rowsAdded: 0, nonzerosAdded: 0, skipReason: "model-budget" };
  }

  const resourceForVector = (vector: readonly number[]): number | undefined => {
    let total = 0;
    for (const [, attribute] of resourceAxes) {
      const value = vector[attribute];
      if (!Number.isSafeInteger(value) || value! < 0) return undefined;
      total += value!;
      if (!Number.isSafeInteger(total)) return undefined;
    }
    return total;
  };
  const resourcesBySlot: number[][] = [];
  const slotMaximums: number[] = [];
  for (const vectors of model.equipmentAttributes) {
    const resources = vectors.map(resourceForVector);
    if (resources.length === 0 || resources.some((value) => value === undefined)) return undefined;
    const validResources = resources as number[];
    resourcesBySlot.push(validResources);
    slotMaximums.push(validResources.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY));
  }
  const maximumFoodResource = foodMaximumBonuses.reduce((maximum, bonuses) => {
    let total = 0;
    for (const [, attribute] of resourceAxes) {
      const value = bonuses[attribute];
      if (!Number.isSafeInteger(value) || value! < 0) return Number.NaN;
      total += value!;
      if (!Number.isSafeInteger(total)) return Number.NaN;
    }
    return Math.max(maximum, total);
  }, 0);
  if (!Number.isSafeInteger(maximumFoodResource) || maximumFoodResource < 0) return undefined;
  const maximumGearResource = slotMaximums.reduce((total, value) => total + value, 0);
  const globalBudget = maximumGearResource + maximumFoodResource;
  if (!Number.isSafeInteger(maximumGearResource) || !Number.isSafeInteger(globalBudget)) return undefined;

  const resourceTerms = new Map<string, number>();
  const maximumBluWeaponAddition = options.job === "BLU"
    ? Math.max(0, ...(groups.find((group) => group.name === "main")?.classes
      .map((factorClass) => factorClass.auxiliary ?? 0) ?? [0]))
    : 0;
  for (const [name, , group] of resourceAxes) {
    for (const factorClass of group.classes) {
      if (!Number.isSafeInteger(factorClass.min) || factorClass.min < 0) return undefined;
      // 青魔法师的武器因子包含依赖 INT 的加成。减去该加成的最大值后，
      // 对所有主属性与武器伤害组合，此约束行仍由装备原始属性蕴含，同时保留有用的下界。
      const minimum = name === "weapon"
        ? Math.max(0, factorClass.min - maximumBluWeaponAddition)
        : factorClass.min;
      addTerm(resourceTerms, factorClass.variable, minimum);
    }
  }
  if (resourceTerms.size === 0) return { candidateBands, rowsAdded: 0, nonzerosAdded: 0 };

  const pendingRows: { name: string; terms: Map<string, number>; sense: "<="; rhs: number }[] = [];
  let nonzerosAdded = 0;
  const maxThresholdsPerSlot = profile === "compact" || profile === "compact-weighted"
    ? MAX_COMPACT_RESOURCE_THRESHOLDS_PER_SLOT
    : MAX_CONDITIONAL_BANDS_PER_SLOT;
  for (let slotIndex = 0; slotIndex < outsidePriorCandidatesBySlot.length; slotIndex++) {
    const slotMaximum = slotMaximums[slotIndex]!;
    const otherGearMaximum = maximumGearResource - slotMaximum;
    if (!Number.isSafeInteger(otherGearMaximum) || otherGearMaximum < 0) return undefined;
    const variables = model.slotVariables[slotIndex]!;
    const outsideCandidates = outsidePriorCandidatesBySlot[slotIndex]!;
    const thresholds = [...new Set(outsideCandidates
      .map((candidateIndex) => resourcesBySlot[slotIndex]![candidateIndex]!)
      .filter((resource) => resource < slotMaximum))].sort((left, right) => left - right);
    const selectedThresholds = thresholds.length <= maxThresholdsPerSlot
      ? thresholds
      : maxThresholdsPerSlot === 1
      ? [thresholds.at(-1)!]
      : Array.from({ length: maxThresholdsPerSlot }, (_, index) =>
          thresholds[Math.round(index * (thresholds.length - 1) / (maxThresholdsPerSlot - 1))]!)
        .filter((threshold, index, values) => values.indexOf(threshold) === index);
    for (let thresholdIndex = 0; thresholdIndex < selectedThresholds.length; thresholdIndex++) {
      const resourceThreshold = selectedThresholds[thresholdIndex]!;
      const activationVariables = outsideCandidates.flatMap((candidateIndex) =>
        resourcesBySlot[slotIndex]![candidateIndex]! <= resourceThreshold
          ? [variables[candidateIndex]!]
          : []);
      if (activationVariables.some((variable) => variable === undefined) || activationVariables.length === 0) return undefined;
      const conditionalBudget = resourceThreshold + otherGearMaximum + maximumFoodResource;
      const relaxation = slotMaximum - resourceThreshold;
      if (!Number.isSafeInteger(conditionalBudget) || conditionalBudget < 0 ||
        !Number.isSafeInteger(relaxation) || relaxation < 0 ||
        conditionalBudget !== globalBudget - relaxation) return undefined;

      const terms = new Map(resourceTerms);
      for (const variable of activationVariables) addTerm(terms, variable, relaxation);
      nonzerosAdded += terms.size;
      if (pendingRows.length + 1 > MAX_CONDITIONAL_RESOURCE_ROWS ||
        nonzerosAdded > MAX_CONDITIONAL_RESOURCE_NONZEROS) {
        return { candidateBands, rowsAdded: 0, nonzerosAdded: 0, skipReason: "model-budget" };
      }
      pendingRows.push({
        name: `factor_resource_level_${slotIndex}_${thresholdIndex}`,
        terms,
        sense: "<=",
        rhs: globalBudget,
      });
    }
  }

  // 早期四职业未同步证明快照会将均匀支撑行与一个非负因子斜率方向配合使用。
  // 加权行仍由精确装备资源预算蕴含，只用于强化 HiGHS 的松弛模型。
  let weightedRowsAdded = 0;
  let selectedWeightedResourceWeights: Readonly<Record<string, number>> | undefined;
  if (profile === "compact-weighted") {
    const resourceAxisNames = resourceAxes.map(([name]) => name);
    const mainAxisIndex = resourceAxisNames.indexOf("main");
    const weightedResourceWeights = factorResourceWeightVectors(groups, resourceAxisNames).at(-1);
    if (weightedResourceWeights !== undefined && mainAxisIndex >= 0 &&
      weightedResourceWeights[mainAxisIndex]! > 0) {
      const weightedResourceForVector = (vector: readonly number[]): number | undefined => {
        let total = 0;
        for (let index = 0; index < resourceAxes.length; index++) {
          const weight = weightedResourceWeights[index]!;
          const value = vector[resourceAxes[index]![1]];
          if (!Number.isSafeInteger(weight) || weight < 0 || !Number.isSafeInteger(value) || value! < 0 ||
            value! > Math.floor((Number.MAX_SAFE_INTEGER - total) / Math.max(1, weight))) return undefined;
          total += value! * weight;
        }
        return total;
      };
      const weightedResourcesBySlot = model.equipmentAttributes.map((vectors) =>
        vectors.map(weightedResourceForVector));
      if (weightedResourcesBySlot.every((resources) => resources.length > 0 &&
        resources.every((resource) => resource !== undefined))) {
        const weightedSlotMaximums = weightedResourcesBySlot.map((resources) =>
          (resources as number[]).reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY));
        const weightedFoodMaximum = foodMaximumBonuses.reduce((maximum, bonuses) => {
          let total = 0;
          for (let index = 0; index < resourceAxes.length; index++) {
            const weight = weightedResourceWeights[index]!;
            const value = bonuses[resourceAxes[index]![1]];
            if (!Number.isSafeInteger(value) || value! < 0 ||
              value! > Math.floor((Number.MAX_SAFE_INTEGER - total) / Math.max(1, weight))) return Number.NaN;
            total += value! * weight;
          }
          return Math.max(maximum, total);
        }, 0);
        const weightedGearMaximum = weightedSlotMaximums.reduce((total, value) => total + value, 0);
        const weightedGlobalBudget = weightedGearMaximum + weightedFoodMaximum;
        const maximumWeightedBluWeaponAddition = options.job === "BLU"
          ? Math.max(0, ...(groups.find((group) => group.name === "main")?.classes
            .map((factorClass) => factorClass.auxiliary ?? 0) ?? [0]))
          : 0;
        const weightedResourceTerms = new Map<string, number>();
        let validWeightedTerms = Number.isSafeInteger(weightedGlobalBudget) && weightedGlobalBudget >= 0;
        for (let axisIndex = 0; axisIndex < resourceAxes.length && validWeightedTerms; axisIndex++) {
          const [name, , group] = resourceAxes[axisIndex]!;
          const weight = weightedResourceWeights[axisIndex]!;
          if (weight === 0) continue;
          for (const factorClass of group.classes) {
            if (!Number.isSafeInteger(factorClass.min) || factorClass.min < 0 ||
              factorClass.min > Math.floor(Number.MAX_SAFE_INTEGER / weight)) {
              validWeightedTerms = false;
              break;
            }
            const minimum = name === "weapon"
              ? Math.max(0, factorClass.min - maximumWeightedBluWeaponAddition)
              : factorClass.min;
            addTerm(weightedResourceTerms, factorClass.variable, minimum * weight);
          }
        }
        if (validWeightedTerms && weightedResourceTerms.size > 0) {
          const weightedPendingRows: typeof pendingRows = [];
          let weightedNonzeros = 0;
          for (let slotIndex = 0; slotIndex < outsidePriorCandidatesBySlot.length; slotIndex++) {
            const slotMaximum = weightedSlotMaximums[slotIndex]!;
            const outsideCandidates = outsidePriorCandidatesBySlot[slotIndex]!;
            const resources = weightedResourcesBySlot[slotIndex]! as number[];
            const thresholds = [...new Set(outsideCandidates
              .map((candidateIndex) => resources[candidateIndex]!)
              .filter((resource) => resource < slotMaximum))].sort((left, right) => left - right);
            if (thresholds.length === 0) continue;
            const resourceThreshold = thresholds.at(-1)!;
            const relaxation = slotMaximum - resourceThreshold;
            if (!Number.isSafeInteger(relaxation) || relaxation < 0) {
              validWeightedTerms = false;
              break;
            }
            const activationVariables = outsideCandidates.flatMap((candidateIndex) =>
              resources[candidateIndex]! <= resourceThreshold
                ? [model.slotVariables[slotIndex]![candidateIndex]!]
                : []);
            if (activationVariables.length === 0) continue;
            const terms = new Map(weightedResourceTerms);
            for (const variable of activationVariables) addTerm(terms, variable, relaxation);
            weightedNonzeros += terms.size;
            weightedPendingRows.push({
              name: `factor_resource_weighted_level_${slotIndex}`,
              terms,
              sense: "<=",
              rhs: weightedGlobalBudget,
            });
          }
          if (validWeightedTerms && pendingRows.length + weightedPendingRows.length <= MAX_CONDITIONAL_RESOURCE_ROWS &&
            nonzerosAdded + weightedNonzeros <= MAX_CONDITIONAL_RESOURCE_NONZEROS) {
            pendingRows.push(...weightedPendingRows);
            nonzerosAdded += weightedNonzeros;
            weightedRowsAdded = weightedPendingRows.length;
            if (weightedRowsAdded > 0) {
              selectedWeightedResourceWeights = Object.fromEntries(resourceAxisNames.map((name, index) =>
                [name, weightedResourceWeights[index]!]));
            }
          }
        }
      }
    }
  }

  for (const row of pendingRows) {
    // 选择窗口外且低于此资源阈值的候选，会收紧全局预算。
    addRows(model.rows, row.name, row.terms, row.sense, row.rhs);
  }
  return {
    candidateBands,
    rowsAdded: pendingRows.length - weightedRowsAdded,
    weightedRowsAdded,
    nonzerosAdded,
    ...(selectedWeightedResourceWeights === undefined ? {} : { weightedResourceWeights: selectedWeightedResourceWeights }),
    ...(pendingRows.length === 0 ? { skipReason: "no-strictly-tighter-bands" as const } : {}),
  };
}
