import { describe, expect, it } from "vitest";
import { calculateFixedGearset } from "./fixed-gearset";
import { addStatsForJob, filterStatsForJob, isStatApplicableToJob } from "./job-stats";
import { jobSchemas } from "./jobs";
import { runOptimizationLocally } from "./optimizer";
import { calculateEffects } from "./rules";

describe("job stat applicability", () => {
  it("keeps only stats from the job schema plus universal weapon stats", () => {
    const filtered = filterStatsForJob(
      { STR: 10, TEN: 24, PIE: 30, MND: 12, PDMG: 66, MDMG: 0, DLY: 2_240 },
      jobSchemas.BST,
    );
    expect(filtered).toEqual({
      STR: 10,
      PDMG: 66,
      MDMG: 0,
      DLY: 2_240,
    });
    expect(isStatApplicableToJob(jobSchemas.WAR, "TEN")).toBe(true);
    expect(isStatApplicableToJob(jobSchemas.BST, "TEN")).toBe(false);
  });

  it("drops inapplicable gear stats when merging the loadout totals", () => {
    const base = {
      STR: 679,
      CRT: 400,
      DET: 566,
      DHT: 691,
      SKS: 341,
      VIT: 753,
      PDMG: 66,
      DLY: 2_240,
    };
    const totals = addStatsForJob(jobSchemas.BST, base, {
      TEN: 24,
      PIE: 30,
      MND: 12,
    });
    expect(totals).toEqual(base);

    const effects = calculateEffects({
      stats: totals,
      job: jobSchemas.BST,
      level: 50,
      weaponDamage: 66,
    });
    expect(effects.tenDamage).toBe(1);
  });

  it("still applies tenacity for jobs whose schema includes it", () => {
    const effects = calculateEffects({
      stats: {
        STR: 100,
        CRT: 100,
        DET: 100,
        DHT: 100,
        SKS: 100,
        TEN: 5_000,
        VIT: 100,
        PDMG: 100,
        DLY: 2_800,
      },
      job: jobSchemas.WAR,
      level: 100,
      weaponDamage: 146,
    });
    expect(effects.tenDamage).toBeGreaterThan(1);
  });

  it("keeps optimization and fixed-gearset results on the same applicable stats", async () => {
    const result = await runOptimizationLocally({
      jobId: "BST",
      minItemLevel: 130,
      maxItemLevel: 135,
      maximizeTenacity: false,
      objective: "damage",
      excludedSources: [],
      excludedGearIds: [],
      forcedGear: {},
      sharedSlots: [],
      foodId: 0,
    });
    expect(result).toBeDefined();
    expect(result!.stats.TEN).toBeUndefined();
    expect(result!.effects.tenDamage).toBe(1);

    const fixed = calculateFixedGearset({
      jobId: "BST",
      jobLevel: result!.calculationLevel!,
      gears: result!.gear.map((gear) => ({
        id: gear.id,
        materias: gear.melds.map((meld) => [meld.stat, meld.grade] as const),
      })),
      foodId: result!.food.id,
    });
    expect(fixed.damagePerPotency).toBeCloseTo(result!.effects.damage, 10);
  }, 120_000);
});

/**
 * 对照基线：Asvel/ffxiv-gearing（提交 048376f）在 2026-10-19 打开同一条分享链接时
 * 显示 3.60337（未同步）与 3.45881（同步品级 130）。驯兽师可穿戴带坚韧的装备，
 * 但这些属性不属于其职业属性结构，不能进入总属性或伤害期望。
 */
describe("Beastmaster reference gearset parity", () => {
  const gearIds = [
    50_772, 50_773, 50_774, 50_775, 50_776, 8_967, 8_898, 8_885, 8_968, 51_736,
    51_737, 51_745,
  ];
  const materiaStats: Record<number, readonly ("CRT" | "DET" | "DHT")[]> = {
    51_736: ["CRT", "CRT", "DET", "DET", "DET"],
    51_737: ["CRT", "CRT", "CRT", "CRT", "DET"],
    51_745: ["CRT", "CRT", "CRT", "DHT", "DHT"],
  };
  const foodId = 49_245;
  const expectedUnsyncedDamage = 3.6033709139120003;
  const expectedSyncedDamage = 3.4588079608305606;

  it("matches the reference planner without sync and drops inapplicable tenacity", () => {
    const result = calculateFixedGearset({
      jobId: "BST",
      jobLevel: 50,
      gears: gearIds.map((id) => ({
        id,
        materias: (materiaStats[id] ?? []).map((stat) => [stat, 4] as const),
      })),
      foodId,
    });

    expect(result.damagePerPotency).toBeCloseTo(expectedUnsyncedDamage, 10);
    expect(result.stats.TEN).toBeUndefined();
    expect(result.effects.tenDamage).toBe(1);
    expect(result.stats.STR).toBe(679);
  });

  it("matches the reference planner when the special bonus is added after sync caps", () => {
    const result = calculateFixedGearset({
      jobId: "BST",
      jobLevel: 50,
      syncLevel: 130,
      gears: gearIds.map((id) => ({ id, materias: [] })),
      foodId,
    });

    expect(result.damagePerPotency).toBeCloseTo(expectedSyncedDamage, 10);
    expect(result.stats.TEN).toBeUndefined();
    // 同步封顶后的基础力量加上不参与封顶的特殊加成，与参考实现一致。
    expect(result.stats.STR).toBe(678);
  });
});
