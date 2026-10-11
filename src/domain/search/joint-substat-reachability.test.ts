import { describe, expect, test } from "vitest";
import {
  buildJointSubstatReachabilitySupports,
  type JointSubstatConditionalExtrema,
  type JointSubstatReachabilityInput,
} from "./joint-substat-reachability.ts";
import type { FoodParam } from "./types.ts";

const food0: FoodParam[] = [
  { baseParamId: 11, multiplier: 1.5, maxValue: 2 },
  { baseParamId: 12, multiplier: 1.5, maxValue: 2, baseValue: 1 },
];
const food1: FoodParam[] = [
  { baseParamId: 11, multiplier: 1.25, maxValue: 1, baseValue: 1 },
  { baseParamId: 12, multiplier: 1.25, maxValue: 3 },
];

function makeFoodInput(): JointSubstatReachabilityInput {
  return {
    equipmentAttributes: [
      [[1, 4], [3, 2]],
      [[0, 1], [2, 2]],
    ],
    attributeIds: [11, 12],
    crtAttribute: 0,
    dhtAttribute: 1,
    crtClasses: [
      { min: 1, max: 4, variable: "crt_class_0" },
      { min: 5, max: 7, variable: "crt_class_1" },
    ],
    dhtClasses: [
      { min: 3, max: 5, variable: "dht_class_0" },
      { min: 6, max: 8, variable: "dht_class_1" },
    ],
    foods: [{ baseParams: food0 }, { baseParams: food1 }],
    foodBonuses: [
      { foodIndex: 0, attribute: 0, numerator: 1, denominator: 2, cap: 2, maximumRaw: 5 },
      { foodIndex: 0, attribute: 1, numerator: 1, denominator: 2, cap: 2, maximumRaw: 7 },
      { foodIndex: 1, attribute: 0, numerator: 1, denominator: 4, cap: 1, maximumRaw: 6 },
      { foodIndex: 1, attribute: 1, numerator: 1, denominator: 4, cap: 3, maximumRaw: 6 },
    ],
    rawMaximums: [5, 6],
    crtFinalVariable: "final_crt",
    dhtFinalVariable: "final_dht",
    crtGlobalMinimum: 1,
    crtGlobalMaximum: 7,
    dhtGlobalMinimum: 3,
    dhtGlobalMaximum: 8,
  };
}

function foodBonus(raw: number, param: FoodParam | undefined): number {
  if (param === undefined || param.maxValue <= 0 || param.multiplier <= 1) return 0;
  return Math.min(param.maxValue, Math.floor(((raw + (param.baseValue ?? 0)) * (param.multiplier - 1)) + 1e-7));
}

function legalCombinations(input: JointSubstatReachabilityInput) {
  const foods = input.foods.length === 0 ? [undefined] : input.foods;
  const results: { crt: number; dht: number }[] = [];
  for (const first of input.equipmentAttributes[0]!) {
    for (const second of input.equipmentAttributes[1]!) {
      const rawCrt = first[input.crtAttribute]! + second[input.crtAttribute]!;
      const rawDht = first[input.dhtAttribute]! + second[input.dhtAttribute]!;
      for (const food of foods) {
        const crtParam = food?.baseParams.find((param) => param.baseParamId === input.attributeIds[input.crtAttribute]);
        const dhtParam = food?.baseParams.find((param) => param.baseParamId === input.attributeIds[input.dhtAttribute]);
        results.push({
          crt: rawCrt + foodBonus(rawCrt, crtParam),
          dht: rawDht + foodBonus(rawDht, dhtParam),
        });
      }
    }
  }
  return results;
}

function expectedConditionals(
  combinations: readonly { crt: number; dht: number }[],
  classes: JointSubstatReachabilityInput["crtClasses"],
  indexed: "crt" | "dht",
): JointSubstatConditionalExtrema[] {
  return classes.flatMap((factorClass) => {
    const values = combinations
      .filter((entry) => entry[indexed] >= factorClass.min && entry[indexed] <= factorClass.max)
      .map((entry) => entry[indexed === "crt" ? "dht" : "crt"]);
    return values.length === 0 ? [] : [{
      classVariable: factorClass.variable,
      classMin: factorClass.min,
      classMax: factorClass.max,
      otherMin: Math.min(...values),
      otherMax: Math.max(...values),
    }];
  });
}

function classSelectors(
  value: number,
  classes: JointSubstatReachabilityInput["crtClasses"],
): Map<string, number> {
  return new Map(classes.map((factorClass) => [
    factorClass.variable,
    Number(value >= factorClass.min && value <= factorClass.max),
  ]));
}

