type EquipmentIdentityInput = {
  itemId: number;
  itemLevel: number;
  variantKey?: string;
  baseParams: readonly { baseParamId: number; value: number }[];
  PDMG: number;
  MDMG: number;
  DLY: number;
  ringEquips?: readonly EquipmentIdentityInput[];
};

/** Encodes full equipment and materia identity, including unordered ring pairs. */
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
    ...(ringKeys === undefined ? {} : { ringEquips: ringKeys }),
  });
}
