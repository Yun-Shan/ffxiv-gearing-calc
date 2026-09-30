import { describe, expect, it } from "vitest";
import { foods, gameData, gears } from "./data";
import {
  findFeasibleGcdsLocally,
  gearOptionsFor,
  runOptimizationLocally,
  slotsForJob,
} from "./optimizer";
import type { JobId, OptimizationConfig } from "./types";

const maxItemLevel = Math.max(...gears.map((gear) => gear.level));

function configFor(jobId: JobId, jobLevel = 100): OptimizationConfig {
  return {
    jobId,
    jobLevel,
    minItemLevel: 0,
    maxItemLevel,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    sharedSlots: [],
    foodId: 0,
  };
}

function forceOnePerSlot(
  config: OptimizationConfig,
  weaponId?: number,
): OptimizationConfig {
  const forcedGear: OptimizationConfig["forcedGear"] = {};
  const selectedRingIds = new Set<number>();

  for (const slot of slotsForJob(config.jobId)) {
    const pool = gearOptionsFor(config, slot)
      .filter((item) => !item.customParameters?.length)
      .sort((left, right) => right.level - left.level || left.id - right.id);
    let selected = pool.find((item) =>
      slot !== "ring" && slot !== "ring2" || !selectedRingIds.has(item.id),
    );
    if (slot === "weapon" && weaponId !== undefined) {
      selected = gearOptionsFor(config, slot).find((item) => item.id === weaponId);
    }
    if (!selected) throw new Error(`测试数据没有 ${config.jobId} 的 ${slot} 装备候选`);
    forcedGear[slot] = selected.id;
    if (slot === "ring" || slot === "ring2") selectedRingIds.add(selected.id);
  }

  return {
    ...config,
    foodId: foods.find((food) => food.best && (food.stats.VIT ?? 0) > 0)?.id ?? 0,
    forcedGear,
  };
}

