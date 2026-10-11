import { describe, expect, it } from "vitest";
import { gearOptionsFor, runOptimizationLocally, slotsForJob } from "./optimizer.ts";
import type { OptimizationConfig } from "./types.ts";

describe("candidate generation Pareto filtering", () => {
  it("drops dominated private gear variants without lowering the exact optimum", async () => {
    const config: OptimizationConfig = {
      jobId: "WHM",
      minItemLevel: 730,
      maxItemLevel: 740,
      maximizeTenacity: false,
      excludedSources: [],
      forcedGear: {},
      sharedSlots: [],
      foodId: 49240,
      maxSearchMs: 10_000,
    };
    const headIds = [46057, 44630];
    const heads = gearOptionsFor(config, "head");
    expect(headIds.every((id) => heads.some((gear) => gear.id === id))).toBe(true);

    const forcedGear: OptimizationConfig["forcedGear"] = {};
    for (const slot of slotsForJob(config.jobId)) {
      if (slot === "head" || slot === "ring2") continue;
      const pool = gearOptionsFor(config, slot);
      const candidate = slot === "ring"
        ? pool.find((gear) => gear.unique === false)
        : pool.find((gear) => gear.customParameters === undefined);
      if (candidate === undefined) throw new Error(`缺少 ${slot} 测试装备`);
      forcedGear[slot] = candidate.id;
      if (slot === "ring") forcedGear.ring2 = candidate.id;
    }

    const run = async (
      allowedHeadIds: readonly number[],
      constraints: Partial<OptimizationConfig> = {},
    ) => {
      const searchConfig: OptimizationConfig = {
        ...config,
        ...constraints,
        forcedGear: { ...forcedGear },
        excludedGearIds: heads
          .filter((gear) => !allowedHeadIds.includes(gear.id))
          .map((gear) => gear.id),
      };
      if (allowedHeadIds.length === 1) searchConfig.forcedGear.head = allowedHeadIds[0]!;
      let headCandidateCount: number | undefined;
      const result = await runOptimizationLocally(searchConfig, {
        onCandidateCounts: ({ slots }) => {
          headCandidateCount = slots.find(({ slot }) => slot === "head")?.count;
        },
      });
      expect(result).toBeDefined();
      expect(headCandidateCount).toBeDefined();
      return { result: result!, count: headCandidateCount! };
    };

    const individual = await Promise.all(headIds.map((id) => run([id])));
    const combined = await run(headIds);
    expect(combined.count).toBeLessThan(individual.reduce((total, item) => total + item.count, 0));
    expect(combined.result.score).toBeCloseTo(Math.max(...individual.map(({ result }) => result.score)), 10);
    expect(combined.result.gear.find((gear) => gear.slot === "head")?.id).toBe(headIds[0]);

    const speedLimited = await run(headIds, { speedMax: 1124 });
    expect(speedLimited.result.stats.SPS).toBeLessThanOrEqual(1124);
  });
});
