import { describe, expect, it } from "vitest";
import { gears } from "./data";
import { jobSchemas } from "./jobs";
import {
  addStats,
  applyFood,
  calculateBaseStats,
  calculateEffects,
  calculateGcdTier,
  getGearStatCap,
} from "./rules";
import type { Gear } from "./types";

describe("rules runtime boundaries", () => {
  it("treats explicitly undefined optional stat entries as absent", () => {
    expect(addStats({ STR: 10, DEX: undefined }, { DEX: 5 })).toEqual({
      STR: 10,
      DEX: 5,
    });
    expect(
      applyFood(
        { STR: 100, CRT: undefined },
        { CRT: 20, DHT: undefined },
        { CRT: 10 },
      ),
    ).toEqual({ STR: 100, CRT: 0, DHT: 0 });
  });

  it("uses 100% for an omitted optional secondary modifier and defaults missing speed", () => {
    const sam = jobSchemas.SAM;
    const optionalStat = sam.stats.find(
      (stat) => stat !== sam.mainStat && sam.statModifiers[stat] === undefined,
    );
    expect(optionalStat).toBeDefined();
    const withoutOptionalModifier = {
      ...sam,
      statModifiers: { ...sam.statModifiers, [optionalStat!]: undefined },
    };
    const explicitDefault = {
      ...sam,
      statModifiers: { ...sam.statModifiers, [optionalStat!]: 100 },
    };

    expect(calculateBaseStats(withoutOptionalModifier, 100)[optionalStat!]).toBe(
      calculateBaseStats(explicitDefault, 100)[optionalStat!],
    );
    expect(calculateGcdTier({}, sam)).toBe(
      calculateGcdTier({ SKS: calculateBaseStats(sam, 100).SKS }, sam),
    );
  });

  it("uses the low-level GCD formula without the level-80 job modifier", () => {
    const job = jobSchemas.SAM;
    const withoutGcdModifier = { ...job, gcdModifier: 100 };
    const stats = { STR: 2500, SKS: 600 };

    expect(
      calculateEffects({ stats, job, level: 70, weaponDamage: 100 }).gcd,
    ).toBe(
      calculateEffects({ stats, job: withoutGcdModifier, level: 70, weaponDamage: 100 }).gcd,
    );
  });

  it("fails closed when required level, attack, or HP modifiers are unavailable", () => {
    const sam = jobSchemas.SAM;
    const input = {
      stats: { STR: 3000, VIT: 3000, CRT: 2000, DET: 2000 },
      job: sam,
      level: 100,
      weaponDamage: 100,
    };

    expect(() => calculateBaseStats(sam, 999)).toThrow();
    expect(() => calculateEffects({ ...input, level: 999 })).toThrow();
    expect(() => calculateEffects({
      ...input,
      job: { ...sam, statModifiers: { ...sam.statModifiers, [sam.mainStat]: undefined } },
    })).toThrow();
    expect(() => calculateEffects({
      ...input,
      job: { ...sam, statModifiers: { ...sam.statModifiers, hp: undefined } },
    })).toThrow();
  });

  it("uses real Blue Mage intelligence and rejects an impossible negative contribution", () => {
    const base = calculateBaseStats(jobSchemas.BLU, 80);
    const effects = calculateEffects({
      stats: { ...base, CRT: 1000, DHT: 1000 },
      job: jobSchemas.BLU,
      level: 80,
      weaponDamage: 100,
    });

    expect(base.INT).toBeGreaterThan(0);
    expect(Number.isFinite(effects.damage)).toBe(true);
    expect(effects.damage).toBeGreaterThan(0);
    expect(() => calculateEffects({
      stats: { CRT: 1000, DHT: 1000 },
      job: jobSchemas.BLU,
      level: 80,
      weaponDamage: 100,
    })).toThrow("智力装备贡献必须为非负安全整数");
  });

  it("fails closed when a direct stat-cap lookup receives an unknown item level", () => {
    const gear = gears.find((item) => item.jobs.includes("SAM"))!;
    expect(() => getGearStatCap({ ...gear, level: -1 } as Gear, "CRT")).toThrow(
      "缺少属性上限",
    );
  });
});
