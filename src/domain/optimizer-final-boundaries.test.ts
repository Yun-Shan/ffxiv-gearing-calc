import { describe, expect, it } from "vitest";
import { foods } from "./data";
import {
  findFeasibleGcdsLocally,
  gearOptionsFor,
  runJointOptimizationLocally,
  runOptimizationLocally,
  slotsForJob,
} from "./optimizer";
import type { JobId, OptimizationConfig } from "./types";

function lowLevelForcedConfig(jobId: JobId, foodId: number): OptimizationConfig {
  const config: OptimizationConfig = {
    jobId,
    jobLevel: 50,
    minItemLevel: 15,
    maxItemLevel: 20,
    maximizeTenacity: false,
    objective: "dps",
    excludedSources: [],
    forcedGear: {},
    foodId,
  };
  const forcedGear: OptimizationConfig["forcedGear"] = {};

  for (const slot of slotsForJob(jobId)) {
    if (slot === "ring2") continue;
    const candidate = gearOptionsFor(config, slot).find((gear) =>
      gear.materiaSlots === 0 &&
      gear.customParameters === undefined &&
      (slot !== "ring" || gear.unique === false),
    );
    if (!candidate) throw new Error(`没有 ${jobId} 的低品级 ${slot} 测试装备`);
    forcedGear[slot] = candidate.id;
    if (slot === "ring") forcedGear.ring2 = candidate.id;
  }

  return { ...config, forcedGear };
}

describe("optimizer public adapter final boundaries", () => {
  it("keeps independent real foods and normalizes joint DPS against each job baseline", async () => {
    const tankFood = foods.find((food) => (food.stats.TEN ?? 0) > 0);
    expect(tankFood).toBeDefined();
    const healerFood = foods.find((food) =>
      food.id !== tankFood!.id && (food.stats.PIE ?? 0) > 0,
    );
    expect(healerFood).toBeDefined();

    const jobs = [
      lowLevelForcedConfig("PLD", tankFood!.id),
      lowLevelForcedConfig("WHM", healerFood!.id),
    ];
    const progressMessages: string[] = [];
    const result = await runJointOptimizationLocally({
      jobs,
      commonSlots: [],
      foodStrategy: "independent",
      objective: "dps",
      maxSearchMs: 15_000,
      cacheLimit: 1,
    }, {
      onProgress: (message) => progressMessages.push(message),
    });

    expect(result).toBeDefined();
    expect(result!.objective).toBe("dps");
    expect(result!.statistics.timeLimitMs).toBe(15_000);
    expect(result!.statistics.cacheLimit).toBe(1);
    expect(progressMessages.some((message) =>
      message.includes("正在计算 PLD 的单职业最优伤害基线"),
    )).toBe(true);
    expect(result!.commonFood).toBeUndefined();
    expect(result!.commonGear).toEqual({});
    expect(new Set(jobs.map((job) => result!.jobResults[job.jobId]!.food.id)).size).toBe(2);

    for (const job of jobs) {
      const recommended = result!.jobResults[job.jobId]!;
      const baseline = result!.optima[job.jobId]!;
      expect(recommended.food.id).toBe(job.foodId);
      expect(recommended.objective).toBe("dps");
      expect(recommended.score).toBe(recommended.effects.damage / recommended.effects.gcd);
      expect(recommended.score).toBeCloseTo(baseline.score, 12);
      expect(baseline.objective).toBe("dps");
    }

    expect(BigInt(result!.value.numerator)).toBe(2n * BigInt(result!.value.denominator));
    expect(result!.value.approximate).toBeCloseTo(2, 12);

    const infeasible = await runJointOptimizationLocally({
      jobs: [
        { ...jobs[0]!, speedMin: result!.optima.PLD!.stats.SKS! + 1 },
        jobs[1]!,
      ],
      commonSlots: [],
      foodStrategy: "independent",
      objective: "dps",
      maxSearchMs: 15_000,
      cacheLimit: 1,
    });
    expect(infeasible).toBeUndefined();
  }, 30_000);

  it("returns only the attainable GCD at exact speed and toughness bounds", async () => {
    const tankFood = foods.find((food) => (food.stats.TEN ?? 0) > 0);
    expect(tankFood).toBeDefined();
    const config = lowLevelForcedConfig("PLD", tankFood!.id);
    const baseline = await runOptimizationLocally(config);
    expect(baseline).toBeDefined();
    expect(baseline!.stats.SKS).toBeDefined();
    expect(baseline!.stats.TEN).toBeDefined();

    const exactBounds = {
      ...config,
      speedMin: baseline!.stats.SKS!,
      speedMax: baseline!.stats.SKS!,
      minTenacity: baseline!.stats.TEN!,
    };
    expect(findFeasibleGcdsLocally(exactBounds)).toEqual([baseline!.effects.gcd]);
    expect(findFeasibleGcdsLocally({
      ...exactBounds,
      speedMin: baseline!.stats.SKS! + 1,
    })).toEqual([]);
    expect(findFeasibleGcdsLocally({
      ...exactBounds,
      speedMax: baseline!.stats.SKS! - 1,
    })).toEqual([]);
    expect(findFeasibleGcdsLocally({
      ...exactBounds,
      minTenacity: baseline!.stats.TEN! + 1,
    })).toEqual([]);
  });

  it("treats toughnessMin as the minTenacity alias and rejects it for a healer", async () => {
    const tankFood = foods.find((food) => (food.stats.TEN ?? 0) > 0);
    expect(tankFood).toBeDefined();
    const tankConfig = lowLevelForcedConfig("PLD", tankFood!.id);
    const baseline = await runOptimizationLocally(tankConfig);
    expect(baseline).toBeDefined();
    const tenacity = baseline!.stats.TEN!;
    const aliasConfig = { ...tankConfig, toughnessMin: tenacity };
    const explicitConfig = { ...tankConfig, minTenacity: tenacity };

    expect(findFeasibleGcdsLocally(aliasConfig)).toEqual([baseline!.effects.gcd]);
    expect(findFeasibleGcdsLocally(explicitConfig)).toEqual([baseline!.effects.gcd]);

    const aliasResult = await runOptimizationLocally(aliasConfig);
    const explicitResult = await runOptimizationLocally(explicitConfig);
    expect(aliasResult).toBeDefined();
    expect(explicitResult).toBeDefined();
    expect(aliasResult!.stats).toEqual(explicitResult!.stats);
    expect(aliasResult!.effects).toEqual(explicitResult!.effects);
    expect(aliasResult!.score).toBe(explicitResult!.score);
    await expect(runOptimizationLocally({
      ...aliasConfig,
      toughnessMin: tenacity + 1,
    })).resolves.toBeUndefined();

    const healerFood = foods.find((food) => (food.stats.PIE ?? 0) > 0);
    expect(healerFood).toBeDefined();
    await expect(runOptimizationLocally({
      ...lowLevelForcedConfig("WHM", healerFood!.id),
      toughnessMin: 1,
    })).rejects.toThrow("职业 WHM 不使用坚韧属性");
  });
});
