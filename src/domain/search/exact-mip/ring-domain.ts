import type { ExactMipOptions } from "./types.ts";
import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { EquipInfo } from "../types.ts";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";

export type JointMipJob = {
  id: string;
  slotNames: readonly string[];
  options: ExactMipOptions;
  baseline: IntegerDamageFactors;
};

export type RingPairCandidate = EquipInfo & {
  ringEquips: readonly [EquipInfo, EquipInfo];
  ringUniqueByItemId?: readonly (readonly [number, boolean])[];
};

export type JointRingSplit = {
  originalSlotIndex: number;
  originalSlotName: string;
  firstSlotIndex: number;
  secondSlotIndex: number;
  firstSlotName: string;
  secondSlotName: string;
  firstCandidates: EquipInfo[];
  secondCandidates: EquipInfo[];
  uniqueItemIds: Set<number>;
  pairByOrderedChildren: Map<string, RingPairCandidate>;
};

/** Only the layouts and identity mapping are needed to project a ring selection. */
type JointRingDomainJob = {
  job: JointMipJob;
  originalJob: JointMipJob;
  ringSplit?: JointRingSplit;
};

export function ringPairCandidate(equipment: EquipInfo): RingPairCandidate | undefined {
  const pair = (equipment as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] }).ringEquips;
  return !Array.isArray(pair) || pair.length !== 2 || pair[0] === undefined || pair[1] === undefined
    || typeof pair[0] !== "object" || pair[0] === null ||
    typeof pair[1] !== "object" || pair[1] === null
    ? undefined
    : { ...equipment, ringEquips: pair };
}

export function hasUniqueRingConflict(selection: readonly EquipInfo[]): boolean {
  const independentRings = new Map<0 | 1, EquipInfo>();
  for (const equipment of selection) {
    if ((equipment.ringSlotIndex === 0 || equipment.ringSlotIndex === 1) &&
      independentRings.has(equipment.ringSlotIndex)) return true;
    if (equipment.ringSlotIndex === 0 || equipment.ringSlotIndex === 1) {
      independentRings.set(equipment.ringSlotIndex, equipment);
    }
    const pair = ringPairCandidate(equipment);
    if (pair === undefined || pair.ringEquips[0].itemId !== pair.ringEquips[1].itemId) continue;
    const metadata = pair.ringUniqueByItemId?.find(([itemId]) => itemId === pair.ringEquips[0].itemId)?.[1];
    if (metadata === true || pair.ringEquips.some((ring) => ring.isUnique === true)) return true;
  }
  const first = independentRings.get(0);
  const second = independentRings.get(1);
  return first !== undefined && second !== undefined && first.itemId === second.itemId &&
    (first.isUnique === true || second.isUnique === true);
}

export function hasRingPairProperty(equipment: EquipInfo): boolean {
  return "ringEquips" in equipment;
}

export function ringChildStructuralKey(equipment: EquipInfo): string {
  return JSON.stringify({
    itemId: equipment.itemId,
    itemLevel: equipment.itemLevel,
    variantKey: equipment.variantKey,
    key: equipment.key,
    baseParams: equipment.baseParams
      .map(({ baseParamId, value }) => [baseParamId, value] as const)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]),
    PDMG: equipment.PDMG,
    MDMG: equipment.MDMG,
    DLY: equipment.DLY,
  });
}

export function orderedRingChildrenKey(first: string, second: string): string {
  return JSON.stringify([first, second]);
}

export function ringPairSharedIdentity(
  equipment: RingPairCandidate,
  equipmentIdentity: (equipment: EquipInfo) => string,
): string {
  return JSON.stringify(equipment.ringEquips.map(equipmentIdentity).sort());
}

export function extractedAttributeMap(
  options: ExactMipOptions,
  equipment: EquipInfo,
): Map<number, number> {
  const result = new Map<number, number>();
  const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
  for (const { baseParamId, value } of params) {
    result.set(baseParamId, (result.get(baseParamId) ?? 0) + value);
  }
  return result;
}

