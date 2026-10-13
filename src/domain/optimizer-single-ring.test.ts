import { describe, expect, it } from "vitest";
import { foods, gameData, gears } from "./data";
import {
  findFeasibleGcds,
  findFeasibleGcdsLocally,
  gearOptionsFor,
  optimize,
  optimizeJoint,
  slotsForJob,
} from "./optimizer";
import type { OptimizationConfig } from "./types";

const jobIds = ["WHM", "AST"] as const;
const sharedUniqueRingId = 32496;
const sameStatsUniqueRingId = 34228;
const separateRingId = 33437;

function configFor(jobId: OptimizationConfig["jobId"]): OptimizationConfig {
  return {
    jobId,
    minItemLevel: 500,
    maxItemLevel: 520,
    syncLevel: 500,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    sharedSlots: [],
    foodId: 49240,
    maxSearchMs: 15_000,
  };
}

function forcedMageConfig(
  jobId: OptimizationConfig["jobId"],
  firstRing: number,
  secondRing: number,
): OptimizationConfig {
  const config = configFor(jobId);
  const forcedGear: OptimizationConfig["forcedGear"] = { ring: firstRing, ring2: secondRing };
  for (const slot of [
    "weapon", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet",
  ] as const) {
    const candidate = gearOptionsFor(config, slot).find((gear) =>
      gear.level > config.syncLevel! && gear.customParameters === undefined);
    if (candidate === undefined) throw new Error(`缺少 ${jobId} 可用的 ${slot} 测试装备`);
    forcedGear[slot] = candidate.id;
  }
  return { ...config, forcedGear };
}

function unforcedMageConfig(
  jobId: OptimizationConfig["jobId"],
  allowedRingIds: readonly [number, number],
  minItemLevel = 500,
): OptimizationConfig {
  const config = forcedMageConfig(jobId, allowedRingIds[0], allowedRingIds[1]);
  const forcedGear = { ...config.forcedGear };
  delete forcedGear.ring;
  delete forcedGear.ring2;
  const ringConfig = { ...config, minItemLevel, forcedGear, excludedGearIds: [] };
  const availableRingIds = gearOptionsFor(ringConfig, "ring").map((gear) => gear.id);
  return {
    ...ringConfig,
    excludedGearIds: availableRingIds.filter((id) => !allowedRingIds.includes(id)),
  };
}

function lowLevelForcedConfig(
  jobId: OptimizationConfig["jobId"],
  foodId: number,
): OptimizationConfig {
  const config: OptimizationConfig = {
    ...configFor(jobId),
    jobLevel: 50,
    minItemLevel: 15,
    maxItemLevel: 20,
    foodId,
  };
  const forcedGear: OptimizationConfig["forcedGear"] = {};
  for (const slot of slotsForJob(jobId)) {
    if (slot === "ring2") continue;
    const gear = gearOptionsFor(config, slot).find((candidate) =>
      candidate.level >= config.minItemLevel &&
      candidate.level <= config.maxItemLevel &&
      candidate.materiaSlots === 0 &&
      candidate.customParameters === undefined &&
      (slot !== "ring" || candidate.unique === false));
    if (gear === undefined) throw new Error(`缺少 ${jobId} 的低品级 ${slot} 测试装备`);
    forcedGear[slot] = gear.id;
    if (slot === "ring") forcedGear.ring2 = gear.id;
  }
  return { ...config, forcedGear };
}

