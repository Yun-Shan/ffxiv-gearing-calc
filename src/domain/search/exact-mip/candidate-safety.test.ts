import { expect, test } from "vitest";
import type { Stat } from "../../types.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
} from "../equipped-effects.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { buildLinearAttributeModel } from "./attribute-model.ts";
import {
  prepareExactMipModel,
  reachableFinalAttributeValues,
} from "./model-preparation.ts";
import {
  maximumFoodBonusTables,
  pruneCandidatesByIncumbentUpperBound,
  candidateUpperBoundAttributeIndexes,
} from "./candidate-bounds.ts";
import { addCandidateLevelConditionalResourceSupports } from "./resource-support.ts";
import { exactProduct } from "./factor-model.ts";
import { sparseMipStart } from "./initial-solution.ts";
import type { ExactMipOptions } from "./types.ts";

const ids = [-1, 1, 2, 3, 4, 5, 6];
const indexes = new Map<Stat, number>([
  ["MDMG", 0],
  ["INT", 1],
  ["CRT", 2],
  ["DET", 3],
  ["DHT", 4],
  ["SPS", 5],
  ["TEN", 6],
]);
function equipment(itemId: number, level: number, values: number[]): EquipInfo {
  return {
    itemId,
    itemLevel: level,
    key: String(itemId),
    PDMG: 0,
    MDMG: values[0]!,
    DLY: 0,
    baseParams: ids.map((baseParamId, index) => ({
      baseParamId,
      value: values[index]!,
    })),
  };
}
function fixture(): ExactMipOptions {
  return markCanonicalEvaluatorCandidateUpperBound({
    job: "RDM",
    jobLevel: 100,
    attributeIds: ids,
    statIndexes: indexes,
    slots: [
      [
        equipment(1, 795, [150, 500, 100, 90, 80, 0, 0]),
        equipment(2, 715, [140, 300, 40, 30, 20, 0, 0]),
      ],
      [
        equipment(3, 795, [0, 100, 60, 50, 40, 0, 0]),
        equipment(4, 715, [0, 70, 30, 20, 10, 0, 0]),
      ],
    ],
    foods: [],
    objective: "damage",
    candidateItemLevelRanges: [{ min: 790, max: 795 }],
    evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, indexes),
  });
}
const factorEvaluator = createIntegerDamageFactorEvaluator("RDM", 100, indexes);
const vector = (selection: readonly EquipInfo[]) =>
  ids.map((id) =>
    selection.reduce(
      (sum, gear) =>
        sum +
        gear.baseParams
          .filter((param) => param.baseParamId === id)
          .reduce((subtotal, param) => subtotal + param.value, 0),
      0,
    ),
  );
const combinations = (options: ExactMipOptions) =>
  options.slots[0]!.flatMap((a) => options.slots[1]!.map((b) => [a, b]));

test("incumbent candidate pruning retains every exact optimum in a complete small domain", () => {
  const options = fixture();
  const model = buildLinearAttributeModel(options)!;
  const choices = combinations(options);
  const score = (selection: readonly EquipInfo[]) =>
    exactProduct(factorEvaluator(vector(selection))!);
  const bestScore = choices.map(score).reduce((a, b) => (a > b ? a : b));
  const selection = choices.find((choice) => score(choice) === bestScore)!;
  const pruned = pruneCandidatesByIncumbentUpperBound(
    options,
    model,
    factorEvaluator,
    false,
    { hint: new Map(), selection, food: undefined },
    Infinity,
    () => false,
  )!;
  expect(pruned.candidatesAfter).toBeLessThan(pruned.candidatesBefore);
  for (const optimum of choices.filter(
    (choice) => score(choice) === bestScore,
  )) {
    optimum.forEach((candidate, slot) =>
      expect(pruned.slots[slot]).toContain(candidate),
    );
  }
  expect(
    combinations({ ...options, slots: pruned.slots }).map(score),
  ).toContain(bestScore);
  // A lost trusted identity or cancellation must abandon preprocessing entirely.
  expect(
    pruneCandidatesByIncumbentUpperBound(
      { ...options },
      model,
      factorEvaluator,
      false,
      { hint: new Map(), selection, food: undefined },
      Infinity,
      () => false,
    ),
  ).toBeUndefined();
  expect(
    pruneCandidatesByIncumbentUpperBound(
      options,
      model,
      factorEvaluator,
      false,
      { hint: new Map(), selection, food: undefined },
      Infinity,
      () => true,
    ),
  ).toBeUndefined();
});

