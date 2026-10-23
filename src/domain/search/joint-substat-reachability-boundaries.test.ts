import { describe, expect, test } from "vitest";
import {
  buildJointSubstatReachabilitySupports,
  type JointSubstatReachabilityInput,
} from "./joint-substat-reachability.ts";

function inputFor(
  overrides: Partial<JointSubstatReachabilityInput> = {},
): JointSubstatReachabilityInput {
  return {
    equipmentAttributes: [
      [
        [0, 4],
        [4, 0],
      ],
      [
        [0, 0],
        [1, 1],
      ],
    ],
    attributeIds: [11, 12],
    crtAttribute: 0,
    dhtAttribute: 1,
    crtClasses: [
      { min: 0, max: 2, variable: "crt0" },
      { min: 3, max: 6, variable: "crt1" },
    ],
    dhtClasses: [
      { min: 0, max: 2, variable: "dht0" },
      { min: 3, max: 6, variable: "dht1" },
    ],
    foods: [],
    foodBonuses: [],
    rawMaximums: [5, 5],
    crtFinalVariable: "crt",
    dhtFinalVariable: "dht",
    crtGlobalMinimum: 0,
    crtGlobalMaximum: 6,
    dhtGlobalMinimum: 0,
    dhtGlobalMaximum: 6,
    ...overrides,
  };
}

function foodInput(): JointSubstatReachabilityInput {
  return inputFor({
    foods: [
      { baseParams: [{ baseParamId: 11, multiplier: 1.2, maxValue: 2 }] },
    ],
    foodBonuses: [
      {
        foodIndex: 0,
        attribute: 0,
        numerator: 1,
        denominator: 5,
        cap: 2,
        maximumRaw: 5,
      },
    ],
  });
}

function expectFallback(input: JointSubstatReachabilityInput, reason: string) {
  const result = buildJointSubstatReachabilitySupports(input);
  expect(result.rows).toEqual([]);
  expect(result.crtConditionals).toEqual([]);
  expect(result.dhtConditionals).toEqual([]);
  expect(result.diagnostics.skippedReason).toBe(reason);
}

