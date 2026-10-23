import type { ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { EquipInfo, SharedSlotProjection } from "../types.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import type { CommonChoice, FoodChoice, JobContext, JointLoadoutV3Options, RingPairInfo } from "./types.ts";
import { applyFood, buildRawAttributes } from "./attributes.ts";
import { commonSlotIndex } from "./shared-equipment.ts";
import { integerDamageProduct } from "./score.ts";
import { foodIdentityForOptional } from "./shared-foods.ts";

function attributeVectorKey(values: readonly number[]): string {
  return values.join(",");
}

/**
 * 投影共享装备后，重新平衡至多两个私有的同物品魔晶石变体。
 * 匹配成功会恢复完整的单职业原始属性向量，因此也会恢复所有规范因子和约束输入，
 * 不需要根据加权得分推断属性。
 */
function findSameItemAttributeCompensation(
  context: JobContext,
  selection: readonly EquipInfo[],
  targetRawAttributes: readonly number[],
  commonSlotIndexes: ReadonlySet<number>,
  checkBudget: () => void,
): readonly { slotIndex: number; equipment: EquipInfo }[] | undefined {
  const currentRawAttributes = buildRawAttributes(context, selection);
  if (currentRawAttributes.length !== targetRawAttributes.length) return undefined;
  const needed = targetRawAttributes.map((value, index) => value - currentRawAttributes[index]!);
  if (needed.some((value) => !Number.isSafeInteger(value))) return undefined;
  if (needed.every((value) => value === 0)) return [];
  const neededKey = attributeVectorKey(needed);
  const alternativesBySlot: {
    slotIndex: number;
    alternatives: { equipment: EquipInfo; delta: number[]; key: string }[];
  }[] = [];
  const maxAlternativesPerSlot = 128;
  let scannedCandidates = 0;
  const maxScannedCandidates = 50_000;

  for (let slotIndex = 0; slotIndex < context.solverSlots.length; slotIndex++) {
    if (commonSlotIndexes.has(slotIndex)) continue;
    const current = selection[slotIndex];
    if (current === undefined || current.ringSlotIndex !== undefined ||
      current.resistanceWeaponAdjust !== undefined ||
      (current as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips !== undefined) continue;
    const currentIdentity = equipmentIdentity(current);
    const sameItemCandidates: EquipInfo[] = [];
    let exceededSlotLimit = false;
    for (const candidate of context.solverSlots[slotIndex]!) {
      if ((scannedCandidates++ & 255) === 0) checkBudget();
      if (scannedCandidates > maxScannedCandidates) return undefined;
      if (candidate.itemId !== current.itemId || candidate.ringSlotIndex !== undefined ||
        candidate.resistanceWeaponAdjust !== undefined ||
        (candidate as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips !== undefined ||
        equipmentIdentity(candidate) === currentIdentity) continue;
      sameItemCandidates.push(candidate);
      if (sameItemCandidates.length > maxAlternativesPerSlot) {
        exceededSlotLimit = true;
        break;
      }
    }
    if (sameItemCandidates.length === 0 || exceededSlotLimit) continue;
    const currentVector = buildRawAttributes(context, [current]);
    const alternatives = sameItemCandidates.map((equipment) => {
      const candidateVector = buildRawAttributes(context, [equipment]);
      const delta = candidateVector.map((value, index) => value - currentVector[index]!);
      return { equipment, delta, key: attributeVectorKey(delta) };
    });
    alternativesBySlot.push({ slotIndex, alternatives });
  }

  for (const group of alternativesBySlot) {
    const match = group.alternatives.find(({ key }) => key === neededKey);
    if (match !== undefined) return [{ slotIndex: group.slotIndex, equipment: match.equipment }];
  }

  let checkedPairs = 0;
  const maxPairChecks = 100_000;
  for (let leftIndex = 0; leftIndex < alternativesBySlot.length; leftIndex++) {
    const left = alternativesBySlot[leftIndex]!;
    const byDelta = new Map<string, EquipInfo>();
    for (const candidate of left.alternatives) {
      if (!byDelta.has(candidate.key)) byDelta.set(candidate.key, candidate.equipment);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < alternativesBySlot.length; rightIndex++) {
      const right = alternativesBySlot[rightIndex]!;
      for (const candidate of right.alternatives) {
        if ((checkedPairs++ & 255) === 0) checkBudget();
        if (checkedPairs > maxPairChecks) return undefined;
        const complement = needed.map((value, index) => value - candidate.delta[index]!);
        if (complement.some((value) => !Number.isSafeInteger(value))) return undefined;
        const equipment = byDelta.get(attributeVectorKey(complement));
        if (equipment !== undefined) {
          return [
            { slotIndex: left.slotIndex, equipment },
            { slotIndex: right.slotIndex, equipment: candidate.equipment },
          ];
        }
      }
    }
  }
  return undefined;
}

/** Reconstruct feasible seeds, including the existing bounded materia compensation. */
export function createSeedResults({
  options, contexts, commonSlotProjections, objective,
  enableSharedMateriaCompensation, assertWithinBudget,
}: {
  options: JointLoadoutV3Options;
  contexts: readonly JobContext[];
  commonSlotProjections: ReadonlyMap<string, SharedSlotProjection>;
  objective: "damage" | "dps";
  enableSharedMateriaCompensation: boolean;
  assertWithinBudget: (stage: string) => void;
}) {
  const seedResultsFor = (
    fixed: ReadonlyMap<string, CommonChoice>,
    foodChoice: FoodChoice | undefined,
    allowMateriaCompensation = false,
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
      let rawAttributes = buildRawAttributes(context, selection);
      let attributes = applyFood(rawAttributes, selectedFood, context.attributeIndexes);
      let factors = context.factorEvaluator(attributes);
      if (factors !== undefined) {
        const product = integerDamageProduct(factors);
        const reachesSoloOptimum = objective === "dps"
          ? product * BigInt(context.optimumGcd) ===
            context.optimumProduct * BigInt(factors.gcdCentiseconds)
          : product === context.optimumProduct;
        if (allowMateriaCompensation && enableSharedMateriaCompensation && !reachesSoloOptimum &&
          foodIdentityForOptional(selectedFood) === foodIdentityForOptional(context.optimum.food)) {
          const targetRawAttributes = buildRawAttributes(context, context.optimum.selection);
          const commonSlotIndexes = new Set(options.commonSlots.map((name) =>
            commonSlotIndex(context, name, commonSlotProjections)));
          const compensation = findSameItemAttributeCompensation(
            context,
            selection,
            targetRawAttributes,
            commonSlotIndexes,
            () => assertWithinBudget("共享种子魔晶石属性补偿"),
          );
          if (compensation !== undefined) {
            const compensatedSelection = [...selection];
            for (const { slotIndex, equipment } of compensation) compensatedSelection[slotIndex] = equipment;
            const compensatedRawAttributes = buildRawAttributes(context, compensatedSelection);
            if (compensatedRawAttributes.every((value, index) => value === targetRawAttributes[index])) {
              for (const { slotIndex, equipment } of compensation) selection[slotIndex] = equipment;
              rawAttributes = compensatedRawAttributes;
              attributes = applyFood(rawAttributes, selectedFood, context.attributeIndexes);
              factors = context.factorEvaluator(attributes);
            }
          }
        }
      }
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
