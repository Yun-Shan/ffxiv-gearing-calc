import { describe, expect, test, vi } from "vitest";
import type { Stat } from "../../types.ts";
import { createDamageGcdVectorEvaluator, createIntegerDamageFactorEvaluator, blueMageWeaponDamageAddition } from "../equipped-effects.ts";
import { prepareExactMipModel } from "../exact-mip/model-preparation.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import { contextFor, equip, optionsFor, resultFor } from "./fixtures.helper.test.ts";
import { findBestSharedStateLoadout } from "./shared-state-search.ts";
import type { CommonChoice, FoodChoice, JobContext, Rational } from "./types.ts";
import * as resourceBudget from "../factor-resource-budget-upper-bound.ts";

type Objective = "damage" | "dps";
type Bonus = { coordinate: number; base: number; numerator: number; denominator: number; cap: number };
type Schema = { ids: number[]; order: number[]; stats: Stat[]; bonuses: Bonus[][] };
const schemas: Schema[] = [
  { ids: [1, 2, 3, 4, 5, 6, 7], order: [0, 1, 2, 3, 4, 5, 6],
    stats: ["PDMG", "STR", "CRT", "DET", "DHT", "SKS", "TEN"],
    bonuses: [[{ coordinate: 2, base: 73, numerator: 1, denominator: 10, cap: 41 }],
      [{ coordinate: 3, base: 51, numerator: 1, denominator: 4, cap: 67 }]] },
  { ids: [101, 102, 103, 104, 105, 106, 107], order: [2, 5, 0, 6, 4, 1, 3],
    stats: ["MDMG", "INT", "CRT", "DET", "DHT", "SPS", "TEN"],
    bonuses: [[{ coordinate: 1, base: 37, numerator: 1, denominator: 10, cap: 83 },
      { coordinate: 2, base: 19, numerator: 1, denominator: 4, cap: 29 }],
    [{ coordinate: 3, base: 17, numerator: 1, denominator: 10, cap: 53 }]] },
];

function cartesian<T>(slots: readonly (readonly T[])[]): T[][] {
  return slots.reduce<T[][]>((rows, slot) => rows.flatMap((row) => slot.map((value) => [...row, value])), [[]]);
}

// These rational operations and the raw/food construction deliberately do not
// call the shared-search attribute, score or legality implementations.
const compare = (a: Rational, b: Rational) => a.numerator * b.denominator - b.numerator * a.denominator;
const add = (a: Rational, b: Rational): Rational => ({ numerator: a.numerator * b.denominator + b.numerator * a.denominator,
  denominator: a.denominator * b.denominator });

function oracleAttributes(job: number, selection: readonly EquipInfo[], foodIndex: number): number[] {
  const schema = schemas[job]!;
  const logical = new Array<number>(7).fill(0);
  for (const equipment of selection) for (const { baseParamId, value } of equipment.baseParams) logical[baseParamId - 1]! += value;
  for (const bonus of schema.bonuses[foodIndex]!) {
    const increase = (BigInt(logical[bonus.coordinate]!) + BigInt(bonus.base)) * BigInt(bonus.numerator) / BigInt(bonus.denominator);
    logical[bonus.coordinate]! += Number(increase < BigInt(bonus.cap) ? increase : BigInt(bonus.cap));
  }
  return schema.order.map((coordinate) => logical[coordinate]!);
}

function oracleValue(context: JobContext, job: number, selection: readonly EquipInfo[], foodIndex: number, objective: Objective): Rational | undefined {
  const attributes = oracleAttributes(job, selection, foodIndex);
  const factors = context.factorEvaluator(attributes)!;
  const speed = attributes[schemas[job]!.order.indexOf(5)]!;
  const constraints = context.constraints!;
  if (speed < constraints.speedMin! || speed > constraints.speedMax!) return undefined;
  const rings = selection.filter(({ ringSlotIndex }) => ringSlotIndex !== undefined);
  if (rings.length === 2 && rings[0]!.itemId === rings[1]!.itemId && (rings[0]!.isUnique || rings[1]!.isUnique)) return undefined;
  const product = [factors.weaponDamage, factors.mainStat, factors.determination, factors.tenacity, factors.critical, factors.directHit]
    .reduce((value, factor) => value * BigInt(factor), 1n);
  return { numerator: product, denominator: objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n };
}

