import { describe, expect, expectTypeOf, it } from "vitest";
import {
  foods,
  jointOptimizationConfigError,
  optimizationConfigError,
} from "@/domain";
import type { JointOptimizationResult, OptimizationResult } from "@/domain";
import { makeConfig } from "./app-config";
import {
  assertUiJointOptimizationConfig,
  jointConfigForDomain,
  optimizationConfigForDomain,
  uiJointOptimizationConfigError,
  uiOptimizationConfigError,
} from "./search-config";
import type { UiJointOptimizationConfig } from "./search-config";
import { validateSearchHistoryRecord } from "./search-history";
import {
  compileSingleDraft,
  singleDraftFromConfig,
} from "@/ui/pages/single-workbench/state/useSingleController";
import {
  compileJointWorkbenchDraft,
  createJointWorkbenchRuntime,
  jointWorkbenchDraftFromConfig,
} from "@/ui/pages/joint-workbench/joint-workbench-state";
import type {
  CompiledJobCondition,
  GcdDraft,
  TankConditionDraft,
} from "@/ui/features/job-condition/types";

function result(): OptimizationResult {
  return {
    calculationLevel: 50,
    gear: [],
    food: { ...foods[0]!, actualStats: {}, utilization: 0 },
    stats: {},
    effects: {
      crtChance: 0,
      crtDamage: 1,
      detDamage: 1,
      dhtChance: 0,
      tenDamage: 1,
      tenMitigation: 0,
      damage: 1,
      gcd: 2.5,
      hp: 1,
      mp: 1,
    },
    objective: "damage",
    damagePerSecond: 0.4,
    score: 1,
    gcdTier: 2.5,
    searchedCandidates: 1,
    statistics: { elapsedMs: 1 },
  };
}

function record(config: unknown, kind: "single" | "joint" = "single") {
  const jobs =
    kind === "joint" ? (config as UiJointOptimizationConfig).jobs : [];
  const byJob = Object.fromEntries(jobs.map((job) => [job.jobId, result()]));
  const jointResult: JointOptimizationResult = {
    jobResults: byJob,
    optima: byJob,
    commonGear: {},
    objective: "damage",
    value: { numerator: "2", denominator: "1", approximate: 2 },
    proof: {
      complete: true,
      objective: "damage",
      optimalityScope: "test",
      outerBound: "test",
      innerSolverStatus: "Optimal",
      formalCertificate: false,
      numericalLimitation: "test",
      terminationReason: "test",
    },
    statistics: {
      elapsedMs: 1,
      outerNodes: 1,
      completeNodes: 1,
      upperBoundPrunes: 0,
      relaxedOptimaAttained: 0,
      innerSolves: 1,
      parentResultReuses: 0,
      cacheHits: 0,
      cacheMisses: 1,
      cacheEntries: 1,
      cacheLimit: 1,
    },
  };
  return {
    id: "contract",
    kind,
    status: "completed",
    config,
    startedAtISO: "2026-10-25T00:00:00.000Z",
    result: kind === "single" ? result() : jointResult,
  };
}

