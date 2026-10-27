import { describe, expect, test } from "vitest";
import type { ModelRow } from "../core/model-types.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import type { ExactMipOptions } from "./types.ts";
import { buildLinearAttributeModel } from "./attribute-model.ts";
import { prepareSpeedFoodProjection } from "./speed-food-projection.ts";

const equipment = (itemId: number, speed: number): EquipInfo => ({
  itemId, itemLevel: 795, key: String(itemId), PDMG: 0, MDMG: 0, DLY: 0,
  baseParams: [{ baseParamId: 1, value: speed }],
});
const food = (
  itemId: number,
  multiplier = 1,
  maxValue = 0,
  baseValue = 0,
): FoodInfo => ({
  itemId, itemLevel: 795, key: `food-${itemId}`,
  baseParams: multiplier === 1 ? [] : [{ baseParamId: 1, multiplier, maxValue, baseValue }],
});

function fixture(values = [[0, 5, 10], [0, 3]], foods: FoodInfo[] = []) {
  const options: ExactMipOptions = {
    job: "WAR", jobLevel: 100, clanIndex: 0, objective: "damage",
    attributeIds: [1], statIndexes: new Map([["SKS", 0]]), speedAttributeId: 1,
    slots: values.map((slot, index) => slot.map((speed, candidate) =>
      equipment(index * 100 + candidate + 1, speed))),
    foods,
    evaluationFunction: () => ({ damage: 1, gcd: 2.5 }),
  };
  const model = buildLinearAttributeModel(options)!;
  options.constraints = { speedMin: 0 };
  return { options, model };
}

function rowsAccept(rows: readonly ModelRow[], raw: number, selectedFood: number, count: number) {
  const values = new Map([["raw_0", raw]]);
  for (let index = 0; index < count; index++) values.set(`f_${index}`, Number(index === selectedFood));
  return rows.every((row) => {
    const value = [...row.terms].reduce((sum, [name, coefficient]) => sum + coefficient * values.get(name)!, 0);
    return row.sense === "=" ? value === row.rhs : row.sense === "<=" ? value <= row.rhs : value >= row.rhs;
  });
}

