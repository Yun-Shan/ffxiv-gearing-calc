import { describe, expect, it } from "vitest";
import type { GcdAnalysisInput } from "../types";
import { gcdAnalysisInputFromConfig, gcdAnalysisKey } from "../gcd-analysis";
import type { OptimizationConfig } from "@/domain";

const input: GcdAnalysisInput = {
  clanIndex: 0,
  jobId: "RDM",
  minItemLevel: 700,
  maxItemLevel: 795,
  speedMin: 400,
  speedMax: 600,
  sync: undefined,
  minTenacity: undefined,
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
      clanIndex: 0,
      jobId: "RDM",
      minItemLevel: 700,
      maxItemLevel: 795,
      sync: undefined,
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

  it("tracks materia and custom stat changes in the feasibility request key", () => {
    const materiaConfig = {
      ...input,
      forcedGear: {
        head: {
          id: 2,
          melds: [{ stat: "CRT" as const, value: 54, grade: 12 }, null],
        },
      },
    };
    const changedMateria = {
      ...materiaConfig,
      forcedGear: {
        head: {
          id: 2,
          melds: [{ stat: "DET" as const, value: 54, grade: 12 }, null],
        },
      },
    };
    expect(gcdAnalysisKey(materiaConfig)).not.toBe(
      gcdAnalysisKey(changedMateria),
    );
    expect(
      gcdAnalysisKey({
        ...materiaConfig,
        forcedGear: {
          head: { id: 2, customStats: { DET: 100, CRT: 200 } },
        },
      }),
    ).not.toBe(
      gcdAnalysisKey({
        ...materiaConfig,
        forcedGear: {
          head: { id: 2, customStats: { DET: 100, CRT: 201 } },
        },
      }),
    );
    expect(
      gcdAnalysisKey({
        ...materiaConfig,
        forcedGear: {
          head: { id: 2, customStats: { CRT: 200, DET: 100 } },
        },
      }),
    ).toBe(
      gcdAnalysisKey({
        ...materiaConfig,
        forcedGear: {
          head: { id: 2, customStats: { DET: 100, CRT: 200 } },
        },
      }),
    );
  });

  it("distinguishes level-only sync from an item-level target", () => {
    expect(
      gcdAnalysisKey({ ...input, sync: { kind: "jobLevel", value: 90 } }),
    ).not.toBe(
      gcdAnalysisKey({ ...input, sync: { kind: "itemLevel", value: 660 } }),
    );
  });
});