describe("configuration and history share the current contract", () => {
  const base = makeConfig("PLD");
  const joint: UiJointOptimizationConfig = {
    jobs: [base, makeConfig("WAR")],
    commonSlots: ["head", "ring", "ring2"],
    foodStrategy: "shared",
    objective: "damage",
  };

  it("keeps compiler fields required and accepts omitted equipment restrictions everywhere", () => {
    expectTypeOf<CompiledJobCondition["config"]>().toExtend<{
      objective: "damage" | "dps";
      clanIndex: number;
    }>();
    const { excludedSources, excludedGearIds, forcedGear, ...omitted } = base;
    expect(optimizationConfigError(omitted)).toBeUndefined();
    expect(uiOptimizationConfigError(omitted)).toBeUndefined();
    expect(validateSearchHistoryRecord(record(omitted)).config).toBe(omitted);
    expect(singleDraftFromConfig(omitted).equipment).toEqual({
      excludedSources: [],
      excludedGearIds: [],
      forcedGear: {},
    });
    const omittedJoint = {
      ...joint,
      jobs: [omitted, { ...omitted, jobId: "WAR" as const }],
    };
    expect(jointOptimizationConfigError(omittedJoint)).toBeUndefined();
    expect(uiJointOptimizationConfigError(omittedJoint)).toBeUndefined();
    expect(
      validateSearchHistoryRecord(record(omittedJoint, "joint")).config,
    ).toBe(omittedJoint);
    expect(
      jointWorkbenchDraftFromConfig(omittedJoint).shared.equipment.shared,
    ).toEqual({ excludedSources: [], excludedGearIds: [], forcedGear: {} });
  });

  it.each([
    { objective: undefined },
    { clanIndex: undefined },
    { extra: true },
    { excludedSources: null },
    { excludedGearIds: null },
    { forcedGear: null },
    { gcdChoices: [2.5], speedMin: 400 },
    { minTenacity: 2300, maximizeTenacity: true },
  ])(
    "rejects the same malformed single input at domain and history boundaries %j",
    (fields) => {
      const config = { ...base, ...fields };
      expect(optimizationConfigError(config)).toBeTypeOf("string");
      expect(uiOptimizationConfigError(config)).toBeTypeOf("string");
      expect(() => validateSearchHistoryRecord(record(config))).toThrow(
        "配置缺少必要字段",
      );
      const jointInput = { ...joint, jobs: [config, joint.jobs[1]!] };
      expect(jointOptimizationConfigError(jointInput)).toBeTypeOf("string");
      expect(uiJointOptimizationConfigError(jointInput)).toBeTypeOf("string");
      expect(() =>
        validateSearchHistoryRecord(record(jointInput, "joint")),
      ).toThrow("配置缺少必要字段");
    },
  );

  it("keeps the selected duty exclusively in UI snapshots", () => {
    const config = {
      ...base,
      sync: { kind: "jobLevel" as const, value: 50 },
      syncDuty: "test duty",
    };
    expect(uiOptimizationConfigError(config)).toBeUndefined();
    expect(optimizationConfigError(config)).toBeTypeOf("string");
    expect(
      optimizationConfigError(optimizationConfigForDomain(config)),
    ).toBeUndefined();
    expect(validateSearchHistoryRecord(record(config)).config).toBe(config);
    const withDuty = {
      ...joint,
      jobs: [config, { ...config, jobId: "WAR" as const }],
    };
    expect(uiJointOptimizationConfigError(withDuty)).toBeUndefined();
    expect(
      jointOptimizationConfigError(jointConfigForDomain(withDuty)),
    ).toBeUndefined();
    expect(
      jointConfigForDomain(withDuty).jobs.every((job) => !("syncDuty" in job)),
    ).toBe(true);
    expect(
      uiJointOptimizationConfigError({
        ...withDuty,
        jobs: [config, { ...withDuty.jobs[1]!, syncDuty: "different" }],
      }),
    ).toBeTypeOf("string");
  });

  it.each([
    null,
    [],
    { ...base, syncDuty: "test" },
    { ...base, sync: { kind: "jobLevel", value: 50 }, syncDuty: "" },
  ])("rejects invalid UI metadata %j", (config) =>
    expect(uiOptimizationConfigError(config)).toBeTypeOf("string"),
  );

  it.each([
    { ...joint, jobs: [base] },
    { ...joint, objective: undefined },
    { ...joint, commonSlots: ["weapon"] },
    {
      ...joint,
      jobs: [base, { ...joint.jobs[1]!, excludedSources: ["other"] }],
    },
    { ...joint, jobs: [base, { ...joint.jobs[1]!, forcedGear: { head: 1 } }] },
  ])(
    "refuses inconsistent joint snapshots without adapting them %j",
    (config) => {
      expect(jointOptimizationConfigError(config)).toBeTypeOf("string");
      expect(uiJointOptimizationConfigError(config)).toBeTypeOf("string");
      expect(() => assertUiJointOptimizationConfig(config)).toThrow();
      expect(() =>
        validateSearchHistoryRecord(record(config, "joint")),
      ).toThrow();
    },
  );

  it("handles invalid joint containers through the same boundary", () => {
    expect(uiJointOptimizationConfigError(null)).toBeTypeOf("string");
    expect(uiJointOptimizationConfigError({ jobs: null })).toBeTypeOf("string");
    expect(uiJointOptimizationConfigError({ ...joint, jobs: [] })).toBeTypeOf(
      "string",
    );
  });
});

const gcds: GcdDraft[] = [
  { mode: "any" },
  { mode: "tiers", tiers: [2.5] },
  { mode: "tiers", tiers: [2.5, 2.48] },
  { mode: "speed", min: 400, max: 1000 },
];
const tanks: TankConditionDraft[] = [
  { strategy: "any" },
  { strategy: "tenacity", minimumTenacity: 2300 },
  { strategy: "reduction", minimumDamageReductionPercent: 10 },
  { strategy: "maximize" },
];

it.each(gcds.flatMap((gcd) => tanks.map((tank) => ({ gcd, tank }))))(
  "preserves current constraints through compilation, history, and restoration: $gcd.mode / $tank.strategy",
  ({ gcd, tank }) => {
    const draft = singleDraftFromConfig(makeConfig("PLD"));
    draft.condition = { ...draft.condition, gcd, tank };
    draft.condition.range = {
      ...draft.condition.range,
      clanIndex: 2,
      sync: { kind: "jobLevel", value: 50 },
    };
    const config = compileSingleDraft(draft, [2.5, 2.48]);
    expect(
      optimizationConfigError(optimizationConfigForDomain(config)),
    ).toBeUndefined();
    expect(validateSearchHistoryRecord(record(config)).config).toBe(config);
    expect(
      compileSingleDraft(singleDraftFromConfig(config), [2.5, 2.48]),
    ).toEqual(config);
    const joint: UiJointOptimizationConfig = {
      jobs: [config, { ...config, jobId: "WAR" }],
      commonSlots: ["ring", "ring2"],
      foodStrategy: "shared",
      objective: config.objective,
    };
    expect(uiJointOptimizationConfigError(joint)).toBeUndefined();
    expect(validateSearchHistoryRecord(record(joint, "joint")).config).toBe(
      joint,
    );
    const restored = jointWorkbenchDraftFromConfig(joint);
    const runtime = createJointWorkbenchRuntime(restored.jobs);
    for (const jobId of restored.jobs)
      runtime[jobId]!.gcdAnalysis = {
        status: "ready",
        key: "test",
        feasibleTiers: [2.5, 2.48],
      };
    expect(compileJointWorkbenchDraft(restored, runtime)).toEqual(joint);
  },
);
