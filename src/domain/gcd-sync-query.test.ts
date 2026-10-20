import { describe, expect, it } from "vitest";
import { gameData, gears, getGearById } from "./data.ts";
import { calculateFeasibleGcdTiers } from "./gcd-tier-calculator.ts";
import { calculationJobLevelFor, slotsForJob } from "./gear-options.ts";
import { jobSchemas } from "./jobs.ts";
import { findFeasibleGcdsLocally, runOptimizationLocally } from "./optimizer";
import { concretizeGearStats } from "./rules.ts";
import {
  highestMateriaGrade,
  materiaForGrade,
} from "./optimizer/equipment-candidates.ts";
import type { ForcedGearValue, GearSlot, OptimizationConfig, Stat } from "./types";

const forcedGear: OptimizationConfig["forcedGear"] = {
  weapon: 42146,
  head: 42166,
  body: 42167,
  hands: 42168,
  legs: 42169,
  feet: 42170,
  earrings: 42201,
  necklace: 42206,
  bracelet: 42211,
  ring: 42216,
  ring2: 42216,
};

const config: OptimizationConfig = {
  jobId: "WAR",
  minItemLevel: 663,
  maxItemLevel: 663,
  syncLevel: 665,
  maximizeTenacity: false,
  objective: "damage",
  excludedSources: [],
  forcedGear,
  sharedSlots: [],
  foodId: 0,
  gcdChoices: [],
};

function fixedMateria(itemId: number, stat: "CRT" | "SKS"): ForcedGearValue {
  const gear = getGearById(itemId);
  if (gear === undefined) throw new Error(`缺少装备 ${itemId}`);
  const capacity = gear.materiaAdvanced === true ? 5 : gear.materiaSlots;
  if (capacity === 0) throw new Error(`装备 ${itemId} 没有魔晶石孔`);
  const grade = highestMateriaGrade(gear.level, true);
  return {
    id: itemId,
    melds: Array.from({ length: capacity }, (_, index) =>
      index === 0
        ? { ...materiaForGrade(stat, grade), slotIndex: index }
        : null,
    ),
  };
}

function fullyFixedMateria(itemId: number, stat: "CRT" | "SKS"): ForcedGearValue {
  const gear = getGearById(itemId);
  if (gear === undefined) throw new Error(`缺少装备 ${itemId}`);
  const capacity = gear.materiaAdvanced === true ? 5 : gear.materiaSlots;
  return {
    id: itemId,
    melds: Array.from({ length: capacity }, (_, index) => ({
      ...materiaForGrade(stat, highestMateriaGrade(gear.level, index <= gear.materiaSlots)),
      slotIndex: index,
    })),
  };
}

function maximumFeasibleSpeed(config: OptimizationConfig): number {
  let lower = 0;
  let upper = 4096;
  while (lower < upper) {
    const candidate = Math.ceil((lower + upper) / 2);
    if (findFeasibleGcdsLocally({ ...config, speedMin: candidate }).length > 0) {
      lower = candidate;
    } else {
      upper = candidate - 1;
    }
  }
  return lower;
}

