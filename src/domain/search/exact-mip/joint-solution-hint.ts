import type { JointPreparedJob, JointSearchOptions } from "./joint-types.ts";
import type { prepareJointIdentity } from "./joint-identity.ts";
import { internalRingSelection } from "./ring-domain.ts";
import { ringChildStructuralKey } from "./ring-domain.ts";

import type { JointModel } from "./joint-model.ts";
import type { JointIncumbent } from "./joint-results.ts";

export function createJointSolutionHint(
  options: Pick<JointSearchOptions, "equipmentIdentity" | "foodIdentity">,
  preparedJobs: readonly JointPreparedJob[],
  model: Pick<
    JointModel,
    | "prefix"
    | "sharedEquipmentDomains"
    | "sharedEquipmentSelectors"
    | "sharedFoodSelectors"
  >,
  originalSelectionIdentity: ReturnType<
    typeof prepareJointIdentity
  >["originalSelectionIdentity"],
  best: JointIncumbent | undefined,
  solverRuns: number,
) {
  const {
    prefix,
    sharedEquipmentDomains,
    sharedEquipmentSelectors,
    sharedFoodSelectors,
  } = model;
  const solutionHint = new Map<string, number>();
  // 在证明工作量较大的双职业重跑中，部分当前最优解提示并未帮助 HiGHS 修复出可行解；
  // 省略该提示不会改变模型。
  if (best !== undefined && !(preparedJobs.length === 2 && solverRuns > 0)) {
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const jointJob = preparedJobs[jobIndex]!;
      const { job, prepared } = jointJob;
      const result = best.results[jobIndex]!;
      const modelSelection = internalRingSelection(jointJob, result.selection);
      if (modelSelection === undefined)
        throw new Error(`联合解提示无法展开戒指对：${job.id}`);
      modelSelection.forEach((equipment, slotIndex) => {
        const isSplitRingSlot =
          jointJob.ringSplit !== undefined &&
          (slotIndex === jointJob.ringSplit.firstSlotIndex ||
            slotIndex === jointJob.ringSplit.secondSlotIndex);
        const candidate = job.options.slots[slotIndex]!.findIndex((entry) =>
          isSplitRingSlot
            ? ringChildStructuralKey(entry) ===
              ringChildStructuralKey(equipment)
            : options.equipmentIdentity(entry) ===
              options.equipmentIdentity(
                equipment.resistanceAllocation === undefined
                  ? equipment
                  : { ...equipment, resistanceAllocation: undefined },
              ),
        );
        if (candidate < 0)
          throw new Error(
            `联合解提示装备不属于模型候选：${job.id}/${slotIndex}`,
          );
        solutionHint.set(
          prefix(
            jobIndex,
            prepared.model.slotVariables[slotIndex]![candidate]!,
          ),
          1,
        );
      });
      if (result.food !== undefined) {
        const foodIndex = job.options.foods.findIndex(
          (entry) =>
            options.foodIdentity(entry) === options.foodIdentity(result.food!),
        );
        if (foodIndex < 0)
          throw new Error(`联合解提示食物不属于模型候选：${job.id}`);
        solutionHint.set(
          prefix(jobIndex, prepared.model.foodVariables[foodIndex]!),
          1,
        );
      }
    }
    for (const domain of sharedEquipmentDomains) {
      const key = originalSelectionIdentity(
        best.results[0]!.selection,
        domain.slot,
        0,
      );
      const selector =
        key === undefined
          ? undefined
          : sharedEquipmentSelectors.get(domain.slot)?.get(key);
      if (selector === undefined)
        throw new Error(`联合解提示缺少共享装备选择：${domain.slot}`);
      solutionHint.set(selector, 1);
    }
    if (sharedFoodSelectors !== undefined) {
      const food = best.results[0]!.food;
      const key = food === undefined ? undefined : options.foodIdentity(food);
      const selector =
        key === undefined ? undefined : sharedFoodSelectors.get(key);
      if (selector === undefined) throw new Error("联合解提示缺少共享食物选择");
      solutionHint.set(selector, 1);
    }
  }
  return solutionHint;
}
