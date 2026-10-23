import type { EquipInfo } from "../types.ts";
import type { FoodInfo } from "../types.ts";
import type { ExactMipOptions } from "./types.ts";
import type { buildLinearAttributeModel } from "./attribute-model.ts";
import { getAttributeVector } from "./attributes.ts";
import type { FactorGroup } from "./types.ts";
import type { IntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import { canonicalFoodBonusAtRawWithRate } from "../exact-mip-candidate-upper-bound.ts";
import { validateMipSolution } from "../core/solution-validation.ts";

export type GreedyMipStart = {
  hint: Map<string, number>;
  selection: EquipInfo[];
  food: FoodInfo | undefined;
};

export function sparseMipStart(
  slots: readonly (readonly EquipInfo[])[],
  foods: readonly FoodInfo[],
  slotVariables: readonly (readonly string[])[],
  foodVariables: readonly string[],
  selection: readonly EquipInfo[],
  food: FoodInfo | undefined,
): Map<string, number> | undefined {
  if (slots.length !== selection.length || slotVariables.length !== slots.length) return undefined;
  const hint = new Map<string, number>();
  const uniqueRingItems = new Set<number>();
  for (let slot = 0; slot < selection.length; slot++) {
    const candidateIndex = slots[slot]!.indexOf(selection[slot]!);
    const variable = slotVariables[slot]?.[candidateIndex];
    if (candidateIndex < 0 || variable === undefined) return undefined;
    const equipment = selection[slot]!;
    if (equipment.ringSlotIndex !== undefined && equipment.isUnique === true) {
      if (uniqueRingItems.has(equipment.itemId)) return undefined;
      uniqueRingItems.add(equipment.itemId);
    }
    hint.set(variable, 1);
  }
  if (foods.length > 0) {
    if (food === undefined) return undefined;
    const foodIndex = foods.indexOf(food);
    const variable = foodVariables[foodIndex];
    if (foodIndex < 0 || variable === undefined) return undefined;
    hint.set(variable, 1);
  } else if (food !== undefined) {
    return undefined;
  }
  return hint;
}

export function greedyMipStart(options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>, useDps: boolean, deadline: number,
  isCancelled: () => boolean): GreedyMipStart | undefined {
  const selection = options.slots.map((slot) => slot[0]!);
  let chosenFood = options.foods[0];
  const speedIndex = options.speedAttributeId === undefined ? undefined : model.idToIndex.get(options.speedAttributeId);
  const toughnessIndex = options.toughnessAttributeId === undefined ? undefined : model.idToIndex.get(options.toughnessAttributeId);
  const choiceRanges = options.constraints?.gcdChoices?.flatMap((gcd) => {
    const range = options.gcdToSpeedRange?.(gcd);
    return range === undefined ? [] : [range];
  });
  const ringSlotIndexes = new Map<0 | 1, number>();
  options.slots.forEach((slot, index) => {
    const ringSlotIndex = slot[0]?.ringSlotIndex;
    if (ringSlotIndex === 0 || ringSlotIndex === 1) ringSlotIndexes.set(ringSlotIndex, index);
  });
  const evaluate = () => {
    const attributes = getAttributeVector(selection, chosenFood, options.attributeIds, options.equipmentAttributeExtractor, options.statIndexes);
    const evaluation = options.evaluationFunction(attributes);
    if (evaluation === undefined || !Number.isFinite(evaluation.damage) || !Number.isFinite(evaluation.gcd) || evaluation.gcd <= 0) return undefined;
    let violation = 0;
    for (const [attribute, range] of model.ranges) {
      violation += Math.max(0, (range.min ?? attributes[attribute]!) - attributes[attribute]!,
        attributes[attribute]! - (range.max ?? attributes[attribute]!));
    }
    if (choiceRanges !== undefined && speedIndex !== undefined) {
      violation += Math.min(...choiceRanges.map((range) => Math.max(0,
        range.min - attributes[speedIndex]!, attributes[speedIndex]! - range.max)));
    }
    const firstRing = ringSlotIndexes.get(0);
    const secondRing = ringSlotIndexes.get(1);
    if (firstRing !== undefined && secondRing !== undefined &&
      selection[firstRing]!.itemId === selection[secondRing]!.itemId &&
      selection[firstRing]!.isUnique === true && selection[secondRing]!.isUnique === true) {
      violation = Number.POSITIVE_INFINITY;
    }
    return { violation, toughness: toughnessIndex === undefined ? 0 : attributes[toughnessIndex]!,
      score: useDps ? evaluation.damage / evaluation.gcd : evaluation.damage };
  };
  type HeuristicScore = NonNullable<ReturnType<typeof evaluate>>;
  const better = (candidate: HeuristicScore | undefined, current: HeuristicScore | undefined) => {
    if (candidate === undefined) return false;
    if (current === undefined || candidate.violation < current.violation) return true;
    if (candidate.violation !== current.violation) return false;
    if (options.constraints?.maxToughnessMode === true && candidate.toughness !== current.toughness) {
      return candidate.toughness > current.toughness;
    }
    return candidate.score > current.score;
  };
  let current = evaluate();
  type FeasibleStart = { selection: EquipInfo[]; food: FoodInfo | undefined; score: HeuristicScore };
  let bestFeasible: FeasibleStart | undefined;
  const rememberFeasible = (score: HeuristicScore | undefined) => {
    if (score === undefined || score.violation !== 0 ||
      (bestFeasible !== undefined && !better(score, bestFeasible.score))) return;
    bestFeasible = { selection: [...selection], food: chosenFood, score };
  };
  const createStart = (): GreedyMipStart | undefined => {
    if (bestFeasible === undefined) return undefined;
    const selection = [...bestFeasible.selection];
    if (model.canonicalRingOrder !== undefined) {
      const { firstSlotIndex, secondSlotIndex, firstRanks, secondRanks } = model.canonicalRingOrder;
      const firstCandidateIndex = options.slots[firstSlotIndex]!.indexOf(selection[firstSlotIndex]!);
      const secondCandidateIndex = options.slots[secondSlotIndex]!.indexOf(selection[secondSlotIndex]!);
      if (firstCandidateIndex < 0 || secondCandidateIndex < 0) return undefined;
      if (firstRanks[firstCandidateIndex]! > secondRanks[secondCandidateIndex]!) {
        const firstReplacement = firstRanks.indexOf(secondRanks[secondCandidateIndex]!);
        const secondReplacement = secondRanks.indexOf(firstRanks[firstCandidateIndex]!);
        if (firstReplacement < 0 || secondReplacement < 0) return undefined;
        selection[firstSlotIndex] = options.slots[firstSlotIndex]![firstReplacement]!;
        selection[secondSlotIndex] = options.slots[secondSlotIndex]![secondReplacement]!;
      }
    }
    const hint = sparseMipStart(
      options.slots,
      options.foods,
      model.slotVariables,
      model.foodVariables,
      selection,
      bestFeasible.food,
    );
    return hint === undefined ? undefined : { hint, selection, food: bestFeasible.food };
  };
  rememberFeasible(current);
  let checks = 0;
  // 这段有界坐标搜索只为 MIP 提供提示，绝不作为答案或上界；
  // 每个最终结果仍须经过完整证明。
  for (let pass = 0; pass < 6; pass++) {
    if (isCancelled()) return undefined;
    if (performance.now() >= deadline) return createStart();
    let changed = false;
    for (let slot = 0; slot < selection.length; slot++) {
      const previous = selection[slot]!;
      let winner = previous;
      for (const candidate of options.slots[slot]!) {
        if ((++checks & 63) === 0) {
          if (isCancelled()) {
            selection[slot] = winner;
            return undefined;
          }
          if (performance.now() >= deadline) {
            selection[slot] = winner;
            return createStart();
          }
        }
        selection[slot] = candidate;
        const score = evaluate();
        if (better(score, current)) { winner = candidate; current = score; }
        rememberFeasible(score);
      }
      selection[slot] = winner;
      changed ||= winner !== previous;
    }
    const previousFood = chosenFood;
    let winningFood = previousFood;
    for (const food of options.foods) {
      if ((++checks & 63) === 0) {
        if (isCancelled()) {
          chosenFood = winningFood;
          return undefined;
        }
        if (performance.now() >= deadline) {
          chosenFood = winningFood;
          return createStart();
        }
      }
      chosenFood = food;
      const score = evaluate();
      if (better(score, current)) { winningFood = food; current = score; }
      rememberFeasible(score);
    }
    chosenFood = winningFood;
    changed ||= chosenFood !== previousFood;
    if (!changed) break;
  }
  return createStart();
}

export function completeFeasibleMipStart(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  groups: readonly FactorGroup[],
  factorEvaluator: IntegerDamageFactorEvaluator,
  greedyStart: GreedyMipStart,
  factorAttributeIndexes: Readonly<Record<string, number | undefined>>,
): Map<string, number> {
  const sparseFallback = greedyStart.hint;
  const reject = () => sparseFallback;
  try {
    if (options.slots.length !== greedyStart.selection.length ||
      model.slotVariables.length !== options.slots.length ||
      model.equipmentAttributes.length !== options.slots.length) return reject();

    const values = new Map<string, number>(model.bounds.map(({ name }) => [name, 0]));
    const rawAttributes = new Array<number>(model.rawVariables.length).fill(0);
    for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
      const candidateIndex = options.slots[slotIndex]!.indexOf(greedyStart.selection[slotIndex]!);
      if (candidateIndex < 0 || model.slotVariables[slotIndex]?.[candidateIndex] === undefined) {
        return reject();
      }
      values.set(model.slotVariables[slotIndex]![candidateIndex]!, 1);
      const equipmentAttributes = model.fixedEquipmentAttributes[slotIndex]?.[candidateIndex];
      if (equipmentAttributes === undefined || equipmentAttributes.length !== rawAttributes.length) {
        return reject();
      }
      for (let attribute = 0; attribute < rawAttributes.length; attribute++) {
        rawAttributes[attribute] += equipmentAttributes[attribute]!;
      }
    }

    let selectedFoodIndex = -1;
    if (options.foods.length > 0) {
      if (greedyStart.food === undefined) return reject();
      selectedFoodIndex = options.foods.indexOf(greedyStart.food);
      if (selectedFoodIndex < 0 || model.foodVariables[selectedFoodIndex] === undefined) {
        return reject();
      }
      values.set(model.foodVariables[selectedFoodIndex]!, 1);
    } else if (greedyStart.food !== undefined || model.foodVariables.length !== 0) {
      return reject();
    }

    const finalAttributes = [...rawAttributes];
    const selectedFood = selectedFoodIndex < 0 ? undefined : options.foods[selectedFoodIndex];
    for (const bonus of model.foodBonuses) {
      if (bonus.foodIndex !== selectedFoodIndex) continue;
      const baseParamId = options.attributeIds[bonus.attribute];
      if (baseParamId === undefined || selectedFood === undefined) return reject();
      const parameter = selectedFood.baseParams.find((candidate) => candidate.baseParamId === baseParamId);
      if (parameter === undefined) return reject();
      const amount = canonicalFoodBonusAtRawWithRate(rawAttributes[bonus.attribute]!, {
        baseValue: parameter.baseValue ?? 0,
        multiplier: parameter.multiplier,
        maxValue: parameter.maxValue,
        numerator: bonus.numerator,
        denominator: bonus.denominator,
      });
      if (amount === undefined || amount > bonus.cap) return reject();
      values.set(bonus.bonus, amount);
      values.set(bonus.capped, Number(amount === bonus.cap));
      finalAttributes[bonus.attribute] += amount;
    }
    for (let attribute = 0; attribute < rawAttributes.length; attribute++) {
      values.set(model.rawVariables[attribute]!, rawAttributes[attribute]!);
      values.set(model.finalVariables[attribute]!, finalAttributes[attribute]!);
    }

    if (model.gcdChoiceVariables.length !== model.gcdChoiceRanges.length) return reject();
    if (model.gcdChoiceVariables.length > 0) {
      const speedAttribute = options.speedAttributeId === undefined
        ? undefined
        : model.idToIndex.get(options.speedAttributeId);
      if (speedAttribute === undefined) return reject();
      const speed = finalAttributes[speedAttribute]!;
      const choiceIndex = model.gcdChoiceRanges.findIndex((range) => speed >= range.min && speed <= range.max);
      if (choiceIndex < 0 || model.gcdChoiceVariables[choiceIndex] === undefined) return reject();
      values.set(model.gcdChoiceVariables[choiceIndex]!, 1);
    }

    const factors = factorEvaluator(finalAttributes);
    const zeroFactors = factorEvaluator(new Array<number>(options.attributeIds.length).fill(0));
    if (factors === undefined || zeroFactors === undefined) return reject();
    const factorTargets: Record<string, { value: number; attribute?: number }> = {
      weapon: {
        value: factors.weaponDamage,
        attribute: factors.weaponDamage - zeroFactors.weaponDamage,
      },
      main: { value: factors.mainStat },
      det: { value: factors.determination },
      ten: { value: factors.tenacity },
      crt: { value: factors.critical },
      dht: { value: factors.directHit },
      gcd: { value: factors.gcdCentiseconds },
    };
    for (const group of groups) {
      const target = factorTargets[group.name];
      if (target === undefined) return reject();
      const attribute = group.name === "weapon"
        ? target.attribute
        : factorAttributeIndexes[group.name];
      const attributeValue = group.name === "weapon"
        ? target.attribute!
        : attribute === undefined ? 0 : finalAttributes[attribute]!;
      const matching = group.classes.filter((factorClass) =>
        factorClass.value === target.value &&
        attributeValue >= factorClass.min && attributeValue <= factorClass.max);
      if (matching.length !== 1) return reject();
      values.set(matching[0]!.variable, 1);
      if (group.name === "weapon") {
        if (!values.has("weapon_relative")) return reject();
        values.set("weapon_relative", attributeValue);
      }
    }

    if (values.size !== model.bounds.length || model.bounds.some(({ name }) => !values.has(name))) {
      return reject();
    }
    const columns = Object.fromEntries(model.bounds.map(({ name }) => [name, { Primal: values.get(name)! }]));
    validateMipSolution(model.rows, model.bounds, columns);
    return values;
  } catch {
    return reject();
  }
}
