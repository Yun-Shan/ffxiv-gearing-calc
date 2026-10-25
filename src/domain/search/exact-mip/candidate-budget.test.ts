import { afterEach, describe, expect, test, vi } from "vitest";
import type { EquipInfo, FoodInfo } from "../types.ts";
import type { ExactMipOptions, FactorGroup } from "./types.ts";
import { buildLinearAttributeModel } from "./attribute-model.ts";
import { prepareResourceBudgetCandidateBounds } from "./candidate-bounds.ts";

function fixture() {
  const equipment = (itemId: number, values: number[]): EquipInfo => ({
    itemId,
    itemLevel: 700,
    key: String(itemId),
    PDMG: 0,
    MDMG: 0,
    DLY: 0,
    baseParams: values.map((value, index) => ({
      baseParamId: index + 1,
      value,
    })),
  });
  const options: ExactMipOptions = {
    clanIndex: 0,
    objective: "dps",
    job: "RDM",
    jobLevel: 100,
    attributeIds: [1, 2, 3],
    statIndexes: new Map(),
    slots: [
      [equipment(1, [10, 0, 2]), equipment(2, [0, 10, 2])],
      [equipment(3, [0, 10, 0]), equipment(4, [10, 0, 0])],
    ],
    foods: [],
    candidateItemLevelRanges: [{ min: 790, max: 795 }],
    resourceBudgetCandidateProfile: "weighted",
    evaluationFunction: () => ({ damage: 1, gcd: 2.5 }),
  };
  const groups: FactorGroup[] = [
    ["main", 10, 10],
    ["det", 10, 20],
    ["weapon", 2, 3],
  ].map(([name, min, q]) => ({
    name: String(name),
    classes: [
      { min: 0, max: Number(min) - 1, q: 0, value: 1, variable: `${name}_0` },
      {
        min: Number(min),
        max: Number(min),
        q: Number(q),
        value: 2,
        variable: `${name}_1`,
      },
    ],
  }));
  const model = buildLinearAttributeModel(options)!;
  const axes = new Map<string, number | undefined>([
    ["main", 0],
    ["det", 1],
    ["weapon", 2],
  ]);
  const run = (
    config: {
      cancelled?: () => boolean;
      deadline?: number;
      includeAll?: boolean;
    } = {},
  ) =>
    prepareResourceBudgetCandidateBounds(
      options,
      model,
      groups,
      axes,
      config.deadline ?? Infinity,
      config.cancelled ?? (() => false),
      config.includeAll,
    );
  return { options, model, groups, axes, run };
}

afterEach(() => vi.restoreAllMocks());

