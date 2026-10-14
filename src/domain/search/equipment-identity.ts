type EquipmentIdentityInput = {
  itemId: number;
  itemLevel: number;
  variantKey?: string;
  baseParams: readonly { baseParamId: number; value: number }[];
  PDMG: number;
  MDMG: number;
  DLY: number;
  resistanceAllocation?: readonly { stat: string; value: number }[];
  ringEquips?: readonly EquipmentIdentityInput[];
};

/** 编码完整装备与魔晶石身份，并将无序的戒指对视为相同身份。 */
export function equipmentIdentity(equipment: EquipmentIdentityInput): string {
  const ringKeys = equipment.ringEquips?.map(equipmentIdentity).sort();
  const baseParams = equipment.baseParams
    .map(({ baseParamId, value }) => [baseParamId, value] as const)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return JSON.stringify({
    ...(ringKeys === undefined ? { itemId: equipment.itemId } : {}),
    ...(equipment.variantKey === undefined
      ? {}
      : { variantKey: equipment.variantKey }),
    itemLevel: equipment.itemLevel,
    baseParams,
    PDMG: equipment.PDMG,
    MDMG: equipment.MDMG,
    DLY: equipment.DLY,
    ...(equipment.resistanceAllocation === undefined
      ? {}
      : {
          resistanceAllocation: [...equipment.resistanceAllocation]
            .map(({ stat, value }) => [stat, value] as const)
            .sort(([leftStat, leftValue], [rightStat, rightValue]) =>
              leftStat.localeCompare(rightStat) || leftValue - rightValue),
        }),
    ...(ringKeys === undefined ? {} : { ringEquips: ringKeys }),
  });
}

/** 整数分配求解前生成的输入候选身份。 */
export function equipmentCandidateIdentity(
  equipment: EquipmentIdentityInput,
): string {
  if (equipment.resistanceAllocation === undefined) return equipmentIdentity(equipment);
  return equipmentIdentity({ ...equipment, resistanceAllocation: undefined });
}
