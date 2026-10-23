import type { ModelRow } from "../core/model-types.ts";
import { addRows } from "../core/model-builder.ts";
import type { EquipInfo } from "../types.ts";
import type { CustomizableStat } from "../../types.ts";
import type { ExactMipOptions } from "./types.ts";
import type { VariableBounds } from "../core/model-types.ts";
import type { GcdSpeedRange } from "../search-types.ts";
import { addTerm } from "../core/model-builder.ts";
import type { AttributeFoodBonus } from "./types.ts";
import { validateFoodRate } from "./attributes.ts";

export function addRangeConstraint(
  rows: ModelRow[],
  name: string,
  variable: string,
  minimum: number | undefined,
  maximum: number | undefined,
): void {
  if (minimum !== undefined) {
    addRows(rows, `${name}_min`, [[variable, 1]], ">=", Math.ceil(minimum));
  }
  if (maximum !== undefined) {
    addRows(rows, `${name}_max`, [[variable, 1]], "<=", Math.floor(maximum));
  }
}

export function ringEquipmentIdentity(equipment: EquipInfo): string {
  return JSON.stringify({
    itemId: equipment.itemId,
    ...(equipment.variantKey === undefined ? {} : { variantKey: equipment.variantKey }),
    itemLevel: equipment.itemLevel,
    baseParams: equipment.baseParams
      .map(({ baseParamId, value }) => [baseParamId, value] as const)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]),
    PDMG: equipment.PDMG,
    MDMG: equipment.MDMG,
    DLY: equipment.DLY,
  });
}

export function symmetricRingSlotOrder(
  slots: readonly (readonly EquipInfo[])[],
  ringSlots: ReadonlyMap<0 | 1, number>,
  hasCustomExtractor: boolean,
): { firstSlotIndex: number; secondSlotIndex: number; firstRanks: number[]; secondRanks: number[] } | undefined {
  if (hasCustomExtractor || ringSlots.size !== 2) return undefined;
  const firstSlotIndex = ringSlots.get(0)!;
  const secondSlotIndex = ringSlots.get(1)!;
  const firstIdentities = slots[firstSlotIndex]!.map(ringEquipmentIdentity);
  const secondIdentities = slots[secondSlotIndex]!.map(ringEquipmentIdentity);
  if (firstIdentities.length !== secondIdentities.length) return undefined;
  const firstSorted = [...firstIdentities].sort();
  const secondSorted = [...secondIdentities].sort();
  if (firstSorted.some((identity, index) => identity !== secondSorted[index])) return undefined;
  const rankByIdentity = new Map<string, number>();
  [...new Set(firstSorted)].forEach((identity, rank) => rankByIdentity.set(identity, rank));
  return {
    firstSlotIndex,
    secondSlotIndex,
    firstRanks: firstIdentities.map((identity) => rankByIdentity.get(identity)!),
    secondRanks: secondIdentities.map((identity) => rankByIdentity.get(identity)!),
  };
}

export type ResistanceAllocationVariable = {
  slotIndex: number;
  candidateIndex: number;
  stat: CustomizableStat;
  baseParamId: number;
  attributeIndex: number;
  maxValue: number;
  variable: string;
  maxTotalStats: number;
};