function compatibilityFixture(objective: Objective) {
  const shared = [equip(10, [0, 0, 0, 600, 0, 0, 0]), equip(11, [0, 0, 600, 0, 0, 100, 0]),
    equip(12, [0, 200, 50, 0, 0, 100, 0])];
  const contexts = schemas.map((schema, job) => {
    const main = job === 0 ? 3000 : 600;
    const weapons = [equip(20 + job * 10, [1000, main, 100, 200, 100, job === 0 ? 0 : 100, 0]),
      equip(21 + job * 10, [1, main, 100, 200, 100, job === 0 ? 100 : 0, 0]),
      equip(22 + job * 10, [980, main + 50, 150, 180, 120, job === 0 ? 20 : 80, 0])];
    const context = contextFor([shared, weapons], ["body", "weapon"], job === 0 ? "SAM" : "BLU");
    const actualJob = job === 0 ? "SAM" : "BLU";
    const level = job === 0 ? 100 : 80;
    const attributeIds = schema.order.map((coordinate) => schema.ids[coordinate]!);
    const statIndexes = new Map(schema.stats.map((stat, coordinate) => [stat, schema.order.indexOf(coordinate)]));
    const foods: FoodInfo[] = schema.bonuses.map((bonuses, foodIndex) => ({ itemId: 60 + foodIndex, key: String(60 + foodIndex), itemLevel: 795,
      baseParams: bonuses.map((bonus) => ({ baseParamId: schema.ids[bonus.coordinate]!, baseValue: bonus.base,
        multiplier: 1 + bonus.numerator / bonus.denominator, maxValue: bonus.cap })) }));
    context.job.options = { ...context.job.options, job: actualJob, jobLevel: level, objective, attributeIds, statIndexes, foods,
      speedAttributeId: schema.ids[5], toughnessAttributeId: schema.ids[6],
      equipmentAttributeExtractor: (equipment) => equipment.baseParams.map(({ baseParamId, value }) => ({ baseParamId: schema.ids[baseParamId - 1]!, value })),
      evaluationFunction: createDamageGcdVectorEvaluator(actualJob, level, statIndexes) };
    context.factorEvaluator = createIntegerDamageFactorEvaluator(actualJob, level, statIndexes);
    context.attributeIndexes = new Map(attributeIds.map((id, index) => [id, index]));
    context.equipAttributes = new WeakMap();
    context.constraints = { speedMin: 100, speedMax: 120 };
    context.job.options.constraints = context.constraints;
    return context;
  });
  const baselines = contexts.map((context, job) => {
    let winner: { selection: EquipInfo[]; foodIndex: number; value: Rational } | undefined;
    for (const selection of cartesian(context.solverSlots)) for (let foodIndex = 0; foodIndex < context.job.options.foods.length; foodIndex++) {
      const value = oracleValue(context, job, selection, foodIndex, objective);
      if (value && (!winner || compare(value, winner.value) > 0n)) winner = { selection, foodIndex, value };
    }
    expect(winner).toBeDefined();
    context.optimum = resultFor(context, winner!.selection, context.job.options.foods[winner!.foodIndex]);
    context.optimumProduct = winner!.value.numerator;
    context.optimumGcd = context.factorEvaluator(oracleAttributes(job, winner!.selection, winner!.foodIndex))!.gcdCentiseconds;
    return winner!.value;
  });
  const commonChoicesByName = new Map<string, CommonChoice[]>([["body", shared.map((equipment) => ({ key: equipmentIdentity(equipment),
    equipments: new Map(contexts.map((context) => [context.job.id, equipment])) }))]]);
  const foodChoices: FoodChoice[] = [0, 1].map((index) => ({ key: String(60 + index),
    foods: new Map(contexts.map((context) => [context.job.id, context.job.options.foods[index]])) }));
  const options = { ...optionsFor(contexts), commonSlots: ["body"], foodStrategy: "shared" as const, objective };
  const input = { options, contexts, commonChoicesByName, foodChoices, projections: new Map(), assertWithinBudget: (_stage: string) => {},
    remainingTimeLimit: () => undefined, limits: { maxElapsedMs: 10000, maxSeedMs: 0, maxTransitions: 1_000_000 } };
  const score = (selections: readonly (readonly EquipInfo[])[], foodIndex: number): Rational | undefined => {
    let total: Rational = { numerator: 0n, denominator: 1n };
    for (let job = 0; job < contexts.length; job++) {
      const value = oracleValue(contexts[job]!, job, selections[job]!, foodIndex, objective);
      if (!value) return undefined;
      const baseline = baselines[job]!;
      total = add(total, { numerator: value.numerator * baseline.denominator, denominator: value.denominator * baseline.numerator });
    }
    return total;
  };
  let expected: Rational = { numerator: 0n, denominator: 1n };
  let witnesses = 0;
  for (const selections of cartesian(contexts.map((context) => cartesian(context.solverSlots)))) {
    if (equipmentIdentity(selections[0]![0]!) !== equipmentIdentity(selections[1]![0]!)) continue;
    for (let foodIndex = 0; foodIndex < foodChoices.length; foodIndex++) {
      const value = score(selections, foodIndex);
      if (value) { witnesses++; if (compare(value, expected) > 0n) expected = value; }
    }
  }
  expect(witnesses).toBeGreaterThan(0);
  // Opposing strong private-weapon speed requirements prevent a seed ceiling.
  expect(compare(expected, { numerator: 2n, denominator: 1n })).toBeLessThan(0n);
  return { input, expected, score };
}