describe("sync GCD query", () => {
  it("applies the sync calculation level and only returns formally searchable tiers", async () => {
    const tiers = findFeasibleGcdsLocally(config);
    expect(tiers).toContain(2.4);
    expect(tiers).not.toContain(2.24);
    for (const tier of tiers) {
      const result = await runOptimizationLocally({
        ...config,
        gcdChoices: [tier],
      });
      expect(result?.effects.gcd, `GCD ${tier}`).toBe(tier);
    }
  }, 120_000);

  it("uses positional forced materia candidates and distinguishes ring-slot restrictions", () => {
    const unsyncedConfig = { ...config, syncLevel: undefined };
    const allFixedGear = Object.fromEntries(
      Object.entries(forcedGear).map(([slot, itemId]) => [
        slot,
        fullyFixedMateria(itemId as number, "CRT"),
      ]),
    ) as OptimizationConfig["forcedGear"];
    const allFixedConfig = {
      ...unsyncedConfig,
      forcedGear: allFixedGear,
    };
    expect(maximumFeasibleSpeed(allFixedConfig)).toBe(1081);
    expect(maximumFeasibleSpeed(unsyncedConfig)).toBe(2085);

    const ringAsymmetric = {
      ...unsyncedConfig,
      forcedGear: {
        ...forcedGear,
        ring: fixedMateria(42216, "SKS"),
        ring2: fixedMateria(42216, "CRT"),
      },
    };
    const ringSwapped = {
      ...unsyncedConfig,
      forcedGear: {
        ...forcedGear,
        ring: fixedMateria(42216, "CRT"),
        ring2: fixedMateria(42216, "SKS"),
      },
    };
    const asymmetricTiers = findFeasibleGcdsLocally(ringAsymmetric);
    const swappedTiers = findFeasibleGcdsLocally(ringSwapped);
    expect(asymmetricTiers).toEqual(swappedTiers);
    expect(asymmetricTiers).toEqual([
      2.43, 2.42, 2.41, 2.4, 2.39, 2.38, 2.37,
      2.36, 2.35, 2.34, 2.33, 2.32, 2.31,
    ]);
  }, 120_000);

  it("uses only a fixed Resistance allocation in the GCD speed profile", () => {
    const resistanceWeapon = gears.find((gear) =>
      gear.jobs.includes("WAR") &&
      gear.slot === "weapon" &&
      gear.resistanceWeaponAdjust !== undefined,
    );
    if (resistanceWeapon?.resistanceWeaponAdjust === undefined) {
      throw new Error("缺少 WAR Resistance 武器测试数据");
    }
    const speedStat = resistanceWeapon.resistanceWeaponAdjust.stats.find(
      (stat): stat is "SKS" => stat === "SKS",
    );
    if (speedStat === undefined) {
      throw new Error("WAR Resistance 武器没有技速参数");
    }
    const baseStats = concretizeGearStats(
      resistanceWeapon.stats,
      jobSchemas.WAR,
    );
    const baseSpeed = baseStats[speedStat] ?? 0;
    const maximum = resistanceWeapon.resistanceWeaponAdjust.maxEachStat;
    const query = (allocation: number): OptimizationConfig => ({
      ...config,
      syncLevel: undefined,
      minItemLevel: 1,
      maxItemLevel: 795,
      forcedGear: {
        ...forcedGear,
        weapon: {
          id: resistanceWeapon.id,
          customStats: { [speedStat]: baseSpeed + allocation } as Partial<
            Record<Stat, number>
          >,
        },
      },
    });
    const baseAllocationSpeed = maximumFeasibleSpeed(query(0));
    const fixedAllocationSpeed = maximumFeasibleSpeed(query(maximum));
    expect(baseAllocationSpeed).toBe(1953);
    expect(fixedAllocationSpeed).toBe(2155);
  }, 120_000);

  it("rejects malformed forced materia capacity instead of falling back to auto profiles", () => {
    expect(() => findFeasibleGcdsLocally({
      ...config,
      forcedGear: {
        ...forcedGear,
        head: { id: 42166, melds: [] },
      },
    })).toThrow(/强制魔晶石数组长度/);
  });

  it("validates the GCD query configuration before building candidate profiles", () => {
    expect(() => findFeasibleGcdsLocally({
      ...config,
      minItemLevel: 664,
      maxItemLevel: 663,
    })).toThrow("装备品级范围无效");
    expect(() => findFeasibleGcdsLocally({ ...config, syncLevel: 0 }))
      .toThrow("等级同步品级必须是正整数");
    expect(() => findFeasibleGcdsLocally({ ...config, clanIndex: -1 }))
      .toThrow();
    expect(() => findFeasibleGcdsLocally({
      ...config,
      forcedGear: {
        ...forcedGear,
        head: { id: "invalid" } as unknown as ForcedGearValue,
      },
    })).toThrow(/槽位 head 的强制装备配置无效/);
  });

  it("rejects tenacity constraints for a job that does not use tenacity", () => {
    expect(() => findFeasibleGcdsLocally({
      ...config,
      jobId: "BLM",
      minItemLevel: 1,
      maxItemLevel: 795,
      forcedGear: {},
      minTenacity: 1,
    })).toThrow("职业 BLM 不使用坚韧属性");
  });

  it("returns no tiers for an unavailable food and reports GCD preparation progress", () => {
    expect(findFeasibleGcdsLocally({ ...config, foodId: 999_999 })).toEqual([]);

    const progress: string[] = [];
    expect(findFeasibleGcdsLocally(config, { onProgress: (message) => progress.push(message) }))
      .toContain(2.4);
    expect(progress[0]).toContain("正在按装备二进制索引准备 GCD 候选");
    expect(progress.some((message) => message.startsWith("GCD速度与坚韧状态："))).toBe(true);
  }, 120_000);

  it("builds automatic profiles for numeric Resistance and custom-parameter gear locks", () => {
    const resistanceWeapon = gears.find((gear) =>
      gear.jobs.includes("WAR") &&
      gear.slot === "weapon" &&
      gear.resistanceWeaponAdjust !== undefined,
    );
    const customWeapon = gears.find((gear) =>
      gear.jobs.includes("WAR") &&
      gear.slot === "weapon" &&
      gear.customParameters?.length === 4,
    );
    if (resistanceWeapon === undefined || customWeapon === undefined) {
      throw new Error("缺少 WAR Resistance 或自定义参数武器测试数据");
    }
    const automaticConfig = {
      ...config,
      syncLevel: undefined,
      minItemLevel: 1,
      maxItemLevel: 795,
    };
    const resistanceTiers = findFeasibleGcdsLocally({
      ...automaticConfig,
      forcedGear: { ...forcedGear, weapon: resistanceWeapon.id },
    });
    const customTiers = findFeasibleGcdsLocally({
      ...automaticConfig,
      forcedGear: { ...forcedGear, weapon: customWeapon.id },
    });
    expect(resistanceTiers.length).toBeGreaterThan(0);
    expect(customTiers.length).toBeGreaterThan(0);
  }, 120_000);

  it("fails closed when automatic materia or custom-parameter source data is malformed", () => {
    const regularGear = getGearById(42166);
    const customWeapon = gears.find((gear) =>
      gear.jobs.includes("WAR") &&
      gear.slot === "weapon" &&
      gear.customParameters?.length === 4,
    );
    if (regularGear === undefined || customWeapon?.customParameters === undefined) {
      throw new Error("缺少自动魔晶石或自定义参数武器测试数据");
    }
    const automaticConfig = {
      ...config,
      syncLevel: undefined,
      minItemLevel: 1,
      maxItemLevel: 795,
    };

    const originalRestrictions = gameData.materiaGradeIsRestricted;
    gameData.materiaGradeIsRestricted = originalRestrictions.slice(1);
    try {
      expect(() => findFeasibleGcdsLocally(automaticConfig))
        .toThrow("魔晶石禁断等级数据与等级要求数据长度不一致");
    } finally {
      gameData.materiaGradeIsRestricted = originalRestrictions;
    }

    const originalMateriaValues = gameData.materias.CRT;
    gameData.materias.CRT = [];
    try {
      expect(() => findFeasibleGcdsLocally(automaticConfig))
        .toThrow("魔晶石 CRT 缺少");
    } finally {
      gameData.materias.CRT = originalMateriaValues;
    }

    const originalCustomParameters = customWeapon.customParameters;
    customWeapon.customParameters = originalCustomParameters.slice(0, 3);
    try {
      expect(() => findFeasibleGcdsLocally({
        ...automaticConfig,
        forcedGear: { ...forcedGear, weapon: customWeapon.id },
      })).toThrow(/槽位数 3 不是 4/);
    } finally {
      customWeapon.customParameters = originalCustomParameters;
    }
  }, 120_000);

  it("applies enabled special stats and ranks same-speed ring profiles", () => {
    const source = getGearById(42166);
    const sourceRing = getGearById(42216);
    if (source === undefined || sourceRing === undefined) {
      throw new Error("缺少合成 GCD profile 测试所需装备数据");
    }
    const plainGear = {
      ...source,
      materiaSlots: 0,
      materiaAdvanced: undefined,
      customParameters: undefined,
      resistanceWeaponAdjust: undefined,
      itemSpecialBonus: undefined,
      specialStats: undefined,
    };
    const specialGear = {
      ...plainGear,
      id: source.id + 1_000_000,
      itemSpecialBonus: 77,
      specialStats: { SKS: 50, TEN: 5 },
    };
    const ringGear = (id: number, tenacity: number) => ({
      ...sourceRing,
      id,
      materiaSlots: 0,
      materiaAdvanced: undefined,
      unique: false,
      customParameters: undefined,
      resistanceWeaponAdjust: undefined,
      itemSpecialBonus: undefined,
      specialStats: undefined,
      stats: { ...sourceRing.stats, TEN: tenacity },
    });
    const ringCandidates = [
      ringGear(2_000_001, 10),
      ringGear(2_000_002, 12),
      ringGear(2_000_002, 14),
      ringGear(2_000_003, 9),
    ];
    const dependencies = {
      getJobLevel: calculationJobLevelFor,
      slotsForJob,
      gearOptionsFor: (_config: OptimizationConfig, slot: GearSlot) =>
        slot === "ring"
          ? ringCandidates
          : slot === "weapon"
            ? [specialGear]
            : [plainGear],
    };
    const specialConfig = {
      ...config,
      syncLevel: undefined,
      minItemLevel: 1,
      maxItemLevel: 795,
      forcedGear: {},
      maximizeTenacity: true,
      enabledItemSpecialBonuses: [77],
    };
    const withSpecialBonus = calculateFeasibleGcdTiers(
      specialConfig,
      {},
      dependencies,
    );
    const withoutSpecialBonus = calculateFeasibleGcdTiers(
      { ...specialConfig, enabledItemSpecialBonuses: undefined },
      {},
      dependencies,
    );
    expect(withSpecialBonus.length).toBeGreaterThan(0);
    expect(withSpecialBonus).not.toEqual(withoutSpecialBonus);
  }, 120_000);
});

describe("GCD query without available slot candidates", () => {
  const beastmaster: OptimizationConfig = {
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
    gcdChoices: [],
  };

  it("reports the slots that have no candidates when a source exclusion empties them", () => {
    expect(() =>
      findFeasibleGcdsLocally({
        ...beastmaster,
        excludedSources: ["斗兽奇弈"],
      })
    ).toThrow(/以下槽位没有可用候选装备：.*武器.*盾牌/s);
  });

  it("reports the slot that is emptied by a forced gear outside the item level range", () => {
    expect(() =>
      findFeasibleGcdsLocally({
        ...beastmaster,
        forcedGear: { weapon: 50_742 },
      })
    ).toThrow(/以下槽位没有可用候选装备：武器/);
  });

  it("still returns tiers when the exclusions leave every slot with candidates", () => {
    const tiers = findFeasibleGcdsLocally({
      ...beastmaster,
      minItemLevel: 0,
      excludedSources: ["斗兽奇弈"],
    });
    expect(tiers.length).toBeGreaterThan(0);
  });
});
