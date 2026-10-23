import { describe, expect, it } from "vitest";
import { gameData, gears } from "./data.ts";
import {
  applyItemSpecialBonus,
  itemSpecialBonusAdditions,
  withDomainItemSpecialBonusDefaults,
} from "./item-special-bonus.ts";
import { jobSchemas } from "./jobs.ts";
import { makeGearCandidates } from "./optimizer/equipment-candidates.ts";
import {
  capGearStatsAtLevel,
  concretizeGearStats,
  getGearStatCap,
} from "./rules.ts";
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
  it("resolves matching bonus contributions per job without mutating the gear", () => {
    const gear = bonusGear();
    const originalStats = { ...gear.stats };
    const job = jobSchemas.BST;
    const additions = itemSpecialBonusAdditions(gear, job, [11]);
    const repeated = itemSpecialBonusAdditions(gear, job, [11]);

    // main 解析为力量 11，叠加显式力量 7；secondary 解析为直击 5。
    expect(additions).toEqual({ STR: 18, DHT: 5 });
    expect(repeated).toEqual(additions);
    expect(gear.stats).toEqual(originalStats);
    expect(gear.itemSpecialBonusParam).toBe(9);
    expect(concretizeGearStats(gear.stats, job).STR).toBe(3);
  });

  it("does not append bonuses that are disabled or do not match the enabled list", () => {
    const gear = bonusGear();

    expect(itemSpecialBonusAdditions(gear, jobSchemas.BST)).toEqual({});
    expect(itemSpecialBonusAdditions(gear, jobSchemas.BST, [10])).toEqual({});
  });

  it("resolves a tank special main placeholder to its unified STR main stat", () => {
    const additions = itemSpecialBonusAdditions(
      bonusGear(),
      jobSchemas.PLD,
      [11],
    );

    expect(jobSchemas.PLD.mainStat).toBe("STR");
    expect(additions).toEqual({ STR: 18, TEN: 5 });
  });

  it("appends the bonus onto already-final stats without clipping it", () => {
    const gear = bonusGear();
    const capped = { STR: 30, DHT: 12 };
    const final = applyItemSpecialBonus(capped, gear, jobSchemas.BST, [11]);

    expect(final).toEqual({ STR: 48, DHT: 17 });
    expect(capped).toEqual({ STR: 30, DHT: 12 });
  });

  it("applies the configured list once after sync caps and materia caps", () => {
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
    const base = concretizeGearStats(gear.stats, jobSchemas.BST);

    expect(enabled.finalStats.STR).toBe((base.STR ?? 0) + 18);
    expect(enabled.finalStats.DHT).toBe((base.DHT ?? 0) + 5);
    expect(disabled.finalStats).toEqual(base);
    expect(repeated.finalStats).toEqual(enabled.finalStats);
  });

  it("applies the bonus after sync caps instead of capping the bonus itself", () => {
    const syncLevel = gameData.sync.levels.find(({ jobLevel }) => jobLevel === 80)?.defaultItemLevel;
    if (syncLevel === undefined) throw new Error("缺少 80 级同步品级");
    const template = gears.find((gear) =>
      gear.slot === "body" &&
      gear.level > syncLevel &&
      gear.equipLevelVariable !== true &&
      gear.equipLevel <= 100,
    );
    if (template === undefined) throw new Error("缺少测试用身体装备");
    const syncedGear: Gear = {
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
      syncedGear,
      syncedGear.slot,
      { ...config([11], "SAM"), sync: { kind: "jobLevel", value: 80 } },
      new Map(),
    )[0]!.gear;
    const cappedBase = capGearStatsAtLevel(
      syncedGear,
      concretizeGearStats(syncedGear.stats, jobSchemas.SAM),
      syncLevel,
    ).STR!;

    expect(cappedBase).toBeLessThan(5_000);
    expect(synced.finalStats.STR).toBe(cappedBase + 5_000);
    expect(synced.melds).toEqual([]);
  });

  it("does not let the bonus reduce the materia capacity", () => {
    const template = gears.find((gear) =>
      gear.slot === "body" &&
      gear.materiaSlots > 0 &&
      gear.equipLevelVariable !== true &&
      gear.equipLevel <= 100,
    );
    if (template === undefined) throw new Error("缺少测试用可镶嵌身体装备");
    const cap = getGearStatCap(template, "CRT");
    const capGear: Gear = {
      ...template,
      id: 999_999_993,
      jobs: ["SAM"],
      stats: { CRT: cap - 10 },
      specialStats: { CRT: 10 },
      itemSpecialBonus: 11,
      materiaSlots: 1,
      materiaAdvanced: undefined,
      customParameters: undefined,
      resistanceWeaponAdjust: undefined,
    };
    const candidates = makeGearCandidates(
      capGear,
      capGear.slot,
      config([11], "SAM"),
      new Map(),
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const meldedCrt = candidate.gear.melds
        .filter(({ stat }) => stat === "CRT")
        .reduce((sum, { value }) => sum + value, 0);
      // 镶嵌按基础属性计算可用量并封顶，随后才追加不封顶的特殊加成。
      expect(candidate.gear.finalStats.CRT).toBe(
        Math.min(cap, cap - 10 + meldedCrt) + 10,
      );
    }
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