describe("shared-state compatibility across canonical job schemas", () => {
  test.each(["damage", "dps"] as const)("BLU auxiliary and job-specific foods/index order match a complete Cartesian %s oracle", async (objective) => {
    const { input, expected, score } = compatibilityFixture(objective);
    const blu = input.contexts[1]!;
    const prepared = await prepareExactMipModel(blu.job.options);
    expect(prepared).toBeDefined();
    const mainClasses = prepared!.groups.find(({ name }) => name === "main")!.classes;
    expect(new Set(mainClasses.map(({ auxiliary }) => auxiliary)).size).toBeGreaterThan(1);
    const zeroWeapon = blu.factorEvaluator(new Array<number>(7).fill(0))!.weaponDamage;
    for (const selection of cartesian(blu.solverSlots)) for (let foodIndex = 0; foodIndex < 2; foodIndex++) {
      const attributes = oracleAttributes(1, selection, foodIndex);
      const intelligence = attributes[schemas[1]!.order.indexOf(1)]!;
      const rawWeapon = attributes[schemas[1]!.order.indexOf(0)]!;
      const factors = blu.factorEvaluator(attributes)!;
      const auxiliary = blueMageWeaponDamageAddition(intelligence) - blueMageWeaponDamageAddition(0);
      expect(factors.weaponDamage).toBe(zeroWeapon + rawWeapon + auxiliary);
      const mainClass = mainClasses.find(({ min, max }) => min <= intelligence && intelligence <= max)!;
      expect(mainClass.auxiliary).toBe(auxiliary);
      expect(prepared!.factorEvaluator(attributes)).toEqual(factors);
    }
    expect(input.contexts[0]!.job.options.attributeIds).not.toEqual(blu.job.options.attributeIds);
    expect(input.foodChoices[0]!.foods.get("SAM")!.baseParams).not.toEqual(input.foodChoices[0]!.foods.get("BLU")!.baseParams);
    // Exercise the lower-level canonical contexts; this does not assert that
    // product-level job selection permits a mixed BLU party.
    const result = await findBestSharedStateLoadout(input);
    expect(result.status, result.statistics.reason).toBe("complete-feasible");
    expect(result.statistics.termination).toBe("enumeration");
    expect(result.statistics.sharedVectorClasses).toBe(2);
    expect(result.statistics.resourceSupports).toBeGreaterThan(0);
    const foodIndex = input.contexts[0]!.job.options.foods.indexOf(result.results![0]!.food!);
    for (let job = 0; job < input.contexts.length; job++) {
      expect(result.results![job]!.food).toBe(input.contexts[job]!.job.options.foods[foodIndex]);
      result.results![job]!.selection.forEach((equipment, slot) => expect(input.contexts[job]!.solverSlots[slot]).toContain(equipment));
    }
    expect(compare(score(result.results!.map(({ selection }) => selection), foodIndex)!, expected)).toBe(0n);
  });

  test.each([1, 2])("propagates AbortError at post-resource checkpoint %i without swallowing it as an optional budget", async (checkpointAfterLastPartition) => {
    const original = resourceBudget.preparePartitionedFactorResourceBudgetUpperBound;
    const partition = vi.spyOn(resourceBudget, "preparePartitionedFactorResourceBudgetUpperBound");
    try {
      const reference = compatibilityFixture("dps");
      const complete = await findBestSharedStateLoadout(reference.input);
      expect(complete.statistics.termination).toBe("enumeration");
      const totalPreparations = partition.mock.calls.length;
      expect(totalPreparations).toBeGreaterThan(0);
      partition.mockClear();
      // Keep the genuine certificate helper. Only observe its final invocation;
      // the first forced check follows resource preparation and the next forced
      // check begins enumeration, with no wall-clock assumptions.
      partition.mockRestore();
      let preparations = 0;
      let afterLast = 0;
      const observe = vi.spyOn(resourceBudget, "preparePartitionedFactorResourceBudgetUpperBound").mockImplementation((...args) => {
        const result = original(...args);
        preparations++;
        return result;
      });
      const cancelled = compatibilityFixture("dps");
      const abort = Object.assign(new Error("cancelled after resource preparation"), { name: "AbortError" });
      cancelled.input.assertWithinBudget = () => {
        if (preparations === totalPreparations && ++afterLast === checkpointAfterLastPartition) throw abort;
      };
      try {
        await expect(findBestSharedStateLoadout(cancelled.input)).rejects.toBe(abort);
        expect(preparations).toBe(totalPreparations);
        expect(afterLast).toBe(checkpointAfterLastPartition);
      } finally { observe.mockRestore(); }
    } finally { partition.mockRestore(); }
  });
});
