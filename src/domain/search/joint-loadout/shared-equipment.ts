import type { EquipInfo, SharedSlotProjection } from "../types.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import type { JobContext, RingPairInfo } from "./types.ts";

export function projectEquipment(
  equipment: EquipInfo,
  projection: SharedSlotProjection | undefined,
): EquipInfo {
  if (projection === undefined) return equipment;
  const pair = equipment as Partial<RingPairInfo>;
  const projected = pair.ringEquips?.[projection.ringIndex];
  if (projected === undefined) {
    throw new Error(`共享槽位 ${projection.commonSlot} 的完整候选缺少对应戒指`);
  }
  return projected;
}

export function projectionMap(
  commonSlots: readonly string[],
  projections: readonly SharedSlotProjection[] = [],
): Map<string, SharedSlotProjection> {
  const result = new Map<string, SharedSlotProjection>();
  const projectedSlots = new Set<string>();
  for (const projection of projections) {
    if (!commonSlots.includes(projection.commonSlot)) {
      throw new RangeError(`共享槽位投影 ${projection.commonSlot} 不在 commonSlots 中`);
    }
    if (!projection.slotName || (projection.ringIndex !== 0 && projection.ringIndex !== 1)) {
      throw new RangeError(`共享槽位投影 ${projection.commonSlot} 无效`);
    }
    if (result.has(projection.commonSlot)) {
      throw new RangeError(`共享槽位 ${projection.commonSlot} 有重复投影`);
    }
    if (commonSlots.includes(projection.slotName)) {
      throw new RangeError(`完整槽位 ${projection.slotName} 与其共享投影不能同时选择`);
    }
    const projectedKey = `${projection.slotName}:${projection.ringIndex}`;
    if (projectedSlots.has(projectedKey)) {
      throw new RangeError(`共享槽位投影重复指向 ${projectedKey}`);
    }
    projectedSlots.add(projectedKey);
    result.set(projection.commonSlot, projection);
  }
  return result;
}

export function commonSlotIndex(
  context: Pick<JobContext, "indexByName" | "job">,
  commonSlot: string,
  projections: ReadonlyMap<string, SharedSlotProjection>,
): number {
  const slotName = projections.get(commonSlot)?.slotName ?? commonSlot;
  const index = context.indexByName.get(slotName);
  if (index === undefined) throw new RangeError(`通用槽位 ${commonSlot} 在职业 ${context.job.id} 中不存在`);
  return index;
}

export function equipmentForCommonSlot(
  context: Pick<JobContext, "indexByName" | "job">,
  selection: readonly EquipInfo[],
  commonSlot: string,
  projections: ReadonlyMap<string, SharedSlotProjection>,
): EquipInfo {
  const equipment = selection[commonSlotIndex(context, commonSlot, projections)];
  if (equipment === undefined) throw new Error(`通用槽位 ${commonSlot} 缺少装备候选`);
  return projectEquipment(equipment, projections.get(commonSlot));
}

export function commonSlotIdentity(
  context: Pick<JobContext, "indexByName" | "job">,
  selection: readonly EquipInfo[],
  commonSlot: string,
  projections: ReadonlyMap<string, SharedSlotProjection>,
): string {
  return equipmentIdentity(equipmentForCommonSlot(context, selection, commonSlot, projections));
}
