import type { EquipInfo } from "../types.ts";
import type { FoodInfo } from "../types.ts";
import type { EquipmentAttributeExtractor } from "../search-types.ts";
import type { Stat } from "../../types.ts";
import type { CustomizableStat } from "../../types.ts";
import { gcd } from "../core/exact-arithmetic.ts";

export function getAttributeVector(
  selection: readonly EquipInfo[],
  food: FoodInfo | undefined,
  attributeIds: readonly number[],
  equipmentAttributeExtractor: EquipmentAttributeExtractor | undefined,
  statIndexes: ReadonlyMap<Stat, number>,
): number[] {
  const indexes = new Map(attributeIds.map((id, index) => [id, index]));
  const result = new Array<number>(attributeIds.length).fill(0);
  for (const equipment of selection) {
    const params = equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
    for (const param of params) {
      const index = indexes.get(param.baseParamId);
      if (index !== undefined) result[index] += param.value;
    }
    const allocations = equipment.resistanceAllocation ?? [];
    if (allocations.length > 0) {
      const adjustment = equipment.resistanceWeaponAdjust;
      if (adjustment === undefined) {
        throw new Error(`装备 ${equipment.itemId} 的属性分配缺少 ResistanceWeaponAdjust 参数`);
      }
      const seen = new Set<CustomizableStat>();
      let total = 0;
      for (const allocation of allocations) {
        const maximum = adjustment.statMaximums?.[allocation.stat] ?? adjustment.maxEachStat;
        const statIndex = statIndexes.get(allocation.stat);
        const expectedAttributeId = statIndex === undefined ? undefined : attributeIds[statIndex];
        const index = indexes.get(allocation.baseParamId);
        if (!adjustment.stats.includes(allocation.stat) || seen.has(allocation.stat) ||
          !Number.isSafeInteger(maximum) || maximum < 0 ||
          !Number.isSafeInteger(allocation.value) || allocation.value <= 0 ||
          allocation.value > maximum || expectedAttributeId !== allocation.baseParamId ||
          index === undefined) {
          throw new Error(`装备 ${equipment.itemId} 的 ${allocation.stat} 属性分配无效`);
        }
        seen.add(allocation.stat);
        total += allocation.value;
        result[index] += allocation.value;
      }
      if (!Number.isSafeInteger(total) || total > adjustment.maxTotalStats) {
        throw new Error(`装备 ${equipment.itemId} 的总分配属性超过 ResistanceWeaponAdjust 上限`);
      }
    }
  }
  if (food !== undefined) {
    for (const param of food.baseParams) {
      const index = indexes.get(param.baseParamId);
      if (index === undefined) continue;
      result[index] += Math.min(
        param.maxValue,
        Math.trunc((result[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
      );
    }
  }
  return result;
}

export function parseRationalRate(rate: number): { numerator: number; denominator: number } {
  const numerator = Math.round(rate * 100);
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError(`食物加成比例不是百分比整数：${rate}`);
  }
  const divisor = gcd(numerator, 100);
  return { numerator: numerator / divisor, denominator: 100 / divisor };
}

export function validateFoodRate(param: FoodInfo["baseParams"][number], maximumRaw: number): {
  numerator: number;
  denominator: number;
} {
  const rate = parseRationalRate(param.multiplier - 1);
  for (let raw = 0; raw <= maximumRaw; raw++) {
    const expected = Math.min(
      param.maxValue,
      Math.trunc((raw + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
    );
    const rational = Math.min(
      param.maxValue,
      Math.floor(((raw + (param.baseValue ?? 0)) * rate.numerator) / rate.denominator),
    );
    if (expected !== rational) {
      throw new Error(
        `食物 ${param.baseParamId} 的整数比例模型与 v2 取整不一致：原始值=${raw}`,
      );
    }
  }
  return rate;
}
