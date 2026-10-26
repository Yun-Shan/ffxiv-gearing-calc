import type { ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { EquipInfo, SharedSlotProjection } from "../types.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import type { CommonChoice, FoodChoice, JobContext, JointLoadoutV3Options, RingPairInfo } from "./types.ts";
import { applyFood, buildRawAttributes } from "./attributes.ts";
import { commonSlotIndex } from "./shared-equipment.ts";

/** Reconstruct feasible seeds from the shared choices and independent optima. */
export function createSeedResults({
  options, contexts, commonSlotProjections,
}: {
  options: JointLoadoutV3Options;
  contexts: readonly JobContext[];
  commonSlotProjections: ReadonlyMap<string, SharedSlotProjection>;
}) {
  const seedResultsFor = (
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
  ): ExactMipResult[] | undefined => {
    const patchedResults: ExactMipResult[] = [];
    for (const context of contexts) {
      const selection = [...context.optimum.selection];
      const projectedRingKeys = new Map<number, Map<number, string>>();
      for (const [name, choice] of fixed) {
        const projection = commonSlotProjections.get(name);
        const slotIndex = commonSlotIndex(context, name, commonSlotProjections);
        if (projection === undefined) {
          const candidate = context.job.options.slots[slotIndex]!.find((equipment) =>
            equipmentIdentity(equipment) === choice.key);
          if (candidate === undefined) return undefined;
          selection[slotIndex] = candidate;
          continue;
        }
        const ringKeys = projectedRingKeys.get(slotIndex) ?? new Map<number, string>();
        ringKeys.set(projection.ringIndex, choice.key);
        projectedRingKeys.set(slotIndex, ringKeys);
      }
      for (const [slotIndex, ringKeys] of projectedRingKeys) {
        const currentPair = selection[slotIndex] as RingPairInfo | undefined;
        if (currentPair?.ringEquips === undefined) return undefined;
        const desired = [
          ringKeys.get(0) ?? equipmentIdentity(currentPair.ringEquips[0]),
          ringKeys.get(1) ?? equipmentIdentity(currentPair.ringEquips[1]),
        ];
        const pair = context.job.options.slots[slotIndex]!.find((equipment) => {
          const children = (equipment as Partial<RingPairInfo>).ringEquips;
          return children !== undefined &&
            equipmentIdentity(children[0]) === desired[0] &&
            equipmentIdentity(children[1]) === desired[1];
        });
        if (pair === undefined) return undefined;
        selection[slotIndex] = pair;
      }
      if (options.factorizedSharedRingPair) {
        const firstIndex = context.indexByName.get("ring");
        const secondIndex = context.indexByName.get("ring2");
        const first = firstIndex === undefined ? undefined : selection[firstIndex];
        const second = secondIndex === undefined ? undefined : selection[secondIndex];
        if (first === undefined || second === undefined ||
          (first.itemId === second.itemId && (first.isUnique === true || second.isUnique === true))) {
          return undefined;
        }
      }
      const selectedFood = foodChoice === undefined
        ? context.optimum.food
        : foodChoice.foods.get(context.job.id);
      const rawAttributes = buildRawAttributes(context, selection);
      const attributes = applyFood(rawAttributes, selectedFood, context.attributeIndexes);
      const factors = context.factorEvaluator(attributes);
      if (factors === undefined) return undefined;
      const constraints = context.constraints ?? {};
      if (constraints.gcd !== undefined &&
        Math.round(constraints.gcd * 100) !== factors.gcdCentiseconds) return undefined;
      if (constraints.gcdChoices !== undefined && !constraints.gcdChoices.some((gcd) =>
        Math.round(gcd * 100) === factors.gcdCentiseconds)) return undefined;
      if (context.job.options.speedAttributeId !== undefined) {
        const speedIndex = context.attributeIndexes.get(context.job.options.speedAttributeId);
        if (speedIndex === undefined) return undefined;
        const speed = attributes[speedIndex]!;
        if ((constraints.speedMin !== undefined && speed < constraints.speedMin) ||
          (constraints.speedMax !== undefined && speed > constraints.speedMax)) return undefined;
      } else if (constraints.speedMin !== undefined || constraints.speedMax !== undefined) {
        return undefined;
      }
      if (constraints.toughMin !== undefined || constraints.toughnessMinPercent !== undefined ||
        constraints.maxToughnessMode === true) {
        const toughnessAttributeId = context.job.options.toughnessAttributeId;
        if (toughnessAttributeId === undefined) return undefined;
        const toughnessIndex = context.attributeIndexes.get(toughnessAttributeId);
        if (toughnessIndex === undefined) return undefined;
        let minimum = constraints.toughMin ?? Number.NEGATIVE_INFINITY;
        if (constraints.toughnessMinPercent !== undefined) {
          const convert = context.job.options.toughnessPercentToMinimum;
          if (convert === undefined) return undefined;
          minimum = Math.max(minimum, convert(constraints.toughnessMinPercent));
        }
        if (constraints.maxToughnessMode === true) {
          if (context.optimum.maximumToughness === undefined) return undefined;
          minimum = Math.max(minimum, context.optimum.maximumToughness);
        }
        if (attributes[toughnessIndex]! < minimum) return undefined;
      }
      const evaluation = context.job.options.evaluationFunction(attributes);
      if (evaluation === undefined || !Number.isFinite(evaluation.damage) || !Number.isFinite(evaluation.gcd)) {
        return undefined;
      }
      patchedResults.push({
        ...context.optimum,
        selection,
        food: selectedFood,
        damage: evaluation.damage,
      });
    }
    return patchedResults;
  };
  return seedResultsFor;
}