describe("food-conditioned speed projection", () => {
  test("adds food-specific raw bounds after compiling disjoint GCD ranges", () => {
    const { options } = fixture([[10, 15, 20]], [food(1), food(2, 2, 5), food(3, 1.1, 1)]);
    options.constraints = { gcdChoices: [2.5, 2.49], speedMax: 20 };
    options.gcdToSpeedRange = (gcd) => gcd === 2.5 ? { min: 10, max: 10 } : { min: 20, max: 20 };
    const model = buildLinearAttributeModel(options)!;
    const projection = model.speedFoodProjection!;
    expect(projection.rawSpeedsByFood).toEqual([[10, 20], [15], []]);
    expect(projection.excludedFoodIndexes).toEqual([2]);
    expect(model.rows.filter(({ name }) => name.startsWith("speed_food_"))).toEqual(projection.rows);
    expect(model.gcdChoiceRanges).toEqual([{ min: 10, max: 10 }, { min: 20, max: 20 }]);
    expect(rowsAccept(projection.rows, 10, 0, 3)).toBe(true);
    expect(rowsAccept(projection.rows, 15, 1, 3)).toBe(true);
    expect(rowsAccept(projection.rows, 15, 2, 3)).toBe(false);
    // The interval projection deliberately leaves this hole for the original GCD model.
    expect(rowsAccept(projection.rows, 15, 0, 3)).toBe(true);
  });

  test("food floor, cap and base value are applied before testing final speed", () => {
    const { options, model } = fixture([[5, 6, 7, 8, 9]], [food(1, 1.25, 2, 3)]);
    options.constraints = { speedMin: 8, speedMax: 10 };
    model.ranges.set(0, { min: 8, max: 10 });
    const projection = prepareSpeedFoodProjection(options, model)!;
    expect(projection.rawSpeedsByFood).toEqual([[6, 7, 8]]);
    expect(rowsAccept(projection.rows, 5, 0, 1)).toBe(false);
    expect(rowsAccept(projection.rows, 8, 0, 1)).toBe(true);
    expect(rowsAccept(projection.rows, 9, 0, 1)).toBe(false);
  });

  test("no-food searches use constant bounds or an exact empty-relaxation contradiction", () => {
    const { options, model } = fixture([[2, 5], [0, 4]]);
    model.ranges.set(0, { min: 4, max: 8 });
    const projection = prepareSpeedFoodProjection(options, model)!;
    expect(projection.rawSpeeds).toEqual([2, 5, 6, 9]);
    expect(projection.rawSpeedsByFood).toEqual([[5, 6]]);
    expect(rowsAccept(projection.rows, 5, 0, 0)).toBe(true);
    expect(rowsAccept(projection.rows, 6, 0, 0)).toBe(true);
    model.ranges.set(0, { min: 7, max: 8 });
    const empty = prepareSpeedFoodProjection(options, model)!;
    expect(empty.rows).toMatchObject([{ name: "speed_food_empty", sense: "=", rhs: 1 }]);
    expect(empty.rows[0]!.terms.size).toBe(0);
  });

  test("keeps every legal single-axis resistance allocation", () => {
    const { options } = fixture([[4]]);
    options.slots[0]![0]!.resistanceWeaponAdjust = {
      stats: ["SKS"], maxEachStat: 5, maxTotalStats: 3,
    };
    options.constraints = { speedMin: 6, speedMax: 6 };
    const model = buildLinearAttributeModel(options)!;
    expect(model.speedFoodProjection!.rawSpeeds).toEqual([4, 5, 6, 7]);
    expect(model.speedFoodProjection!.rawSpeedsByFood).toEqual([[6]]);
  });

  test("ring uniqueness stays in the original model while projection safely relaxes it", () => {
    const { options } = fixture([[10], [10, 5]]);
    options.slots = [
      [{ ...equipment(1, 10), ringSlotIndex: 0, isUnique: true }],
      [
        { ...equipment(1, 10), ringSlotIndex: 1, isUnique: true },
        { ...equipment(2, 5), ringSlotIndex: 1, isUnique: false },
      ],
    ];
    const model = buildLinearAttributeModel(options)!;
    expect(model.speedFoodProjection!.coverage).toBe("slotwise-speed-relaxation");
    expect(model.speedFoodProjection!.rawSpeedsByFood).toEqual([[15, 20]]);
    expect(model.rows.some(({ name }) => name === "unique_ring_item_1")).toBe(true);
    expect(rowsAccept(model.speedFoodProjection!.rows, 15, 0, 0)).toBe(true);
  });

  test("uses the attribute model's extractor result instead of a canonical-job assumption", () => {
    const { options } = fixture([[10, 20]]);
    options.equipmentAttributeExtractor = (item) => [{ baseParamId: 1, value: item.itemId }];
    options.constraints = { speedMin: 2, speedMax: 2 };
    const model = buildLinearAttributeModel(options)!;
    expect(model.speedFoodProjection!.rawSpeedsByFood).toEqual([[2]]);
  });

  test("all small-domain legal witnesses satisfy every projected row", () => {
    let seed = 14731;
    const next = (maximum: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % maximum;
    };
    for (let trial = 0; trial < 60; trial++) {
      const slots = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => next(16)));
      const foods = [food(1), food(2, 1.1, next(6), next(5)), food(3, 1.25, next(8), next(5))];
      const { options, model } = fixture(slots, foods);
      const minimum = next(35);
      const maximum = minimum + next(15);
      model.ranges.set(0, { min: minimum, max: maximum });
      const projection = prepareSpeedFoodProjection(options, model)!;
      const expected = foods.map(() => new Set<number>());
      // This independent Cartesian enumeration uses the existing public food rounding semantics.
      for (const first of slots[0]!) for (const second of slots[1]!) for (const third of slots[2]!) {
        const raw = first + second + third;
        foods.forEach((choice, index) => {
          const parameter = choice.baseParams[0];
          const bonus = parameter === undefined ? 0 : Math.min(parameter.maxValue,
            Math.trunc((raw + (parameter.baseValue ?? 0)) * (parameter.multiplier - 1) + 1e-7));
          const final = raw + bonus;
          if (final < minimum || final > maximum) return;
          expected[index]!.add(raw);
          expect(rowsAccept(projection.rows, raw, index, foods.length)).toBe(true);
        });
      }
      expect(projection.rawSpeedsByFood).toEqual(expected.map((values) => [...values].sort((a, b) => a - b)));
    }
  });

  test.each([
    { maxTransitionWork: 1 }, { maxRawSpan: 1 }, { maxFoodEvaluations: 1 },
    { maxTransitionWork: 0 }, { maxRawSpan: Infinity },
  ])("budget exhaustion keeps all existing rows intact: %j", (limits) => {
    const { options, model } = fixture(undefined, [food(1), food(2)]);
    const before = structuredClone(model.rows);
    expect(prepareSpeedFoodProjection(options, model, limits)).toBeUndefined();
    expect(model.rows).toEqual(before);
  });

  test.each([
    "unmapped-speed", "missing-raw-variable", "wrong-slot-count", "wrong-candidate-count", "empty-slot",
    "wrong-food-count", "unsafe-attribute", "invalid-range", "invalid-choice-range", "duplicate-parameter",
    "duplicate-bonus", "missing-bonus", "invalid-bonus", "invalid-base", "invalid-allocation",
  ] as const)("unproved data abandons the whole projection: %s", (reason) => {
    const { options, model } = fixture(undefined, [food(1, 1.1, 5)]);
    if (reason === "unmapped-speed") model.idToIndex.delete(1);
    if (reason === "missing-raw-variable") model.rawVariables.length = 0;
    if (reason === "wrong-slot-count") model.fixedEquipmentAttributes.pop();
    if (reason === "wrong-candidate-count") model.fixedEquipmentAttributes[0]!.pop();
    if (reason === "empty-slot") {
      model.fixedEquipmentAttributes[0]!.length = 0;
      options.slots = [[], ...options.slots.slice(1)];
    }
    if (reason === "wrong-food-count") model.foodVariables.pop();
    if (reason === "unsafe-attribute") model.fixedEquipmentAttributes[0]![0]![0] = Number.MAX_SAFE_INTEGER;
    if (reason === "invalid-range") model.ranges.set(0, { max: Infinity });
    if (reason === "invalid-choice-range") model.gcdChoiceRanges.push({ min: 10, max: 9 });
    if (reason === "duplicate-parameter") options.foods[0]!.baseParams.push({ ...options.foods[0]!.baseParams[0]! });
    if (reason === "duplicate-bonus") model.foodBonuses.push({ ...model.foodBonuses[0]! });
    if (reason === "missing-bonus") model.foodBonuses.length = 0;
    if (reason === "invalid-bonus") model.foodBonuses[0]!.denominator = 0;
    if (reason === "invalid-base") options.foods[0]!.baseParams[0]!.baseValue = -1;
    if (reason === "invalid-allocation") model.resistanceAllocationVariables.push({
      slotIndex: 0, candidateIndex: 0, attributeIndex: 0, maxValue: -1,
      stat: "SKS", baseParamId: 1, variable: "bad", maxTotalStats: 1,
    });
    const before = structuredClone(model.rows);
    expect(prepareSpeedFoodProjection(options, model)).toBeUndefined();
    expect(model.rows).toEqual(before);
  });

  test("unconstrained speeds avoid preparation and cancellation is never swallowed", () => {
    const { options, model } = fixture();
    options.constraints = undefined;
    expect(prepareSpeedFoodProjection(options, model)).toBeUndefined();
    options.constraints = { speedMin: 0 };
    options.speedAttributeId = undefined;
    expect(prepareSpeedFoodProjection(options, model)).toBeUndefined();
    options.speedAttributeId = 1;
    options.isCancelled = () => true;
    const before = structuredClone(model.rows);
    expect(() => prepareSpeedFoodProjection(options, model)).toThrowError("搜索已取消");
    expect(model.rows).toEqual(before);
    let checks = 0;
    options.isCancelled = () => ++checks >= 4;
    expect(() => prepareSpeedFoodProjection(options, model)).toThrowError("搜索已取消");
    expect(model.rows).toEqual(before);
  });
});