describe("joint search with independently shared ring slots", () => {
  it("factorizes a shared pair while preserving other shared slots and rejects a unique duplicate", async () => {
    const weakRingId = 15133;
    expect(gears.find((gear) => gear.id === sharedUniqueRingId)?.unique).toBe(true);
    expect(gears.find((gear) => gear.id === weakRingId)?.unique).toBe(false);

    const ringConfigs = (["WHM", "AST", "SGE", "SCH"] as const).map((jobId) =>
      unforcedMageConfig(jobId, [sharedUniqueRingId, weakRingId], 1));
    const sharedBody = gearOptionsFor(ringConfigs[0]!, "body").find((candidate) =>
      ringConfigs.every((config) => gearOptionsFor(config, "body").some((gear) => gear.id === candidate.id)));
    expect(sharedBody).toBeDefined();
    const configs = ringConfigs.map((config) => ({
      ...config,
      forcedGear: { ...config.forcedGear, body: sharedBody!.id },
    }));
    const candidateSlots = new Map<string, string[]>();
    const result = await optimizeJoint({
      jobs: configs,
      commonSlots: ["body", "rings"],
      foodStrategy: "shared",
      objective: "damage",
      maxSearchMs: 15_000,
    }, {
      onCandidateCounts: ({ jobId, slots }) => {
        candidateSlots.set(jobId, slots.map(({ slot }) => slot));
      },
    });

    expect(result).toBeDefined();
    expect(candidateSlots.size).toBe(configs.length);
    for (const slots of candidateSlots.values()) {
      expect(slots).toContain("body");
      expect(slots).toContain("ring");
      expect(slots).toContain("ring2");
      expect(slots).not.toContain("rings");
    }
    expect(result!.commonGear.rings).toHaveLength(2);
    expect(result!.commonGear.body?.map((gear) => gear.id)).toEqual([sharedBody!.id]);
    expect(result!.commonGear.rings!.map((gear) => gear.id).sort()).toEqual(
      [sharedUniqueRingId, weakRingId].sort(),
    );
    expect(result!.commonGear).not.toHaveProperty("ring");
    expect(result!.commonGear).not.toHaveProperty("ring2");
    for (const config of configs) {
      const equippedRings = result!.jobResults[config.jobId]!.gear
        .filter((gear) => gear.slot === "ring" || gear.slot === "ring2");
      expect(equippedRings.map((gear) => gear.id).sort()).toEqual(
        [sharedUniqueRingId, weakRingId].sort(),
      );
      expect(equippedRings.filter((gear) => gear.unique === true)).toHaveLength(1);
    }
  });

  it("shares one unique ring by full identity while leaving the other ring free", async () => {
    const first = gears.find((gear) => gear.id === sharedUniqueRingId)!;
    const sameStats = gears.find((gear) => gear.id === sameStatsUniqueRingId)!;
    expect(first.unique).toBe(true);
    expect(sameStats.unique).toBe(true);
    expect(first.level).toBe(sameStats.level);
    expect(first.stats).toEqual(sameStats.stats);

    const configs = [
      forcedMageConfig("WHM", sharedUniqueRingId, sameStatsUniqueRingId),
      forcedMageConfig("AST", sharedUniqueRingId, separateRingId),
    ];
    const result = await optimizeJoint({
      jobs: configs,
      commonSlots: ["ring"],
      foodStrategy: "shared",
      objective: "damage",
    });

    expect(result).toBeDefined();
    expect(result!.commonGear.ring).toHaveLength(1);
    expect(result!.commonGear.ring![0]!.id).toBe(sharedUniqueRingId);
    const firstRingIds = jobIds.map((jobId) => result!.jobResults[jobId]!.gear
      .find((gear) => gear.slot === "ring")!.id);
    const secondRingIds = jobIds.map((jobId) => result!.jobResults[jobId]!.gear
      .find((gear) => gear.slot === "ring2")!.id);
    expect(firstRingIds).toEqual([sharedUniqueRingId, sharedUniqueRingId]);
    expect(secondRingIds).toEqual([sameStatsUniqueRingId, separateRingId]);
    for (const jobId of jobIds) {
      const equipped = result!.jobResults[jobId]!.gear.filter((gear) => gear.slot.startsWith("ring"));
      expect(equipped).toHaveLength(2);
      expect(new Set(equipped.map((gear) => gear.id)).size).toBe(2);
    }
  });

  it("shares both ring positions without breaking the legal ring pair", async () => {
    const configs = jobIds.map((jobId) =>
      forcedMageConfig(jobId, sharedUniqueRingId, sameStatsUniqueRingId));
    const result = await optimizeJoint({
      jobs: configs,
      commonSlots: ["ring", "ring2"],
      foodStrategy: "shared",
      objective: "damage",
    });

    expect(result).toBeDefined();
    expect(result!.commonGear.ring?.[0]?.id).toBe(sharedUniqueRingId);
    expect(result!.commonGear.ring2?.[0]?.id).toBe(sameStatsUniqueRingId);
    for (const jobId of jobIds) {
      const equipped = result!.jobResults[jobId]!.gear.filter((gear) => gear.slot.startsWith("ring"));
      expect(equipped.map((gear) => gear.id).sort()).toEqual([sharedUniqueRingId, sameStatsUniqueRingId].sort());
    }
  });

  it("keeps unique identical rings from occupying both positions", async () => {
    const configs = jobIds.map((jobId) =>
      forcedMageConfig(jobId, sharedUniqueRingId, sharedUniqueRingId));
    await expect(optimizeJoint({
      jobs: configs,
      commonSlots: ["ring", "ring2"],
      foodStrategy: "independent",
      objective: "damage",
    })).resolves.toBeUndefined();
  });
});

describe("single-job independent ring slots", () => {
  it("keeps asymmetric forced rings as separate exact slots when no ring is shared", async () => {
    const firstRing = sharedUniqueRingId;
    const secondRing = sameStatsUniqueRingId;
    let candidateSlotNames: string[] = [];
    const result = await optimize(
      forcedMageConfig("WHM", firstRing, secondRing),
      { onCandidateCounts: (counts) => { candidateSlotNames = counts.slots.map(({ slot }) => slot); } },
    );

    expect(result).toBeDefined();
    expect(candidateSlotNames).toContain("ring");
    expect(candidateSlotNames).toContain("ring2");
    expect(candidateSlotNames).not.toContain("rings");
    expect(result!.gear.filter((gear) => gear.slot === "ring" || gear.slot === "ring2")
      .map((gear) => gear.id)).toEqual([firstRing, secondRing]);
  });

  it("rejects two meld variants of one forced unique ring across independent slots", async () => {
    const ring = gears.find((gear) => gear.id === sharedUniqueRingId)!;
    expect(ring.unique).toBe(true);
    expect(ring.materiaSlots).toBeGreaterThan(0);
    let candidateSlotNames: string[] = [];
    const result = await optimize(
      forcedMageConfig("WHM", sharedUniqueRingId, sharedUniqueRingId),
      { onCandidateCounts: (counts) => { candidateSlotNames = counts.slots.map(({ slot }) => slot); } },
    );

    expect(candidateSlotNames).toContain("ring");
    expect(candidateSlotNames).toContain("ring2");
    expect(candidateSlotNames).not.toContain("rings");
    expect(result).toBeUndefined();
  });

  it("keeps unique ring legality in the non-MIP GCD reachability path", () => {
    expect(findFeasibleGcdsLocally(
      forcedMageConfig("WHM", sharedUniqueRingId, sharedUniqueRingId),
    )).toEqual([]);
  });
});