export function buildLinearAttributeModel(options: ExactMipOptions) {
  const { slots, foods, attributeIds } = options;
  if (slots.some((slot) => slot.length === 0)) return undefined;
  const idToIndex = new Map(attributeIds.map((id, index) => [id, index]));
  const rows: ModelRow[] = [];
  const bounds: VariableBounds[] = [];
  const binaryVars: string[] = [];
  const generalVars: string[] = [];
  const slotVariables: string[][] = [];
  const foodVariables: string[] = [];
  const gcdChoiceVariables: string[] = [];
  const gcdChoiceRanges: GcdSpeedRange[] = [];
  const fixedEquipmentAttributes = slots.map((slot) => slot.map((equipment) => {
    const result = new Array<number>(attributeIds.length).fill(0);
    const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
    for (const param of params) {
      const index = idToIndex.get(param.baseParamId);
      if (index !== undefined) result[index] += param.value;
    }
    return result;
  }));
  const resistanceAllocationVariables: ResistanceAllocationVariable[] = slots.flatMap((slot, slotIndex) =>
    slot.flatMap((equipment, candidateIndex) => {
      const adjustment = equipment.resistanceWeaponAdjust;
      if (adjustment === undefined) return [];
      if (!Number.isSafeInteger(adjustment.maxTotalStats) || adjustment.maxTotalStats < 0 ||
        !Number.isSafeInteger(adjustment.maxEachStat) || adjustment.maxEachStat < 0 ||
        !Array.isArray(adjustment.stats) || adjustment.stats.length === 0 ||
        new Set(adjustment.stats).size !== adjustment.stats.length) {
        throw new RangeError(`义军武器 ${equipment.itemId} 的 ResistanceWeaponAdjust 参数无效`);
      }
      return adjustment.stats.flatMap((stat) => {
        const vectorIndex = options.statIndexes.get(stat);
        const attributeId = vectorIndex === undefined ? undefined : attributeIds[vectorIndex];
        const attributeIndex = attributeId === undefined ? undefined : idToIndex.get(attributeId);
        if (attributeId === undefined || attributeIndex === undefined) {
          throw new RangeError(`义军武器 ${equipment.itemId} 的属性 ${stat} 不在搜索属性向量中`);
        }
        const statMaximum = adjustment.statMaximums?.[stat] ?? adjustment.maxEachStat;
        if (!Number.isSafeInteger(statMaximum) || statMaximum < 0) {
          throw new RangeError(`义军武器 ${equipment.itemId} 的属性 ${stat} 分配上限无效`);
        }
        const maxValue = Math.min(adjustment.maxTotalStats, adjustment.maxEachStat, statMaximum);
        return maxValue === 0 ? [] : [{
          slotIndex,
          candidateIndex,
          stat,
          baseParamId: attributeId,
          attributeIndex,
          maxValue,
          variable: `rw_${slotIndex}_${candidateIndex}_${stat}`,
          maxTotalStats: adjustment.maxTotalStats,
        }];
      });
    }),
  );
  const equipmentAttributes = fixedEquipmentAttributes.map((slot, slotIndex) =>
    slot.map((fixed, candidateIndex) => {
      const maximum = [...fixed];
      for (const allocation of resistanceAllocationVariables) {
        if (allocation.slotIndex === slotIndex && allocation.candidateIndex === candidateIndex) {
          maximum[allocation.attributeIndex] += allocation.maxValue;
        }
      }
      return maximum;
    }),
  );
  const rawMaximums = attributeIds.map((_, attribute) =>
    equipmentAttributes.reduce((total, slot) =>
      total + Math.max(0, ...slot.map((values) => values[attribute]!)), 0));
  const rawMinimums = attributeIds.map((_, attribute) =>
    fixedEquipmentAttributes.reduce((total, slot) =>
      total + Math.min(...slot.map((values) => values[attribute]!)), 0));
  for (const maximum of rawMaximums) {
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw new RangeError(`装备属性范围不是非负安全整数：${maximum}`);
    }
  }
  for (const minimum of rawMinimums) {
    if (!Number.isSafeInteger(minimum) || minimum < 0) {
      throw new RangeError(`装备属性下界不是非负安全整数：${minimum}`);
    }
  }
  const finalMinimums = attributeIds.map((id, attribute) => {
    if (foods.length === 0) return rawMinimums[attribute]!;
    return Math.min(...foods.map((food) => {
      const param = food.baseParams.find((entry) => entry.baseParamId === id);
      const bonus = param !== undefined && param.maxValue > 0 && param.multiplier > 1
        ? Math.min(param.maxValue, Math.trunc((rawMinimums[attribute]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7))
        : 0;
      return rawMinimums[attribute]! + bonus;
    }));
  });

  slots.forEach((slot, slotIndex) => {
    const variables = slot.map((_, candidateIndex) => `e_${slotIndex}_${candidateIndex}`);
    slotVariables.push(variables);
    variables.forEach((variable) => {
      bounds.push({ name: variable, min: 0, max: 1 });
      binaryVars.push(variable);
    });
    addRows(rows, `slot_${slotIndex}`, variables.map((variable) => [variable, 1] as const), "=", 1);
  });
  const allocationVariablesByCandidate = new Map<string, typeof resistanceAllocationVariables>();
  for (const allocation of resistanceAllocationVariables) {
    const key = `${allocation.slotIndex}:${allocation.candidateIndex}`;
    const candidateAllocations = allocationVariablesByCandidate.get(key) ?? [];
    candidateAllocations.push(allocation);
    allocationVariablesByCandidate.set(key, candidateAllocations);
    bounds.push({ name: allocation.variable, min: 0, max: allocation.maxValue });
    generalVars.push(allocation.variable);
    const selected = slotVariables[allocation.slotIndex]![allocation.candidateIndex]!;
    addRows(rows, `${allocation.variable}_selected`, [
      [allocation.variable, 1],
      [selected, -allocation.maxValue],
    ], "<=", 0);
  }
  for (const [candidateKey, allocations] of allocationVariablesByCandidate) {
    const [slotIndexText, candidateIndexText] = candidateKey.split(":");
    const slotIndex = Number(slotIndexText);
    const candidateIndex = Number(candidateIndexText);
    if (!Number.isSafeInteger(slotIndex) || !Number.isSafeInteger(candidateIndex)) {
      throw new Error("义军武器 MIP 候选索引无效");
    }
    const adjustment = slots[slotIndex]![candidateIndex]!.resistanceWeaponAdjust!;
    const terms = new Map<string, number>();
    for (const allocation of allocations) addTerm(terms, allocation.variable, 1);
    addTerm(terms, slotVariables[slotIndex]![candidateIndex]!, -adjustment.maxTotalStats);
    addRows(rows, `rw_total_${slotIndex}_${candidateIndex}`, terms, "<=", 0);
  }
  const ringSlots = new Map<0 | 1, number>();
  slots.forEach((slot, slotIndex) => {
    const marked = slot.filter((equipment) => equipment.ringSlotIndex !== undefined);
    if (marked.length === 0) return;
    const ringSlotIndex = marked[0]!.ringSlotIndex;
    if ((ringSlotIndex !== 0 && ringSlotIndex !== 1) || marked.length !== slot.length ||
      marked.some((equipment) => equipment.ringSlotIndex !== ringSlotIndex) ||
      ringSlots.has(ringSlotIndex)) {
      throw new RangeError("独立戒指槽标记不完整或重复");
    }
    for (const equipment of marked) {
      if (!Number.isSafeInteger(equipment.itemId) || typeof equipment.isUnique !== "boolean") {
        throw new RangeError(`戒指 ${equipment.itemId} 缺少有效的 IsUnique 元数据`);
      }
    }
    ringSlots.set(ringSlotIndex, slotIndex);
  });
  if (ringSlots.size !== 0 && ringSlots.size !== 2) {
    throw new RangeError("独立戒指模型必须同时包含戒指1和戒指2槽");
  }
  if (ringSlots.size === 2) {
    const uniqueByItemId = new Map<number, boolean>();
    for (const ringSlotIndex of [0, 1] as const) {
      for (const equipment of slots[ringSlots.get(ringSlotIndex)!]!) {
        const known = uniqueByItemId.get(equipment.itemId);
        if (known !== undefined && known !== equipment.isUnique) {
          throw new RangeError(`戒指 ${equipment.itemId} 的 IsUnique 元数据不一致`);
        }
        uniqueByItemId.set(equipment.itemId, equipment.isUnique!);
      }
    }
    for (const [itemId, isUnique] of uniqueByItemId) {
      if (!isUnique) continue;
      const terms = new Map<string, number>();
      for (const ringSlotIndex of [0, 1] as const) {
        const slotIndex = ringSlots.get(ringSlotIndex)!;
        slots[slotIndex]!.forEach((equipment, candidateIndex) => {
          if (equipment.itemId === itemId) addTerm(terms, slotVariables[slotIndex]![candidateIndex]!, 1);
        });
      }
      // 一条约束行覆盖该实体物品在两个槽位中的所有镶嵌变体。
      if (terms.size > 1) addRows(rows, `unique_ring_item_${itemId}`, terms, "<=", 1);
    }
  }
  const canonicalRingOrder = symmetricRingSlotOrder(
    slots,
    ringSlots,
    options.equipmentAttributeExtractor !== undefined,
  );
  if (canonicalRingOrder !== undefined) {
    const terms = new Map<string, number>();
    canonicalRingOrder.firstRanks.forEach((rank, candidateIndex) => {
      addTerm(terms, slotVariables[canonicalRingOrder.firstSlotIndex]![candidateIndex]!, rank);
    });
    canonicalRingOrder.secondRanks.forEach((rank, candidateIndex) => {
      addTerm(terms, slotVariables[canonicalRingOrder.secondSlotIndex]![candidateIndex]!, -rank);
    });
    addRows(rows, "canonical_ring_slot_order", terms, "<=", 0);
  }

  const foodBonuses: AttributeFoodBonus[] = [];
  if (foods.length > 0) {
    foods.forEach((_, index) => {
      const variable = `f_${index}`;
      foodVariables.push(variable);
      bounds.push({ name: variable, min: 0, max: 1 });
      binaryVars.push(variable);
    });
    addRows(rows, "choose_food", foodVariables.map((variable) => [variable, 1] as const), "=", 1);
  }

  const rawVariables: string[] = [];
  const finalVariables: string[] = [];
  attributeIds.forEach((_, attribute) => {
    const rawVariable = `raw_${attribute}`;
    const finalVariable = `final_${attribute}`;
    rawVariables.push(rawVariable);
    finalVariables.push(finalVariable);
    bounds.push({ name: rawVariable, min: rawMinimums[attribute]!, max: rawMaximums[attribute]! });
    bounds.push({ name: finalVariable, min: finalMinimums[attribute]!, max: rawMaximums[attribute]! + Math.max(0, ...foods.map((food) =>
      food.baseParams.find((param) => param.baseParamId === attributeIds[attribute])?.maxValue ?? 0)) });
    generalVars.push(rawVariable, finalVariable);

    const rawTerms = new Map<string, number>([[rawVariable, 1]]);
    slots.forEach((slot, slotIndex) => {
      slot.forEach((_, candidateIndex) => {
        addTerm(rawTerms, slotVariables[slotIndex]![candidateIndex]!, -fixedEquipmentAttributes[slotIndex]![candidateIndex]![attribute]!);
      });
    });
    for (const allocation of resistanceAllocationVariables) {
      if (allocation.attributeIndex === attribute) addTerm(rawTerms, allocation.variable, -1);
    }
    addRows(rows, `raw_sum_${attribute}`, rawTerms, "=", 0);

  });

  for (let foodIndex = 0; foodIndex < foods.length; foodIndex++) {
    const food = foods[foodIndex]!;
    const foodVariable = foodVariables[foodIndex]!;
    for (const param of food.baseParams) {
      const attribute = idToIndex.get(param.baseParamId);
      if (attribute === undefined || param.maxValue <= 0 || param.multiplier <= 1) continue;
      const { numerator, denominator } = validateFoodRate(param, rawMaximums[attribute]!);
      if (numerator === 0) continue;
      const bonus = `b_${foodIndex}_${attribute}`;
      const capped = `c_${foodIndex}_${attribute}`;
      const cap = param.maxValue;
      const offset = numerator * (param.baseValue ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("食物基础属性必须为非负安全整数");
      const bigM = Math.max(
        numerator * rawMaximums[attribute]! + offset,
        denominator * cap,
      );
      bounds.push({ name: bonus, min: 0, max: cap });
      bounds.push({ name: capped, min: 0, max: 1 });
      generalVars.push(bonus);
      binaryVars.push(capped);
      foodBonuses.push({
        foodIndex,
        attribute,
        bonus,
        capped,
        numerator,
        denominator,
        cap,
        maximumRaw: rawMaximums[attribute]! + (param.baseValue ?? 0),
      });
      addRows(rows, `food_cap_flag_${foodIndex}_${attribute}`, [[capped, 1], [foodVariable, -1]], "<=", 0);
      addRows(rows, `food_bonus_cap_low_${foodIndex}_${attribute}`, [[bonus, 1], [capped, -cap]], ">=", 0);
      addRows(rows, `food_bonus_cap_high_${foodIndex}_${attribute}`, [[bonus, 1], [foodVariable, -(cap - 1)], [capped, -1]], "<=", 0);
      addRows(rows, `food_floor_low_${foodIndex}_${attribute}`, [[bonus, denominator], [rawVariables[attribute]!, -numerator]], "<=", offset);
      const floorHigh = new Map<string, number>([
        [rawVariables[attribute]!, numerator],
        [bonus, -denominator],
        [capped, -bigM],
        [foodVariable, bigM],
      ]);
      addRows(rows, `food_floor_high_${foodIndex}_${attribute}`, floorHigh, "<=", denominator - 1 + bigM - offset);
      const capThreshold = new Map<string, number>([
        [rawVariables[attribute]!, numerator],
        [capped, -bigM],
      ]);
      addRows(rows, `food_cap_threshold_${foodIndex}_${attribute}`, capThreshold, ">=", denominator * cap - bigM - offset);
    }
  }
  // 各食物的条件加成变量创建后，重新构造最终属性总和。
  attributeIds.forEach((_, attribute) => {
    const finalTerms = new Map<string, number>([[finalVariables[attribute]!, 1], [rawVariables[attribute]!, -1]]);
    for (const bonus of foodBonuses) {
      if (bonus.attribute === attribute) addTerm(finalTerms, bonus.bonus, -1);
    }
    addRows(rows, `final_food_sum_${attribute}`, finalTerms, "=", 0);
  });

  const constraints = options.constraints ?? {};
  const ranges = new Map<number, { min?: number; max?: number }>();
  const mergeRange = (attributeId: number, min?: number, max?: number) => {
    const index = idToIndex.get(attributeId);
    if (index === undefined) throw new RangeError(`属性约束包含未配置的属性 id：${attributeId}`);
    const existing = ranges.get(index) ?? {};
    const combined = {
      min: Math.max(existing.min ?? Number.NEGATIVE_INFINITY, min ?? Number.NEGATIVE_INFINITY),
      max: Math.min(existing.max ?? Number.POSITIVE_INFINITY, max ?? Number.POSITIVE_INFINITY),
    };
    if (combined.min > combined.max) throw new RangeError(`属性 ${attributeId} 的约束范围为空`);
    ranges.set(index, {
      min: Number.isFinite(combined.min) ? combined.min : undefined,
      max: Number.isFinite(combined.max) ? combined.max : undefined,
    });
  };
  if (constraints.gcd !== undefined) {
    if (options.gcdToSpeedRange === undefined) throw new RangeError("按 GCD 搜索需要配置 gcdToSpeedRange");
    const range = options.gcdToSpeedRange(constraints.gcd);
    if (range === undefined) return undefined;
    if (options.speedAttributeId === undefined) throw new RangeError("按 GCD 搜索缺少速度属性 id");
    mergeRange(options.speedAttributeId, range.min, range.max);
  }
  if (constraints.gcdChoices !== undefined) {
    if (constraints.gcdChoices.length === 0) return undefined;
    if (options.gcdToSpeedRange === undefined) throw new RangeError("多个 GCD 搜索需要配置 gcdToSpeedRange");
    if (options.speedAttributeId === undefined) throw new RangeError("多个 GCD 搜索缺少速度属性 id");
    const choices = new Map<string, GcdSpeedRange>();
    for (const gcdChoice of constraints.gcdChoices) {
      if (!Number.isFinite(gcdChoice) || gcdChoice <= 0) {
        throw new RangeError(`GCD 备选值必须为正有限数：${gcdChoice}`);
      }
      const range = options.gcdToSpeedRange(gcdChoice);
      if (range === undefined) continue;
      if (!Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max) || range.min > range.max) {
        throw new RangeError(`GCD ${gcdChoice} 对应的速度范围无效`);
      }
      choices.set(`${range.min}:${range.max}`, range);
    }
    if (choices.size === 0) return undefined;
    const speedIndex = idToIndex.get(options.speedAttributeId);
    if (speedIndex === undefined) throw new RangeError(`GCD 搜索的速度属性未配置：${options.speedAttributeId}`);
    const lowerTerms = new Map<string, number>([[finalVariables[speedIndex]!, 1]]);
    const upperTerms = new Map<string, number>([[finalVariables[speedIndex]!, 1]]);
    for (const [index, range] of [...choices.values()].entries()) {
      const variable = `gcd_choice_${index}`;
      gcdChoiceVariables.push(variable);
      gcdChoiceRanges.push(range);
      bounds.push({ name: variable, min: 0, max: 1 });
      binaryVars.push(variable);
      addTerm(lowerTerms, variable, -range.min);
      addTerm(upperTerms, variable, -range.max);
    }
    addRows(rows, "choose_gcd_choice", gcdChoiceVariables.map((variable) => [variable, 1] as const), "=", 1);
    addRows(rows, "gcd_choice_speed_min", lowerTerms, ">=", 0);
    addRows(rows, "gcd_choice_speed_max", upperTerms, "<=", 0);
  }
  if (constraints.speedMin !== undefined || constraints.speedMax !== undefined) {
    if (options.speedAttributeId === undefined) throw new RangeError("速度约束缺少速度属性 id");
    mergeRange(options.speedAttributeId, constraints.speedMin, constraints.speedMax);
  }
  if (constraints.toughMin !== undefined || constraints.toughnessMinPercent !== undefined || constraints.maxToughnessMode === true) {
    if (options.toughnessAttributeId === undefined) throw new RangeError("坚韧约束需要配置坚韧属性 id");
    if (constraints.toughMin !== undefined) mergeRange(options.toughnessAttributeId, constraints.toughMin);
    if (constraints.toughnessMinPercent !== undefined) {
      if (options.toughnessPercentToMinimum === undefined) throw new RangeError("按坚韧百分比搜索需要配置 toughnessPercentToMinimum");
      mergeRange(options.toughnessAttributeId, options.toughnessPercentToMinimum(constraints.toughnessMinPercent));
    }
  }
  for (const [attribute, range] of ranges) {
    addRangeConstraint(rows, `attribute_range_${attribute}`, finalVariables[attribute]!, range.min, range.max);
  }

  return {
    rows,
    bounds,
    binaryVars,
    generalVars,
    slotVariables,
    foodVariables,
    gcdChoiceVariables,
    gcdChoiceRanges,
    rawVariables,
    finalVariables,
    rawMaximums,
    rawMinimums,
    finalMinimums,
    equipmentAttributes,
    fixedEquipmentAttributes,
    resistanceAllocationVariables,
    foodBonuses,
    idToIndex,
    ranges,
    canonicalRingOrder,
  };
}
