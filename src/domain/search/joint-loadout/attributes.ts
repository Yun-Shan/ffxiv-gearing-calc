import type { EquipInfo, FoodInfo } from "../types.ts";
import type { JobContext } from "./types.ts";

export function applyFood(attributes: readonly number[], food: FoodInfo | undefined, indexes: ReadonlyMap<number, number>): number[] {
  const final = [...attributes];
  if (food === undefined) return final;
  for (const param of food.baseParams) {
    const index = indexes.get(param.baseParamId);
    if (index === undefined) continue;
    final[index] += Math.min(
      param.maxValue,
      Math.trunc((final[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
    );
  }
  return final;
}

export function buildRawAttributes(context: JobContext, selection: readonly EquipInfo[]): number[] {
  const attributes = new Array<number>(context.job.options.attributeIds.length).fill(0);
  for (const equipment of selection) {
    let values = context.equipAttributes.get(equipment);
    if (values === undefined) {
      const next = new Array<number>(attributes.length).fill(0);
      const params = context.job.options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
      for (const param of params) {
        const index = context.attributeIndexes.get(param.baseParamId);
        if (index !== undefined) next[index] += param.value;
      }
      for (const allocation of equipment.resistanceAllocation ?? []) {
        const index = context.attributeIndexes.get(allocation.baseParamId);
        if (index !== undefined) next[index] += allocation.value;
      }
      if (next.some((value) => !Number.isSafeInteger(value))) {
        throw new RangeError(`装备 ${equipment.itemId} 的属性不是安全整数`);
      }
      values = next;
      context.equipAttributes.set(equipment, values);
    }
    for (let index = 0; index < attributes.length; index++) attributes[index] += values[index]!;
  }
  return attributes;
}

function rawAttributeUpperBound(context: JobContext, equipment: EquipInfo): number[] {
  const attributes = buildRawAttributes(context, [equipment]);
  const adjustment = equipment.resistanceWeaponAdjust;
  if (adjustment === undefined) return attributes;
  for (const stat of adjustment.stats) {
    const vectorIndex = context.job.options.statIndexes.get(stat);
    const attributeId = vectorIndex === undefined
      ? undefined
      : context.job.options.attributeIds[vectorIndex];
    const attribute = attributeId === undefined
      ? undefined
      : context.attributeIndexes.get(attributeId);
    if (attribute === undefined) continue;
    const maxValue = Math.min(
      adjustment.maxTotalStats,
      adjustment.maxEachStat,
      adjustment.statMaximums?.[stat] ?? adjustment.maxEachStat,
    );
    attributes[attribute] += maxValue;
  }
  return attributes;
}

export function rawAttributeMaximums(context: JobContext, checkBudget: () => void): number[] {
  const maximums = new Array<number>(context.job.options.attributeIds.length).fill(0);
  for (const slot of context.job.options.slots) {
    checkBudget();
    for (let attribute = 0; attribute < maximums.length; attribute++) {
      const maximum = Math.max(0, ...slot.map((equipment) =>
        rawAttributeUpperBound(context, equipment)[attribute]!));
      maximums[attribute] += maximum;
    }
  }
  return maximums;
}
