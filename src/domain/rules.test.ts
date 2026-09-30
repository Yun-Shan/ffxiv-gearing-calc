import { describe, expect, it } from "vitest";
import { foods, gameData, gears } from "./data";
import { jobSchemas } from "./jobs";
import type { Gear } from "./types";
import {
  addStats,
  applyFood,
  calculateBaseStats,
  calculateEffects,
  calculateGcdTier,
  getGearStatCap,
  gcdThresholds,
  isGearUsable,
  isGearBaseStatAtCap,
  mergeGearStats,
} from "./rules";

const job = jobSchemas.SAM;
const stats = {
  STR: 3100,
  VIT: 2900,
  CRT: 2600,
  DET: 2200,
  DHT: 1900,
  SKS: 2100,
};

describe("stat rules", () => {
  it("adds sparse stats without dropping keys", () =>
    expect(addStats({ CRT: 10, DET: 4 }, { CRT: 2, DHT: 7 })).toEqual({
      CRT: 12,
      DET: 4,
      DHT: 7,
    }));
  it("applies percentage food caps to the pre-food value", () =>
    expect(
      applyFood({ CRT: 1000 }, { CRT: 110, DET: 70 }, { CRT: 10, DET: 10 }),
    ).toEqual({ CRT: 1100, DET: 0 }));
  it("keeps unrelated stats when applying food", () =>
    expect(applyFood({ STR: 10 }, foods[0].stats, foods[0].statRates).STR).toBe(
      10,
    ));
  it("handles missing food rate and missing input stat", () =>
    expect(applyFood({}, { DET: 70 }, {}).DET).toBe(0));
  it("calculates positive combat effects", () => {
    const effects = calculateEffects({
      stats,
      job,
      level: 100,
      weaponDamage: 146,
    });
    expect(effects.damage).toBeGreaterThan(0);
    expect(effects.gcd).toBeGreaterThan(0);
    expect(effects.crtChance).toBeGreaterThan(0);
  });
  it("reproduces the known 7.55 SAM reference set", () => {
    const effects = calculateEffects({
      stats: { STR: 6501, CRT: 3605, DET: 2533, DHT: 1847, SKS: 420, VIT: 7467 },
      job: jobSchemas.SAM,
      level: 100,
      weaponDamage: 158,
    });
    expect(effects.damage).toBeCloseTo(101.8633, 3);
    expect(effects.gcd).toBe(2.17);
  });
  it("reproduces the known 7.55 BLM 2.45 GCD damage expectation", () => {
    const effects = calculateEffects({
      stats: { INT: 6516, CRT: 3602, DET: 2287, DHT: 1837, SPS: 787, VIT: 6795 },
      job: jobSchemas.BLM,
      level: 100,
      weaponDamage: 158,
    });
    expect(effects.damage).toBeCloseTo(131.7515994, 7);
    expect(effects.gcd).toBe(2.45);
  });
  it("builds upstream base stats with job and clan modifiers", () => {
    const base = calculateBaseStats(jobSchemas.SAM, 100);
    expect(base).toMatchObject({ STR: 494, CRT: 420, DET: 440, DHT: 420, SKS: 420 });
    expect(() => calculateBaseStats(jobSchemas.SAM, 999)).toThrow("不支持的职业等级");
    expect(calculateBaseStats(jobSchemas.SAM, 100, 99).STR).toBe(492);
    expect(calculateBaseStats({ ...jobSchemas.SAM, stats: ["PDMG"] }, 100).PDMG).toBe(0);
  });
  it("rejects unknown levels without substituting another level", () =>
    expect(() => calculateEffects({ stats, job, level: 999, weaponDamage: 100 })).toThrow("不支持的职业等级"));
  it("uses the job-specific secondary speed stat", () =>
    expect(
      calculateGcdTier({ SPS: 2100 }, jobSchemas.BLM),
    ).not.toBe(calculateGcdTier({ SPS: 420 }, jobSchemas.BLM)));
  it("supports tank and healer-specific speed branches", () => {
    expect(
      calculateGcdTier({ ...stats, SKS: 2200 }, jobSchemas.WAR),
    ).toBeGreaterThan(0);
    expect(
      calculateGcdTier({ ...stats, SPS: 2200 }, jobSchemas.WHM),
    ).toBeGreaterThan(0);
    expect(
      calculateEffects({
        stats: { ...stats, VIT: 3500, TEN: 2200 },
        job: jobSchemas.WAR,
        level: 100,
        weaponDamage: 146,
      }).tenMitigation,
    ).toBeGreaterThan(0);
  });
  it("returns sorted unique gcd thresholds", () => {
    const tiers = gcdThresholds(1900, 2300, job);
    expect(tiers.length).toBeGreaterThan(1);
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a));
  });
  it("merges gear stats and melds", () => {
    const gear = gears.find((item) => item.jobs.includes("SAM") && item.materiaSlots >= 2)!;
    const merged = mergeGearStats(gear, [{ CRT: 9999 }, { CRT: 9999 }]);
    const levelIndex = gameData.levelCaps.level.indexOf(gear.level);
    const cap = Math.round(
      (gameData.levelCaps.CRT[levelIndex] * gameData.slotCaps.CRT[gear.rawSlot] *
        gameData.roleCaps.CRT[gear.roleId]) / 100_000,
    );
    expect(merged.CRT).toBe(cap);
    expect(merged.DET).toBe(gear.stats.DET);
    expect(getGearStatCap(gear, "CRT")).toBe(cap);
    expect(isGearBaseStatAtCap(gear, "CRT")).toBe((gear.stats.CRT ?? 0) >= cap);
  });
  it("fails closed when cap source data cannot describe a gear", () => {
    const gear = gears.find((item) => item.jobs.includes("SAM"))!;
    expect(() => mergeGearStats({ ...gear, level: -1 }, [{ CRT: 54 }])).toThrow("缺少属性上限");
    expect(() => mergeGearStats({ ...gear, rawSlot: 999 }, [{ CRT: 54 }])).toThrow("上限数据不完整");
  });
  it("filters gear by job, item level and source", () => {
    const gear = {
      id: 1,
      level: 735,
      jobs: ["SAM"],
      source: "点数/神典",
    } as Gear;
    expect(isGearUsable(gear, job, 700, 740, [])).toBe(true);
    expect(isGearUsable(gear, jobSchemas.BLM, 700, 740, [])).toBe(false);
    expect(isGearUsable(gear, job, 740, 750, [])).toBe(false);
    expect(isGearUsable(gear, job, 700, 740, ["点数"])).toBe(false);
  });
});
