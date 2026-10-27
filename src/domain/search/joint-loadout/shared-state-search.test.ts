import { describe, expect, test, vi } from "vitest";
import { findBestSharedStateLoadout, sharedStateResourcePriceProposals } from "./shared-state-search.ts";
import { contextFor, equip, food, optionsFor, resultFor } from "./fixtures.helper.test.ts";
import { applyFood, buildRawAttributes } from "./attributes.ts";
import { addRational, compareRational, integerDamageProduct, rational } from "./score.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import { equippedSpeedRangeForGcd } from "../equipped-effects.ts";
import { findBestJointLoadoutV3 } from "./coordinator.ts";
import type { CommonChoice, FoodChoice, JobContext, Rational } from "./types.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import * as resourceBudget from "../factor-resource-budget-upper-bound.ts";
import { createIntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import * as sharedStateSearch from "./shared-state-search.ts";

function cartesian<T>(slots: readonly (readonly T[])[]): T[][] {
  let rows: T[][] = [[]];
  for (const slot of slots) rows = rows.flatMap((row) => slot.map((value) => [...row, value]));
  return rows;
}

function legal(context: JobContext, selection: readonly EquipInfo[], selectedFood?: FoodInfo, freezeMax = true): boolean {
  const rings = selection.filter((equipment) => equipment.ringSlotIndex !== undefined);
  if (rings.length === 2 && rings[0]!.itemId === rings[1]!.itemId && (rings[0]!.isUnique || rings[1]!.isUnique)) return false;
  const attributes = applyFood(buildRawAttributes(context, selection), selectedFood, context.attributeIndexes);
  const factors = context.factorEvaluator(attributes)!;
  const constraints = context.constraints ?? {};
  const speed = attributes[5]!;
  if ((constraints.speedMin !== undefined && speed < constraints.speedMin) ||
    (constraints.speedMax !== undefined && speed > constraints.speedMax) ||
    (constraints.gcd !== undefined && Math.round(constraints.gcd * 100) !== factors.gcdCentiseconds) ||
    (constraints.gcdChoices !== undefined && !constraints.gcdChoices.some((gcd) => Math.round(gcd * 100) === factors.gcdCentiseconds))) return false;
  const minimum = Math.max(constraints.toughMin ?? 0,
    constraints.toughnessMinPercent === undefined ? 0 : context.job.options.toughnessPercentToMinimum!(constraints.toughnessMinPercent),
    freezeMax && constraints.maxToughnessMode ? context.optimum.maximumToughness! : 0);
  return attributes[6]! >= minimum;
}

function scalar(context: JobContext, selection: readonly EquipInfo[], selectedFood: FoodInfo | undefined, objective: "damage" | "dps"): Rational {
  const factors = context.factorEvaluator(applyFood(buildRawAttributes(context, selection), selectedFood, context.attributeIndexes))!;
  return rational(integerDamageProduct(factors), objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n);
}

function setBaselines(contexts: readonly JobContext[], objective: "damage" | "dps") {
  for (const context of contexts) {
    const selections = cartesian(context.solverSlots);
    const foods = context.job.options.foods.length > 0 ? context.job.options.foods : [undefined];
    const feasible = selections.flatMap((selection) => foods.map((selectedFood) => ({ selection, selectedFood })))
      .filter(({ selection, selectedFood }) => legal(context, selection, selectedFood, false));
    if (context.constraints?.maxToughnessMode) {
      const maximum = Math.max(...feasible.map(({ selection, selectedFood }) =>
        applyFood(buildRawAttributes(context, selection), selectedFood, context.attributeIndexes)[6]!));
      context.optimum.maximumToughness = maximum;
    }
    let winner: typeof feasible[number] | undefined;
    for (const candidate of feasible) {
      if (!legal(context, candidate.selection, candidate.selectedFood)) continue;
      if (winner === undefined || compareRational(scalar(context, candidate.selection, candidate.selectedFood, objective),
        scalar(context, winner.selection, winner.selectedFood, objective)) > 0) winner = candidate;
    }
    expect(winner).toBeDefined();
    const maximumToughness = context.optimum.maximumToughness;
    context.optimum = resultFor(context, winner!.selection, winner!.selectedFood);
    context.optimum.maximumToughness = maximumToughness;
    const factors = context.factorEvaluator(applyFood(buildRawAttributes(context, winner!.selection), winner!.selectedFood, context.attributeIndexes))!;
    context.optimumProduct = integerDamageProduct(factors);
    context.optimumGcd = factors.gcdCentiseconds;
  }
}

function fixture(objective: "damage" | "dps" = "damage", shield = false) {
  const shared = [
    equip(10, [0, 0, 0, 600, 0, 0, 5]),
    equip(11, [0, 0, 600, 0, 0, 100, 5]),
    equip(12, [0, 0, 0, 600, 0, 0, 5]),
  ];
  const head = [equip(20, [0, 0, 0, 0, 0, 0, 0]), equip(21, [0, 0, 0, 0, 0, 0, 0])];
  const contexts = [0, 1].map((job) => {
    const strong = [200, 3000, 100, 200, 100, job === 0 ? 0 : 100, 0];
    const weak = [100, 3000, 100, 200, 100, job === 0 ? 100 : 0, 0];
    const weapons = [equip(30 + job * 10, strong), equip(31 + job * 10, weak)];
    const slots = [shared, head, weapons, ...(shield ? [[equip(50, [0, 0, 0, 0, 5, 0, 0]), equip(51, [0, 0, 0, 5, 0, 0, 0])]] : [])];
    const context = contextFor(slots, ["body", "head", "weapon", ...(shield ? ["shield"] : [])], `job${job}`);
    context.job.options.objective = objective;
    context.constraints = { speedMin: 100, speedMax: 100 };
    context.job.options.constraints = context.constraints;
    context.job.options.gcdToSpeedRange = (gcd) => equippedSpeedRangeForGcd("SAM", 100, gcd, 0);
    return context;
  });
  const foods = [food(60, 3, 1.1, 21), food(61, 4, 1.1, 21)];
  foods[0]!.baseParams[0]!.baseValue = 73;
  for (const context of contexts) context.job.options.foods = foods;
  setBaselines(contexts, objective);
  const commonChoicesByName = new Map<string, CommonChoice[]>([
    ["body", shared.map((equipment) => ({ key: equipmentIdentity(equipment), equipments: new Map(contexts.map((context) => [context.job.id, equipment])) }))],
    ["head", head.map((equipment) => ({ key: equipmentIdentity(equipment), equipments: new Map(contexts.map((context) => [context.job.id, equipment])) }))],
  ]);
  const foodChoices: FoodChoice[] = foods.map((selected) => ({ key: String(selected.itemId), foods: new Map(contexts.map((context) => [context.job.id, selected])) }));
  const options = { ...optionsFor(contexts), commonSlots: ["body", "head"], foodStrategy: "shared" as const, objective };
  return { options, contexts, commonChoicesByName, foodChoices, projections: new Map(), assertWithinBudget: () => {},
    remainingTimeLimit: () => undefined, limits: { maxElapsedMs: 10000, maxSeedMs: 0, maxTransitions: 1_000_000 } };
}

function exhaustive(f: ReturnType<typeof fixture>): Rational {
  let best = rational(0n, 1n);
  const all = f.contexts.map((context) => cartesian(context.solverSlots));
  for (const selections of cartesian(all)) for (const choice of f.foodChoices) {
    if (!f.options.commonSlots.every((name) => selections.every((selection, job) =>
      equipmentIdentity(selection[f.contexts[job]!.indexByName.get(name)!]!) ===
      equipmentIdentity(selections[0]![f.contexts[0]!.indexByName.get(name)!]!)))) continue;
    let total = rational(0n, 1n);
    let feasible = true;
    for (let job = 0; job < f.contexts.length; job++) {
      const context = f.contexts[job]!;
      const selectedFood = choice.foods.get(context.job.id);
      if (!legal(context, selections[job]!, selectedFood)) { feasible = false; break; }
      const value = scalar(context, selections[job]!, selectedFood, f.options.objective);
      const base = scalar(context, context.optimum.selection, context.optimum.food, f.options.objective);
      total = addRational(total, rational(value.numerator * base.denominator, value.denominator * base.numerator));
    }
    if (feasible && compareRational(total, best) > 0) best = total;
  }
  return best;
}

function outputScore(f: ReturnType<typeof fixture>, results: readonly { selection: readonly EquipInfo[]; food?: FoodInfo }[]): Rational {
  return results.reduce((total, result, job) => {
    const context = f.contexts[job]!;
    const value = scalar(context, result.selection, result.food, f.options.objective);
    const base = scalar(context, context.optimum.selection, context.optimum.food, f.options.objective);
    return addRational(total, rational(value.numerator * base.denominator, value.denominator * base.numerator));
  }, rational(0n, 1n));
}

function equivalentFixture(objective: "damage" | "dps" = "damage") {
  const f = fixture(objective);
  const first = f.contexts[0]!;
  const second = f.contexts[1]!;
  second.solverSlots = second.solverSlots.map((slot, index) => index === 2 ? first.solverSlots[2]!.map((equipment) => ({
    ...equipment, itemId: equipment.itemId! + 1000, baseParams: equipment.baseParams.map((parameter) => ({ ...parameter })),
  })) : slot);
  second.job.options.slots = second.solverSlots;
  second.equipAttributes = new WeakMap();
  const evaluate = second.job.options.evaluationFunction;
  second.job.options.evaluationFunction = (attributes) => {
    const result = evaluate(attributes);
    return result === undefined ? undefined : { ...result, damage: result.damage * 2 };
  };
  setBaselines(f.contexts, objective);
  return f;
}

describe("complete shared attribute states and private envelopes", () => {
  test.each(["damage", "dps"] as const)("folds certified utilities for %s and restores each physical private witness/display", async (objective) => {
    const f = equivalentFixture(objective);
    const result = await findBestSharedStateLoadout(f);
    const separate = equivalentFixture(objective);
    const unfolded = await findBestSharedStateLoadout({ ...separate, limits: { ...separate.limits, disableUtilityMerging: true } });
    expect(result.status).toBe("complete-feasible");
    expect(result.statistics.utilityClasses).toBe(1);
    expect(result.statistics.equivalentJobs).toBe(1);
    expect(result.statistics.privateEvaluationsSaved).toBeGreaterThan(0);
    expect(unfolded.statistics.utilityClasses).toBe(2);
    expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
    expect(compareRational(outputScore(f, result.results!), outputScore(separate, unfolded.results!))).toBe(0);
    expect(outputScore(f, result.results!)).toEqual(rational(2n, 1n));
    expect(result.results![1]!.selection[2]!.itemId).toBeGreaterThan(1000);
    expect(result.results![1]!.damage).toBe(result.results![0]!.damage * 2);
  });

  test("counts saved evaluations only after completing a feasible envelope", async () => {
    const f = equivalentFixture();
    // This option cannot meet speed=100 with any nonnegative private speed,
    // but the lower-bound coordinate walk still tries it.
    const impossible = equip(13, [0, 0, 0, 1200, 0, 200, 5]);
    for (const [job, context] of f.contexts.entries()) {
      // Each independent optimum has a stronger job-specific item that is
      // absent from the common intersection, so the seed cannot hit ceiling.
      const soloOnly = equip(900 + job, [0, 0, 0, 3000, 0, 100, 5]);
      context.solverSlots = context.solverSlots.map((slot, index) => index === 0 ? [...slot, impossible, soloOnly] : slot);
      context.job.options.slots = context.solverSlots;
    }
    f.commonChoicesByName.get("body")!.push({ key: equipmentIdentity(impossible),
      equipments: new Map(f.contexts.map((context) => [context.job.id, impossible])) });
    f.limits.maxSeedMs = 1000;
    setBaselines(f.contexts, "damage");
    for (const context of f.contexts) expect(context.optimum.selection[0]!.itemId).toBeGreaterThanOrEqual(900);
    const result = await findBestSharedStateLoadout(f);
    expect(result.status).toBe("complete-feasible");
    expect(result.statistics.equivalentJobs).toBe(1);
    expect(result.statistics.privateEvaluationsSaved).toBeGreaterThan(0);
    expect(result.statistics.privateEvaluationsSaved).toBeLessThan(result.statistics.privateEvaluations);
    expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
  });

  test.each(["damage", "dps"] as const)("preserves original job-count thresholds with a repeated utility and a conflicting %s utility", async (objective) => {
    const f = equivalentFixture(objective);
    const third = fixture(objective).contexts[1]!;
    third.job = { ...third.job, id: "third", options: { ...third.job.options } };
    third.solverSlots = third.solverSlots.map((slot, index) => index < 2 ? f.contexts[0]!.solverSlots[index]! : slot);
    third.job.options.slots = third.solverSlots;
    third.equipAttributes = new WeakMap();
    f.contexts.push(third); f.options.jobs = f.contexts.map((context) => context.job);
    for (const choices of f.commonChoicesByName.values()) for (const choice of choices) {
      choice.equipments.set(third.job.id, choice.equipments.get(f.contexts[0]!.job.id)!);
    }
    for (const choice of f.foodChoices) choice.foods.set(third.job.id, choice.foods.get(f.contexts[0]!.job.id));
    third.job.options.foods = f.contexts[0]!.job.options.foods;
    setBaselines(f.contexts, objective);
    const expected = exhaustive(f);
    expect(compareRational(expected, rational(3n, 1n))).toBeLessThan(0);
    const result = await findBestSharedStateLoadout(f);
    const separate = await findBestSharedStateLoadout({ ...f, limits: { ...f.limits, disableUtilityMerging: true } });
    expect(result.status).toBe("complete-feasible");
    expect(result.statistics.utilityClasses).toBe(2);
    expect(result.statistics.termination).toBe("enumeration");
    expect(compareRational(outputScore(f, result.results!), expected)).toBe(0);
    expect(compareRational(outputScore(f, separate.results!), expected)).toBe(0);
    expect(result.results).toHaveLength(3);
  });

  test.each(["unregistered", "formula", "constraints", "shared-vector", "private-vector", "food", "duplicate-food"] as const)(
    "does not fold when %s equivalence evidence differs", async (difference) => {
      const f = equivalentFixture();
      const context = f.contexts[1]!;
      if (difference === "unregistered") {
        const original = context.factorEvaluator;
        context.factorEvaluator = (values) => original(values);
      } else if (difference === "formula") {
        context.factorEvaluator = createIntegerDamageFactorEvaluator("SAM", 100, context.job.options.statIndexes, 4);
      } else if (difference === "constraints") {
        context.constraints = { speedMin: 0, speedMax: 200 };
        context.job.options.constraints = context.constraints;
      } else if (difference === "shared-vector") {
        context.job.options.equipmentAttributeExtractor = (equipment) => equipment.baseParams.map((parameter) => ({
          ...parameter, value: parameter.value + (equipment.itemId === 10 && parameter.baseParamId === 3 ? 1 : 0),
        }));
        context.equipAttributes = new WeakMap();
      } else if (difference === "private-vector") {
        context.solverSlots[2]![0]!.baseParams[2]!.value += 1;
        context.equipAttributes = new WeakMap();
      } else {
        const previous = context.job.options.foods[0]!;
        const changed = { ...previous, baseParams: previous.baseParams.map((parameter) => ({ ...parameter,
          baseValue: (parameter.baseValue ?? 0) + 1 })) };
        if (difference === "duplicate-food") changed.baseParams.push({ ...changed.baseParams[0]! });
        context.job.options.foods = [changed, ...context.job.options.foods.slice(1)];
        f.foodChoices[0]!.foods.set(context.job.id, changed);
      }
      setBaselines(f.contexts, "damage");
      const result = await findBestSharedStateLoadout(f);
      expect(result.status, result.statistics.reason).toBe("complete-feasible");
      expect(result.statistics.utilityClasses).toBe(2);
      expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
    });

  test("skips heavy state enumeration while retaining an ordinary feasible MIP seed", async () => {
    const f = fixture();
    for (const [name, slot] of [["body", 0], ["head", 1]] as const) {
      const candidates = Array.from({ length: 30 }, (_, index) => equip(100 + slot * 100 + index,
        [0, 0, index * 10, (30 - index) * 10, 0, 0, 0]));
      for (const context of f.contexts) {
        context.solverSlots = context.solverSlots.map((previous, index) => index === slot ? candidates : previous);
        context.job.options.slots = context.solverSlots;
      }
      f.commonChoicesByName.set(name, candidates.map((equipment) => ({ key: equipmentIdentity(equipment),
        equipments: new Map(f.contexts.map((context) => [context.job.id, equipment])) })));
    }
    setBaselines(f.contexts, "damage");
    f.limits.maxTransitions = 500;
    const result = await findBestSharedStateLoadout(f);
    expect(result.status).toBe("skipped");
    expect(result.statistics.activationDecision).toBe("skipped");
    expect(result.statistics.activationContexts).toBeGreaterThan(0);
    expect(result.statistics.activationHeuristicWork).toBeGreaterThan(f.limits.maxTransitions);
    expect(result.statistics.seedEvaluations).toBeGreaterThan(0);
    expect(result.statistics.states).toBe(0);
    expect(result.statistics.enumerationMs).toBe(0);
    expect(result.statistics.resourceSupports).toBe(0);
    expect(result.results).toHaveLength(f.contexts.length);
    for (let job = 0; job < f.contexts.length; job++) {
      expect(legal(f.contexts[job]!, result.results![job]!.selection, result.results![job]!.food)).toBe(true);
    }
  });

  test("keeps small shared domains enabled with a substantial private envelope", async () => {
    const f = fixture();
    for (const context of f.contexts) {
      context.solverSlots = context.solverSlots.map((slot, slotIndex) => slotIndex === 2 ?
        Array.from({ length: 80 }, (_, index) => equip(1000 + index,
          [100, 3000, index * 10, 800 - index * 10, 0, 100, 0])) : slot);
      context.job.options.slots = context.solverSlots;
    }
    setBaselines(f.contexts, "damage");
    const result = await findBestSharedStateLoadout(f);
    expect(result.status).toBe("complete-feasible");
    expect(result.statistics.activationDecision).toBe("enabled");
    expect(result.statistics.privateStates).toBeGreaterThanOrEqual(160);
  });

  test("keeps a larger shared domain enabled with light private work", async () => {
    const f = fixture();
    const candidates = Array.from({ length: 60 }, (_, index) => equip(2000 + index,
      [0, 0, index * 10, 600 - index * 10, 0, 0, 0]));
    for (const context of f.contexts) {
      context.constraints = { speedMin: 0, speedMax: 200 };
      context.job.options.constraints = context.constraints;
      context.solverSlots = [candidates, context.solverSlots[1]!, [context.solverSlots[2]![0]!]];
      context.job.options.slots = context.solverSlots;
    }
    f.commonChoicesByName.set("body", candidates.map((equipment) => ({ key: equipmentIdentity(equipment),
      equipments: new Map(f.contexts.map((context) => [context.job.id, equipment])) })));
    setBaselines(f.contexts, "damage");
    const result = await findBestSharedStateLoadout(f);
    expect(result.status).toBe("complete-feasible");
    expect(result.statistics.activationDecision).toBe("enabled");
    expect(result.statistics.privateStates).toBe(2);
    expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
  });

  test("unknown activation evidence skips safely and skipped attempts use the coordinator fallback", async () => {
    const f = fixture();
    f.contexts[0]!.factorEvaluator = () => undefined;
    const skipped = await findBestSharedStateLoadout(f);
    expect(skipped.status).toBe("skipped");
    expect(skipped.statistics.activationReason).toBe("unknown activation eligibility");
    expect(skipped.results).toBeUndefined();
    const attempt = vi.spyOn(sharedStateSearch, "findBestSharedStateLoadout").mockResolvedValue(skipped);
    try {
      const fresh = fixture();
      const result = await findBestJointLoadoutV3(fresh.options);
      expect(result).toBeDefined();
      expect(result!.proof.innerSolverStatus).not.toBe("ExactStateEnumeration");
      expect(result!.proof.complete).toBe(true);
    } finally { attempt.mockRestore(); }
  });
  test.each(["damage", "dps"] as const)("matches the full Cartesian oracle for %s and performs real merges/private elimination", async (objective) => {
    const f = fixture(objective, true);
    const expected = exhaustive(f);
    expect(compareRational(expected, rational(2n, 1n))).toBeLessThan(0);
    const result = await findBestSharedStateLoadout(f);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(compareRational(outputScore(f, result.results!), expected)).toBe(0);
    expect(result.statistics.mergedStates).toBeGreaterThan(0);
    expect(result.statistics.states).toBeGreaterThan(0);
    expect(result.statistics.privateStates).toBeGreaterThan(2);
    expect(result.statistics.privateEvaluations).toBeGreaterThan(0);
    expect(result.statistics.resourceSupports).toBeGreaterThan(0);
    expect(result.statistics.resourcePartitionPrices).toBeGreaterThan(0);
    expect(result.statistics.resourcePartitionAttempts).toBeLessThanOrEqual(2 * f.contexts.length);
    expect(result.statistics.resourcePartitions).toBeLessThanOrEqual(8 * result.statistics.resourcePartitionPrices);
    expect(result.statistics.resourcePartitionSupports).toBeGreaterThan(0);
    expect(result.statistics.sharedVectorClasses).toBe(1);
    expect(result.statistics.speedPrunes).toBeGreaterThan(0);
    expect(result.statistics.termination).toBe("enumeration");
    for (const resultForJob of result.results!) expect(resultForJob.statistics.signatureBandProof).toBe(false);
  });

  test("keeps separated GCD choices and freezes the full-domain maximum toughness", async () => {
    const f = fixture();
    for (const context of f.contexts) {
      const gcdAt = (speed: number) => context.factorEvaluator([0, 0, 0, 0, 0, speed, 0])!.gcdCentiseconds / 100;
      context.constraints = { gcdChoices: [gcdAt(0), gcdAt(200)], maxToughnessMode: true, toughnessMinPercent: 1 };
      context.job.options.constraints = context.constraints;
      context.job.options.toughnessPercentToMinimum = () => 3;
    }
    // The private states can reach all three speed tiers; the middle GCD is not selected.
    for (const context of f.contexts) context.solverSlots[2]![1]!.baseParams[5]!.value = 200;
    f.contexts[0]!.solverSlots[0]![1]!.baseParams[6]!.value = 0;
    for (const context of f.contexts) context.equipAttributes = new WeakMap();
    for (const choices of f.commonChoicesByName.values()) for (const choice of choices) {
      choice.key = equipmentIdentity(choice.equipments.values().next().value!);
    }
    setBaselines(f.contexts, "damage");
    const expected = exhaustive(f);
    const result = await findBestSharedStateLoadout(f);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(compareRational(outputScore(f, result.results!), expected)).toBe(0);
    for (let job = 0; job < result.results!.length; job++) {
      expect(result.results![job]!.maximumToughness).toBe(f.contexts[job]!.optimum.maximumToughness);
      expect(legal(f.contexts[job]!, result.results![job]!.selection, result.results![job]!.food)).toBe(true);
    }
  });

  test("abandons incomplete optional work, retains only a feasible incumbent, and never reports completion", async () => {
    const f = fixture();
    f.limits.maxTransitions = 0;
    const result = await findBestSharedStateLoadout(f);
    expect(result.status).toBe("budget-exhausted");
    for (let job = 0; job < (result.results?.length ?? 0); job++) {
      expect(legal(f.contexts[job]!, result.results![job]!.selection, result.results![job]!.food)).toBe(true);
    }
  });

  test("bounds the current witness DAG rather than summing already released contexts", async () => {
    const f = fixture();
    const result = await findBestSharedStateLoadout({ ...f, limits: { ...f.limits, maxStates: 3 } });
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(result.statistics.contexts).toBeGreaterThan(1);
    expect(result.statistics.states).toBeGreaterThan(3);
    expect(result.statistics.maximumContextStates).toBeLessThanOrEqual(3);
    expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
    const limited = await findBestSharedStateLoadout({ ...f, limits: { ...f.limits, maxStates: 1 } });
    expect(limited.status).toBe("budget-exhausted");
    expect(limited.statistics.reason).toBe("context state budget");
  });

  test("retains separate full vectors when the same physical choice contributes differently by job", async () => {
    const f = fixture();
    const context = f.contexts[1]!;
    context.job.options.equipmentAttributeExtractor = (equipment) => equipment.baseParams.map((parameter) => ({
      ...parameter,
      value: parameter.value + (equipment.itemId === 10 && parameter.baseParamId === 3 ? 37 : 0),
    }));
    context.equipAttributes = new WeakMap();
    setBaselines(f.contexts, "damage");
    const result = await findBestSharedStateLoadout(f);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(result.statistics.sharedVectorClasses).toBe(2);
    expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
  });

  test.each([true, false])("forms a complete legal common ring group (unique=%s) and keeps physical multiplicity", async (isUnique) => {
    const f = fixture();
    const first = [equip(70, [0, 0, 10, 0, 0, 0, 0], { ringSlotIndex: 0, isUnique }),
      equip(71, [0, 0, 20, 0, 0, 0, 0], { ringSlotIndex: 0, isUnique })];
    const second = first.map((equipment) => ({ ...equipment, ringSlotIndex: 1 as const }));
    for (const context of f.contexts) {
      context.job.slotNames = [...context.job.slotNames, "ring", "ring2"];
      context.solverSlots = [...context.solverSlots, first, second];
      context.job.options.slots = context.solverSlots;
      context.indexByName.set("ring", 3); context.indexByName.set("ring2", 4);
    }
    for (const [name, slot] of [["ring", first], ["ring2", second]] as const) {
      f.commonChoicesByName.set(name, slot.map((equipment) => ({ key: equipmentIdentity(equipment),
        equipments: new Map(f.contexts.map((context) => [context.job.id, equipment])) })));
    }
    f.options.commonSlots.push("ring", "ring2");
    setBaselines(f.contexts, "damage");
    const expected = exhaustive(f);
    const result = await findBestSharedStateLoadout(f);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(compareRational(outputScore(f, result.results!), expected)).toBe(0);
    for (let job = 0; job < result.results!.length; job++) {
      expect(legal(f.contexts[job]!, result.results![job]!.selection, result.results![job]!.food)).toBe(true);
      const ids = result.results![job]!.selection.slice(3).map((equipment) => equipment.itemId);
      expect(new Set(ids).size).toBe(isUnique ? 2 : 1);
    }
  });

  test("matches independent Cartesian enumeration over deterministic randomized finite domains", async () => {
    let seed = 0x14515;
    const next = (maximum: number) => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) % maximum;
    };
    let enumerated = 0;
    let resourcePruned = 0;
    for (let trial = 0; trial < 60; trial++) {
      const objective = trial % 2 === 0 ? "damage" : "dps";
      const f = fixture(objective);
      for (const equipment of f.contexts[0]!.solverSlots[0]!) {
        equipment.baseParams[2]!.value = next(801);
        equipment.baseParams[3]!.value = next(801);
        equipment.baseParams[4]!.value = next(301);
      }
      for (const equipment of f.contexts[0]!.solverSlots[1]!) {
        equipment.baseParams[2]!.value = next(301);
        equipment.baseParams[3]!.value = next(301);
      }
      for (const context of f.contexts) {
        context.equipAttributes = new WeakMap();
        if (objective === "dps") {
          context.constraints = { speedMin: 0, speedMax: 200 };
          context.job.options.constraints = context.constraints;
        }
        for (const equipment of context.solverSlots[2]!) {
          equipment.baseParams[0]!.value = 100 + next(101);
          equipment.baseParams[1]!.value = 2000 + next(1501);
          equipment.baseParams[2]!.value = next(1001);
          equipment.baseParams[3]!.value = next(1001);
        }
      }
      for (const choices of f.commonChoicesByName.values()) for (const choice of choices) {
        choice.key = equipmentIdentity(choice.equipments.values().next().value!);
      }
      setBaselines(f.contexts, objective);
      const expected = exhaustive(f);
      const result = await findBestSharedStateLoadout(f);
      expect(result.status, `trial ${trial}: ${result.statistics.reason}`).toBe("complete-feasible");
      expect(compareRational(outputScore(f, result.results!), expected), `trial ${trial}`).toBe(0);
      enumerated += Number(result.statistics.termination === "enumeration");
      resourcePruned += result.statistics.resourcePrunes;
    }
    expect(enumerated).toBeGreaterThan(0);
    expect(resourcePruned).toBeGreaterThan(0);
  });

  test("keeps original prices and certificates when partition preparation or queries are unknown", async () => {
    const prepare = vi.spyOn(resourceBudget, "preparePartitionedFactorResourceBudgetUpperBound");
    try {
      prepare.mockReturnValue(undefined);
      const f = fixture();
      const failed = await findBestSharedStateLoadout(f);
      expect(failed.status).toBe("complete-feasible");
      expect(failed.statistics.resourcePartitionAttempts).toBeGreaterThan(0);
      expect(failed.statistics.resourcePartitionPrices).toBe(0);
      expect(failed.statistics.resourcePriceCount).toBeGreaterThan(2 * f.contexts.length);
      expect(compareRational(outputScore(f, failed.results!), exhaustive(f))).toBe(0);

      prepare.mockImplementation((groups) => ({
        minimumCost: groups.reduce((total, group) => total + Math.min(...group.classes.map((entry) => entry.min)), 0),
        supportCount: 1, partitionCount: 2, query: () => undefined,
      }));
      const unknownFixture = fixture();
      const unknown = await findBestSharedStateLoadout(unknownFixture);
      expect(unknown.status).toBe("complete-feasible");
      expect(unknown.statistics.resourcePartitionPrices).toBeGreaterThan(0);
      expect(unknown.statistics.resourcePriceCount).toBe(failed.statistics.resourcePriceCount);
      expect(unknown.statistics.resourcePrunes).toBe(failed.statistics.resourcePrunes);
      expect(unknown.statistics.states).toBe(failed.statistics.states);
      expect(compareRational(outputScore(unknownFixture, unknown.results!), exhaustive(unknownFixture))).toBe(0);
    } finally {
      prepare.mockRestore();
    }
  });

  test("proposes bounded nonnegative prices from all global scales and local baseline differences", () => {
    const groups = [
      { name: "main", qs: [0, 100, 300, 600, 900, 1200] },
      { name: "det", qs: [0, 400, 500, 600, 700, 800] },
      { name: "gcd", qs: [0, 0, 0, 0, 0, 0] },
    ].map(({ name, qs }) => ({ name, classes: qs.map((q, index) => ({
      min: index * 10, max: index * 10 + 9, value: index + 1, variable: `${name}_${index}`, q,
    })) }));
    const axes = groups.map(({ name }) => ({ name, baselineValue: 25 }));
    const proposals = sharedStateResourcePriceProposals(groups, axes);
    expect(proposals.length).toBeLessThanOrEqual(10);
    expect(proposals[0]).toMatchObject({ name: "uniform", weights: [1, 1, 1] });
    expect(proposals.some(({ name }) => name.startsWith("global-"))).toBe(true);
    expect(proposals.some(({ name }) => name.startsWith("baseline-window-1"))).toBe(true);
    expect(proposals.some(({ name }) => name.includes("65536"))).toBe(true);
    expect(new Set(proposals.map(({ weights }) => weights.join(","))).size).toBe(proposals.length);
    for (const { weights } of proposals) expect(weights.every((weight) => Number.isSafeInteger(weight) && weight >= 0)).toBe(true);
    const noBaseline = sharedStateResourcePriceProposals(groups, axes.map((axis) => ({ ...axis, baselineValue: NaN })));
    expect(noBaseline.some(({ name }) => name.startsWith("baseline-"))).toBe(false);
  });

  test("preserves different GCD requirements for different jobs", async () => {
    const f = fixture();
    f.contexts.forEach((context, job) => {
      const gcd = context.factorEvaluator([0, 0, 0, 0, 0, job === 0 ? 100 : 0, 0])!.gcdCentiseconds / 100;
      context.constraints = { gcdChoices: [gcd] };
      context.job.options.constraints = context.constraints;
    });
    setBaselines(f.contexts, "damage");
    const expected = exhaustive(f);
    const result = await findBestSharedStateLoadout(f);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(compareRational(outputScore(f, result.results!), expected)).toBe(0);
    result.results!.forEach((selected, job) => {
      const context = f.contexts[job]!;
      const factors = context.factorEvaluator(applyFood(buildRawAttributes(context, selected.selection), selected.food, context.attributeIndexes))!;
      expect(factors.gcdCentiseconds).toBe(Math.round(context.constraints!.gcdChoices![0]! * 100));
    });
  });

  test("propagates cancellation and global deadlines instead of starting a fallback", async () => {
    const f = fixture();
    f.assertWithinBudget = () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); };
    await expect(findBestSharedStateLoadout(f)).rejects.toMatchObject({ name: "AbortError" });
  });

  test("rejects an incorrect independent baseline before a false sum ceiling can complete", async () => {
    const f = fixture();
    f.contexts[0]!.optimumProduct /= 2n;
    await expect(findBestSharedStateLoadout(f)).rejects.toThrow("超过独立最优基线");
  });

  test("does not treat the zero allocation of a variable weapon as its complete domain", async () => {
    const f = fixture();
    f.contexts[0]!.solverSlots[2]![0]!.resistanceWeaponAdjust = { maxTotalStats: 5, maxEachStat: 5, stats: ["CRT", "DET"] };
    expect((await findBestSharedStateLoadout(f)).status).toBe("unsupported");
  });

  test("declines projected or partially shared rings instead of merging incompatible identities", async () => {
    const f = fixture();
    f.options.commonSlots = ["ring"];
    expect((await findBestSharedStateLoadout(f)).status).toBe("unsupported");
    f.options.commonSlots = ["body", "head"];
    f.projections.set("body", { commonSlot: "body", slotName: "rings", ringIndex: 0 });
    expect((await findBestSharedStateLoadout(f)).status).toBe("unsupported");
  });

  test("declines unsafe accumulated attributes and independent food without a false proof", async () => {
    const f = fixture();
    f.contexts[0]!.solverSlots[0]![0]!.baseParams[1]!.value = Number.MAX_SAFE_INTEGER;
    for (const context of f.contexts) context.equipAttributes = new WeakMap();
    expect((await findBestSharedStateLoadout(f)).status).toBe("unsupported");
    const other = fixture();
    expect((await findBestSharedStateLoadout({ ...other, options: { ...other.options, foodStrategy: "independent" } })).status).toBe("unsupported");
  });

  test("handles the shared no-food context without fabricating a food identity", async () => {
    const f = fixture();
    for (const context of f.contexts) context.job.options.foods = [];
    f.foodChoices = [{ key: "no-food", foods: new Map(f.contexts.map((context) => [context.job.id, undefined])) }];
    setBaselines(f.contexts, "damage");
    const result = await findBestSharedStateLoadout(f);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
    expect(result.results!.every((selected) => selected.food === undefined)).toBe(true);
  });

  test("eliminates complete private ring blocks while preserving uniqueness", async () => {
    const f = fixture();
    const first = [equip(70, [0, 0, 10, 0, 0, 0, 0], { ringSlotIndex: 0, isUnique: true }),
      equip(71, [0, 0, 20, 0, 0, 0, 0], { ringSlotIndex: 0, isUnique: true })];
    const second = first.map((equipment) => ({ ...equipment, ringSlotIndex: 1 as const }));
    for (const context of f.contexts) {
      context.job.slotNames = [...context.job.slotNames, "ring", "ring2"];
      context.solverSlots = [...context.solverSlots, first, second];
      context.job.options.slots = context.solverSlots;
      context.indexByName.set("ring", 3); context.indexByName.set("ring2", 4);
    }
    setBaselines(f.contexts, "damage");
    const result = await findBestSharedStateLoadout(f);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(compareRational(outputScore(f, result.results!), exhaustive(f))).toBe(0);
    for (const selected of result.results!) expect(new Set(selected.selection.slice(3).map(({ itemId }) => itemId)).size).toBe(2);
  });

  test("proves infeasibility when the common ring intersection only permits an illegal duplicate", async () => {
    const f = fixture();
    const common = equip(70, [0, 0, 10, 0, 0, 0, 0], { ringSlotIndex: 0, isUnique: true });
    for (const [job, context] of f.contexts.entries()) {
      const first = [common, equip(71 + job, [0, 0, 20, 0, 0, 0, 0], { ringSlotIndex: 0, isUnique: true })];
      const second = first.map((equipment) => ({ ...equipment, ringSlotIndex: 1 as const }));
      context.job.slotNames = [...context.job.slotNames, "ring", "ring2"];
      context.solverSlots = [...context.solverSlots, first, second];
      context.job.options.slots = context.solverSlots;
      context.indexByName.set("ring", 3); context.indexByName.set("ring2", 4);
    }
    for (const [name, index] of [["ring", 3], ["ring2", 4]] as const) {
      f.commonChoicesByName.set(name, [{ key: equipmentIdentity(common), equipments: new Map(f.contexts.map((context) =>
        [context.job.id, context.solverSlots[index]![0]!])) }]);
    }
    f.options.commonSlots.push("ring", "ring2");
    setBaselines(f.contexts, "damage");
    const result = await findBestSharedStateLoadout(f);
    expect(result.status).toBe("complete-infeasible");
    expect(result.results).toBeUndefined();
    expect(result.statistics.reason).toBe("no legal common ring group");
  });

  test("declines job-dependent shared speed and malformed optional budgets", async () => {
    const f = fixture();
    f.contexts[1]!.job.options.equipmentAttributeExtractor = (equipment) => equipment.baseParams.map((parameter) => ({
      ...parameter, value: parameter.value + (equipment.itemId === 10 && parameter.baseParamId === 6 ? 1 : 0),
    }));
    f.contexts[1]!.equipAttributes = new WeakMap();
    const result = await findBestSharedStateLoadout(f);
    expect(result.status).toBe("unsupported");
    expect(result.statistics.reason).toBe("shared speed has job-dependent contributions");
    const other = fixture();
    const invalid = await findBestSharedStateLoadout({ ...other, limits: { ...other.limits, maxStates: NaN } });
    expect(invalid.status).toBe("unsupported");
  });

  test("distinguishes private-state budgets and missing maximum-toughness evidence", async () => {
    const f = fixture();
    const limited = await findBestSharedStateLoadout({ ...f, limits: { ...f.limits, maxPrivateStates: 0 } });
    expect(limited.status).toBe("budget-exhausted");
    expect(limited.statistics.reason).toBe("private state budget");
    f.contexts[0]!.constraints = { maxToughnessMode: true };
    await expect(findBestSharedStateLoadout(f)).rejects.toThrow("最高坚韧基线没有返回最大值");
  });

  test("publishes shared-state work before subsequent coordinator phases", async () => {
    vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
    try {
      const f = fixture();
      const profiles: Record<string, unknown>[] = [];
      f.contexts[0]!.job.options.onSolverProgress = (event) => {
        if (event.message?.startsWith("PROFILE ")) profiles.push(JSON.parse(event.message.slice(8)));
      };
      await findBestJointLoadoutV3(f.options);
      const state = profiles.find((profile) => profile.phase === "exact-shared-state-search");
      expect(state).toMatchObject({ status: "complete-feasible" });
      for (const key of ["states", "transitions", "privateEvaluations", "seedMs", "elapsedMs",
        "resourcePartitionAttempts", "resourcePartitionPrices", "resourcePartitions", "resourcePartitionSupports",
    "resourcePartitionPreparationMs", "utilityClasses", "equivalentJobs", "privateEvaluationsSaved", "utilityCertificateMs",
    "activationContexts", "activationEstimatedWork", "activationHeuristicWork", "activationSaturated", "activationDecisionMs"]) {
        expect(typeof state![key]).toBe("number");
      }
      expect(typeof state!.seedValueNumerator).toBe("string");
      expect(typeof state!.seedValueDenominator).toBe("string");
      expect(Array.isArray(JSON.parse(state!.resourcePriceDiagnostics as string))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