export function trySplitRingPairDomain(
  job: JointMipJob,
  equipmentIdentity: (equipment: EquipInfo) => string,
): JointRingSplit | undefined {
  if (job.slotNames.length !== job.options.slots.length) return undefined;
  const candidatePairSlots = job.options.slots.flatMap((slot, index) =>
    slot.some(hasRingPairProperty) ? [index] : []);
  if (candidatePairSlots.length !== 1) return undefined;
  const originalSlotIndex = candidatePairSlots[0]!;
  const originalSlotName = job.slotNames[originalSlotIndex];
  const pairSlot = job.options.slots[originalSlotIndex]!;
  if (originalSlotName === undefined || pairSlot.length === 0) return undefined;

  const firstByStructuralKey = new Map<string, EquipInfo>();
  const secondByStructuralKey = new Map<string, EquipInfo>();
  const pairByOrderedChildren = new Map<string, RingPairCandidate>();
  const uniqueByItemId = new Map<number, boolean>();
  const pairCompositionBySharedIdentity = new Map<string, string>();
  for (const equipment of pairSlot) {
    const pair = ringPairCandidate(equipment);
    if (pair === undefined) return undefined;
    const [first, second] = pair.ringEquips;
    const uniquenessMetadata = pair.ringUniqueByItemId;
    if (!Array.isArray(uniquenessMetadata)) return undefined;
    const currentUniqueByItemId = new Map<number, boolean>();
    for (const entry of uniquenessMetadata) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) ||
        typeof entry[1] !== "boolean" || currentUniqueByItemId.has(entry[0])) return undefined;
      currentUniqueByItemId.set(entry[0], entry[1]);
    }
    if ([first, second].some((child) => !Number.isSafeInteger(child.itemId) ||
      !currentUniqueByItemId.has(child.itemId))) return undefined;
    if (uniqueByItemId.size === 0) {
      for (const [itemId, unique] of currentUniqueByItemId) uniqueByItemId.set(itemId, unique);
    } else if (uniqueByItemId.size !== currentUniqueByItemId.size ||
      [...uniqueByItemId].some(([itemId, unique]) => currentUniqueByItemId.get(itemId) !== unique)) {
      return undefined;
    }
    const firstKey = ringChildStructuralKey(first);
    const secondKey = ringChildStructuralKey(second);
    firstByStructuralKey.set(firstKey, first);
    secondByStructuralKey.set(secondKey, second);
    const orderedKey = orderedRingChildrenKey(firstKey, secondKey);
    if (pairByOrderedChildren.has(orderedKey)) return undefined;

    const pairAttributes = extractedAttributeMap(job.options, pair);
    const childAttributes = extractedAttributeMap(job.options, first);
    for (const [attributeId, value] of extractedAttributeMap(job.options, second)) {
      childAttributes.set(attributeId, (childAttributes.get(attributeId) ?? 0) + value);
    }
    for (const attributeId of job.options.attributeIds) {
      if ((pairAttributes.get(attributeId) ?? 0) !== (childAttributes.get(attributeId) ?? 0)) {
        return undefined;
      }
    }
    const compositionCounts = new Map<string, number>();
    for (const child of pair.ringEquips) {
      const identity = equipmentIdentity(child);
      compositionCounts.set(identity, (compositionCounts.get(identity) ?? 0) + 1);
    }
    const sharedIdentity = ringPairSharedIdentity(pair, equipmentIdentity);
    const sharedComposition = JSON.stringify([...compositionCounts].sort(([left], [right]) =>
      left.localeCompare(right)));
    const previousComposition = pairCompositionBySharedIdentity.get(sharedIdentity);
    if (previousComposition !== undefined && previousComposition !== sharedComposition) return undefined;
    pairCompositionBySharedIdentity.set(sharedIdentity, sharedComposition);
    pairByOrderedChildren.set(orderedKey, pair);
  }
  if (firstByStructuralKey.size === 0 || secondByStructuralKey.size === 0) return undefined;

  const expectedPairs = new Set<string>();
  for (const [firstKey, first] of firstByStructuralKey) {
    for (const [secondKey, second] of secondByStructuralKey) {
      if (first.itemId === second.itemId && uniqueByItemId.get(first.itemId) === true) continue;
      expectedPairs.add(orderedRingChildrenKey(firstKey, secondKey));
    }
  }
  if (expectedPairs.size !== pairByOrderedChildren.size ||
    [...expectedPairs].some((key) => !pairByOrderedChildren.has(key))) return undefined;

  let firstSlotName = `__joint_ring_first_${originalSlotIndex}`;
  let secondSlotName = `__joint_ring_second_${originalSlotIndex}`;
  while (job.slotNames.includes(firstSlotName) || job.slotNames.includes(secondSlotName)) {
    firstSlotName = `_${firstSlotName}`;
    secondSlotName = `_${secondSlotName}`;
  }
  const firstSlotIndex = originalSlotIndex;
  const secondSlotIndex = originalSlotIndex + 1;
  return {
    originalSlotIndex,
    originalSlotName,
    firstSlotIndex,
    secondSlotIndex,
    firstSlotName,
    secondSlotName,
    firstCandidates: [...firstByStructuralKey.values()],
    secondCandidates: [...secondByStructuralKey.values()],
    uniqueItemIds: new Set([...uniqueByItemId].flatMap(([itemId, isUnique]) =>
      isUnique ? [itemId] : [])),
    pairByOrderedChildren,
  };
}

