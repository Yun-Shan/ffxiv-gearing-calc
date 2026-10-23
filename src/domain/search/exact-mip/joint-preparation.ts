import type { JointPreparedJob, JointSearchOptions } from "./joint-types.ts";
import type { prepareJointIdentity } from "./joint-identity.ts";
import type { JointMipJob } from "./ring-domain.ts";
import { prepareExactMipModel } from "./model-preparation.ts";
import type { EquipInfo } from "../types.ts";
import { throwIfCancelled } from "../cancellation.ts";
import { expandJointRingPairDomain } from "./ring-domain.ts";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";

export async function prepareJointJobs(
  options: Pick<
    JointSearchOptions,
    | "canonicalSharedRingPair"
    | "commonSlots"
    | "equipmentIdentity"
    | "initialResults"
    | "jobs"
    | "objective"
  >,
  identity: ReturnType<typeof prepareJointIdentity>,
  isCancelled: () => boolean,
) {
  const { activeRingSplits, projections } = identity;
  const jointJobs: readonly JointMipJob[] = options.jobs;
  const providedInitialResults = options.initialResults;
  throwIfCancelled(isCancelled);
  const preparedJobs: JointPreparedJob[] = [];
  const modelPreparationStartedAt = performance.now();
  for (let jobIndex = 0; jobIndex < jointJobs.length; jobIndex++) {
    throwIfCancelled(isCancelled);
    const originalJob = jointJobs[jobIndex]!;
    const ringSplit = activeRingSplits[jobIndex];
    const job =
      ringSplit === undefined
        ? originalJob
        : expandJointRingPairDomain(originalJob, ringSplit);
    const jobModelOptions = inheritCanonicalEvaluatorCandidateUpperBound(
      job.options,
      {
        ...job.options,
        objective: options.objective,
      },
    );
    const prepared = await prepareExactMipModel(jobModelOptions, true);
    throwIfCancelled(isCancelled);
    if (prepared === undefined) return undefined;
    preparedJobs.push({
      job,
      originalJob,
      ...(ringSplit === undefined ? {} : { ringSplit }),
      prepared,
    });
  }
  const canonicalRingRanks = new Map<string, number>();
  const canonicalRingSlotIndexes: {
    firstSlotIndex: number;
    secondSlotIndex: number;
  }[] = [];
  if (options.canonicalSharedRingPair) {
    if (
      !options.commonSlots.includes("ring") ||
      !options.commonSlots.includes("ring2") ||
      projections.has("ring") ||
      projections.has("ring2") ||
      preparedJobs.some(
        ({ job }) => job.options.equipmentAttributeExtractor !== undefined,
      )
    ) {
      throw new RangeError(
        "共享完整戒指对的规范排序仅支持无投影、默认属性提取的对称槽位",
      );
    }
    const allIdentities = new Set<string>();
    for (const { job } of preparedJobs) {
      const firstSlotIndex = job.slotNames.indexOf("ring");
      const secondSlotIndex = job.slotNames.indexOf("ring2");
      const firstSlot = job.options.slots[firstSlotIndex];
      const secondSlot = job.options.slots[secondSlotIndex];
      if (
        firstSlotIndex < 0 ||
        secondSlotIndex < 0 ||
        firstSlot === undefined ||
        secondSlot === undefined ||
        job.slotNames.lastIndexOf("ring") !== firstSlotIndex ||
        job.slotNames.lastIndexOf("ring2") !== secondSlotIndex
      ) {
        throw new RangeError(`共享完整戒指对缺少独立戒指槽：${job.id}`);
      }
      const collectIdentities = (
        slot: readonly EquipInfo[],
        expectedIndex: 0 | 1,
      ) => {
        const identities = new Set<string>();
        for (const equipment of slot) {
          if (
            equipment.ringSlotIndex !== expectedIndex ||
            !Number.isSafeInteger(equipment.itemId) ||
            typeof equipment.isUnique !== "boolean"
          ) {
            throw new RangeError(
              `共享完整戒指对候选缺少槽位或唯一性元数据：${job.id}`,
            );
          }
          identities.add(options.equipmentIdentity(equipment));
        }
        return identities;
      };
      const firstIdentities = collectIdentities(firstSlot, 0);
      const secondIdentities = collectIdentities(secondSlot, 1);
      if (
        firstIdentities.size === 0 ||
        firstIdentities.size !== secondIdentities.size ||
        [...firstIdentities].some((identity) => !secondIdentities.has(identity))
      ) {
        throw new RangeError(
          `共享完整戒指对的两个槽位候选身份不对称：${job.id}`,
        );
      }
      canonicalRingSlotIndexes.push({ firstSlotIndex, secondSlotIndex });
      for (const identity of firstIdentities) allIdentities.add(identity);
    }
    [...allIdentities]
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .forEach((identity, rank) => canonicalRingRanks.set(identity, rank));
  }
  if (
    providedInitialResults !== undefined &&
    providedInitialResults.length !== preparedJobs.length
  ) {
    throw new Error("联合初始方案职业数不匹配");
  }
  const jointInitialResults = providedInitialResults?.map(
    (result, jobIndex) => {
      if (!options.canonicalSharedRingPair) return result;
      const { firstSlotIndex, secondSlotIndex } =
        canonicalRingSlotIndexes[jobIndex]!;
      const first = result.selection[firstSlotIndex];
      const second = result.selection[secondSlotIndex];
      if (first === undefined || second === undefined) return result;
      const firstIdentity = options.equipmentIdentity(first);
      const secondIdentity = options.equipmentIdentity(second);
      if (
        canonicalRingRanks.get(firstIdentity)! <=
        canonicalRingRanks.get(secondIdentity)!
      )
        return result;
      const firstReplacement = jointJobs[jobIndex]!.options.slots[
        firstSlotIndex
      ]!.find(
        (equipment) => options.equipmentIdentity(equipment) === secondIdentity,
      );
      const secondReplacement = jointJobs[jobIndex]!.options.slots[
        secondSlotIndex
      ]!.find(
        (equipment) => options.equipmentIdentity(equipment) === firstIdentity,
      );
      if (firstReplacement === undefined || secondReplacement === undefined) {
        throw new Error(
          `共享完整戒指对无法规范化初始方案：${jointJobs[jobIndex]!.id}`,
        );
      }
      const selection = [...result.selection];
      selection[firstSlotIndex] = firstReplacement;
      selection[secondSlotIndex] = secondReplacement;
      return { ...result, selection };
    },
  );
  const modelPreparationMs = performance.now() - modelPreparationStartedAt;
  return {
    preparedJobs,
    canonicalRingRanks,
    canonicalRingSlotIndexes,
    jointInitialResults,
    modelPreparationMs,
  };
}
