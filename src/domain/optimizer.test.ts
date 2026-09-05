import { describe, expect, it } from "vitest";
import { foods, gears } from "./data";
import { findFeasibleGcds, gearOptionsFor, optimize } from "./optimizer";
import { mergeGearStats } from "./rules";
import type { OptimizationConfig } from "./types";

const maxLevel = Math.max(...gears.map((gear) => gear.level));
const base: OptimizationConfig = {
  jobId: "SAM",
  minItemLevel: maxLevel - 15,
  maxItemLevel: maxLevel,
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  sharedSlots: [],
  foodId: 0,
};

describe("optimizer with imported game data", () => {
  it("finds a complete set with two distinct rings", () => {
    const result = optimize(base);
    expect(result).toBeDefined();
    expect(result?.gear).toHaveLength(11);
    expect(result?.gear.filter((gear) => gear.slot.startsWith("ring"))).toHaveLength(2);
    expect(new Set(result?.gear.map((gear) => gear.id)).size).toBe(11);
    expect(result?.score).toBeGreaterThan(0);
    expect(result?.food.level).toBe(
      Math.max(...foods.filter((food) => food.best && food.stats.VIT).map((food) => food.level)),
    );
  });

  it("honors a real forced gear id", () => {
    const weapon = gearOptionsFor(base, "weapon").find((gear) => gear.materiaSlots > 0)!;
    const result = optimize({ ...base, forcedGear: { weapon: weapon.id } });
    expect(result?.gear[0].id).toBe(weapon.id);
    expect(result?.gear[0].melds).toHaveLength(Math.min(weapon.materiaSlots, 2));
    expect(result?.gear[0].finalStats).toEqual(
      mergeGearStats(
        weapon,
        result!.gear[0].melds.map((meld) => ({ [meld.stat]: meld.value })),
      ),
    );
  });

  it("falls back to normal candidates for an unknown forced id", () =>
    expect(optimize({ ...base, forcedGear: { weapon: -1 } })?.gear).toHaveLength(11));

  it("returns no result when all real weapon sources are excluded", () => {
    const sources = gearOptionsFor(base, "weapon").flatMap((gear) => gear.source ? [gear.source] : []);
    expect(optimize({ ...base, excludedSources: [...new Set(sources)] })).toBeUndefined();
  });

  it("honors a selected real combat food", () => {
    const food = foods.find((item) => item.best && item.stats.VIT)!;
    expect(optimize({ ...base, foodId: food.id })?.food.id).toBe(food.id);
  });

  it("rejects unavailable food and impossible constraints", () => {
    expect(optimize({ ...base, foodId: -1 })).toBeUndefined();
    expect(optimize({ ...base, gcdTarget: 9 })).toBeUndefined();
    expect(optimize({ ...base, jobId: "WAR", minTenacity: 999_999 })).toBeUndefined();
  });

  it("supports GCD and maximum-tenacity tank passes", () => {
    const tank = { ...base, jobId: "WAR" as const };
    const unconstrained = optimize(tank)!;
    expect(optimize({ ...tank, gcdTarget: unconstrained.effects.gcd })?.effects.gcd)
      .toBe(unconstrained.effects.gcd);
    expect(optimize({ ...tank, maximizeTenacity: true })?.stats.TEN).toBeGreaterThan(0);
  });

  it("supports the PLD shield slot and ring alias", () => {
    const paladin = optimize({ ...base, jobId: "PLD" });
    expect(paladin?.gear.some((gear) => gear.slot === "offhand")).toBe(true);
    expect(gearOptionsFor(base, "ring2")).toEqual(gearOptionsFor(base, "ring"));
  });

  it("filters candidate sources and supports healer speed melds", () => {
    const weapons = gearOptionsFor(base, "weapon");
    const source = weapons.find((gear) => gear.source)?.source!;
    expect(gearOptionsFor({ ...base, excludedSources: [source] }, "weapon").length).toBeLessThan(weapons.length);
    expect(optimize({ ...base, jobId: "WHM" })?.effects.gcd).toBeGreaterThan(0);
  });

  it("finds all reachable GCD values without using damage ranking", () => {
    const gcds = findFeasibleGcds(base);
    expect(gcds.length).toBeGreaterThan(1);
    expect(gcds).toEqual([...gcds].sort((a, b) => b - a));
    expect(new Set(gcds).size).toBe(gcds.length);
    expect(gcds).toContain(2.17);
    expect(gcds).toContain(2.16);
    expect(optimize({ ...base, gcdTarget: 2.16 })?.effects.gcd).toBe(2.16);
  });

  it("uses SPS and exposes multiple real GCD values for casters", () => {
    const gcds = findFeasibleGcds({ ...base, jobId: "BLM" });
    expect(gcds).toContain(2.5);
    expect(gcds.length).toBeGreaterThan(1);
    expect(gcds).not.toContain(2.55);
    expect(optimize({ ...base, jobId: "BLM", gcdTarget: 2.5 })?.effects.gcd).toBe(2.5);
  });

  it("keeps the known BLM 2.45 reference damage reachable", () => {
    const result = optimize({
      ...base,
      jobId: "BLM",
      foodId: 49240,
      gcdTarget: 2.45,
    });
    expect(result?.effects.gcd).toBe(2.45);
    expect(result?.score).toBeGreaterThan(131.7515994);
  }, 30_000);

  it("keeps the known BLM 2.17 reference reachable with automatic food", () => {
    const weapon = gearOptionsFor({ ...base, jobId: "BLM" }, "weapon")
      .find((gear) => gear.name === "总冠军咒杖")!;
    const result = optimize({
      ...base,
      jobId: "BLM",
      forcedGear: { weapon: weapon.id },
      gcdTarget: 2.17,
    });
    expect(result?.effects.gcd).toBe(2.17);
    expect(result?.food.id).toBe(49243);
    expect(result?.score).toBeGreaterThan(117.4569);
  }, 30_000);

  it("honors forced gear, food and tenacity constraints during GCD discovery", () => {
    const weapon = gearOptionsFor(base, "weapon").find((gear) => gear.materiaSlots > 0)!;
    const forcedConfig = { ...base, forcedGear: { weapon: weapon.id } };
    const gcds = findFeasibleGcds(forcedConfig);
    expect(gcds.length).toBeGreaterThan(0);
    const gcdResult = optimize({ ...forcedConfig, gcdTarget: gcds[0] });
    expect(gcdResult?.gear[0].melds).toHaveLength(Math.min(weapon.materiaSlots, 2));
    expect(findFeasibleGcds({ ...base, foodId: -1 })).toEqual([]);
    expect(findFeasibleGcds({ ...base, minTenacity: 999_999 })).toEqual([]);
    expect(findFeasibleGcds({ ...base, jobId: "WHM" }).length).toBeGreaterThan(0);
    expect(findFeasibleGcds({ ...base, jobId: "WAR", maximizeTenacity: true }).length).toBeGreaterThan(0);
  });

  it("rejects an impossible pair of identical forced rings", () => {
    const ring = gearOptionsFor(base, "ring")[0];
    expect(
      findFeasibleGcds({ ...base, forcedGear: { ring: ring.id, ring2: ring.id } }),
    ).toEqual([]);
  });

});
