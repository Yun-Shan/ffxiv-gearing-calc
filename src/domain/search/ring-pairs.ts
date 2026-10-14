import type { EquipInfo, ParamInfo } from "./types.ts";

export type RingPairEquipInfo = EquipInfo & {
  ringEquips: readonly [EquipInfo, EquipInfo];
  /** 戒指候选池中完整的物品 ID 到唯一性元数据映射。 */
  ringUniqueByItemId?: readonly (readonly [number, boolean])[];
};

export function isRingPairEquipInfo(
  equipment: EquipInfo,
): equipment is RingPairEquipInfo {
  return "ringEquips" in equipment;
}

export function buildRingPairEquipInfos(
  rings: readonly EquipInfo[],
  isUnique: (itemId: number) => boolean,
  compareSymmetricSlotOrder?: (left: EquipInfo, right: EquipInfo) => number,
): RingPairEquipInfo[] {
  const result: RingPairEquipInfo[] = [];
  const uniqueByItemId = new Map<number, boolean>();
  for (const ring of rings) {
    if (!uniqueByItemId.has(ring.itemId)) uniqueByItemId.set(ring.itemId, isUnique(ring.itemId));
  }
  const ringUniqueByItemId = [...uniqueByItemId]
    .sort(([left], [right]) => left - right)
    .map(([itemId, unique]) => [itemId, unique] as const);
  for (const first of rings) {
    for (const second of rings) {
      if (compareSymmetricSlotOrder !== undefined && compareSymmetricSlotOrder(first, second) > 0) continue;
      if (first.itemId === second.itemId && uniqueByItemId.get(first.itemId) === true) continue;

      const attributes = new Map<number, number>();
      for (const param of [...first.baseParams, ...second.baseParams]) {
        attributes.set(
          param.baseParamId,
          (attributes.get(param.baseParamId) ?? 0) + param.value,
        );
      }
      const baseParams: ParamInfo[] = [...attributes]
        .map(([baseParamId, value]) => ({ baseParamId, value }))
        .sort((left, right) => left.baseParamId - right.baseParamId);

      result.push({
        itemId: first.itemId * 100_000 + second.itemId,
        itemLevel: first.itemLevel + second.itemLevel,
        key: baseParams.map((param) => param.baseParamId).join("-"),
        baseParams,
        PDMG: first.PDMG + second.PDMG,
        MDMG: first.MDMG + second.MDMG,
        DLY: first.DLY + second.DLY,
        ringEquips: [first, second],
        ringUniqueByItemId,
      });
    }
  }
  return result;
}
