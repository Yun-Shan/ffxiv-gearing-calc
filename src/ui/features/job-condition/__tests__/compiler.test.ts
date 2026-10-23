import { describe, expect, it } from "vitest";
import type { OptimizationConfig } from "@/domain";
import {
  compileJobCondition,
  deriveJobObjective,
  normalizeJointObjective,
} from "../compiler";
import { jobConditionDraftFromConfig, normalizeCompiledDraft } from "../draft";
import type { JobConditionDraft } from "../types";

function config(
  overrides: Partial<OptimizationConfig> = {},
): OptimizationConfig {
  return {
    jobId: "PLD",
    minItemLevel: 700,
    maxItemLevel: 795,
    sync: undefined,
    gcdTarget: undefined,
    gcdChoices: undefined,
    speedMin: undefined,
    speedMax: undefined,
    minTenacity: undefined,
    toughnessMinPercent: undefined,
    maximizeTenacity: false,
    objective: "dps",
    excludedSources: [],
    excludedGearIds: [],
    forcedGear: {},
    sharedSlots: [],
    foodId: 0,
    ...overrides,
  };
}

const draft: JobConditionDraft = {
  range: {
    minItemLevel: 735,
    maxItemLevel: 795,
    sync: { kind: "itemLevel", value: 735 },
    clanIndex: 0,
  },
  gcd: { mode: "speed", min: 400, max: 500 },
  food: { mode: "specific", foodId: 123 },
  tank: {
    minimumTenacity: 2300,
    minimumDamageReductionPercent: undefined,
    maximizeTenacity: false,
  },
};

describe("job condition draft compiler", () => {
  it("maps Draft fields to current execution config without a configurable character level", () => {
    const compiled = compileJobCondition(draft, {
      jobId: "PLD",
      feasibleGcds: [2.5],
    });

    expect(compiled.config).not.toHaveProperty("jobLevel");
    expect(compiled).toEqual({
      config: expect.objectContaining({
        jobId: "PLD",
        minItemLevel: 735,
        maxItemLevel: 795,
        sync: { kind: "itemLevel", value: 735 },
        speedMin: 400,
        speedMax: 500,
        objective: "damage",
        foodId: 123,
        minTenacity: 2300,
        maximizeTenacity: false,
      }),
      levelResolution: "domain",
    });
  });

  it("derives objective from one chosen GCD or one feasible GCD in the active unrestricted mode", () => {
    expect(
      deriveJobObjective({ mode: "tiers", tiers: [2.5] }, [2.5, 2.48]),
    ).toBe("damage");
    expect(
      deriveJobObjective({ mode: "tiers", tiers: [2.5, 2.48] }, [2.5, 2.48]),
    ).toBe("dps");
    expect(deriveJobObjective({ mode: "any" }, [2.5])).toBe("damage");
    expect(deriveJobObjective({ mode: "speed", min: 400 }, [2.5, 2.48])).toBe(
      "dps",
    );
  });

  it("round-trips only normalized compiled values and keeps the objective normalization external to Draft", () => {
    const configValue = config({
      sync: { kind: "itemLevel", value: 735 },
      gcdChoices: [2.5],
      foodId: 55,
    });
    const draftValue = jobConditionDraftFromConfig(configValue);
    expect(normalizeCompiledDraft(configValue)).toEqual(draftValue);
    expect(draftValue).toMatchObject({
      range: { sync: { kind: "itemLevel", value: 735 } },
      gcd: { mode: "tiers", tiers: [2.5] },
      food: { mode: "specific", foodId: 55 },
    });
    expect(draftValue).not.toHaveProperty("objective");
  });

  it("normalizes all joint job objectives to the one current domain objective", () => {
    expect(
      normalizeJointObjective([
        { objective: "damage" as const, marker: "a" },
        { objective: "damage" as const, marker: "b" },
      ]),
    ).toEqual({
      objective: "damage",
      jobs: [
        { objective: "damage", marker: "a" },
        { objective: "damage", marker: "b" },
      ],
    });
    expect(
      normalizeJointObjective([
        { objective: "damage" as const },
        { objective: "dps" as const },
      ]),
    ).toEqual({
      objective: "dps",
      jobs: [{ objective: "dps" }, { objective: "dps" }],
    });
  });
});
