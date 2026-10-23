import { gameData } from "../../data.ts";
import type { Stat } from "../../types.ts";
import type { EquipInfo, SharedSlotProjection } from "../types.ts";
import { hasCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { paretoRingCandidates } from "../candidate-pareto.ts";
import type { CommonChoice, JobContext } from "./types.ts";
import { buildRawAttributes } from "./attributes.ts";
import { commonSlotIdentity } from "./shared-equipment.ts";

export function pruneInnerSlots(
  context: JobContext,
  preserveSlotIndexes: ReadonlySet<number> = new Set(),
  sourceSlots: readonly (readonly EquipInfo[])[] = context.job.options.slots,
  workBudget?: {
    maxDominanceChecks: number;
    maxDurationMs: number;
    dominanceAttributeIndexes?: ReadonlySet<number>;
  },
): readonly (readonly EquipInfo[])[] {
  const constraints = context.constraints ?? {};
  const mustKeepSpeedEqual = constraints.gcd !== undefined ||
    (constraints.gcdChoices?.length ?? 0) > 0 || constraints.speedMax !== undefined;
  const speedIndex = context.job.options.speedAttributeId === undefined
    ? undefined
    : context.attributeIndexes.get(context.job.options.speedAttributeId);
  const ringSlotIndexes = new Map<0 | 1, number>();
  const uniqueByItemId = new Map<number, boolean>();
  let completeRingMetadata = true;
  sourceSlots.forEach((slot, slotIndex) => {
    const marked = slot.filter((equipment) => equipment.ringSlotIndex !== undefined);
    if (marked.length === 0) return;
    const ringSlotIndex = marked[0]!.ringSlotIndex;
    if ((ringSlotIndex !== 0 && ringSlotIndex !== 1) || marked.length !== slot.length ||
      marked.some((equipment) => equipment.ringSlotIndex !== ringSlotIndex) ||
      ringSlotIndexes.has(ringSlotIndex)) {
      completeRingMetadata = false;
      return;
    }
    ringSlotIndexes.set(ringSlotIndex, slotIndex);
    for (const equipment of marked) {
      if (!Number.isSafeInteger(equipment.itemId) || typeof equipment.isUnique !== "boolean") {
        completeRingMetadata = false;
        continue;
      }
      const known = uniqueByItemId.get(equipment.itemId);
      if (known !== undefined && known !== equipment.isUnique) completeRingMetadata = false;
      uniqueByItemId.set(equipment.itemId, equipment.isUnique);
    }
  });
  if (ringSlotIndexes.size !== 2) completeRingMetadata = false;

  const conflictGroupByItemId = new Map<number, string>();
  if (completeRingMetadata) {
    for (const ringSlotIndex of [0, 1] as const) {
      const slotIndex = ringSlotIndexes.get(ringSlotIndex)!;
      const oppositeSlot = sourceSlots[ringSlotIndexes.get(ringSlotIndex === 0 ? 1 : 0)!]!;
      const oppositeUniqueIds = new Set(oppositeSlot
        .filter((equipment) => equipment.isUnique === true)
        .map((equipment) => equipment.itemId));
      for (const equipment of sourceSlots[slotIndex]!) {
        if (equipment.isUnique === true && oppositeUniqueIds.has(equipment.itemId)) {
          conflictGroupByItemId.set(equipment.itemId, `conflict:${equipment.itemId}`);
        }
      }
    }
  }

  return sourceSlots.map((slot, slotIndex) => {
    if (preserveSlotIndexes.has(slotIndex)) return slot;
    // 零分配基础向量不能支配可调属性候选。
    // 若槽位中存在这类候选，则保留完整候选域。
    if (slot.some((equipment) => equipment.resistanceWeaponAdjust !== undefined)) return slot;
    if (slot.length < 2) return slot;
    const candidates = slot.map((equipment, inputOrder) => ({
      equipment,
      inputOrder,
      attributes: buildRawAttributes(context, [equipment]),
    }));
    const dominates = (left: readonly number[], right: readonly number[]) => {
      let strict = false;
      for (let index = 0; index < left.length; index++) {
        if (workBudget?.dominanceAttributeIndexes !== undefined &&
          !workBudget.dominanceAttributeIndexes.has(index)) continue;
        if (mustKeepSpeedEqual && index === speedIndex && left[index] !== right[index]) return false;
        if (left[index]! < right[index]!) return false;
        if (left[index]! > right[index]!) strict = true;
      }
      return strict || workBudget?.dominanceAttributeIndexes !== undefined ||
        left.every((value, index) => value === right[index]);
    };
    const budgetExceeded = Symbol("baseline Pareto budget exceeded");
    const startedAt = performance.now();
    let dominanceChecks = 0;
    const checkBudget = () => {
      if (workBudget === undefined) return;
      dominanceChecks++;
      if (dominanceChecks > workBudget.maxDominanceChecks ||
        ((dominanceChecks & 0x3ff) === 0 && performance.now() - startedAt > workBudget.maxDurationMs)) {
        throw budgetExceeded;
      }
    };
    const paretoFrontier = (domain: typeof candidates) => {
      const frontier: typeof candidates = [];
      const ordered = [...domain].sort((left, right) => {
        const leftSum = left.attributes.reduce((total, value) => total + value, 0);
        const rightSum = right.attributes.reduce((total, value) => total + value, 0);
        return rightSum - leftSum || left.inputOrder - right.inputOrder;
      });
      if (workBudget !== undefined && performance.now() - startedAt > workBudget.maxDurationMs) {
        throw budgetExceeded;
      }
      for (const candidate of ordered) {
        let isDominated = false;
        for (const kept of frontier) {
          checkBudget();
          if (dominates(kept.attributes, candidate.attributes)) {
            isDominated = true;
            break;
          }
        }
        if (isDominated) continue;
        for (let index = frontier.length - 1; index >= 0; index--) {
          checkBudget();
          if (dominates(candidate.attributes, frontier[index]!.attributes)) frontier.splice(index, 1);
        }
        frontier.push(candidate);
      }
      return frontier;
    };
    if (candidates.some(({ equipment }) => equipment.ringSlotIndex !== undefined)) {
      // 候选能否与另一槽位配对，只取决于与其唯一物品 ID 冲突的候选。
      // 没有冲突对象的候选共用一个前沿；存在冲突的 ID 则分别维护前沿。
      // 元数据缺失或相互矛盾时，退回按物品分别划分的方式。
      const groups = new Map<string, typeof candidates>();
      for (const candidate of candidates) {
        const groupKey = completeRingMetadata
          ? conflictGroupByItemId.get(candidate.equipment.itemId) ?? "no-conflicts"
          : `item:${candidate.equipment.itemId}`;
        const domain = groups.get(groupKey) ?? [];
        domain.push(candidate);
        groups.set(groupKey, domain);
      }
      try {
        return [...groups.values()]
          .flatMap(paretoFrontier)
          .sort((left, right) => left.inputOrder - right.inputOrder)
          .map(({ equipment }) => equipment);
      } catch (error) {
        if (error === budgetExceeded) return slot;
        throw error;
      }
    }
    try {
      return paretoFrontier(candidates).map(({ equipment }) => equipment);
    } catch (error) {
      if (error === budgetExceeded) return slot;
      throw error;
    }
  });
}

export function canonicalBaselineDamageAttributes(context: JobContext): ReadonlySet<number> | undefined {
  if (!hasCanonicalEvaluatorCandidateUpperBound(context.job.options) ||
    context.job.options.equipmentAttributeExtractor !== undefined) return undefined;
  const schema = gameData.jobSchemas[context.job.options.job];
  if (schema?.mainStat === undefined) return undefined;
  const mainStat: Stat = schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const relevantStats: readonly Stat[] = [mainStat, weaponStat, "DET", "TEN", "CRT", "DHT", speedStat];
  const result = new Set<number>();
  for (const stat of relevantStats) {
    const vectorIndex = context.job.options.statIndexes.get(stat);
    const attributeId = vectorIndex === undefined ? undefined : context.job.options.attributeIds[vectorIndex];
    const attributeIndex = attributeId === undefined ? undefined : context.attributeIndexes.get(attributeId);
    if (attributeIndex === undefined) return undefined;
    result.add(attributeIndex);
  }
  for (const attributeId of [
    context.job.options.speedAttributeId,
    context.job.options.toughnessAttributeId,
  ]) {
    if (attributeId === undefined) continue;
    const attributeIndex = context.attributeIndexes.get(attributeId);
    if (attributeIndex === undefined) return undefined;
    result.add(attributeIndex);
  }
  return result;
}

export function dedupeEquivalentBaselineRingCandidates(
  context: JobContext,
  sourceSlots: readonly (readonly EquipInfo[])[],
): readonly (readonly EquipInfo[])[] {
  if (context.job.options.equipmentAttributeExtractor !== undefined ||
    !hasCanonicalEvaluatorCandidateUpperBound(context.job.options)) return sourceSlots;
  const ringSlotIndexes = new Map<0 | 1, number>();
  for (let slotIndex = 0; slotIndex < sourceSlots.length; slotIndex++) {
    const slot = sourceSlots[slotIndex]!;
    const marked = slot.filter((equipment) => equipment.ringSlotIndex !== undefined);
    if (marked.length === 0) continue;
    const ringSlotIndex = marked[0]!.ringSlotIndex;
    if ((ringSlotIndex !== 0 && ringSlotIndex !== 1) || marked.length !== slot.length ||
      marked.some((equipment) => equipment.ringSlotIndex !== ringSlotIndex) ||
      ringSlotIndexes.has(ringSlotIndex) || marked.some((equipment) =>
        !Number.isSafeInteger(equipment.itemId) || typeof equipment.isUnique !== "boolean")) return sourceSlots;
    ringSlotIndexes.set(ringSlotIndex, slotIndex);
  }
  if (ringSlotIndexes.size !== 2) return sourceSlots;

  const reduced = [...sourceSlots];
  for (const ringSlotIndex of [0, 1] as const) {
    const slotIndex = ringSlotIndexes.get(ringSlotIndex)!;
    const firstByEquivalentValue = new Map<string, EquipInfo>();
    for (const equipment of sourceSlots[slotIndex]!) {
      const attributes = buildRawAttributes(context, [equipment]);
      const conflictClass = equipment.isUnique === true ? `unique:${equipment.itemId}` : "repeatable";
      const key = JSON.stringify([
        conflictClass,
        attributes,
        equipment.PDMG,
        equipment.MDMG,
        equipment.DLY,
      ]);
      if (!firstByEquivalentValue.has(key)) firstByEquivalentValue.set(key, equipment);
    }
    reduced[slotIndex] = [...firstByEquivalentValue.values()];
  }
  return reduced;
}

export function speedMustRemainEqual(context: JobContext): boolean {
  const constraints = context.constraints ?? {};
  return constraints.gcd !== undefined ||
    (constraints.gcdChoices?.length ?? 0) > 0 ||
    constraints.speedMax !== undefined;
}

function commonChoiceMetrics(
  choice: CommonChoice,
  contexts: readonly JobContext[],
): readonly (readonly number[])[] {
  return contexts.map((context) => {
    const equipment = choice.equipments.get(context.job.id)!;
    return [...buildRawAttributes(context, [equipment]), equipment.PDMG, equipment.MDMG];
  });
}

export function pruneCommonChoices(
  slotName: string,
  choices: readonly CommonChoice[],
  contexts: readonly JobContext[],
  projections: ReadonlyMap<string, SharedSlotProjection>,
  checkBudget: () => void,
): CommonChoice[] {
  // 投影戒指的合法配对取决于其实体身份和完整戒指对的另一半。
  // 因此，仅按属性判断支配或等价可能会删掉唯一合法的联合唯一装备配对。
  if (projections.has(slotName) || choices.length < 2 ||
    choices.some((choice) => [...choice.equipments.values()].some((equipment) =>
      equipment.resistanceWeaponAdjust !== undefined))) return [...choices];
  const metrics = choices.map((choice) => commonChoiceMetrics(choice, contexts));
  const baselineMatches = choices.map((choice) => contexts.reduce((count, context) => {
    return count + Number(choice.key === commonSlotIdentity(
      context, context.optimum.selection, slotName, projections,
    ));
  }, 0));
  const dominates = (leftIndex: number, rightIndex: number): boolean => {
    let strict = false;
    for (let jobIndex = 0; jobIndex < contexts.length; jobIndex++) {
      const context = contexts[jobIndex]!;
      const left = metrics[leftIndex]![jobIndex]!;
      const right = metrics[rightIndex]![jobIndex]!;
      const speedIndex = context.job.options.speedAttributeId === undefined
        ? undefined
        : context.attributeIndexes.get(context.job.options.speedAttributeId);
      for (let attribute = 0; attribute < left.length; attribute++) {
        if (speedMustRemainEqual(context) && attribute === speedIndex && left[attribute] !== right[attribute]) {
          return false;
        }
        if (left[attribute]! < right[attribute]!) return false;
        if (left[attribute]! > right[attribute]!) strict = true;
      }
    }
    return strict;
  };
  const keep = choices.map((_, candidateIndex) => {
    if ((candidateIndex & 15) === 0) checkBudget();
    for (let otherIndex = 0; otherIndex < choices.length; otherIndex++) {
      if (candidateIndex === otherIndex) continue;
      if (dominates(otherIndex, candidateIndex)) return false;
      const equalMetrics = metrics[otherIndex]!.every((values, jobIndex) =>
        values.every((value, attribute) => value === metrics[candidateIndex]![jobIndex]![attribute]));
      if (
        equalMetrics &&
        (baselineMatches[otherIndex]! > baselineMatches[candidateIndex]! ||
          (baselineMatches[otherIndex] === baselineMatches[candidateIndex] && otherIndex < candidateIndex))
      ) return false;
    }
    return true;
  });
  return choices.filter((_, index) => keep[index]);
}

export function pruneCommonRingChoices(
  choices: readonly CommonChoice[],
  oppositeChoices: readonly CommonChoice[],
  contexts: readonly JobContext[],
  checkBudget: () => void,
): CommonChoice[] {
  if (choices.length < 2 || oppositeChoices.length === 0) return [...choices];
  const metadataFor = (choice: CommonChoice) => {
    let itemId: number | undefined;
    let isUnique: boolean | undefined;
    for (const context of contexts) {
      const equipment = choice.equipments.get(context.job.id);
      if (equipment === undefined || !Number.isSafeInteger(equipment.itemId) ||
        typeof equipment.isUnique !== "boolean") return undefined;
      if (itemId !== undefined && itemId !== equipment.itemId) return undefined;
      if (isUnique !== undefined && isUnique !== equipment.isUnique) return undefined;
      itemId = equipment.itemId;
      isUnique = equipment.isUnique;
    }
    return itemId === undefined || isUnique === undefined
      ? undefined
      : { itemId, isUnique };
  };
  const choiceMetadata = choices.map(metadataFor);
  const oppositeMetadata = oppositeChoices.map(metadataFor);
  if (choiceMetadata.some((metadata) => metadata === undefined) ||
    oppositeMetadata.some((metadata) => metadata === undefined)) return [...choices];

  const uniqueByItemId = new Map<number, boolean>();
  for (const metadata of [...choiceMetadata, ...oppositeMetadata]) {
    if (metadata === undefined) return [...choices];
    const previous = uniqueByItemId.get(metadata.itemId);
    if (previous !== undefined && previous !== metadata.isUnique) return [...choices];
    uniqueByItemId.set(metadata.itemId, metadata.isUnique);
  }

  const equalCoordinates: number[] = [];
  let coordinateOffset = 0;
  for (const context of contexts) {
    const width = context.attributeIndexes.size + 2;
    if (speedMustRemainEqual(context)) {
      const speedCoordinate = context.attributeIndexes.get(context.job.options.speedAttributeId!);
      if (speedCoordinate === undefined || speedCoordinate >= context.attributeIndexes.size) {
        return [...choices];
      }
      equalCoordinates.push(coordinateOffset + speedCoordinate);
    }
    coordinateOffset += width;
  }

  const toParetoCandidates = (values: readonly CommonChoice[], metadata: readonly ({
    itemId: number;
    isUnique: boolean;
  } | undefined)[]) => values.map((choice, order) => {
    if ((order & 15) === 0) checkBudget();
    const attributes = commonChoiceMetrics(choice, contexts).flat();
    return {
      value: choice,
      itemId: metadata[order]!.itemId,
      isUnique: metadata[order]!.isUnique,
      attributes,
      order,
    };
  });

  const candidates = toParetoCandidates(choices, choiceMetadata);
  const oppositeCandidates = toParetoCandidates(oppositeChoices, oppositeMetadata);
  if ([...candidates, ...oppositeCandidates].some(({ attributes }) =>
    attributes.some((value) => !Number.isSafeInteger(value) || value < 0))) return [...choices];
  return paretoRingCandidates(candidates, oppositeCandidates, equalCoordinates)
    .map(({ value }) => value);
}
