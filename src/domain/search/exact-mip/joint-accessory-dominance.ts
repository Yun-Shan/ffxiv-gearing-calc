import type { SharedSlotProjection } from "../types.ts";
import type { EquipInfo } from "../types.ts";
import { ringPairCandidate } from "./ring-domain.ts";
import { addRows } from "../core/model-builder.ts";
import { sharedAccessoryPairDominanceLimitsFor } from "../shared-accessory-pair-dominance-policy.ts";
import type { SharedAccessoryPairCandidate } from "../shared-accessory-pair-dominance.ts";
import { findStrictlyDominatedSharedAccessoryPairs } from "../shared-accessory-pair-dominance.ts";

import type { JointPreparedJob } from "./joint-types.ts";
import type { JointModel, SharedEquipmentDomain } from "./joint-model.ts";

export function prepareJointAccessoryDominance(
  enabled: boolean,
  preparedJobs: readonly JointPreparedJob[],
  model: Pick<
    JointModel,
    "rows" | "sharedEquipmentDomains" | "sharedEquipmentSelectors"
  >,
  projections: ReadonlyMap<string, SharedSlotProjection>,
  jointPreprocessingBudgetBaseMs: number,
  isCancelled: () => boolean,
) {
  const sharedAccessoryPairDominanceEnabled = enabled;
  const { rows, sharedEquipmentDomains, sharedEquipmentSelectors } = model;
  let sharedAccessoryPairDominanceCandidateCount = 0;
  let sharedAccessoryPairDominanceComparisons = 0;
  let sharedAccessoryPairDominanceCuts = 0;
  let sharedAccessoryPairDominancePreprocessingMs = 0;
  let sharedAccessoryPairDominanceMaximumCuts = 0;
  let sharedAccessoryPairDominanceMaximumComparisons = 0;
  let sharedAccessoryPairDominancePreprocessingBudgetMs = 0;
  let sharedAccessoryPairDominanceLimitReached = false;
  let sharedAccessoryPairDominanceCandidateUpperBound = 0n;
  if (sharedAccessoryPairDominanceEnabled) {
    const preprocessingStartedAt = performance.now();
    const accessoryDomains = ["earrings", "necklace", "bracelet"]
      .map((slot) =>
        sharedEquipmentDomains.find(
          (domain) => domain.slot === slot && !domain.splitPair,
        ),
      )
      .filter(
        (domain): domain is SharedEquipmentDomain =>
          domain !== undefined && !projections.has(domain.slot),
      );
    const domainPairs = accessoryDomains.flatMap((left, index) =>
      accessoryDomains.slice(index + 1).map((right) => ({
        left,
        right,
        count: BigInt(left.keys.size) * BigInt(right.keys.size),
      })),
    );
    sharedAccessoryPairDominanceCandidateUpperBound = domainPairs.reduce(
      (total, pair) => total + pair.count,
      0n,
    );
    const dominanceLimits = sharedAccessoryPairDominanceLimitsFor(
      preparedJobs.length,
      sharedAccessoryPairDominanceCandidateUpperBound,
    );
    const maximumCandidates = dominanceLimits.maxCandidates;
    const maximumComparisons = dominanceLimits.maxComparisons;
    const maximumCuts = dominanceLimits.maxCuts;
    const preprocessingBudgetMs = Math.max(
      0,
      Math.min(
        dominanceLimits.maxPreprocessingMs,
        jointPreprocessingBudgetBaseMs * 0.02,
      ),
    );
    sharedAccessoryPairDominanceMaximumCuts = maximumCuts;
    sharedAccessoryPairDominanceMaximumComparisons = maximumComparisons;
    sharedAccessoryPairDominancePreprocessingBudgetMs = preprocessingBudgetMs;
    const preprocessingDeadline =
      preprocessingStartedAt + preprocessingBudgetMs;
    const shouldStopPreprocessing = () =>
      performance.now() >= preprocessingDeadline || isCancelled();
    domainPairs.sort((left, right) =>
      left.count < right.count ? -1 : left.count > right.count ? 1 : 0,
    );
    const slotItemIds = (equipment: EquipInfo): number[] => {
      const ids = [equipment.itemId];
      const pair = ringPairCandidate(equipment);
      if (pair !== undefined)
        ids.push(...pair.ringEquips.map((ring) => ring.itemId));
      return ids;
    };
    for (const { left, right } of domainPairs) {
      const remainingCandidates =
        maximumCandidates - sharedAccessoryPairDominanceCandidateCount;
      if (
        remainingCandidates <= 0 ||
        sharedAccessoryPairDominanceCuts >= maximumCuts ||
        sharedAccessoryPairDominanceComparisons >= maximumComparisons ||
        performance.now() - preprocessingStartedAt >= preprocessingBudgetMs
      ) {
        sharedAccessoryPairDominanceLimitReached = true;
        break;
      }
      const potentialCount = BigInt(left.keys.size) * BigInt(right.keys.size);
      if (potentialCount > BigInt(remainingCandidates)) {
        sharedAccessoryPairDominanceLimitReached = true;
        continue;
      }
      let outsideCandidateWork = 0;
      let outsidePreprocessingStopped = false;
      const outsideIdsByJob = preparedJobs.map(({ originalJob }) => {
        const leftIndex = originalJob.slotNames.indexOf(left.slot);
        const rightIndex = originalJob.slotNames.indexOf(right.slot);
        if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex)
          return undefined;
        const excluded = new Set([leftIndex, rightIndex]);
        const ids = new Set<number>();
        for (
          let slotIndex = 0;
          slotIndex < originalJob.options.slots.length;
          slotIndex++
        ) {
          if (excluded.has(slotIndex)) continue;
          for (const equipment of originalJob.options.slots[slotIndex]!) {
            if (
              (++outsideCandidateWork & 127) === 0 &&
              shouldStopPreprocessing()
            ) {
              outsidePreprocessingStopped = true;
              return undefined;
            }
            for (const itemId of slotItemIds(equipment)) {
              if (!Number.isSafeInteger(itemId)) return undefined;
              ids.add(itemId);
            }
          }
        }
        return ids;
      });
      if (outsidePreprocessingStopped || shouldStopPreprocessing()) {
        sharedAccessoryPairDominanceLimitReached = true;
        break;
      }
      const pairCandidates: SharedAccessoryPairCandidate[] = [];
      const leftSelectors = sharedEquipmentSelectors.get(left.slot);
      const rightSelectors = sharedEquipmentSelectors.get(right.slot);
      if (leftSelectors === undefined || rightSelectors === undefined) continue;
      let stopBuilding = false;
      let inspectedPairKeys = 0;
      for (const keyA of left.keys) {
        const entryAByJob = left.choices.map((choice) => choice.get(keyA));
        if (entryAByJob.some((entry) => entry?.attributes === undefined))
          continue;
        const itemIdAByJob = entryAByJob.map(
          (entry) => entry!.equipment.itemId,
        );
        for (const keyB of right.keys) {
          if ((++inspectedPairKeys & 127) === 0 && shouldStopPreprocessing()) {
            sharedAccessoryPairDominanceLimitReached = true;
            stopBuilding = true;
            break;
          }
          if (pairCandidates.length >= remainingCandidates) {
            sharedAccessoryPairDominanceLimitReached = true;
            stopBuilding = true;
            break;
          }
          const entryBByJob = right.choices.map((choice) => choice.get(keyB));
          if (entryBByJob.some((entry) => entry?.attributes === undefined))
            continue;
          const values: number[] = [];
          let validValues = true;
          let canDominate = true;
          for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
            const entryA = entryAByJob[jobIndex]!;
            const entryB = entryBByJob[jobIndex]!;
            const attributesA = entryA.attributes!;
            const attributesB = entryB.attributes!;
            if (attributesA.length !== attributesB.length) {
              validValues = false;
              break;
            }
            for (
              let attribute = 0;
              attribute < attributesA.length;
              attribute++
            ) {
              const value = attributesA[attribute]! + attributesB[attribute]!;
              if (!Number.isSafeInteger(value) || value < 0) {
                validValues = false;
                break;
              }
              values.push(value);
            }
            if (!validValues) break;
            const itemIdA = itemIdAByJob[jobIndex]!;
            const itemIdB = entryB.equipment.itemId;
            const outsideIds = outsideIdsByJob[jobIndex];
            if (
              !Number.isSafeInteger(itemIdA) ||
              !Number.isSafeInteger(itemIdB) ||
              itemIdA === itemIdB ||
              outsideIds === undefined ||
              outsideIds.has(itemIdA) ||
              outsideIds.has(itemIdB)
            ) {
              canDominate = false;
            }
          }
          if (!validValues) continue;
          const selectorA = leftSelectors.get(keyA);
          const selectorB = rightSelectors.get(keyB);
          if (selectorA === undefined || selectorB === undefined) continue;
          pairCandidates.push({
            keyA,
            keyB,
            selectorA,
            selectorB,
            values,
            canDominate,
          });
        }
        if (stopBuilding) break;
      }
      sharedAccessoryPairDominanceCandidateCount += pairCandidates.length;
      const result = findStrictlyDominatedSharedAccessoryPairs(pairCandidates, {
        maxCuts: maximumCuts - sharedAccessoryPairDominanceCuts,
        maxComparisons:
          maximumComparisons - sharedAccessoryPairDominanceComparisons,
        deadlineAt: preprocessingDeadline,
        shouldStop: isCancelled,
      });
      sharedAccessoryPairDominanceComparisons += result.comparisons;
      sharedAccessoryPairDominanceLimitReached ||=
        result.comparisonLimitReached || result.preprocessingLimitReached;
      for (const { dominated } of result.cuts) {
        addRows(
          rows,
          `shared_accessory_pair_dominance_${sharedAccessoryPairDominanceCuts}`,
          [
            [dominated.selectorA, 1],
            [dominated.selectorB, 1],
          ],
          "<=",
          1,
        );
        sharedAccessoryPairDominanceCuts++;
      }
      if (stopBuilding) break;
    }
    sharedAccessoryPairDominancePreprocessingMs =
      performance.now() - preprocessingStartedAt;
  }
  return {
    get sharedAccessoryPairDominanceCandidateCount() {
      return sharedAccessoryPairDominanceCandidateCount;
    },
    get sharedAccessoryPairDominanceComparisons() {
      return sharedAccessoryPairDominanceComparisons;
    },
    get sharedAccessoryPairDominanceCuts() {
      return sharedAccessoryPairDominanceCuts;
    },
    get sharedAccessoryPairDominancePreprocessingMs() {
      return sharedAccessoryPairDominancePreprocessingMs;
    },
    get sharedAccessoryPairDominanceMaximumCuts() {
      return sharedAccessoryPairDominanceMaximumCuts;
    },
    get sharedAccessoryPairDominanceMaximumComparisons() {
      return sharedAccessoryPairDominanceMaximumComparisons;
    },
    get sharedAccessoryPairDominancePreprocessingBudgetMs() {
      return sharedAccessoryPairDominancePreprocessingBudgetMs;
    },
    get sharedAccessoryPairDominanceLimitReached() {
      return sharedAccessoryPairDominanceLimitReached;
    },
    get sharedAccessoryPairDominanceCandidateUpperBound() {
      return sharedAccessoryPairDominanceCandidateUpperBound;
    },
  };
}
