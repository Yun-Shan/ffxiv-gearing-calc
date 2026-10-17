import { describe, expect, it } from "vitest";
import type { GcdAnalysisInput } from "../types";
import { gcdAnalysisInputFromConfig, gcdAnalysisKey } from "../gcd-analysis";
import type { OptimizationConfig } from "@/domain";

const input: GcdAnalysisInput = {
  jobId: "RDM",
  minItemLevel: 700,
  maxItemLevel: 795,
  speedMin: 400,
  speedMax: 600,
  syncLevel: undefined,
  minTenacity: undefined,
  toughnessMin: undefined,
  toughnessMinPercent: undefined,
  maximizeTenacity: false,
  excludedSources: ["B", "A"],
  excludedGearIds: [2, 1],
  forcedGear: { head: 2 },
  foodId: 0,
};

describe("GCD analysis input identity", () => {
  it("includes speed bounds while ignoring objective and normalizes set-like restrictions", () => {
    const sameMeaning = {
      ...input,
      excludedSources: ["A", "B"],
      excludedGearIds: [1, 2],
    };
    expect(gcdAnalysisKey(input)).toBe(gcdAnalysisKey(sameMeaning));
    expect(gcdAnalysisKey({ ...input, speedMin: 410 })).not.toBe(
      gcdAnalysisKey(input),
    );
  });

  it("projects only declared feasibility inputs from the execution config", () => {
    const config = {
      jobId: "RDM",
      minItemLevel: 700,
      maxItemLevel: 795,
      syncLevel: undefined,
      speedMin: 400,
      speedMax: undefined,
      maximizeTenacity: false,
      excludedSources: [],
      excludedGearIds: [],
      forcedGear: {},
      foodId: 0,
      objective: "dps",
      gcdChoices: [2.5],
    } as OptimizationConfig;
    const projected = gcdAnalysisInputFromConfig(config);
    expect(projected).toMatchObject({ jobId: "RDM", speedMin: 400, foodId: 0 });
    expect(projected).not.toHaveProperty("objective");
    expect(projected).not.toHaveProperty("gcdChoices");
  });
});