describe("full materia placement", () => {
  it("fills every ordinary and allowed overmeld hole", async () => {
    const targetRing = gears.find((gear) => gear.id === 34153)!;
    expect(targetRing.materiaAdvanced).toBe(true);
    expect(targetRing.materiaSlots).toBe(1);
    const syncLevel = gameData.syncLevels[80]!.find((level) => level >= targetRing.level)!;
    const config = { ...configFor("WHM"), minItemLevel: 510, maxItemLevel: syncLevel + 5, syncLevel };
    const forcedGear: OptimizationConfig["forcedGear"] = { ring: targetRing.id };
    for (const slot of [
      "weapon", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring2",
    ] as const) {
      const candidate = gearOptionsFor(config, slot).find((gear) =>
        gear.level > syncLevel && gear.customParameters === undefined && gear.id !== targetRing.id);
      if (candidate === undefined) throw new Error(`缺少 ${slot} 五孔验收测试装备`);
      forcedGear[slot] = candidate.id;
    }
    const result = await optimize({ ...config, forcedGear });
    expect(result).toBeDefined();
    const equippedRing = result!.gear.find((gear) => gear.id === targetRing.id)!;
    expect(equippedRing.melds).toHaveLength(5);
    expect(new Set(equippedRing.melds.map((meld) => meld.grade)).size).toBeGreaterThan(1);
    expect(equippedRing.melds.every((meld) => meld.value > 0)).toBe(true);
  });

  it("uses the same job-applicable food attributes in optimization and GCD feasibility", async () => {
    const foodWithUnusedPiety = foods.find((food) => (food.stats.PIE ?? 0) > 0)!;
    const config = { ...configFor("RDM"), foodId: foodWithUnusedPiety.id };
    const forcedGear: OptimizationConfig["forcedGear"] = {};
    for (const slot of [
      "weapon", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet",
    ] as const) {
      const candidate = gearOptionsFor(config, slot).find((gear) =>
        gear.level > config.syncLevel! && gear.customParameters === undefined && gear.stats.PIE === undefined);
      if (candidate === undefined) throw new Error(`缺少 RDM 可用的 ${slot} 测试装备`);
      forcedGear[slot] = candidate.id;
    }
    const rings = gearOptionsFor(config, "ring").filter((gear) =>
      !gear.unique && gear.level > config.syncLevel! && gear.stats.PIE === undefined);
    expect(rings.length).toBeGreaterThanOrEqual(2);
    forcedGear.ring = rings[0]!.id;
    forcedGear.ring2 = rings[1]!.id;
    const configured = { ...config, forcedGear };
    const result = await optimize(configured);
    expect(result).toBeDefined();
    expect(result!.stats.PIE).toBeUndefined();
    await expect(findFeasibleGcds(configured)).resolves.toEqual(expect.any(Array));
  });
});

describe("character equipment level", () => {
  it("excludes gear requiring a higher job level even when its item level is in range", () => {
    const config = {
      ...configFor("RDM"),
      jobLevel: 50,
      minItemLevel: 1,
      maxItemLevel: 999,
    };
    const eligible = gearOptionsFor(config, "ring");
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((gear) => gear.equipLevel <= 50)).toBe(true);
    expect(gears.some((gear) => gear.slot === "ring" && gear.jobs.includes("RDM") && gear.equipLevel > 50))
      .toBe(true);
  });
});

describe("shared physical food across same-group jobs", () => {
  it("matches the same TEN/PIE food identity for a joint tank search", async () => {
    for (const stat of ["TEN", "PIE"] as const) {
      const food = foods.find((candidate) => (candidate.stats[stat] ?? 0) > 0);
      expect(food).toBeDefined();
      const result = await optimizeJoint({
        jobs: [
          lowLevelForcedConfig("PLD", food!.id),
          lowLevelForcedConfig("WAR", food!.id),
        ],
        commonSlots: [],
        foodStrategy: "shared",
        objective: "damage",
      });
      expect(result).toBeDefined();
      expect(result!.commonFood?.id).toBe(food!.id);
      expect(result!.jobResults.PLD!.food.id).toBe(food!.id);
      expect(result!.jobResults.WAR!.food.id).toBe(food!.id);
    }
  });
});
