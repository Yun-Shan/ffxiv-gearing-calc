import { describe, expect, it } from "vitest";
import { gameData, gears } from "./data.ts";
import { gearStatsWithEnabledItemSpecialBonus, withDomainItemSpecialBonusDefaults } from "./item-special-bonus.ts";
import { jobSchemas } from "./jobs.ts";
import { makeGearCandidates } from "./optimizer/equipment-candidates.ts";
import { capGearStatsAtLevel, concretizeGearStats, getGearStatCap } from "./rules.ts";
import type { Gear, JobId, OptimizationConfig } from "./types.ts";

function bonusGear(): Gear {
  const template = gears.find((gear) => gear.slot === "body");
  if (template === undefined) throw new Error("缺少测试用身体装备");
  return {
    ...template,
    id: 999_999_991,
    jobs: ["BST"],
    stats: { main: 100, STR: 3, secondary: 30 },
    specialStats: { main: 11, STR: 7, secondary: 5 },
    itemSpecialBonus: 11,
    itemSpecialBonusParam: 9,
    materiaSlots: 0,
    materiaAdvanced: undefined,
    customParameters: undefined,
    resistanceWeaponAdjust: undefined,
  };
}

function config(
  enabledItemSpecialBonuses: number[],
  jobId: JobId = "BST",
): OptimizationConfig {
  return {
    jobId,
    minItemLevel: 0,
    maxItemLevel: 9999,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
    enabledItemSpecialBonuses,
  };
}

describe("ItemSpecialBonus gear stats", () => {
  it("adds matching bonus contributions after existing base-stat resolution", () => {
    const gear = bonusGear();
    const originalStats = { ...gear.stats };
    const job = jobSchemas.BST;
    const enabled = gearStatsWithEnabledItemSpecialBonus(gear, job, [11]);
    const repeated = gearStatsWithEnabledItemSpecialBonus(gear, job, [11]);

    expect(enabled[job.mainStat]).toBe(21);
    expect(enabled[job.secondaryStat]).toBe(35);
    expect(repeated).toEqual(enabled);
    expect(gear.stats).toEqual(originalStats);
    expect(gear.itemSpecialBonusParam).toBe(9);
    expect(concretizeGearStats(gear.stats, job)[job.mainStat]).toBe(3);
  });

  it("does not append bonuses that are disabled or do not match the enabled list", () => {
    const gear = bonusGear();

    const expected = concretizeGearStats(gear.stats, jobSchemas.BST);
    expect(gearStatsWithEnabledItemSpecialBonus(gear, jobSchemas.BST)).toEqual(expected);
    expect(gearStatsWithEnabledItemSpecialBonus(gear, jobSchemas.BST, [10])).toEqual(expected);
  });

  it("applies the configured list once before candidate stat processing", () => {
    const gear = bonusGear();
    const enabledConfig = config([11]);
    const disabledConfig = config([]);
    const enabled = makeGearCandidates(
      gear,
      gear.slot,
      enabledConfig,
      new Map(),
    )[0]!.gear;
    const disabled = makeGearCandidates(
      gear,
      gear.slot,
      disabledConfig,
      new Map(),
    )[0]!.gear;
    const repeated = makeGearCandidates(
      gear,
      gear.slot,
      enabledConfig,
      new Map(),
    )[0]!.gear;

    expect(enabled.finalStats[jobSchemas.BST.mainStat]).toBe(21);
    expect(disabled.finalStats[jobSchemas.BST.mainStat]).toBe(3);
    expect(repeated.finalStats).toEqual(enabled.finalStats);
  });

  it("applies the bonus before sync caps and before materia fills the remaining cap", () => {
    const syncLevel = gameData.syncLevelOfJobLevels[80];
    if (syncLevel === undefined) throw new Error("缺少 80 级同步品级");
    const template = gears.find((gear) =>
      gear.slot === "body" &&
      gear.materiaSlots > 0 &&
      gear.level > syncLevel &&
      gear.equipLevelVariable !== true &&
      gear.equipLevel <= 100,
    );
    if (template === undefined) throw new Error("缺少测试用可镶嵌身体装备");
    const baseGear: Gear = {
      ...template,
      id: 999_999_992,
      jobs: ["SAM"],
      stats: { STR: 5_000 },
      specialStats: { STR: 5_000 },
      itemSpecialBonus: 11,
      materiaSlots: 0,
      materiaAdvanced: undefined,
      customParameters: undefined,
      resistanceWeaponAdjust: undefined,
    };
    const synced = makeGearCandidates(
      baseGear,
      baseGear.slot,
      { ...config([11], "SAM"), syncLevel },
      new Map(),
    )[0]!.gear;
    const syncedCap = capGearStatsAtLevel(
      baseGear,
      gearStatsWithEnabledItemSpecialBonus(baseGear, jobSchemas.BST, [11]),
      syncLevel,
    )["STR"];
    expect(synced.finalStats.STR).toBe(syncedCap);
    expect(synced.melds).toEqual([]);

    const cap = getGearStatCap(template, "CRT");
    const capGear: Gear = {
      ...baseGear,
      id: 999_999_993,
      level: template.level,
      materiaSlots: 1,
      stats: { CRT: cap - 10 },
      specialStats: { CRT: 10 },
    };
    const enabledCandidates = makeGearCandidates(
      capGear,
      capGear.slot,
      config([11], "SAM"),
      new Map(),
    );
    const disabledCandidates = makeGearCandidates(
      capGear,
      capGear.slot,
      config([], "SAM"),
      new Map(),
    );
    expect(enabledCandidates.length).toBeGreaterThan(0);
    expect(enabledCandidates.every((candidate) =>
      candidate.gear.melds.every(({ stat }) => stat !== "CRT"),
    )).toBe(true);
    expect(disabledCandidates.some((candidate) =>
      candidate.gear.melds.some(({ stat }) => stat === "CRT"),
    )).toBe(true);
  });

  it("overrides caller settings with the current per-job domain defaults", () => {
    const configured = config([99]);
    const beastmaster = withDomainItemSpecialBonusDefaults(configured);
    const warrior = withDomainItemSpecialBonusDefaults({
      ...configured,
      jobId: "WAR",
    });

    expect(beastmaster.enabledItemSpecialBonuses).toEqual([11]);
    expect(warrior.enabledItemSpecialBonuses).toEqual([]);
    expect(configured.enabledItemSpecialBonuses).toEqual([99]);
  });
});