export function expandJointRingPairDomain(
  job: JointMipJob,
  split: JointRingSplit,
): JointMipJob {
  const slots = [...job.options.slots];
  slots.splice(split.originalSlotIndex, 1, split.firstCandidates, split.secondCandidates);
  const slotNames = [...job.slotNames];
  slotNames.splice(split.originalSlotIndex, 1, split.firstSlotName, split.secondSlotName);
  return {
    ...job,
    slotNames,
    options: inheritCanonicalEvaluatorCandidateUpperBound(job.options, { ...job.options, slots }),
  };
}

export function internalRingSelection(
  job: JointRingDomainJob,
  originalSelection: readonly EquipInfo[],
): EquipInfo[] | undefined {
  const split = job.ringSplit;
  if (split === undefined) return [...originalSelection];
  const pair = ringPairCandidate(originalSelection[split.originalSlotIndex]!);
  if (pair === undefined) return undefined;
  const firstKey = ringChildStructuralKey(pair.ringEquips[0]);
  const secondKey = ringChildStructuralKey(pair.ringEquips[1]);
  if (!split.pairByOrderedChildren.has(orderedRingChildrenKey(firstKey, secondKey))) return undefined;
  const result: EquipInfo[] = [];
  for (let index = 0; index < job.job.options.slots.length; index++) {
    if (index === split.firstSlotIndex) result.push(pair.ringEquips[0]);
    else if (index === split.secondSlotIndex) result.push(pair.ringEquips[1]);
    else {
      const originalIndex = index < split.originalSlotIndex ? index : index - 1;
      const selected = originalSelection[originalIndex];
      if (selected === undefined) return undefined;
      result.push(selected);
    }
  }
  return result;
}

export function originalRingSelection(
  job: JointRingDomainJob,
  internalSelection: readonly EquipInfo[],
): EquipInfo[] {
  const split = job.ringSplit;
  if (split === undefined) return [...internalSelection];
  const first = internalSelection[split.firstSlotIndex];
  const second = internalSelection[split.secondSlotIndex];
  if (first === undefined || second === undefined) throw new Error(`联合 MIP 没有为 ${job.job.id} 重建两枚戒指`);
  const pair = split.pairByOrderedChildren.get(orderedRingChildrenKey(
    ringChildStructuralKey(first), ringChildStructuralKey(second),
  ));
  if (pair === undefined) throw new Error(`联合 MIP 返回了不存在的有序戒指对：${job.job.id}`);
  const result: EquipInfo[] = [];
  for (let index = 0; index < job.originalJob.options.slots.length; index++) {
    if (index === split.originalSlotIndex) result.push(pair);
    else {
      const internalIndex = index < split.originalSlotIndex ? index : index + 1;
      const selected = internalSelection[internalIndex];
      if (selected === undefined) throw new Error(`联合 MIP 结果槽位不完整：${job.job.id}`);
      result.push(selected);
    }
  }
  return result;
}
