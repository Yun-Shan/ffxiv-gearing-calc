import { describe, expect, it } from "vitest";
import { foods, gameData, gears } from "./data";
import {
  findFeasibleGcdsLocally,
  gearOptionsFor,
  runOptimizationLocally,
  slotsForJob,
} from "./optimizer";
import type { JobId, OptimizationConfig } from "./types";
import {
  calculationJobLevelFor,
} from "./gear-options";
import { jobSchemas } from "./jobs";
import {
  addStats,
  applyFood,
  capGearStatsAtLevel,
  concretizeGearStats,
  calculateBaseStats,
  calculateEffects,
  effectiveGearSyncLevel,
  getGearStatCap,
} from "./rules";
import { foodStatsForJob } from "./optimizer/equipment-candidates";

const maxItemLevel = Math.max(...gears.map((gear) => gear.level));

function configFor(jobId: JobId, calculationLevel?: number): OptimizationConfig {
  return {
    jobId,
    sync: calculationLevel !== undefined && calculationLevel < 100
      ? { kind: "jobLevel", value: calculationLevel }
      : undefined,
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

function expectResultUsesLevel(result: NonNullable<Awaited<ReturnType<typeof runOptimizationLocally>>>, config: OptimizationConfig, level: number) {
  expect(result.calculationLevel).toBe(level);
  const job = jobSchemas[config.jobId];
  const food = foodStatsForJob(result.food, config.jobId);
  const expectedStats = applyFood(
    addStats(
      calculateBaseStats(job, level),
      ...result.gear.map((gear) => gear.finalStats),
    ),
    food.stats,
    food.statRates,
  );
  expect(result.stats).toEqual(expectedStats);
  const weaponStat = job.mainStat === "INT" || job.mainStat === "MND"
    ? "MDMG"
    : "PDMG";
  expect(result.effects).toEqual(calculateEffects({
    stats: expectedStats,
    job,
    level,
    weaponDamage: expectedStats[weaponStat] ?? 0,
  }));
}

describe("optimizer runtime boundaries", () => {
  it("filters real equipment by job cap, item-level range, source, and id", () => {
    const lowLevel = configFor("SAM", 70);
    const body = gearOptionsFor(lowLevel, "body");
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((item) => item.equipLevel <= 100)).toBe(true);

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

  it("keeps variable-level gear as a candidate", () => {
    const variableGear = gears.find((gear) => gear.id === 52439);
    expect(variableGear).toBeDefined();
    expect(variableGear!.equipLevelVariable).toBe(true);
    const candidates = gearOptionsFor({
      ...configFor("SAM", 100),
      minItemLevel: variableGear!.level,
      maxItemLevel: variableGear!.level,
    }, variableGear!.slot);
    expect(candidates.some((gear) => gear.id === variableGear!.id)).toBe(true);

  });

  it("resolves variable gear main/secondary per job and applies reference sync-level selection", () => {
    const variableGear = gears.find((gear) => gear.id === 52439);
    expect(variableGear).toBeDefined();
    expect(variableGear!.equipLevelVariable).toBe(true);
    expect(concretizeGearStats(variableGear!.stats, jobSchemas.SAM)).toMatchObject({
      STR: 212,
      DHT: 162,
      VIT: 214,
      DET: 162,
    });
    expect(concretizeGearStats(variableGear!.stats, jobSchemas.PLD)).toMatchObject({
      STR: 212,
      TEN: 162,
      VIT: 214,
      DET: 162,
    });
    expect(effectiveGearSyncLevel(variableGear!, 90)).toBe(660);
    expect(effectiveGearSyncLevel(variableGear!, 90, { kind: "itemLevel", value: 635 })).toBe(635);
    expect(effectiveGearSyncLevel(variableGear!, 100)).toBeUndefined();
    const concrete = concretizeGearStats(variableGear!.stats, jobSchemas.SAM);
    const capped = capGearStatsAtLevel(
      variableGear!,
      { ...concrete, STR: 9999, DHT: 9999 },
      660,
    );
    expect(capped.STR).toBe(getGearStatCap(variableGear!, "STR", 660));
    expect(capped.DHT).toBe(getGearStatCap(variableGear!, "DHT", 660));
  });

  it("uses variable-level gear stats in optimizer results and feasible GCD candidates", async () => {
    const variableGear = gears.find((gear) => gear.id === 52439)!;
    for (const jobLevel of [90, 100]) {
      const fixed = forceOnePerSlot(configFor("SAM", jobLevel));
      const config = {
        ...fixed,
        forcedGear: { ...fixed.forcedGear, [variableGear.slot]: variableGear.id },
      };
      const result = await runOptimizationLocally(config);
      expect(result).toBeDefined();
      const selected = result!.gear.find((gear) => gear.id === variableGear.id)!;
      expect(selected.stats).toMatchObject({
        STR: 212,
        DHT: 162,
        VIT: 214,
        DET: 162,
      });
      expect(result!.calculationLevel).toBe(calculationJobLevelFor(config));
      if (jobLevel === 90) {
        expect(effectiveGearSyncLevel(variableGear, result!.calculationLevel!, config.sync)).toBe(660);
        expect(selected.melds).toEqual([]);
        const concreteStats = concretizeGearStats(variableGear.stats, jobSchemas.SAM);
        expect(selected.finalStats.STR).toBeLessThan(concreteStats.STR!);
        for (const stat of ["STR", "DHT", "VIT", "DET"] as const) {
          expect(selected.finalStats[stat]).toBe(
            Math.min(concreteStats[stat] ?? 0, getGearStatCap(variableGear, stat, 660)),
          );
        }
      } else {
        expect(effectiveGearSyncLevel(variableGear, 100, config.sync)).toBeUndefined();
        expect(selected.finalStats).toMatchObject({ STR: 212, DHT: 162, VIT: 214, DET: 162 });
      }
      expect(findFeasibleGcdsLocally(config)).toContain(result!.effects.gcd);
    }
  }, 30_000);

  it("shares the STR gear index while keeping weapon candidates job-specific", () => {
    const tankConfig = configFor("PLD");
    const strengthDpsConfig = configFor("RPR");
    expect(jobSchemas.PLD.mainStat).toBe("STR");
    expect(jobSchemas.RPR.mainStat).toBe("STR");

    const tankWeapons = gearOptionsFor(tankConfig, "weapon");
    const strengthDpsWeapons = gearOptionsFor(strengthDpsConfig, "weapon");
    expect(tankWeapons.some((gear) => gear.jobs.includes("PLD"))).toBe(true);
    expect(strengthDpsWeapons.some((gear) => gear.jobs.includes("RPR"))).toBe(true);
    expect(tankWeapons.every((gear) => gear.jobs.includes("PLD"))).toBe(true);
    expect(strengthDpsWeapons.every((gear) => gear.jobs.includes("RPR"))).toBe(true);
    expect(tankWeapons.some((gear) => gear.jobs.includes("PLD") && !gear.jobs.includes("RPR"))).toBe(true);
    expect(strengthDpsWeapons.some((gear) => gear.jobs.includes("RPR") && !gear.jobs.includes("PLD"))).toBe(true);
  });

  it("uses each job cap and clamps high sync mappings to a limited job cap", () => {
    expect(calculationJobLevelFor(configFor("SAM"))).toBe(100);
    expect(calculationJobLevelFor({ ...configFor("BLU"), sync: { kind: "itemLevel", value: 700 } })).toBe(jobSchemas.BLU.maxJobLevel);

    const variableGear = gears.find((gear) => gear.id === 52439)!;
    const target = { kind: "jobLevel", value: 100 } as const;
    const blueMageCalculationLevel = calculationJobLevelFor({ jobId: "BLU", sync: target });
    const blueMageRule = gameData.sync.levels.find(({ jobLevel }) => jobLevel === blueMageCalculationLevel)!;

    expect(blueMageCalculationLevel).toBe(jobSchemas.BLU.maxJobLevel);
    expect(effectiveGearSyncLevel(variableGear, blueMageCalculationLevel, target)).toBe(blueMageRule.defaultItemLevel);
  });

  it("uses explicit sync mapping for single-job base stats and effects", async () => {
    for (const level of [80, 90, 100]) {
      const config = forceOnePerSlot({
        ...configFor("SAM", level),
      });
      const result = await runOptimizationLocally(config);
      expect(result).toBeDefined();
      expectResultUsesLevel(result!, config, level);
    }
  }, 30_000);

  it("keeps formula level at the job cap for real level-89 and level-99 candidates", async () => {
    const level89Selection = forceOnePerSlot({
      ...configFor("SAM", 100),
      minItemLevel: 0,
      maxItemLevel: 548,
    });
    const level89Config = { ...level89Selection, maxItemLevel: 690 };
    expect(gearOptionsFor(level89Config, "earrings").some((gear) => gear.level === 690)).toBe(true);
    const level89Result = await runOptimizationLocally(level89Config);
    expect(level89Result).toBeDefined();
    expectResultUsesLevel(level89Result!, level89Config, 100);

    const level99Selection = forceOnePerSlot({
      ...configFor("SAM", 100),
      minItemLevel: 0,
      maxItemLevel: 678,
    });
    const level99Config = { ...level99Selection, maxItemLevel };
    expect(gearOptionsFor(level99Config, "body").some((gear) => gear.level > 690)).toBe(true);
    const level99Result = await runOptimizationLocally(level99Config);
    expect(level99Result).toBeDefined();
    expectResultUsesLevel(level99Result!, level99Config, 100);
  }, 30_000);

  it("keeps high equip-level gear wearable when sync formulas use the mapped lower level", async () => {
    const syncLevel = gameData.sync.levels.find(({ jobLevel }) => jobLevel === 80)!.defaultItemLevel;
    const config = forceOnePerSlot({
      ...configFor("SAM", 100),
      minItemLevel: syncLevel + 1,
      sync: { kind: "jobLevel", value: 80 },
    });
    const bodyCandidates = gearOptionsFor(config, "body");
    expect(bodyCandidates.some((item) => item.level > syncLevel && item.equipLevel > 80)).toBe(true);

    const result = await runOptimizationLocally(config);
    expect(result).toBeDefined();
    expect(result!.calculationLevel).toBe(80);
    expect(result!.gear.some((item) => item.level > syncLevel && item.equipLevel > 80)).toBe(true);
    expect(findFeasibleGcdsLocally(config)).toContain(result!.effects.gcd);
  }, 30_000);

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

    const result = await runOptimizationLocally({ ...config, sync: { kind: "itemLevel", value: syncLevel! } });
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
  });

  it("requires a supported sync-level mapping and preserves an Error cancellation reason", () => {
    const controller = new AbortController();
    controller.abort(new Error("用户中止"));
    expect(() => findFeasibleGcdsLocally(configFor("SAM"), { signal: controller.signal }))
      .toThrow(expect.objectContaining({ name: "AbortError", message: "用户中止" }));
    const unavailableSync = Math.max(...gameData.levelCaps.level) + 1;
    expect(() => findFeasibleGcdsLocally({ ...configFor("SAM"), sync: { kind: "itemLevel", value: unavailableSync } }))
      .toThrow("完整属性上限");
  });

  it("uses the same GCD and DPS constraints for forced real equipment", async () => {
    const fixed = forceOnePerSlot(configFor("SAM"));
    const result = await runOptimizationLocally({ ...fixed, objective: "dps" });
    expect(result).toBeDefined();
    expect(result!.score).toBe(result!.effects.damage / result!.effects.gcd);
    expect(findFeasibleGcdsLocally({ ...fixed, speedMax: 0 })).toEqual([]);
    expect(findFeasibleGcdsLocally({ ...fixed, speedMin: Number.MAX_SAFE_INTEGER })).toEqual([]);
  }, 30_000);

  it("fails closed for malformed materia and custom-weapon data, and treats missing unique as false", async () => {
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
      const result = await runOptimizationLocally(fixed);
      expect(result?.gear.filter((item) => item.id === ring.id).map((item) => item.slot).sort())
        .toEqual(["ring", "ring2"]);
    } finally {
      ring.unique = originalUnique;
    }
  }, 30_000);
});