describe("optional substat supports fail open on untrusted metadata", () => {
  test.each([
    { crtAttribute: 1 },
    { crtClasses: [] },
    { crtClasses: [{ min: 2, max: 1, variable: "bad" }] },
    { crtClasses: [{ min: 0, max: 2, variable: "" }] },
    {
      crtClasses: [
        { min: 0, max: 2, variable: "a" },
        { min: 2, max: 4, variable: "b" },
      ],
    },
  ])(
    "missing or overlapping factor axis creates no pruning rows: %j",
    (overrides) => expectFallback(inputFor(overrides), "missing-axis"),
  );

  test.each([
    { crtAttribute: -1 },
    { crtAttribute: 0.5 },
    { dhtAttribute: 9 },
    { crtGlobalMinimum: 9 },
    { dhtGlobalMaximum: -1 },
    { crtFinalVariable: "" },
  ])(
    "invalid final variable or range creates no pruning rows: %j",
    (overrides) => expectFallback(inputFor(overrides), "invalid-input"),
  );

  test.each([
    { foodIndex: -1 },
    { foodIndex: 1 },
    { attribute: 0.5 },
    { numerator: 0 },
    { denominator: 0 },
    { cap: -1 },
    { maximumRaw: -1 },
  ])(
    "invalid food model coefficient creates no pruning rows: %j",
    (overrides) => {
      const input = foodInput();
      input.foodBonuses = [{ ...input.foodBonuses[0]!, ...overrides }];
      expectFallback(input, "invalid-food-metadata");
    },
  );

  test("duplicate food axis metadata and missing raw maxima cannot strengthen the model", () => {
    const input = foodInput();
    expectFallback(
      { ...input, foodBonuses: [...input.foodBonuses, input.foodBonuses[0]!] },
      "invalid-food-metadata",
    );
    expectFallback({ ...input, rawMaximums: [] }, "invalid-food-metadata");
    expectFallback(
      { ...input, attributeIds: [11.5, 12] },
      "invalid-food-metadata",
    );
    expectFallback(
      { ...input, foods: [{ baseParams: [] }] },
      "invalid-food-metadata",
    );
  });

  test.each([
    { baseValue: -1 },
    { multiplier: Number.POSITIVE_INFINITY },
    { multiplier: -1 },
    { maxValue: -1 },
    { multiplier: 1.001 },
    { multiplier: 1 },
    { maxValue: 0 },
  ])(
    "food formula mismatches are discarded conservatively: %j",
    (overrides) => {
      const input = foodInput();
      input.foods = [
        { baseParams: [{ ...input.foods[0]!.baseParams[0]!, ...overrides }] },
      ];
      expectFallback(input, "invalid-food-metadata");
    },
  );

  test.each([{ cap: 3 }, { numerator: 2 }, { maximumRaw: 6 }])(
    "food model must agree with the canonical formula: %j",
    (overrides) => {
      const input = foodInput();
      input.foodBonuses = [{ ...input.foodBonuses[0]!, ...overrides }];
      expectFallback(input, "invalid-food-metadata");
    },
  );

  test("irrelevant food coefficients are ignored and zero-effect foods agree with no-food enumeration", () => {
    const baseline = buildJointSubstatReachabilitySupports(inputFor());
    const input = inputFor({
      foods: [
        {
          baseParams: [
            { baseParamId: 11, baseValue: 99, multiplier: 1, maxValue: 5 },
            { baseParamId: 12, multiplier: 1.2, maxValue: 0 },
          ],
        },
      ],
      foodBonuses: [
        {
          foodIndex: 0,
          attribute: 99,
          numerator: 1,
          denominator: 10,
          cap: 1,
          maximumRaw: 99,
        },
      ],
    });
    const actual = buildJointSubstatReachabilitySupports(input);
    expect(actual.diagnostics.skippedReason).toBeUndefined();
    expect(actual.rows).toEqual(baseline.rows);
    expect(actual.crtConditionals).toEqual(baseline.crtConditionals);
    expect(actual.dhtConditionals).toEqual(baseline.dhtConditionals);
    expect(
      buildJointSubstatReachabilitySupports(input, {
        maxTransitionsPerDirection: Number.NaN,
      }).rows,
    ).toEqual(baseline.rows);
  });

  test.each([{ equipmentAttributes: [] }, { equipmentAttributes: [[]] }])(
    "empty candidate domains create no pruning rows: %j",
    ({ equipmentAttributes }) =>
      expectFallback(inputFor({ equipmentAttributes }), "empty-domain"),
  );

  test("invalid or unsafe equipment vectors never produce partial supports", () => {
    expectFallback(
      inputFor({ equipmentAttributes: [[[1.5, 2]]] }),
      "invalid-input",
    );
    expectFallback(inputFor({ equipmentAttributes: [[[1]]] }), "invalid-input");
    expectFallback(
      inputFor({
        equipmentAttributes: [[[Number.MAX_SAFE_INTEGER, 0]], [[1, 0]]],
      }),
      "unsafe-integer",
    );
    expectFallback(
      inputFor({
        equipmentAttributes: [
          [
            [Number.MIN_SAFE_INTEGER, 0],
            [Number.MAX_SAFE_INTEGER, 0],
          ],
        ],
      }),
      "unsafe-integer",
    );
    expectFallback(
      inputFor({ equipmentAttributes: [[[-1, 2]]] }),
      "unsafe-integer",
    );
  });

  test("food addition that exceeds safe integers creates no pruning rows", () => {
    const input = foodInput();
    input.equipmentAttributes = [[[Number.MAX_SAFE_INTEGER, 0]]];
    input.rawMaximums = [Number.MAX_SAFE_INTEGER, 0];
    input.foodBonuses = [
      { ...input.foodBonuses[0]!, maximumRaw: Number.MAX_SAFE_INTEGER },
    ];
    expectFallback(input, "unsafe-integer");
  });

  test("unreachable factor classes add no rows and class ordering still retains both ends", () => {
    const input = inputFor({
      crtClasses: [
        { min: 2, max: 2, variable: "gap" },
        { min: 6, max: 6, variable: "above" },
      ],
      dhtClasses: [{ min: -1, max: -1, variable: "below" }],
    });
    const result = buildJointSubstatReachabilitySupports(input);
    expect(result.diagnostics.skippedReason).toBeUndefined();
    expect(result.rows).toEqual([]);
    expect(result.crtConditionals).toEqual([]);
    expect(result.dhtConditionals).toEqual([]);
  });
});
