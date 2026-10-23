import type { ModelRow } from "../core/model-types.ts";
import type { VariableBounds } from "../core/model-types.ts";
import type { FactorGroup } from "./types.ts";
import { addRows } from "../core/model-builder.ts";
import { addTerm } from "../core/model-builder.ts";
import type { ExactMipOptions } from "./types.ts";
import { buildLinearAttributeModel } from "./attribute-model.ts";
import type { FoodInfo } from "../types.ts";
import { throwIfCancelled } from "../cancellation.ts";
import { createIntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import { gameData } from "../../data.ts";
import type { Stat } from "../../types.ts";
import { factorGroupsForAttribute } from "./factor-model.ts";
import { retainReachableFactorClasses } from "./factor-model.ts";
import { roundedLog } from "../core/exact-arithmetic.ts";
import { factorResourceWeightVectors } from "./resource-support.ts";
import { addCandidateLevelConditionalResourceSupports } from "./resource-support.ts";

export const SURROGATE_OBJECTIVE_SCALE = 65_536;

export function addClassSelection(
  rows: ModelRow[],
  bounds: VariableBounds[],
  binaryVars: string[],
  group: FactorGroup,
  attributeVariable: string | undefined,
  maximum: number,
): void {
  for (const factorClass of group.classes) {
    bounds.push({ name: factorClass.variable, min: 0, max: 1 });
    binaryVars.push(factorClass.variable);
  }
  const exactlyOne = new Map(group.classes.map((factorClass) => [factorClass.variable, 1]));
  addRows(rows, `${group.name}_one`, exactlyOne, "=", 1);
  if (attributeVariable === undefined) return;
  const lowerTerms = new Map<string, number>();
  const upperTerms = new Map<string, number>();
  addTerm(lowerTerms, attributeVariable, 1);
  addTerm(upperTerms, attributeVariable, 1);
  for (const factorClass of group.classes) {
    addTerm(lowerTerms, factorClass.variable, -factorClass.min);
    addTerm(upperTerms, factorClass.variable, -factorClass.max);
  }
  addRows(rows, `${group.name}_lower`, lowerTerms, ">=", 0);
  addRows(rows, `${group.name}_upper`, upperTerms, "<=", 0);
  if (group.classes.at(-1)!.max !== maximum) {
    throw new Error(`因子组 ${group.name} 的区间未覆盖属性上限`);
  }
}

export function reachableFinalAttributeValues(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  attribute: number,
): number[] | undefined {
  const maximumTransitionWork = 1_000_000;
  const maximumFoodEvaluations = 1_000_000;
  const slotValues: number[][] = [];
  for (let slotIndex = 0; slotIndex < model.fixedEquipmentAttributes.length; slotIndex++) {
    const slot = model.fixedEquipmentAttributes[slotIndex]!;
    const values = new Set<number>();
    for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
      const candidate = slot[candidateIndex]!;
      const maximumAllocation = model.resistanceAllocationVariables
        .filter((allocation) => allocation.slotIndex === slotIndex &&
          allocation.candidateIndex === candidateIndex && allocation.attributeIndex === attribute)
        .reduce((total, allocation) => total + allocation.maxValue, 0);
      if (!Number.isSafeInteger(maximumAllocation) || maximumAllocation < 0 ||
        maximumAllocation + 1 > maximumTransitionWork) return undefined;
      for (let increment = 0; increment <= maximumAllocation; increment++) {
        values.add(candidate[attribute]! + increment);
      }
    }
    slotValues.push([...values]);
  }
  if (slotValues.some((values) => values.length === 0 || values.some((value) => !Number.isSafeInteger(value)))) {
    return undefined;
  }

  let minimum = 0;
  let maximum = 0;
  let reachableCount = 1;
  let reachable = Uint8Array.of(1);
  for (const values of slotValues) {
    if (reachableCount > Math.floor(maximumTransitionWork / values.length)) return undefined;
    const nextMinimum = minimum + Math.min(...values);
    const nextMaximum = maximum + Math.max(...values);
    const width = nextMaximum - nextMinimum + 1;
    if (!Number.isSafeInteger(width) || width <= 0 || width > 200_000) return undefined;
    const next = new Uint8Array(width);
    let nextReachableCount = 0;
    for (let index = 0; index < reachable.length; index++) {
      if (reachable[index] !== 1) continue;
      const previous = minimum + index;
      for (const value of values) {
        const target = previous + value - nextMinimum;
        if (next[target] === 0) {
          next[target] = 1;
          nextReachableCount++;
        }
      }
    }
    reachable = next;
    reachableCount = nextReachableCount;
    minimum = nextMinimum;
    maximum = nextMaximum;
  }

  const foods: readonly (FoodInfo | undefined)[] = options.foods.length > 0 ? options.foods : [undefined];
  if (reachableCount > Math.floor(maximumFoodEvaluations / foods.length)) return undefined;
  const attributeId = options.attributeIds[attribute];
  if (attributeId === undefined) return undefined;
  const foodParams = foods.map((food) => {
    const matchingParams = food?.baseParams.filter((entry) => entry.baseParamId === attributeId) ?? [];
    return { duplicate: matchingParams.length > 1, param: matchingParams[0] };
  });
  if (foodParams.some(({ duplicate }) => duplicate)) return undefined;
  const finalValues = new Set<number>();
  for (let index = 0; index < reachable.length; index++) {
    if (reachable[index] !== 1) continue;
    const raw = minimum + index;
    for (const { param } of foodParams) {
      const bonus = param !== undefined && param.maxValue > 0 && param.multiplier > 1
        ? Math.min(param.maxValue,
          Math.trunc((raw + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7))
        : 0;
      const finalValue = raw + bonus;
      if (!Number.isSafeInteger(finalValue)) return undefined;
      finalValues.add(finalValue);
    }
  }
  return finalValues.size === 0 ? undefined : [...finalValues].sort((left, right) => left - right);
}

export async function prepareExactMipModel(
  options: ExactMipOptions,
  addPrimaryResourceSupports = false,
  prebuiltModel?: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  addMainStatResourceSupport = false,
) {
  throwIfCancelled(options.isCancelled);
  const model = prebuiltModel ?? buildLinearAttributeModel(options);
  throwIfCancelled(options.isCancelled);
  if (model === undefined) return undefined;
  const factorEvaluator = createIntegerDamageFactorEvaluator(
    options.job,
    options.jobLevel,
    options.statIndexes,
    options.clanIndex ?? 0,
  );
  const zeroFactors = factorEvaluator(new Array<number>(options.attributeIds.length).fill(0));
  if (zeroFactors === undefined) throw new Error(`职业 ${options.job} 没有整数伤害因子公式`);
  const schema = gameData.jobSchemas[options.job];
  if (schema.mainStat === undefined) throw new Error(`职业 ${options.job} 缺少主属性公式`);
  const mainStat: Stat = schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats?.includes("SKS") ? "SKS" : "SPS";
  const mainIndex = options.statIndexes.get(mainStat);
  const detIndex = options.statIndexes.get("DET");
  const tenIndex = options.statIndexes.get("TEN");
  const crtIndex = options.statIndexes.get("CRT");
  const dhtIndex = options.statIndexes.get("DHT");
  const speedIndex = options.statIndexes.get(speedStat);
  const weaponIndex = options.statIndexes.get(weaponStat);
  const indexForStat = (stat: Stat) => {
    const vectorIndex = options.statIndexes.get(stat);
    if (vectorIndex === undefined) return undefined;
    const id = options.attributeIds[vectorIndex];
    return id === undefined ? undefined : model.idToIndex.get(id);
  };
  const mainAttribute = mainIndex === undefined ? undefined : indexForStat(mainStat);
  const detAttribute = detIndex === undefined ? undefined : indexForStat("DET");
  const tenAttribute = tenIndex === undefined ? undefined : indexForStat("TEN");
  const crtAttribute = crtIndex === undefined ? undefined : indexForStat("CRT");
  const dhtAttribute = dhtIndex === undefined ? undefined : indexForStat("DHT");
  const speedAttribute = speedIndex === undefined ? undefined : indexForStat(speedStat);
  const weaponAttribute = weaponIndex === undefined ? undefined : indexForStat(weaponStat);
  if (mainAttribute === undefined || weaponAttribute === undefined || speedAttribute === undefined) {
    throw new Error("精确 MIP 模型缺少主属性、武器伤害或职业速度属性");
  }
  const finalMaximums = options.attributeIds.map((id, index) =>
    model.rawMaximums[index]! + Math.max(0, ...options.foods.map((food) =>
      food.baseParams.find((param) => param.baseParamId === id)?.maxValue ?? 0)));

  const groups: FactorGroup[] = [];
  groups.push(factorGroupsForAttribute("main", mainAttribute, finalMaximums[mainAttribute]!, options.attributeIds.length, factorEvaluator, "mainStat", options.job === "BLU", zeroFactors.weaponDamage, model.finalMinimums[mainAttribute]!));
  groups.push(factorGroupsForAttribute("det", detAttribute, detAttribute === undefined ? 0 : finalMaximums[detAttribute]!, options.attributeIds.length, factorEvaluator, "determination", false, 0, detAttribute === undefined ? 0 : model.finalMinimums[detAttribute]!));
  groups.push(factorGroupsForAttribute("ten", tenAttribute, tenAttribute === undefined ? 0 : finalMaximums[tenAttribute]!, options.attributeIds.length, factorEvaluator, "tenacity", false, 0, tenAttribute === undefined ? 0 : model.finalMinimums[tenAttribute]!));
  groups.push(factorGroupsForAttribute("crt", crtAttribute, crtAttribute === undefined ? 0 : finalMaximums[crtAttribute]!, options.attributeIds.length, factorEvaluator, "critical", false, 0, crtAttribute === undefined ? 0 : model.finalMinimums[crtAttribute]!));
  groups.push(factorGroupsForAttribute("dht", dhtAttribute, dhtAttribute === undefined ? 0 : finalMaximums[dhtAttribute]!, options.attributeIds.length, factorEvaluator, "directHit", false, 0, dhtAttribute === undefined ? 0 : model.finalMinimums[dhtAttribute]!));
  groups.push(factorGroupsForAttribute("gcd", speedAttribute, finalMaximums[speedAttribute]!, options.attributeIds.length, factorEvaluator, "gcdCentiseconds", false, 0, model.finalMinimums[speedAttribute]!));
  const groupAttributes = [mainAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute];
  let reachableFactorClassesRemoved = 0;
  let reachableAttributePruningSkipped = 0;
  const reachableValuesByAttribute = new Map<number, number[]>();
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const attribute = groupAttributes[groupIndex];
    if (attribute === undefined) continue;
    let reachableValues = reachableValuesByAttribute.get(attribute);
    if (reachableValues === undefined) {
      reachableValues = reachableFinalAttributeValues(options, model, attribute);
      if (reachableValues === undefined) {
        reachableAttributePruningSkipped++;
        continue;
      }
      reachableValuesByAttribute.set(attribute, reachableValues);
    }
    reachableFactorClassesRemoved += retainReachableFactorClasses(groups[groupIndex]!, reachableValues);
  }
  const mainFactorGroup = groups[0]!;
  const bluAdditionValues = options.job === "BLU"
    ? mainFactorGroup.classes.map((factorClass) => {
      if (factorClass.auxiliary === undefined) {
        throw new Error("青魔法师主属性因子缺少武器伤害附加值");
      }
      return factorClass.auxiliary;
    })
    : [0];
  const bluAdditionMinimum = Math.min(...bluAdditionValues);
  const bluAdditionMaximum = Math.max(...bluAdditionValues);
  let weaponRelativeMinimum = model.finalMinimums[weaponAttribute]! + bluAdditionMinimum;
  let weaponRelativeMaximum = finalMaximums[weaponAttribute]! + bluAdditionMaximum;
  const weaponGroup: FactorGroup = {
    name: "weapon",
    classes: Array.from({ length: weaponRelativeMaximum - weaponRelativeMinimum + 1 }, (_, offset) => {
      const relative = weaponRelativeMinimum + offset;
      const value = zeroFactors.weaponDamage + relative;
      if (value <= 0) throw new RangeError("武器伤害因子必须为正数");
      return {
      min: relative,
      max: relative,
      value,
      variable: `weapon_${offset}`,
      q: roundedLog(value),
      };
    }),
  };
  let reachableWeaponFactorClassesRemoved = 0;
  let reachableWeaponPruningSkipped = 0;
  const reachableWeaponValues = reachableFinalAttributeValues(options, model, weaponAttribute);
  const reachableWeaponAdditions = options.job === "BLU"
    ? [...new Set(mainFactorGroup.classes.map((factorClass) => factorClass.auxiliary))]
    : [0];
  const maximumWeaponTransitionWork = 1_000_000;
  if (reachableWeaponValues === undefined || reachableWeaponAdditions.some((value) =>
    value === undefined || !Number.isSafeInteger(value)) || reachableWeaponAdditions.length === 0 ||
    reachableWeaponValues.length > Math.floor(maximumWeaponTransitionWork / reachableWeaponAdditions.length)) {
    reachableWeaponPruningSkipped++;
  } else {
    const reachableRelativeValues = new Set<number>();
    let validReachableSums = true;
    for (const weaponValue of reachableWeaponValues) {
      for (const addition of reachableWeaponAdditions) {
        const relative = weaponValue + addition!;
        if (!Number.isSafeInteger(relative)) {
          validReachableSums = false;
          break;
        }
        reachableRelativeValues.add(relative);
      }
      if (!validReachableSums) break;
    }
    const sortedReachableRelativeValues = [...reachableRelativeValues].sort((left, right) => left - right);
    const hasReachableClass = sortedReachableRelativeValues.some((value) =>
      value >= weaponRelativeMinimum && value <= weaponRelativeMaximum);
    if (!validReachableSums || !hasReachableClass) {
      reachableWeaponPruningSkipped++;
    } else {
      reachableWeaponFactorClassesRemoved = retainReachableFactorClasses(
        weaponGroup,
        sortedReachableRelativeValues,
      );
      if (reachableWeaponFactorClassesRemoved > 0) {
        reachableFactorClassesRemoved += reachableWeaponFactorClassesRemoved;
        weaponRelativeMinimum = weaponGroup.classes[0]!.min;
        weaponRelativeMaximum = weaponGroup.classes.at(-1)!.max;
      }
    }
  }
  groups.unshift(weaponGroup);

  const groupedByAttribute = [
    [groups[0]!, undefined, 0] as const,
    [groups[1]!, model.finalVariables[mainAttribute], groups[1]!.classes.at(-1)!.max] as const,
    [groups[2]!, detAttribute === undefined ? undefined : model.finalVariables[detAttribute], groups[2]!.classes.at(-1)!.max] as const,
    [groups[3]!, tenAttribute === undefined ? undefined : model.finalVariables[tenAttribute], groups[3]!.classes.at(-1)!.max] as const,
    [groups[4]!, crtAttribute === undefined ? undefined : model.finalVariables[crtAttribute], groups[4]!.classes.at(-1)!.max] as const,
    [groups[5]!, dhtAttribute === undefined ? undefined : model.finalVariables[dhtAttribute], groups[5]!.classes.at(-1)!.max] as const,
    [groups[6]!, model.finalVariables[speedAttribute], groups[6]!.classes.at(-1)!.max] as const,
  ];
  const boundsSet = new Set(model.bounds.map((bound) => bound.name));
  for (const [group, variable, maximum] of groupedByAttribute) {
    if (group.name === "weapon") {
      const relativeVariable = "weapon_relative";
      if (!boundsSet.has(relativeVariable)) {
        model.bounds.push({ name: relativeVariable, min: weaponRelativeMinimum, max: weaponRelativeMaximum });
        model.generalVars.push(relativeVariable);
        boundsSet.add(relativeVariable);
      }
      const wdExpression = new Map<string, number>([[relativeVariable, 1]]);
      if (options.job === "BLU") {
        for (const factorClass of mainFactorGroup.classes) {
          if (factorClass.auxiliary === undefined) {
            throw new Error("青魔法师主属性因子缺少武器伤害附加值");
          }
          addTerm(wdExpression, factorClass.variable, -factorClass.auxiliary);
        }
      }
      if (weaponAttribute !== undefined) addTerm(wdExpression, model.finalVariables[weaponAttribute]!, -1);
      addRows(model.rows, "weapon_total_sum", wdExpression, "=", 0);
      addClassSelection(model.rows, model.bounds, model.binaryVars, group, relativeVariable,
        group.classes.at(-1)!.max);
    } else {
      addClassSelection(model.rows, model.bounds, model.binaryVars, group, variable, maximum);
    }
  }

  const useDps = options.objective === undefined
    ? options.constraints?.gcd === undefined
    : options.objective === "dps";
  const gcdGroup = groups.find((group) => group.name === "gcd")!;
  if (!useDps) {
    for (const factorClass of gcdGroup.classes) factorClass.q = 0;
  } else {
    for (const factorClass of gcdGroup.classes) factorClass.q = -factorClass.q;
  }
  const qByVariable = new Map<string, number>();
  for (const group of groups) {
    const maximumQ = Math.max(...group.classes.map((factorClass) => factorClass.q));
    for (const factorClass of group.classes) {
      const coefficient = factorClass.q - maximumQ;
      qByVariable.set(factorClass.variable, coefficient);
    }
  }

  const resourceAxes = ([
    ...(addPrimaryResourceSupports ? [["main", mainAttribute] as const] : []),
    ["det", detAttribute], ["ten", tenAttribute], ["crt", crtAttribute],
    ["dht", dhtAttribute], ["gcd", speedAttribute],
  ] as const).filter((entry): entry is readonly ["main" | "det" | "ten" | "crt" | "dht" | "gcd", number] => entry[1] !== undefined);
  const foodMaximumBonuses = options.foods.map(() => new Array<number>(options.attributeIds.length).fill(0));
  for (const bonus of model.foodBonuses) {
    const uncapped = BigInt(bonus.maximumRaw) * BigInt(bonus.numerator) / BigInt(bonus.denominator);
    foodMaximumBonuses[bonus.foodIndex]![bonus.attribute] += uncapped >= BigInt(bonus.cap) ? bonus.cap : Number(uncapped);
  }
  // 这些支撑不等式由实际装备和食物资源蕴含。将它们直接施加到因子选择变量上，
  // 以强化整数松弛。
  for (let mask = 1; mask < 1 << resourceAxes.length; mask++) {
    const axes = resourceAxes.filter((_, index) => (mask & (1 << index)) !== 0);
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => total + Math.max(...slot.map((candidate) =>
      axes.reduce((sum, [, attribute]) => sum + candidate[attribute]!, 0))), 0);
    const foodMaximum = Math.max(0, ...foodMaximumBonuses.map((bonuses) =>
      axes.reduce((sum, [, attribute]) => sum + bonuses[attribute]!, 0)));
    const maximum = gearMaximum + foodMaximum;
    if (!Number.isSafeInteger(maximum)) continue;
    const terms = new Map<string, number>();
    for (const [name] of axes) for (const entry of groups.find((group) => group.name === name)!.classes) {
      addTerm(terms, entry.variable, entry.min);
    }
    addRows(model.rows, `factor_resource_${mask}`, terms, "<=", maximum);
  }
  if (addMainStatResourceSupport && !addPrimaryResourceSupports) {
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => total + Math.max(...slot.map((candidate) =>
      candidate[mainAttribute]!)), 0);
    const foodMaximum = Math.max(0, ...foodMaximumBonuses.map((bonuses) => bonuses[mainAttribute]!));
    const maximum = gearMaximum + foodMaximum;
    if (Number.isSafeInteger(maximum)) {
      const terms = new Map<string, number>();
      for (const entry of mainFactorGroup.classes) addTerm(terms, entry.variable, entry.min);
      addRows(model.rows, "factor_resource_main", terms, "<=", maximum);
    }
  }
  const weightedResourceVectors = addPrimaryResourceSupports
    ? factorResourceWeightVectors(groups, resourceAxes.map(([name]) => name))
    : [];
  for (let vectorIndex = 0; vectorIndex < weightedResourceVectors.length; vectorIndex++) {
    const weights = weightedResourceVectors[vectorIndex]!;
    const axes = resourceAxes.flatMap(([name, attribute], index) => {
      const weight = weights[index]!;
      return weight > 0 ? [[name, attribute, weight] as const] : [];
    });
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => total + Math.max(...slot.map((candidate) =>
      axes.reduce((sum, [, attribute, weight]) => sum + candidate[attribute]! * weight, 0))), 0);
    const foodMaximum = Math.max(0, ...foodMaximumBonuses.map((bonuses) =>
      axes.reduce((sum, [, attribute, weight]) => sum + bonuses[attribute]! * weight, 0)));
    const maximum = gearMaximum + foodMaximum;
    if (!Number.isSafeInteger(maximum)) continue;
    const terms = new Map<string, number>();
    for (const [name, , weight] of axes) for (const entry of groups.find((group) => group.name === name)!.classes) {
      addTerm(terms, entry.variable, entry.min * weight);
    }
    addRows(model.rows, `factor_resource_weighted_${vectorIndex}`, terms, "<=", maximum);
  }
  const conditionalResourceSupport = addCandidateLevelConditionalResourceSupports(
    options,
    model,
    groups,
    foodMaximumBonuses,
    new Map([
      ["main", mainAttribute],
      ["weapon", weaponAttribute],
      ["det", detAttribute],
      ["ten", tenAttribute],
      ["crt", crtAttribute],
      ["dht", dhtAttribute],
      ["gcd", speedAttribute],
    ]),
  );
  return { model, groups, factorEvaluator, useDps, qByVariable,
    mainAttribute, weaponAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute,
    reachableFactorClassesRemoved, reachableAttributePruningSkipped,
    reachableWeaponFactorClassesRemoved, reachableWeaponPruningSkipped, conditionalResourceSupport,
    primaryResourceSupportsEnabled: addPrimaryResourceSupports,
    mainStatResourceSupportEnabled: addMainStatResourceSupport && !addPrimaryResourceSupports };
}
