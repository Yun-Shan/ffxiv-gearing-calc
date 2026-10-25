import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertJointOptimizationConfig,
  assertOptimizationConfig,
  jointOptimizationConfigError,
  normalizeOptimizationConfig,
  optimizationConfigError,
} from "./config-validation.ts";
import { clanCount } from "./clans.ts";
import {
  findFeasibleGcdsLocally,
  runOptimizationLocally,
} from "./optimizer.ts";
import type { JointOptimizationConfig, OptimizationConfig } from "./types.ts";

const config: OptimizationConfig = {
  jobId: "PLD",
  minItemLevel: 1,
  maxItemLevel: 795,
  clanIndex: 0,
  objective: "damage",
  maximizeTenacity: false,
  foodId: 0,
};
const joint: JointOptimizationConfig = {
  jobs: [config, { ...config, jobId: "WAR" }],
  commonSlots: ["head", "ring", "ring2"],
  foodStrategy: "shared",
  objective: "damage",
};

describe("current optimization configuration", () => {
  it("requires an explicit objective and clan while allowing all equipment restrictions to be absent", () => {
    expectTypeOf<OptimizationConfig>().toExtend<{
      objective: "damage" | "dps";
      clanIndex: number;
    }>();
    expectTypeOf<
      Omit<
        OptimizationConfig,
        "excludedSources" | "excludedGearIds" | "forcedGear"
      >
    >().toExtend<OptimizationConfig>();
    expectTypeOf<JointOptimizationConfig>().toExtend<{
      objective: "damage" | "dps";
    }>();
    expect(optimizationConfigError(config)).toBeUndefined();
    expect(() => assertOptimizationConfig(config)).not.toThrow();
    expect(normalizeOptimizationConfig(config)).toEqual({
      ...config,
      excludedSources: [],
      excludedGearIds: [],
      forcedGear: {},
    });
    expect(config).not.toHaveProperty("forcedGear");
    const first = normalizeOptimizationConfig(config);
    const second = normalizeOptimizationConfig(config);
    first.excludedSources.push("source");
    first.forcedGear.head = 1;
    expect(second.excludedSources).toEqual([]);
    expect(second.forcedGear).toEqual({});
  });

  it.each([
    {},
    { sync: { kind: "jobLevel", value: 50 } },
    { sync: { kind: "itemLevel", value: 130 } },
    { gcdChoices: [2.5] },
    { gcdChoices: [2.5, 2.48] },
    { speedMin: 0 },
    { speedMax: 1000 },
    { speedMin: 400, speedMax: 400 },
    { minTenacity: 0 },
    { toughnessMinPercent: 100 },
    { maximizeTenacity: true },
    { excludedSources: ["source"], excludedGearIds: [1], forcedGear: {} },
    { forcedGear: { head: 1, body: undefined } },
    { forcedGear: { weapon: { id: 1, customStats: { CRT: 0, SPS: 1 } } } },
    {
      forcedGear: {
        head: { id: 1, melds: [null, { stat: "CRT", value: 54, grade: 12 }] },
      },
    },
    {
      forcedGear: {
        head: {
          id: 1,
          melds: [{ stat: "TEN", value: 1, grade: 1, slotIndex: 4 }],
        },
      },
    },
    { maxSearchMs: 100 },
    { clanIndex: clanCount - 1, objective: "dps" },
  ])("accepts a current condition %j", (fields) => {
    expect(optimizationConfigError({ ...config, ...fields })).toBeUndefined();
  });

  const invalidValues: [string, unknown][] = [
    ["non-object", null],
    ["array", []],
    ["unknown field", { ...config, extra: true }],
    ...[
      "jobId",
      "minItemLevel",
      "maxItemLevel",
      "clanIndex",
      "objective",
      "maximizeTenacity",
      "foodId",
    ].map((field): [string, unknown] => [
      "missing " + field,
      { ...config, [field]: undefined },
    ]),
    ...Object.entries({
      jobId: ["unknown", 1],
      minItemLevel: [Number.NaN, Number.POSITIVE_INFINITY, 1.5, 796],
      maxItemLevel: [Number.NaN, 0],
      clanIndex: [-1, 0.5, clanCount, Number.NaN],
      objective: ["other", null],
      sync: [
        null,
        {},
        { kind: "jobLevel", value: 55 },
        { kind: "itemLevel", value: 89 },
      ],
      gcdChoices: [null, 2.5, [], [0], [Number.NaN], [2.5, 2.5]],
      speedMin: [-1, Number.NaN],
      speedMax: [-1, Number.POSITIVE_INFINITY],
      minTenacity: [-1, Number.NaN],
      toughnessMinPercent: [-1, 101, Number.NaN],
      maximizeTenacity: [1],
      foodId: [-1, 1.5, Number.NaN],
      excludedSources: [null, {}, [1]],
      excludedGearIds: [null, {}, [-1], [1.5]],
      forcedGear: [
        null,
        [],
        { unknown: 1 },
        { head: 0 },
        { head: -1 },
        { head: "1" },
        { head: {} },
        { head: { id: 1 } },
        { head: { id: 1, melds: {} } },
        { head: { id: 1, customStats: { STR: 1 } } },
        { head: { id: 1, customStats: { CRT: -1 } } },
        { head: { id: 1, melds: [{ stat: "STR", value: 1, grade: 1 }] } },
        { head: { id: 1, melds: [{ stat: "CRT", value: -1, grade: 1 }] } },
        { head: { id: 1, melds: [{ stat: "CRT", value: 1, grade: 0 }] } },
        {
          head: {
            id: 1,
            melds: [{ stat: "CRT", value: 1, grade: 1, slotIndex: 5 }],
          },
        },
        {
          head: {
            id: 1,
            melds: [{ stat: "CRT", value: 1, grade: 1, slotIndex: -1 }],
          },
        },
      ],
      maxSearchMs: [0, -1, Number.POSITIVE_INFINITY],
    }).flatMap(([field, values]) =>
      values.map((value): [string, unknown] => [
        "invalid " + field + " " + JSON.stringify(value),
        { ...config, [field]: value },
      ]),
    ),
    ["inverted speed", { ...config, speedMin: 2, speedMax: 1 }],
    ["two GCD modes", { ...config, gcdChoices: [2.5], speedMin: 400 }],
    [
      "two tank strategies",
      { ...config, minTenacity: 1, maximizeTenacity: true },
    ],
    ["non-tank condition", { ...config, jobId: "WHM", toughnessMinPercent: 1 }],
  ];

  it.each(invalidValues)(
    "rejects %s before candidate generation",
    async (_label, input) => {
      expect(optimizationConfigError(input)).toBeTypeOf("string");
      expect(() => assertOptimizationConfig(input)).toThrow();
      await expect(
        runOptimizationLocally(input as OptimizationConfig),
      ).rejects.toThrow();
      expect(() =>
        findFeasibleGcdsLocally(input as OptimizationConfig),
      ).toThrow();
    },
  );
});