test.each(["balanced", "compact", "compact-weighted"] as const)(
  "%s resource rows preserve every feasible assignment",
  async (profile) => {
    const options = fixture();
    options.candidateResourceSupportProfile = profile;
    const prepared = (await prepareExactMipModel(options))!;
    const { model, groups } = prepared;
    const axes = new Map<string, number | undefined>([
      ["main", prepared.mainAttribute],
      ["weapon", prepared.weaponAttribute],
      ["det", prepared.detAttribute],
      ["crt", prepared.crtAttribute],
      ["dht", prepared.dhtAttribute],
      ["gcd", prepared.speedAttribute],
      ["ten", prepared.tenAttribute],
    ]);
    const rowsBefore = model.rows.length;
    const stats = addCandidateLevelConditionalResourceSupports(
      options,
      model,
      groups,
      [],
      axes,
    )!;
    expect(stats.rowsAdded).toBeGreaterThan(0);
    const rows = model.rows.slice(rowsBefore);
    for (const selection of combinations(options)) {
      const values = vector(selection);
      const assignment = new Map<string, number>();
      selection.forEach((candidate, slot) =>
        assignment.set(
          model.slotVariables[slot]![options.slots[slot]!.indexOf(candidate)]!,
          1,
        ),
      );
      for (const group of groups) {
        const attribute = axes.get(group.name);
        if (attribute === undefined) continue;
        const factorClass = group.classes.find(
          (entry) =>
            entry.min <= values[attribute]! && entry.max >= values[attribute]!,
        );
        expect(factorClass, group.name).toBeDefined();
        assignment.set(factorClass!.variable, 1);
      }
      for (const row of rows) {
        const lhs = [...row.terms].reduce(
          (sum, [name, coefficient]) =>
            sum + BigInt(coefficient) * BigInt(assignment.get(name) ?? 0),
          0n,
        );
        expect(lhs, row.name).toBeLessThanOrEqual(BigInt(row.rhs));
      }
    }
  },
);

test("food upper tables use every food and fail conservatively for ambiguous parameters", () => {
  const options = fixture();
  const food: FoodInfo = {
    itemId: 10,
    itemLevel: 795,
    key: "food-10",
    baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 50 }],
  };
  options.foods = [
    food,
    {
      itemId: 11,
      itemLevel: 795,
      key: "food-11",
      baseParams: [
        { baseParamId: 1, baseValue: 10, multiplier: 1.05, maxValue: 60 },
      ],
    },
  ];
  const model = buildLinearAttributeModel(options)!;
  const table = maximumFoodBonusTables(
    options,
    model,
    [1],
    Infinity,
    () => false,
  )!.get(1)!;
  for (let raw = 0; raw <= model.rawMaximums[1]!; raw++) {
    expect(table[raw]).toBe(
      Math.max(
        Math.min(50, Math.floor(raw / 10)),
        Math.min(60, Math.floor((raw + 10) / 20)),
      ),
    );
  }
  expect(
    maximumFoodBonusTables(options, model, [1], Infinity, () => true),
  ).toBeUndefined();
  expect(
    maximumFoodBonusTables(options, model, [1], -Infinity, () => false),
  ).toBeUndefined();
  options.foods = [
    { ...food, baseParams: [...food.baseParams, ...food.baseParams] },
  ];
  expect(
    maximumFoodBonusTables(options, model, [1], Infinity, () => false),
  ).toBeUndefined();
});

