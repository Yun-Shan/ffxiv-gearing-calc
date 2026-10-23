import { describe, expect, it, vi } from "vitest";
import { gameData } from "../data.ts";
import type { OptimizationConfig } from "../types.ts";
import { equippedToughnessForMitigationPercent } from "../search/equipped-effects.ts";
import type { LinearMipProgress } from "../search/linear-mip.ts";
import { attributeIndex } from "./context.ts";
import { prepareSearch } from "./search-preparation.ts";

const baseConfig: OptimizationConfig = {
  jobId: "SAM",
  minItemLevel: 0,
  maxItemLevel: 0,
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  foodId: 0,
};

describe("search preparation edge cases", () => {
  it("includes the generated default item-level band for an only-level sync", () => {
    const syncRule = gameData.sync.levels.find(({ jobLevel }) => jobLevel === 90)!;
    const prepared = prepareSearch(
      {
        ...baseConfig,
        minItemLevel: 0,
        maxItemLevel: 800,
        sync: { kind: "jobLevel", value: 90 },
      },
      {},
    );

    expect(prepared.options.candidateItemLevelRanges).toContainEqual({
      min: syncRule.defaultItemLevel - 20,
      max: syncRule.defaultItemLevel,
    });
  });

  it("fails explicitly when a job's speed stat has no solver coordinate", () => {
    const speedIndex = attributeIndex.get("SKS");
    expect(speedIndex).toBeDefined();
    attributeIndex.delete("SKS");

    try {
      expect(() => prepareSearch(baseConfig, {})).toThrow(
        "职业 SAM 缺少 SKS 搜索坐标",
      );
    } finally {
      attributeIndex.set("SKS", speedIndex!);
    }
  });

  it("converts tank mitigation thresholds and only forwards solver diagnostics", () => {
    const onSolverProgress = vi.fn<(event: LinearMipProgress) => void>();
    const prepared = prepareSearch(
      { ...baseConfig, jobId: "WAR", toughnessMinPercent: 10 },
      { onSolverProgress },
    );
    const convertThreshold = prepared.options.toughnessPercentToMinimum;
    expect(convertThreshold).toBeTypeOf("function");
    expect(convertThreshold!(25)).toBe(
      equippedToughnessForMitigationPercent("WAR", prepared.jobLevel, 25, 0),
    );

    const forward = prepared.options.onSolverProgress;
    expect(forward).toBeTypeOf("function");
    const ordinaryLog: LinearMipProgress = {
      backend: "HiGHS",
      model: "tank-search",
      kind: "log",
      message: "presolve completed",
    };
    const profileLog: LinearMipProgress = {
      ...ordinaryLog,
      message: "PROFILE exact model",
    };
    const progress: LinearMipProgress = {
      backend: "HiGHS",
      model: "tank-search",
      kind: "bound",
    };

    forward!(ordinaryLog);
    forward!({ ...ordinaryLog, message: undefined });
    forward!(profileLog);
    forward!(progress);

    expect(onSolverProgress.mock.calls.map(([event]) => event)).toEqual([
      profileLog,
      progress,
    ]);
  });
});