describe("optimizer runtime boundaries", () => {
  it("filters real equipment by character level, item-level range, source, and id", () => {
    const lowLevel = configFor("SAM", 70);
    const body = gearOptionsFor(lowLevel, "body");
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((item) => item.equipLevel <= 70)).toBe(true);

    const itemLevel = body[0]!.level;
    const exactLevel = gearOptionsFor(
      { ...lowLevel, minItemLevel: itemLevel, maxItemLevel: itemLevel },
      "body",
    );
    expect(exactLevel.every((item) => item.level === itemLevel)).toBe(true);

    const excludedId = body[0]!.id;
    expect(
      gearOptionsFor({ ...lowLevel, excludedGearIds: [excludedId] }, "body")
        .some((item) => item.id === excludedId),
    ).toBe(false);

    const excludedSource = body.find((item) => item.source)?.source;
    expect(excludedSource).toBeDefined();
    expect(
      gearOptionsFor({ ...lowLevel, excludedSources: [excludedSource!] }, "body")
        .every((item) => !item.source?.startsWith(excludedSource!)),
    ).toBe(true);
  });

  it("builds valid low-level loadouts across shield, healer, and caster jobs", () => {
    expect(slotsForJob("PLD")).toContain("offhand");
    expect(slotsForJob("WAR")).not.toContain("offhand");

    for (const jobId of ["PLD", "WHM", "BLM"] as const) {
      const config = forceOnePerSlot(configFor(jobId, 70));
      const gcds = findFeasibleGcdsLocally({
        ...config,
        speedMin: 0,
        speedMax: Number.MAX_SAFE_INTEGER,
        ...(jobId === "PLD" ? { maximizeTenacity: true, toughnessMinPercent: 0 } : {}),
      });
      expect(gcds.length, `${jobId} should have an attainable GCD`).toBeGreaterThan(0);
      expect(gcds.every(Number.isFinite)).toBe(true);
    }
  });

  it("preserves custom weapon parameters through sync while disabling ordinary materia", async () => {
    const base = configFor("SAM");
    const customWeapon = gearOptionsFor(base, "weapon")
      .find((item) => item.customParameters?.length === 4)!;
    const config = forceOnePerSlot(base, customWeapon.id);
    const selectedItems = Object.values(config.forcedGear)
      .map((id) => gears.find((item) => item.id === id)!)
      .filter(Boolean);
    const minimumSelectedLevel = Math.min(...selectedItems.map((item) => item.level));
    const syncLevel = [...gameData.levelCaps.level]
      .filter((level) => level < minimumSelectedLevel)
      .sort((left, right) => right - left)[0];
    expect(syncLevel).toBeDefined();

    const result = await runOptimizationLocally({ ...config, syncLevel: syncLevel! });
    expect(result).toBeDefined();
    const weapon = result!.gear.find((item) => item.slot === "weapon")!;
    expect(weapon.id).toBe(customWeapon.id);
    expect(weapon.melds).toHaveLength(3);
    expect(weapon.finalStats.DLY).toBe(customWeapon.stats.DLY);

    const syncedRegularGear = result!.gear.filter(
      (item) => item.id !== customWeapon.id && item.level > syncLevel! && item.materiaSlots > 0,
    );
    expect(syncedRegularGear.length).toBeGreaterThan(0);
    expect(syncedRegularGear.every((item) => item.melds.length === 0)).toBe(true);
  }, 30_000);

  it("normalizes arbitrary abort reasons and rejects unsupported config identities", () => {
    const controller = new AbortController();
    controller.abort("caller cancelled search");
    expect(() => findFeasibleGcdsLocally(configFor("SAM"), { signal: controller.signal }))
      .toThrow(expect.objectContaining({ name: "AbortError" }));

    expect(() => gearOptionsFor({ ...configFor("SAM"), jobId: "NOPE" as JobId }, "body"))
      .toThrow("缺少职业 NOPE");
    expect(() => gearOptionsFor({ ...configFor("SAM"), jobLevel: 70.5 }, "body"))
      .toThrow("不支持的职业等级");
  });

  it("rejects unavailable sync data and preserves an Error cancellation reason", () => {
    const controller = new AbortController();
    controller.abort(new Error("用户中止"));
    expect(() => findFeasibleGcdsLocally(configFor("SAM"), { signal: controller.signal }))
      .toThrow(expect.objectContaining({ name: "AbortError", message: "用户中止" }));
    const unavailableSync = Math.max(...gameData.levelCaps.level) + 1;
    expect(() => findFeasibleGcdsLocally({ ...configFor("SAM"), syncLevel: unavailableSync }))
      .toThrow();
  });

  it("uses the same GCD and DPS constraints for forced real equipment", async () => {
    const fixed = forceOnePerSlot(configFor("SAM"));
    const result = await runOptimizationLocally({ ...fixed, objective: "dps" });
    expect(result).toBeDefined();
    expect(result!.score).toBe(result!.effects.damage / result!.effects.gcd);
    expect(findFeasibleGcdsLocally({ ...fixed, speedMax: 0 })).toEqual([]);
    expect(findFeasibleGcdsLocally({ ...fixed, speedMin: Number.MAX_SAFE_INTEGER })).toEqual([]);
  }, 30_000);

  it("fails closed for malformed imported materia, custom-weapon, and ring metadata", async () => {
    const base = configFor("SAM");

    const materiaWeapon = gearOptionsFor(base, "weapon")
      .find((item) => item.materiaSlots > 0 && !item.customParameters?.length)!;
    const originalRestrictions = gameData.materiaGradeIsRestricted;
    gameData.materiaGradeIsRestricted = originalRestrictions.slice(1);
    try {
      await expect(runOptimizationLocally(forceOnePerSlot(base, materiaWeapon.id)))
        .rejects.toThrow("魔晶石禁断等级数据与等级要求数据长度不一致");
    } finally {
      gameData.materiaGradeIsRestricted = originalRestrictions;
    }

    const customWeapon = gearOptionsFor(base, "weapon")
      .find((item) => item.customParameters?.length === 4)!;
    const originalParameters = customWeapon.customParameters!;
    customWeapon.customParameters = originalParameters.slice(0, 3);
    try {
      await expect(runOptimizationLocally(forceOnePerSlot(base, customWeapon.id)))
        .rejects.toThrow("槽位数 3 不是 4");
    } finally {
      customWeapon.customParameters = originalParameters;
    }

    const ring = gearOptionsFor(base, "ring").find((item) => item.unique !== undefined)!;
    const originalUnique = ring.unique;
    const fixed = forceOnePerSlot(base);
    fixed.forcedGear = { ...fixed.forcedGear, ring: ring.id, ring2: ring.id };
    Reflect.deleteProperty(ring, "unique");
    try {
      await expect(runOptimizationLocally(fixed)).rejects.toThrow("缺少 IsUnique 上游字段");
    } finally {
      ring.unique = originalUnique;
    }
  }, 30_000);
});