describe("joint CRT/DHT conditional reachability supports", () => {
  test("matches an exhaustive oracle across multiple foods with exact floors and caps", () => {
    const input = makeFoodInput();
    const result = buildJointSubstatReachabilitySupports(input);
    const combinations = legalCombinations(input);
    expect(result.diagnostics.skippedReason).toBeUndefined();
    expect(result.crtConditionals).toEqual(expectedConditionals(combinations, input.crtClasses, "crt"));
    expect(result.dhtConditionals).toEqual(expectedConditionals(combinations, input.dhtClasses, "dht"));
    expect(result.diagnostics.foodEvaluations).toBeGreaterThan(0);
    expect(result.rows.some((row) => row.sense === "<=" && row.name.endsWith("_upper"))).toBe(true);
    expect(result.rows.some((row) => row.sense === ">=" && row.name.endsWith("_lower"))).toBe(true);

    for (const combination of combinations) {
      const values = new Map<string, number>([
        [input.crtFinalVariable, combination.crt],
        [input.dhtFinalVariable, combination.dht],
        ...classSelectors(combination.crt, input.crtClasses),
        ...classSelectors(combination.dht, input.dhtClasses),
      ]);
      for (const row of result.rows) {
        const lhs = row.terms.reduce((sum, [name, coefficient]) => sum + values.get(name)! * coefficient, 0);
        expect(row.sense === "<=" ? lhs <= row.rhs : lhs >= row.rhs).toBe(true);
      }
    }
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test("keeps repeated unique-ring pairs in the DP superset while every legal pair satisfies the rows", () => {
    const input: JointSubstatReachabilityInput = {
      equipmentAttributes: [
        [[1, 10], [5, 0]],
        [[1, 10], [3, 0]],
      ],
      attributeIds: [11, 12],
      crtAttribute: 0,
      dhtAttribute: 1,
      crtClasses: [
        { min: 2, max: 2, variable: "crt_class_0" },
        { min: 4, max: 8, variable: "crt_class_1" },
      ],
      dhtClasses: [{ min: 0, max: 20, variable: "dht_class_0" }],
      foods: [],
      foodBonuses: [],
      rawMaximums: [8, 20],
      crtFinalVariable: "final_crt",
      dhtFinalVariable: "final_dht",
      crtGlobalMinimum: 2,
      crtGlobalMaximum: 8,
      dhtGlobalMinimum: 0,
      dhtGlobalMaximum: 30,
    };
    const result = buildJointSubstatReachabilitySupports(input);
    const lowCrt = result.crtConditionals.find((entry) => entry.classVariable === "crt_class_0");
    expect(lowCrt).toMatchObject({ otherMin: 20, otherMax: 20 });
    expect(result.rows.length).toBeGreaterThan(0);

    const legalPairs = [
      [input.equipmentAttributes[0]![0]!, input.equipmentAttributes[1]![1]!],
      [input.equipmentAttributes[0]![1]!, input.equipmentAttributes[1]![0]!],
      [input.equipmentAttributes[0]![1]!, input.equipmentAttributes[1]![1]!],
    ];
    expect(legalPairs.some(([first, second]) => first[0] + second[0] === 2 && first[1] + second[1] === 20)).toBe(false);
    for (const [first, second] of legalPairs) {
      const crt = first[0]! + second[0]!;
      const dht = first[1]! + second[1]!;
      const values = new Map<string, number>([
        [input.crtFinalVariable, crt],
        [input.dhtFinalVariable, dht],
        ...classSelectors(crt, input.crtClasses),
        ...classSelectors(dht, input.dhtClasses),
      ]);
      for (const row of result.rows) {
        const lhs = row.terms.reduce((sum, [name, coefficient]) => sum + values.get(name)! * coefficient, 0);
        expect(row.sense === "<=" ? lhs <= row.rhs : lhs >= row.rhs).toBe(true);
      }
    }
  });

  test("adds no rows when a transition budget is exceeded or food metadata is duplicated", () => {
    const input = makeFoodInput();
    const overBudget = buildJointSubstatReachabilitySupports(input, { maxTransitionsPerDirection: 0 });
    expect(overBudget.rows).toEqual([]);
    expect(overBudget.diagnostics.skippedReason).toBe("transition-budget");

    const overWidth = buildJointSubstatReachabilitySupports(input, { maxIndexedWidth: 2 });
    expect(overWidth.rows).toEqual([]);
    expect(overWidth.diagnostics.skippedReason).toBe("indexed-width");

    const overFoodBudget = buildJointSubstatReachabilitySupports(input, { maxFoodEvaluations: 0 });
    expect(overFoodBudget.rows).toEqual([]);
    expect(overFoodBudget.diagnostics.skippedReason).toBe("food-evaluation-budget");

    const complete = buildJointSubstatReachabilitySupports(input);
    const sparse = buildJointSubstatReachabilitySupports(input, { maxConditionalClassesPerDirection: 1 });
    expect(sparse.diagnostics.crtConditionalClasses).toBe(2);
    expect(sparse.diagnostics.dhtConditionalClasses).toBe(2);
    expect(sparse.rows.length).toBeLessThanOrEqual(4);
    expect(sparse.rows.every((row) => complete.rows.some((candidate) => candidate.name === row.name))).toBe(true);
    expect(sparse.diagnostics.rowsAdded).toBe(sparse.rows.length);

    const duplicatedFood = {
      ...input,
      foods: [{ baseParams: [...food0, { ...food0[0]! }] }, { baseParams: food1 }],
    };
    const invalidFood = buildJointSubstatReachabilitySupports(duplicatedFood);
    expect(invalidFood.rows).toEqual([]);
    expect(invalidFood.diagnostics.skippedReason).toBe("invalid-food-metadata");
  });

  test("fails open when a raw-sum transition exceeds safe integer precision", () => {
    const input: JointSubstatReachabilityInput = {
      equipmentAttributes: [[[0, Number.MAX_SAFE_INTEGER]], [[0, 1]]],
      attributeIds: [11, 12],
      crtAttribute: 0,
      dhtAttribute: 1,
      crtClasses: [{ min: 0, max: 0, variable: "crt_class_0" }],
      dhtClasses: [{ min: 0, max: Number.MAX_SAFE_INTEGER, variable: "dht_class_0" }],
      foods: [],
      foodBonuses: [],
      rawMaximums: [0, Number.MAX_SAFE_INTEGER],
      crtFinalVariable: "final_crt",
      dhtFinalVariable: "final_dht",
      crtGlobalMinimum: 0,
      crtGlobalMaximum: 0,
      dhtGlobalMinimum: 0,
      dhtGlobalMaximum: Number.MAX_SAFE_INTEGER,
    };
    const result = buildJointSubstatReachabilitySupports(input);
    expect(result.rows).toEqual([]);
    expect(result.diagnostics.skippedReason).toBe("unsafe-integer");
  });
});
