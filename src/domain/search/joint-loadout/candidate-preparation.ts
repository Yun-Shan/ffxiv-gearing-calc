import { createIntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import type { ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import type { CommonChoice, FoodChoice, JobContext, JointLoadoutV3Options } from "./types.ts";
import { commonSlotIndex, projectEquipment, projectionMap } from "./shared-equipment.ts";
import { pruneInnerSlots } from "./candidate-dominance.ts";
import { foodIdentity } from "./shared-foods.ts";

/** Validate each job and retain the complete shared identity intersections before baselines. */
export function prepareCandidates(
  options: JointLoadoutV3Options,
  assertWithinBudget: (stage: string) => void,
) {
  const jobIds = new Set<string>();
  const contexts: JobContext[] = [];
  for (const job of options.jobs) {
    assertWithinBudget("输入校验");
    if (job.id.length === 0 || jobIds.has(job.id)) throw new RangeError(`V3 职业 id 为空或重复：${job.id}`);
    jobIds.add(job.id);
    if (job.slotNames.length !== job.options.slots.length) {
      throw new RangeError(`职业 ${job.id} 的 slotNames 与 slots 长度不一致`);
    }
    const indexByName = new Map<string, number>();
    job.slotNames.forEach((name, index) => {
      if (name.length === 0 || indexByName.has(name)) throw new RangeError(`职业 ${job.id} 有空或重复槽位名：${name}`);
      indexByName.set(name, index);
    });
    if (job.options.slots.some((slot) => slot.length === 0)) return undefined;
    const attributeIndexes = new Map(job.options.attributeIds.map((id, index) => [id, index]));
    if (attributeIndexes.size !== job.options.attributeIds.length) {
      throw new RangeError(`职业 ${job.id} 的 attributeIds 包含重复项`);
    }
    contexts.push({
      job,
      solverSlots: job.options.slots,
      indexByName,
      factorEvaluator: createIntegerDamageFactorEvaluator(job.options.job, job.options.jobLevel, job.options.statIndexes, job.options.clanIndex),
      attributeIndexes,
      equipAttributes: new WeakMap(),
      optimum: undefined as unknown as ExactMipResult,
      optimumProduct: 0n,
      optimumGcd: 0,
      active: true,
      constraints: job.options.constraints,
    });
  }

  const commonSlotProjections = projectionMap(options.commonSlots, options.commonSlotProjections);
  const preserveCommonSlotIndexes = new Map<JobContext, Set<number>>();
  for (const context of contexts) {
    const indexes = new Set<number>();
    for (const name of options.commonSlots) {
      indexes.add(commonSlotIndex(context, name, commonSlotProjections));
    }
    preserveCommonSlotIndexes.set(context, indexes);
  }

  for (const context of contexts) {
    assertWithinBudget("单职业候选等价剪枝");
    context.solverSlots = pruneInnerSlots(context, preserveCommonSlotIndexes.get(context));
    context.job.options.slots = context.solverSlots;
  }
  if (new Set(options.commonSlots).size !== options.commonSlots.length) {
    throw new RangeError("V3 commonSlots 包含重复槽位名");
  }
  for (const name of options.commonSlots) {
    for (const context of contexts) commonSlotIndex(context, name, commonSlotProjections);
  }

  const commonChoicesByName = new Map<string, CommonChoice[]>();
  for (const name of options.commonSlots) {
    assertWithinBudget("通用装备匹配");
    const first = contexts[0]!;
    const firstSlot = first.job.options.slots[commonSlotIndex(first, name, commonSlotProjections)]!;
    const candidates = new Map<string, CommonChoice>();
    for (const equipment of firstSlot) {
      const projected = projectEquipment(equipment, commonSlotProjections.get(name));
      const key = equipmentIdentity(projected);
      if (!candidates.has(key)) candidates.set(key, { key, equipments: new Map([[first.job.id, projected]]) });
    }
    for (let index = 1; index < contexts.length; index++) {
      const context = contexts[index]!;
      const slot = context.job.options.slots[commonSlotIndex(context, name, commonSlotProjections)]!;
      const available = new Map<string, EquipInfo>();
      for (const equipment of slot) {
        const projected = projectEquipment(equipment, commonSlotProjections.get(name));
        const key = equipmentIdentity(projected);
        if (!available.has(key)) available.set(key, projected);
      }
      for (const [key, choice] of candidates) {
        const equipment = available.get(key);
        if (equipment === undefined) candidates.delete(key);
        else choice.equipments.set(context.job.id, equipment);
      }
    }
    if (candidates.size === 0) return undefined;
    commonChoicesByName.set(name, [...candidates.values()]);
  }

  const foodChoices: FoodChoice[] = [];
  if (options.foodStrategy === "shared") {
    if (contexts.every((context) => context.job.options.foods.length === 0)) {
      foodChoices.push({ key: "no-food", foods: new Map(contexts.map((context) => [context.job.id, undefined])) });
    } else {
      const firstFoods = contexts[0]!.job.options.foods;
      const candidates = new Map<string, FoodChoice>();
      for (const food of firstFoods) {
        const key = foodIdentity(food);
        if (!candidates.has(key)) candidates.set(key, { key, foods: new Map([[contexts[0]!.job.id, food]]) });
      }
      for (let index = 1; index < contexts.length; index++) {
        const context = contexts[index]!;
        const available = new Map<string, FoodInfo>();
        for (const food of context.job.options.foods) {
          const key = foodIdentity(food);
          if (!available.has(key)) available.set(key, food);
        }
        for (const [key, choice] of candidates) {
          const food = available.get(key);
          if (food === undefined) candidates.delete(key);
          else choice.foods.set(context.job.id, food);
        }
      }
      foodChoices.push(...candidates.values());
    }
    if (foodChoices.length === 0) return undefined;
  } else {
    foodChoices.push({ key: "independent-food", foods: new Map() });
  }

  return { contexts, commonSlotProjections, preserveCommonSlotIndexes, commonChoicesByName, foodChoices };
}
