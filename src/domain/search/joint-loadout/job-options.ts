import type { ExactMipOptions } from "../loadout-finder-exact-mip.ts";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import type { FoodInfo, SharedSlotProjection } from "../types.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import type { CommonChoice, FoodChoice, JobContext } from "./types.ts";
import { commonSlotIndex, projectEquipment } from "./shared-equipment.ts";

export function minimumTimeLimit(...limits: (number | undefined)[]): number | undefined {
  const definedLimits = limits.filter((limit): limit is number => limit !== undefined);
  return definedLimits.length === 0 ? undefined : Math.min(...definedLimits);
}

export function makeJobOptions(
  context: JobContext,
  fixed: ReadonlyMap<string, CommonChoice>,
  projections: ReadonlyMap<string, SharedSlotProjection>,
  foodChoice: FoodChoice | undefined,
  maxSearchMs: number | undefined,
  objective: "damage" | "dps",
  isCancelled?: () => boolean,
): ExactMipOptions {
  const slots = [...context.solverSlots];
  for (const [name, choice] of fixed) {
    const slotIndex = commonSlotIndex(context, name, projections);
    const available = slots[slotIndex]!;
    slots[slotIndex] = available.filter((equipment) =>
      equipmentIdentity(projectEquipment(equipment, projections.get(name))) === choice.key);
  }

  let foods: readonly FoodInfo[] = context.job.options.foods;
  if (foodChoice !== undefined) {
    const fixedFood = foodChoice.foods.get(context.job.id);
    foods = fixedFood === undefined ? [] : [fixedFood];
  }

  const originalConstraints = context.constraints ?? {};
  let constraints = originalConstraints;
  if (originalConstraints.maxToughnessMode === true) {
    const maximumToughness = context.optimum.maximumToughness;
    if (maximumToughness === undefined) {
      throw new Error(`职业 ${context.job.id} 的最高坚韧基线没有返回最大值`);
    }
    constraints = {
      ...originalConstraints,
      maxToughnessMode: false,
      toughMin: Math.max(originalConstraints.toughMin ?? Number.NEGATIVE_INFINITY, maximumToughness),
    };
  }

  const effectiveTimeLimit = minimumTimeLimit(maxSearchMs, context.job.options.maxSearchMs);
  return inheritCanonicalEvaluatorCandidateUpperBound(context.job.options, {
    ...context.job.options,
    slots,
    foods,
    constraints,
    objective,
    ...(effectiveTimeLimit === undefined ? {} : { maxSearchMs: effectiveTimeLimit }),
    ...(isCancelled === undefined ? {} : { isCancelled }),
  });
}