describe("current joint configuration", () => {
  it("accepts missing restrictions and preserves equivalent source sets", () => {
    expect(() => assertJointOptimizationConfig(joint)).not.toThrow();
    expect(
      jointOptimizationConfigError({
        ...joint,
        jobs: [
          { ...config, excludedSources: ["a", "b"], forcedGear: {} },
          { ...config, jobId: "WAR", excludedSources: ["b", "a"] },
        ],
      }),
    ).toBeUndefined();
    expect(
      jointOptimizationConfigError({ ...joint, maxSearchMs: 1, cacheLimit: 1 }),
    ).toBeUndefined();
  });

  it.each([
    null,
    [],
    { ...joint, extra: true },
    { ...joint, jobs: undefined },
    { ...joint, jobs: [] },
    { ...joint, jobs: [config] },
    { ...joint, jobs: [config, { ...config, objective: undefined }] },
    { ...joint, jobs: [config, config] },
    { ...joint, jobs: [config, { ...config, jobId: "WHM" }] },
    { ...joint, objective: undefined },
    { ...joint, jobs: [config, { ...config, jobId: "WAR", objective: "dps" }] },
    ...[null, {}, ["unknown"], ["weapon"], ["offhand"], ["head", "head"]].map(
      (commonSlots) => ({ ...joint, commonSlots }),
    ),
    { ...joint, foodStrategy: "unknown" },
    ...[
      { minItemLevel: 2 },
      { maxItemLevel: 794 },
      { clanIndex: 1 },
      { sync: { kind: "jobLevel", value: 50 } },
      { excludedSources: ["a"] },
      { forcedGear: { head: 1 } },
      { foodId: 1 },
    ].map((fields) => ({
      ...joint,
      jobs: [config, { ...config, jobId: "WAR", ...fields }],
    })),
    ...[0, Number.POSITIVE_INFINITY].map((maxSearchMs) => ({
      ...joint,
      maxSearchMs,
    })),
    ...[0, 1.5, Number.NaN].map((cacheLimit) => ({ ...joint, cacheLimit })),
  ])("rejects inconsistent joint input %j", (input) => {
    expect(jointOptimizationConfigError(input)).toBeTypeOf("string");
    expect(() => assertJointOptimizationConfig(input)).toThrow();
  });

  it("allows private restrictions and independent food without merging them", () => {
    expect(
      jointOptimizationConfigError({
        ...joint,
        foodStrategy: "independent",
        jobs: [
          {
            ...config,
            excludedGearIds: [1],
            forcedGear: { weapon: 1 },
            foodId: 1,
          },
          {
            ...config,
            jobId: "WAR",
            excludedGearIds: [2],
            forcedGear: { weapon: 2 },
            foodId: 2,
          },
        ],
      }),
    ).toBeUndefined();
  });
});