test.each([
  { multiplier: NaN, maxValue: 10 },
  { multiplier: 0.9, maxValue: 10 },
  { multiplier: 1.1, maxValue: -1 },
  { multiplier: 1.1, maxValue: 1.5 },
  { multiplier: 1.1, maxValue: 10, baseValue: -1 },
  { multiplier: 1.003, maxValue: 10 },
])("food bound rejects unsupported arithmetic: %j", (parameter) => {
  const options = fixture();
  const model = buildLinearAttributeModel(options)!;
  options.foods = [
    {
      itemId: 10,
      itemLevel: 795,
      key: "food-10",
      baseParams: [{ baseParamId: 1, ...parameter }],
    },
  ];
  expect(
    maximumFoodBonusTables(options, model, [1], Infinity, () => false),
  ).toBeUndefined();
});

test("missing required coordinates disable a bound; optional absent stats remain usable", () => {
  const options = fixture();
  const model = buildLinearAttributeModel(options)!;
  expect(
    candidateUpperBoundAttributeIndexes(
      { ...options, statIndexes: new Map([["INT", 1]]) },
      model,
    ),
  ).toBeUndefined();
  expect(
    candidateUpperBoundAttributeIndexes(
      {
        ...options,
        statIndexes: new Map([
          ["INT", 1],
          ["MDMG", 0],
          ["SPS", 5],
        ]),
      },
      model,
    ),
  ).toEqual([1, 0, 5]);
  expect(
    candidateUpperBoundAttributeIndexes(options, {
      ...model,
      idToIndex: new Map(),
    }),
  ).toBeUndefined();
});

test("reachability is exact for a small domain and declines ambiguous or excessive domains", () => {
  const options = fixture();
  const model = buildLinearAttributeModel(options)!;
  expect(reachableFinalAttributeValues(options, model, 1)).toEqual(
    [
      ...new Set(combinations(options).map((choice) => vector(choice)[1]!)),
    ].sort((a, b) => a - b),
  );
  expect(
    reachableFinalAttributeValues(
      options,
      { ...model, fixedEquipmentAttributes: [[]] },
      1,
    ),
  ).toBeUndefined();
  expect(
    reachableFinalAttributeValues(
      options,
      {
        ...model,
        fixedEquipmentAttributes: [
          [
            [0, 0],
            [0, 200_001],
          ],
        ],
      },
      1,
    ),
  ).toBeUndefined();
  expect(
    reachableFinalAttributeValues(
      options,
      { ...model, fixedEquipmentAttributes: [[[0, 1.5]]] },
      1,
    ),
  ).toBeUndefined();
  const parameter = { baseParamId: 1, multiplier: 1.1, maxValue: 10 };
  expect(
    reachableFinalAttributeValues(
      {
        ...options,
        foods: [
          {
            itemId: 10,
            itemLevel: 795,
            key: "food-10",
            baseParams: [parameter, parameter],
          },
        ],
      },
      model,
      1,
    ),
  ).toBeUndefined();
});

test("sparse starts preserve candidate identity and reject invalid food or duplicate unique rings", () => {
  const options = fixture();
  const first = options.slots[0]![0]!;
  const food: FoodInfo = {
    itemId: 20,
    itemLevel: 795,
    key: "food-20",
    baseParams: [],
  };
  expect(
    sparseMipStart([[first]], [], [["x"]], [], [first], undefined),
  ).toEqual(new Map([["x", 1]]));
  expect(
    sparseMipStart([[first]], [], [["x"]], [], [{ ...first }], undefined),
  ).toBeUndefined();
  expect(
    sparseMipStart([[first]], [food], [["x"]], ["f"], [first], undefined),
  ).toBeUndefined();
  expect(
    sparseMipStart([[first]], [], [["x"]], [], [first], food),
  ).toBeUndefined();
  const ring = { ...first, ringSlotIndex: 0 as const, isUnique: true };
  expect(
    sparseMipStart(
      [[ring], [ring]],
      [],
      [["x"], ["y"]],
      [],
      [ring, ring],
      undefined,
    ),
  ).toBeUndefined();
});
