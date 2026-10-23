import type { EquipInfo } from "../types.ts";
import type { ResistanceAllocationVariable } from "./attribute-model.ts";
import type { FoodInfo } from "../types.ts";

export function slotsForResult(
  slots: readonly (readonly EquipInfo[])[],
  variables: readonly (readonly string[])[],
  columns: Record<string, { Primal: number }>,
): EquipInfo[] {
  return slots.map((slot, slotIndex) => {
    const selected = variables[slotIndex]!.findIndex((variable) =>
      (columns[variable]?.Primal ?? 0) > 0.5);
    if (selected < 0) throw new Error(`MIP 没有为槽位 ${slotIndex} 选择装备`);
    return slot[selected]!;
  });
}

export function slotsForResultWithResistanceAllocations(
  slots: readonly (readonly EquipInfo[])[],
  slotVariables: readonly (readonly string[])[],
  allocations: readonly ResistanceAllocationVariable[],
  columns: Record<string, { Primal: number }>,
): EquipInfo[] {
  const selection = slotsForResult(slots, slotVariables, columns);
  return selection.map((equipment, slotIndex) => {
    const candidateIndex = slotVariables[slotIndex]!.findIndex((variable) =>
      (columns[variable]?.Primal ?? 0) > 0.5);
    const resistanceAllocation = allocations
      .filter((allocation) => allocation.slotIndex === slotIndex &&
        allocation.candidateIndex === candidateIndex)
      .map((allocation) => {
        const raw = columns[allocation.variable]?.Primal ?? 0;
        const value = Math.round(raw);
        if (!Number.isSafeInteger(value) || Math.abs(value - raw) > 1e-6 ||
          value < 0 || value > allocation.maxValue) {
          throw new Error(`义军武器 ${equipment.itemId} 的 ${allocation.stat} 分配不是有效整数`);
        }
        return { stat: allocation.stat, baseParamId: allocation.baseParamId, value };
      })
      .filter(({ value }) => value > 0);
    if (resistanceAllocation.length === 0) return equipment;
    const allocatedTotal = resistanceAllocation.reduce((total, { value }) => total + value, 0);
    const maximum = equipment.resistanceWeaponAdjust?.maxTotalStats;
    if (maximum === undefined || !Number.isSafeInteger(allocatedTotal) || allocatedTotal > maximum) {
      throw new Error(`义军武器 ${equipment.itemId} 的总分配属性超过 ResistanceWeaponAdjust 上限`);
    }
    return { ...equipment, resistanceAllocation };
  });
}

export function foodForResult(
  foods: readonly FoodInfo[],
  variables: readonly string[],
  columns: Record<string, { Primal: number }>,
): FoodInfo | undefined {
  if (foods.length === 0) return undefined;
  const selected = variables.findIndex((variable) =>
    (columns[variable]?.Primal ?? 0) > 0.5);
  if (selected < 0) throw new Error("MIP 没有选择食物");
  return foods[selected];
}
