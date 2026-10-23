import type { JointRingSplit } from "./ring-domain.ts";
import type { SharedSlotProjection } from "../types.ts";
import type { EquipInfo } from "../types.ts";
import { hasRingPairProperty } from "./ring-domain.ts";
import { trySplitRingPairDomain } from "./ring-domain.ts";
import { ringPairCandidate } from "./ring-domain.ts";
import { ringPairSharedIdentity } from "./ring-domain.ts";

import type { JointSearchOptions } from "./joint-types.ts";

export function prepareJointIdentity(
  options: Pick<
    JointSearchOptions,
    "commonSlotProjections" | "commonSlots" | "equipmentIdentity" | "jobs"
  >,
) {
  const projections = new Map<string, SharedSlotProjection>();
  for (const projection of options.commonSlotProjections ?? []) {
    if (
      !options.commonSlots.includes(projection.commonSlot) ||
      !projection.slotName ||
      (projection.ringIndex !== 0 && projection.ringIndex !== 1) ||
      projections.has(projection.commonSlot)
    ) {
      throw new RangeError(
        `联合因子 MIP 的共享槽位投影 ${projection.commonSlot} 无效`,
      );
    }
    projections.set(projection.commonSlot, projection);
  }
  const detectedRingPairs = options.jobs.map((job) =>
    job.options.slots.some((slot) => slot.some(hasRingPairProperty)),
  );
  const ringSplitCandidates = options.jobs.map((job) =>
    trySplitRingPairDomain(job, options.equipmentIdentity),
  );
  let useSplitRings =
    detectedRingPairs.some(Boolean) &&
    ringSplitCandidates.every((split) => split !== undefined);
  if (useSplitRings) {
    const splitDomains = ringSplitCandidates as JointRingSplit[];
    for (const [commonSlot, projection] of projections) {
      const pointsToPair = splitDomains.some(
        (split) => split.originalSlotName === projection.slotName,
      );
      if (
        pointsToPair &&
        splitDomains.some(
          (split) => split.originalSlotName !== projection.slotName,
        )
      ) {
        useSplitRings = false;
      }
    }
    for (const commonSlot of options.commonSlots) {
      if (projections.has(commonSlot)) continue;
      const pointsToPair = splitDomains.some(
        (split) => split.originalSlotName === commonSlot,
      );
      if (
        pointsToPair &&
        splitDomains.some((split) => split.originalSlotName !== commonSlot)
      ) {
        useSplitRings = false;
      }
    }
  }
  const activeRingSplits = useSplitRings
    ? (ringSplitCandidates as JointRingSplit[])
    : options.jobs.map(() => undefined);
  const actualSlotName = (commonSlot: string, jobIndex: number) => {
    const projection = projections.get(commonSlot);
    const split = activeRingSplits[jobIndex];
    if (
      projection !== undefined &&
      split !== undefined &&
      projection.slotName === split.originalSlotName
    ) {
      return projection.ringIndex === 0
        ? split.firstSlotName
        : split.secondSlotName;
    }
    return projection?.slotName ?? commonSlot;
  };
  const projectedEquipment = (
    equipment: EquipInfo,
    commonSlot: string,
    jobIndex: number,
  ): EquipInfo => {
    const projection = projections.get(commonSlot);
    if (projection === undefined) return equipment;
    const split = activeRingSplits[jobIndex];
    if (split !== undefined && projection.slotName === split.originalSlotName)
      return equipment;
    const pair = equipment as EquipInfo & {
      ringEquips?: readonly [EquipInfo, EquipInfo];
    };
    const projected = pair.ringEquips?.[projection.ringIndex];
    if (projected === undefined)
      throw new Error(`共享槽位 ${commonSlot} 缺少完整戒指对候选`);
    return projected;
  };
  const commonEquipmentIdentity = (
    equipment: EquipInfo,
    commonSlot: string,
    jobIndex: number,
  ) =>
    options.equipmentIdentity(
      projectedEquipment(equipment, commonSlot, jobIndex),
    );
  const originalSelectionIdentity = (
    selection: readonly EquipInfo[],
    commonSlot: string,
    jobIndex: number,
  ): string | undefined => {
    const originalJob = options.jobs[jobIndex]!;
    const projection = projections.get(commonSlot);
    const originalSlotName = projection?.slotName ?? commonSlot;
    const slotIndex = originalJob.slotNames.indexOf(originalSlotName);
    const equipment = selection[slotIndex];
    if (slotIndex < 0 || equipment === undefined) return undefined;
    const split = activeRingSplits[jobIndex];
    if (
      split !== undefined &&
      projection?.slotName === split.originalSlotName
    ) {
      const pair = ringPairCandidate(equipment);
      const child = pair?.ringEquips[projection.ringIndex];
      return child === undefined ? undefined : options.equipmentIdentity(child);
    }
    if (
      split !== undefined &&
      projection === undefined &&
      commonSlot === split.originalSlotName
    ) {
      const pair = ringPairCandidate(equipment);
      return pair === undefined
        ? undefined
        : ringPairSharedIdentity(pair, options.equipmentIdentity);
    }
    return options.equipmentIdentity(
      projectedEquipment(equipment, commonSlot, jobIndex),
    );
  };
  return {
    get projections() {
      return projections;
    },
    get activeRingSplits() {
      return activeRingSplits;
    },
    get actualSlotName() {
      return actualSlotName;
    },
    get projectedEquipment() {
      return projectedEquipment;
    },
    get commonEquipmentIdentity() {
      return commonEquipmentIdentity;
    },
    get originalSelectionIdentity() {
      return originalSelectionIdentity;
    },
  };
}
