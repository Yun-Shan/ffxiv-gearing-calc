import type { EquipInfo, ParamInfo } from "./types.ts";

export type RingPairEquipInfo = EquipInfo & {
  ringEquips: readonly [EquipInfo, EquipInfo];
};

export function isRingPairEquipInfo(
  equipment: EquipInfo,
): equipment is RingPairEquipInfo {
  return "ringEquips" in equipment;
}

export function buildRingPairEquipInfos(
  rings: readonly EquipInfo[],
  isUnique: (itemId: number) => boolean,
): RingPairEquipInfo[] {
  const result: RingPairEquipInfo[] = [];
  for (const first of rings) {
    for (const second of rings) {
      if (first.itemId === second.itemId && isUnique(first.itemId)) continue;

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
      });
    }
  }
  return result;
}
