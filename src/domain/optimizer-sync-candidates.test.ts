import { describe, expect, it } from "vitest";
import { gears } from "./data";
import { gearOptionsFor } from "./gear-options";
import { calculationJobLevelFor } from "./job-level";
import { makeGearCandidates } from "./optimizer/equipment-candidates";
import { capGearStatsAtLevel, effectiveGearSyncLevel } from "./rules";
import type { OptimizationConfig } from "./types";

const syncLevel = 665;
const sync = { kind: "itemLevel", value: syncLevel } as const;
const calculationLevel = calculationJobLevelFor({ jobId: "WAR", sync });

function syncConfig(jobId: OptimizationConfig["jobId"]): OptimizationConfig {
  return {
    clanIndex: 0,
    jobId,
    minItemLevel: 640,
    maxItemLevel: 665,
    sync,
    maximizeTenacity: false,
    objective: "damage",
    excludedSources: [],
    forcedGear: {},

    foodId: 0,
  };
}

describe("candidate sync follows reference store job level", () => {
  it("matches Gear.syncedLevel for 663 gear with equip level 94 under 665 sync", () => {
    // 参考实现：同步 665 映射等级 90；穿戴等级 94 > 90，同步至 min(663, 660)=660。
    const gear = gears.find(
      (candidate) =>
        candidate.level === 663 &&
        candidate.equipLevel === 94 &&
        candidate.slot === "body" &&
        candidate.jobs.includes("WAR"),
    );
    expect(gear).toBeDefined();
    expect(calculationLevel).toBe(90);
    // 旧逻辑按职业上限 100 比较穿戴等级，会漏掉该同步。
    expect(effectiveGearSyncLevel(gear!, 100, sync)).toBeUndefined();
    expect(effectiveGearSyncLevel(gear!, calculationLevel, sync)).toBe(
      660,
    );

    const config = syncConfig("WAR");
    expect(gearOptionsFor(config, "body").some((item) => item.id === gear!.id)).toBe(
      true,
    );
    const candidates = makeGearCandidates(gear!, "body", config, new Map());
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.gear.melds).toHaveLength(0);
      expect(candidate.gear.finalStats).toEqual(
        capGearStatsAtLevel(gear!, gear!.stats, 660),
      );
    }
  });

  it("applies the mapped job level fallback to variable item level gear", () => {
    const gear = gears.find(
      (candidate) =>
        candidate.equipLevelVariable === true &&
        candidate.jobs.includes("SAM") &&
        candidate.customParameters === undefined &&
        candidate.resistanceWeaponAdjust === undefined &&
        candidate.materiaSlots > 0 &&
        candidate.equipLevel > calculationLevel,
    );
    expect(gear).toBeDefined();
    expect(effectiveGearSyncLevel(gear!, 100, sync)).toBe(syncLevel);
    expect(effectiveGearSyncLevel(gear!, calculationLevel, sync)).toBe(
      660,
    );

    const config = { ...syncConfig("SAM"), minItemLevel: gear!.level, maxItemLevel: gear!.level };
    const candidates = makeGearCandidates(gear!, gear!.slot, config, new Map());
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates)
      expect(candidate.gear.melds).toHaveLength(0);
  });
});