describe("candidate resource-budget upper bounds", () => {
  test.each(["weighted", "default"] as const)(
    "%s budgets preserve the exact score of every four-leaf completion",
    (profile) => {
      const { options, model, groups, run } = fixture();
      options.resourceBudgetCandidateProfile = profile;
      const result = run()!;
      expect(result.additionalBudgetCount).toBeGreaterThan(0);
      expect(result.queryBudgets).toHaveLength(
        result.additionalBudgetCount + 1,
      );
      expect(result.supportCount).toBeGreaterThan(result.budget.supportCount);
      expect(result.candidateCount).toBe(4);
      expect(result.queryBudgets[0]!.weights).toEqual([1, 1, 1]);
      for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
          const attributes = model.equipmentAttributes[0]![a]!.map(
            (value, index) => value + model.equipmentAttributes[1]![b]![index]!,
          );
          const score = groups.reduce((sum, group, axis) => {
            // Groups are main, det, weapon: exhaust their legal integer tiers directly.
            const reachable = group.classes.filter(
              ({ min }) => min <= attributes[axis]!,
            );
            return sum + BigInt(Math.max(...reachable.map(({ q }) => q)));
          }, 0n);
          for (const [slot, candidate] of [
            [0, a],
            [1, b],
          ] as const) {
            expect(
              result.bySlot[slot]!.get(options.slots[slot]![candidate]!),
            ).toBeGreaterThanOrEqual(score);
          }
        }
    },
  );

  test("weighted food caps and unpriced groups remain safe", () => {
    const { options, groups, run } = fixture();
    options.foods = [
      {
        itemId: 20,
        itemLevel: 100,
        key: "food",
        baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 3 }],
      },
    ];
    groups.push({
      name: "gcd",
      classes: [{ min: 0, max: 0, q: -7, value: 250, variable: "gcd" }],
    });
    const result = run()!;
    expect(result.additionalBudgetCount).toBeGreaterThan(0);
    expect(
      result.queryBudgets.every(
        ({ attributes }) => attributes.join(":") === "0:2:1",
      ),
    ).toBe(true);
    expect(result.bySlot.every((slot) => slot.size === 2)).toBe(true);
  });

  test("prior ranges limit preparation but includeAll keeps the complete candidate domain", () => {
    const { options, run } = fixture();
    options.candidateItemLevelRanges = [{ min: 700, max: 700 }];
    expect(run()).toBeUndefined();
    expect(run({ includeAll: true })!.candidateCount).toBe(4);
    options.candidateItemLevelRanges = undefined;
    expect(run()!.candidateCount).toBe(4);
    options.candidateItemLevelRanges = [];
    expect(run()!.candidateCount).toBe(4);
    options.slots[0]![0]!.itemLevel = NaN;
    expect(run()!.candidateCount).toBe(3);
  });

  test.each([
    "disabled",
    "no-axes",
    "slot-count",
    "vector-count",
    "empty-slot",
    "negative",
    "fractional",
    "overflow",
    "bad-groups",
  ] as const)("declines an unproved resource model: %s", (reason) => {
    const { options, model, axes, groups, run } = fixture();
    switch (reason) {
      case "disabled":
        options.resourceBudgetCandidateProfile = "disabled";
        break;
      case "no-axes":
        axes.clear();
        break;
      case "slot-count":
        model.equipmentAttributes.pop();
        break;
      case "vector-count":
        model.equipmentAttributes[0]!.pop();
        break;
      case "empty-slot":
        options.slots = [[], options.slots[1]!];
        model.equipmentAttributes[0] = [];
        break;
      case "negative":
        model.equipmentAttributes[0]![0]![0] = -1;
        break;
      case "fractional":
        model.equipmentAttributes[0]![0]![0] = 1.5;
        break;
      case "overflow":
        model.equipmentAttributes[0]![0] = [Number.MAX_SAFE_INTEGER, 1, 0];
        break;
      case "bad-groups":
        groups[0]!.classes = [];
        break;
    }
    expect(run()).toBeUndefined();
  });

  test.each([
    "missing-attribute",
    "duplicate",
    "negative-cap",
    "fractional-cap",
    "overflow",
  ] as const)("cannot use ambiguous food resources: %s", (reason) => {
    const { options, run } = fixture();
    const param = { baseParamId: 1, multiplier: 1.1, maxValue: 1 };
    const food: FoodInfo = {
      itemId: 20,
      itemLevel: 100,
      key: "food",
      baseParams: [param],
    };
    options.foods = [food];
    if (reason === "missing-attribute") options.attributeIds = [];
    if (reason === "duplicate") food.baseParams.push({ ...param });
    if (reason === "negative-cap") param.maxValue = -1;
    if (reason === "fractional-cap") param.maxValue = 1.5;
    if (reason === "overflow")
      food.baseParams = [
        { ...param, maxValue: Number.MAX_SAFE_INTEGER },
        { ...param, baseParamId: 2 },
      ];
    expect(run()).toBeUndefined();
  });

  test("unsafe total resource bounds abandon preprocessing before any candidate result", () => {
    const { options, model, run } = fixture();
    options.resourceBudgetCandidateProfile = "default";
    model.equipmentAttributes[0] = [
      [Number.MAX_SAFE_INTEGER, 0, 0],
      [0, 0, 0],
    ];
    model.equipmentAttributes[1] = [
      [1, 0, 0],
      [0, 0, 0],
    ];
    expect(run()).toBeUndefined();
  });

  test("cancellation or elapsed deadlines never return partial candidate maps", () => {
    const { run } = fixture();
    expect(run({ cancelled: () => true })).toBeUndefined();
    expect(run({ deadline: -Infinity })).toBeUndefined();
    let checks = 0;
    // Allow weighted supports, then interrupt the per-slot candidate queries.
    expect(run({ cancelled: () => ++checks >= 6 })).toBeUndefined();
    expect(checks).toBeGreaterThanOrEqual(6);
  });

  test("BLU weapon costs subtract the maximum main-factor addition before building budgets", () => {
    const { options, groups, run } = fixture();
    options.job = "BLU";
    groups[0]!.classes[1]!.auxiliary = 2;
    const result = run()!;
    expect(result.additionalBudgetCount).toBeGreaterThan(0);
    expect(result.budget.minimumCost).toBe(0);
    expect(
      result.bySlot.every((slot) =>
        [...slot.values()].every((value) => value >= 0n),
      ),
    ).toBe(true);
    groups.splice(0, 1);
    expect(run()).toBeDefined();
  });
});
