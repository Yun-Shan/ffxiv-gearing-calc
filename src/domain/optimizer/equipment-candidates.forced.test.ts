import { describe, expect, it } from "vitest";
import { foods, gameData, gears } from "../data.ts";
import {
  calculationJobLevelFor,
  gearOptionsFor,
  slotsForJob,
} from "../gear-options.ts";
import {
  capGearStatsAtLevel,
  concretizeGearStats,
  effectiveGearSyncLevel,
  getGearStatCap,
} from "../rules.ts";
import { equipmentIdentity } from "../search/equipment-identity.ts";
import { jobSchemas } from "../jobs.ts";
import type {
  Gear,
  GearSlot,
  JobId,
  Materia,
  MeldedGear,
  OptimizationConfig,
  Stats,
} from "../types.ts";
import {
  materiaAttributeStats,
  materiaForGrade,
  highestMateriaGrade,
  makeGearCandidates,
} from "./equipment-candidates.ts";
import { customParameterMelds } from "../custom-gear-parameters.ts";
import { prepareSearch } from "./search-preparation.ts";
import { runOptimizationLocally } from "./single-search.ts";
import { candidateGearFromInfo } from "./result-assembly.ts";
import { runJointOptimizationLocally } from "./joint-search.ts";

function configFor(jobId: JobId = "SAM"): OptimizationConfig {
  return {
    clanIndex: 0,
    objective: "damage",
    jobId,
    minItemLevel: 0,
    maxItemLevel: 9999,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},

    foodId: 0,
  };
}

function advancedGear(): Gear {
  const item = gears.find(
    (gear) =>
      gear.jobs.includes("SAM") &&
      gear.slot === "body" &&
      gear.materiaAdvanced === true &&
      gear.materiaSlots >= 1 &&
      gear.materiaSlots <= 3 &&
      gameData.materiaGradeRequiredLevels.some(
        (requiredLevel, index) =>
          gameData.materiaGradeIsRestricted[index + 1] === true &&
          requiredLevel <= gear.level,
      ) &&
      gear.customParameters === undefined &&
      gear.resistanceWeaponAdjust === undefined,
  );
  if (item === undefined) throw new Error("缺少带 1–3 个常规孔的禁断测试装备");
  return item;
}

function capacityOf(gear: Gear): number {
  return gear.materiaAdvanced === true ? 5 : gear.materiaSlots;
}

function layoutKey(melds: readonly Materia[]): string {
  return melds
    .map(
      ({ slotIndex, stat, value, grade }) =>
        `${slotIndex}:${stat}:${value}:${grade}`,
    )
    .join("|");
}

function expectedLayouts(
  gear: Gear,
  fixed: readonly (Materia | null)[],
  jobId: JobId,
): Materia[][] {
  const highGrade = highestMateriaGrade(gear.level, true);
  const lowGrade = highestMateriaGrade(gear.level, false);
  const stats = materiaAttributeStats(jobId);
  const output: Materia[][] = [];
  const current: Materia[] = [];
  function walk(index: number): void {
    if (index === fixed.length) {
      output.push(current.map((meld) => ({ ...meld })));
      return;
    }
    const locked = fixed[index];
    if (locked !== null) {
      current[index] = { ...locked, slotIndex: index };
      walk(index + 1);
      return;
    }
    const grade = index <= gear.materiaSlots ? highGrade : lowGrade;
    for (const stat of stats) {
      current[index] = { ...materiaForGrade(stat, grade), slotIndex: index };
      walk(index + 1);
    }
  }
  walk(0);
  return output;
}

describe("forced materia candidate generation", () => {
  it("keeps fixed positions while filling nulls with all automatic legal choices", () => {
    const gear = advancedGear();
    const highGrade = highestMateriaGrade(gear.level, true);
    const lowGrade = highestMateriaGrade(gear.level, false);
    const fixed: (Materia | null)[] = new Array(capacityOf(gear)).fill(null);
    fixed[0] = materiaForGrade("CRT", highGrade);
    fixed[gear.materiaSlots] = materiaForGrade("DET", highGrade);
    fixed[gear.materiaSlots + 1] = materiaForGrade("DHT", lowGrade);
    const config = {
      ...configFor(),
      forcedGear: { body: { id: gear.id, melds: fixed } },
    };
    const candidates = makeGearCandidates(gear, "body", config, new Map());
    const expected = expectedLayouts(gear, fixed, config.jobId);

    expect(
      candidates
        .map(({ gear: candidate }) => layoutKey(candidate.melds))
        .sort(),
    ).toEqual(expected.map(layoutKey).sort());
    expect(candidates).toHaveLength(
      Math.pow(materiaAttributeStats(config.jobId).length, 2),
    );
    for (const { gear: candidate } of candidates) {
      expect(candidate.melds).toHaveLength(5);
      expect(candidate.melds.map(({ slotIndex }) => slotIndex)).toEqual([
        0, 1, 2, 3, 4,
      ]);
      expect(candidate.melds[0]).toMatchObject({ ...fixed[0], slotIndex: 0 });
      expect(candidate.melds[gear.materiaSlots]).toMatchObject({
        ...fixed[gear.materiaSlots],
        slotIndex: gear.materiaSlots,
      });
      expect(candidate.melds[gear.materiaSlots + 1]).toMatchObject({
        ...fixed[gear.materiaSlots + 1],
        slotIndex: gear.materiaSlots + 1,
      });
      for (const meld of candidate.melds.slice(gear.materiaSlots + 1)) {
        expect(gameData.materiaGradeIsRestricted[meld.grade]).toBe(false);
      }
    }
  });

  it("accepts a fixed materia whose only effect is wasted at the stat cap", () => {
    const raw = advancedGear();
    const stat = materiaAttributeStats("SAM")[0]!;
    const cap = getGearStatCap(raw, stat, raw.level);
    const gear: Gear = { ...raw, stats: { ...raw.stats, [stat]: cap } };
    const fixed: (Materia | null)[] = new Array(capacityOf(gear)).fill(null);
    fixed[0] = materiaForGrade(stat, highestMateriaGrade(gear.level, true));
    const automatic = makeGearCandidates(
      gear,
      gear.slot,
      configFor(),
      new Map(),
    );
    const locked = makeGearCandidates(
      gear,
      gear.slot,
      {
        ...configFor(),
        forcedGear: { [gear.slot]: { id: gear.id, melds: fixed } },
      },
      new Map(),
    );

    expect(
      automatic.every(({ gear: candidate }) =>
        candidate.melds.every((meld) => meld.stat !== stat),
      ),
    ).toBe(true);
    expect(locked.length).toBeGreaterThan(0);
    expect(
      locked.every(
        ({ gear: candidate }) =>
          candidate.melds[0]?.stat === stat &&
          candidate.melds[0]?.slotIndex === 0 &&
          candidate.finalStats[stat] === cap,
      ),
    ).toBe(true);
  });

  it("rejects wrong grade values, unsafe later overmelds, bad positions, and malformed payloads", () => {
    const gear = advancedGear();
    const capacity = capacityOf(gear);
    const fixed: (Materia | null)[] = new Array(capacity).fill(null);
    const highGrade = highestMateriaGrade(gear.level, true);
    fixed[0] = {
      ...materiaForGrade("CRT", highGrade),
      value: materiaForGrade("CRT", highGrade).value + 1,
    };
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: fixed } },
        },
        new Map(),
      ),
    ).toThrow(/等级或属性值不合法/);

    const restrictedGrade = materiaGradeRequiredLevelsIndex(gear);
    fixed[0] = null;
    fixed[gear.materiaSlots + 1] = materiaForGrade("CRT", restrictedGrade);
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: fixed } },
        },
        new Map(),
      ),
    ).toThrow(/等级或属性值不合法/);

    fixed[gear.materiaSlots + 1] = {
      ...materiaForGrade("CRT", highestMateriaGrade(gear.level, false)),
      slotIndex: 0,
    };
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: fixed } },
        },
        new Map(),
      ),
    ).toThrow(/slotIndex 不一致/);

    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: [null] } },
        },
        new Map(),
      ),
    ).toThrow(/数组长度必须是/);
    const sparse = new Array<Materia | null>(capacity);
    sparse[0] = null;
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: sparse } },
        },
        new Map(),
      ),
    ).toThrow(/强制魔晶石数据无效/);
    fixed[0] = { ...materiaForGrade("CRT", highGrade), unknown: true } as never;
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: fixed } },
        },
        new Map(),
      ),
    ).toThrow(/未知字段/);
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: {
            body: { id: gear.id, melds: fixed, customStats: {} },
          } as never,
        },
        new Map(),
      ),
    ).toThrow(/必须且只能包含/);
  });

  it("rejects a fixed materia whose grade is above the gear level", () => {
    const gear = gears.find(
      (candidate) =>
        candidate.jobs.includes("SAM") &&
        candidate.slot === "body" &&
        candidate.materiaSlots > 0 &&
        candidate.customParameters === undefined &&
        candidate.resistanceWeaponAdjust === undefined &&
        gameData.materiaGradeRequiredLevels.some(
          (requiredLevel) => requiredLevel > candidate.level,
        ),
    );
    if (gear === undefined) throw new Error("缺少低等级固定镶嵌测试装备");

    const grade =
      gameData.materiaGradeRequiredLevels.findIndex(
        (requiredLevel) => requiredLevel > gear.level,
      ) + 1;
    const fixed = new Array<Materia | null>(capacityOf(gear)).fill(null);
    fixed[0] = materiaForGrade("CRT", grade);

    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor("SAM"),
          forcedGear: { body: { id: gear.id, melds: fixed } },
        },
        new Map(),
      ),
    ).toThrow(/等级或属性值不合法/);
  });

  it("fails malformed slot maps and rejects unsupported forced materia without changing numeric IDs", () => {
    const gear = advancedGear();
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        { ...configFor(), forcedGear: null as never },
        new Map(),
      ),
    ).toThrow(/按槽位索引/);

    const capacity = capacityOf(gear);
    const fixed = new Array<Materia | null>(capacity).fill(null);
    fixed[0] = {
      stat: "STR",
      value: 1,
      grade: 1,
    } as never;
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: fixed } },
        },
        new Map(),
      ),
    ).toThrow(/不能镶嵌 STR/);

    fixed[0] = { stat: "CRT", value: 1, grade: 999 };
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: { body: { id: gear.id, melds: fixed } },
        },
        new Map(),
      ),
    ).toThrow(/等级或属性值不合法/);

    expect(
      makeGearCandidates(
        gear,
        "body",
        {
          ...configFor(),
          forcedGear: {
            body: { id: gear.id + 1, melds: new Array(capacity).fill(null) },
          },
        },
        new Map(),
      ),
    ).toEqual([]);
  });

  it("keeps grade lookup failures explicit for unsupported item levels and materia grades", () => {
    expect(() => highestMateriaGrade(1, true)).toThrow(/没有可用魔晶石等级/);
    expect(() => highestMateriaGrade(1, false)).toThrow(
      /没有限制孔可用的魔晶石等级/,
    );
    expect(() =>
      materiaForGrade("CRT", gameData.materiaGradeRequiredLevels.length + 1),
    ).toThrow(/缺少/);
  });

  it("retains validated stored materia restrictions while ordinary materia has no sync effect", () => {
    const syncLevel = gameData.sync.levels.find(({ jobLevel }) => jobLevel === 80)!.defaultItemLevel;
    const gear = gears.find(
      (item) =>
        item.jobs.includes("SAM") &&
        item.slot === "body" &&
        item.materiaAdvanced === true &&
        item.level > syncLevel &&
        item.customParameters === undefined &&
        item.resistanceWeaponAdjust === undefined,
    );
    if (gear === undefined) throw new Error("缺少可同步的禁断装备测试项");
    const fixed: (Materia | null)[] = new Array(capacityOf(gear)).fill(null);
    fixed[0] = materiaForGrade("CRT", highestMateriaGrade(gear.level, true));
    const config = {
      ...configFor(),
      sync: { kind: "jobLevel" as const, value: 80 },
      forcedGear: { body: { id: gear.id, melds: fixed } },
    };
    const candidate = makeGearCandidates(gear, "body", config, new Map())[0]!;
    const base = concretizeGearStats(gear.stats, jobSchemas[config.jobId]);
    expect(candidate.gear.melds).toEqual([]);
    const syncedLevel = effectiveGearSyncLevel(
      gear,
      calculationJobLevelFor(config),
      config.sync,
    )!;
    expect(candidate.gear.finalStats).toEqual(
      capGearStatsAtLevel(gear, base, syncedLevel),
    );
    expect(() =>
      makeGearCandidates(
        gear,
        "body",
        {
          ...config,
          forcedGear: {
            body: {
              id: gear.id,
              melds: [
                {
                  ...materiaForGrade(
                    "CRT",
                    highestMateriaGrade(gear.level, true),
                  ),
                  value: -1,
                },
                ...fixed.slice(1),
              ],
            },
          },
        },
        new Map(),
      ),
    ).toThrow(/等级或属性值不合法/);
  });

  it("keeps numeric forcing equivalent and makes a custom parameter allocation exactly once", () => {
    const normal = gears.find(
      (gear) =>
        gear.jobs.includes("SAM") &&
        gear.slot === "head" &&
        gear.customParameters === undefined &&
        gear.resistanceWeaponAdjust === undefined,
    );
    if (normal === undefined) throw new Error("缺少普通装备测试项");
    const plain = makeGearCandidates(normal, "head", configFor(), new Map());
    const numeric = makeGearCandidates(
      normal,
      "head",
      {
        ...configFor(),
        forcedGear: { head: normal.id },
      },
      new Map(),
    );
    expect(numeric.map(({ equipment }) => equipment)).toEqual(
      plain.map(({ equipment }) => equipment),
    );

    const weapon = gears.find(
      (gear) =>
        gear.jobs.includes("SAM") &&
        gear.slot === "weapon" &&
        gear.customParameters?.length === 4,
    );
    if (weapon === undefined) throw new Error("缺少自定义参数武器测试项");
    const allocations = customParameterMelds(weapon)[0]!;
    const base = concretizeGearStats(weapon.stats, jobSchemas.SAM);
    const customStats: Stats = {};
    for (const meld of allocations)
      customStats[meld.stat] = (base[meld.stat] ?? 0) + meld.value;
    const candidates = makeGearCandidates(
      weapon,
      "weapon",
      {
        ...configFor(),
        forcedGear: { weapon: { id: weapon.id, customStats } },
      },
      new Map(),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.gear.melds).toEqual(allocations);

    expect(() =>
      makeGearCandidates(
        weapon,
        "weapon",
        {
          ...configFor(),
          forcedGear: { weapon: { id: weapon.id, melds: [] } },
        },
        new Map(),
      ),
    ).toThrow(/不能使用普通魔晶石锁定/);
  });

  it("allows fixed healer PIE but does not add PIE to automatic materia choices", () => {
    const gear = gears.find(
      (item) =>
        item.jobs.includes("WHM") &&
        item.slot === "head" &&
        item.materiaSlots > 0 &&
        item.customParameters === undefined &&
        item.resistanceWeaponAdjust === undefined,
    );
    if (gear === undefined) throw new Error("缺少治疗职业镶嵌测试装备");
    const capacity = capacityOf(gear);
    const automatic = makeGearCandidates(
      gear,
      "head",
      {
        ...configFor("WHM"),
        forcedGear: {
          head: { id: gear.id, melds: new Array(capacity).fill(null) },
        },
      },
      new Map(),
    );
    const fixed = new Array<Materia | null>(capacity).fill(null);
    fixed[0] = materiaForGrade("PIE", highestMateriaGrade(gear.level, true));
    const pieLocked = makeGearCandidates(
      gear,
      "head",
      {
        ...configFor("WHM"),
        forcedGear: { head: { id: gear.id, melds: fixed } },
      },
      new Map(),
    );

    expect(automatic.length).toBeGreaterThan(0);
    expect(
      automatic.every(({ gear: candidate }) =>
        candidate.melds.every(({ stat }) => stat !== "PIE"),
      ),
    ).toBe(true);
    expect(pieLocked).toHaveLength(
      Math.pow(materiaAttributeStats("WHM").length, capacity - 1),
    );
    expect(
      pieLocked.every(
        ({ gear: candidate }) =>
          candidate.melds[0]?.stat === "PIE" &&
          candidate.melds[0]?.slotIndex === 0 &&
          candidate.melds.slice(1).every(({ stat }) => stat !== "PIE"),
      ),
    ).toBe(true);
  });

  it("shares position-independent materia combinations across jobs", () => {
    const gear = gears.find(
      (item) =>
        item.jobs.includes("WAR") &&
        item.jobs.includes("PLD") &&
        item.slot === "body" &&
        item.materiaSlots >= 2 &&
        item.customParameters === undefined &&
        item.resistanceWeaponAdjust === undefined,
    );
    if (gear === undefined) throw new Error("缺少坦克共享身体装备测试项");
    const capacity = capacityOf(gear);
    const firstHole = new Array<Materia | null>(capacity).fill(null);
    const secondHole = new Array<Materia | null>(capacity).fill(null);
    const fixedMateria = materiaForGrade(
      "CRT",
      highestMateriaGrade(gear.level, true),
    );
    firstHole[0] = fixedMateria;
    secondHole[0] = materiaForGrade(
      "DET",
      highestMateriaGrade(gear.level, true),
    );
    const candidateIdentities = (
      jobId: JobId,
      melds: readonly (Materia | null)[],
    ) =>
      new Set(
        makeGearCandidates(
          gear,
          "body",
          {
            ...configFor(jobId),
            forcedGear: { body: { id: gear.id, melds } },
          },
          new Map(),
        ).map(({ equipment }) => equipmentIdentity(equipment)),
      );
    const warFirst = candidateIdentities("WAR", firstHole);
    const pldFirst = candidateIdentities("PLD", firstHole);
    const pldConflicting = candidateIdentities("PLD", secondHole);
    const intersection = (left: Set<string>, right: Set<string>) =>
      [...left].filter((identity) => right.has(identity));

    expect(warFirst.size).toBeGreaterThan(0);
    expect(intersection(warFirst, pldFirst)).toHaveLength(warFirst.size);
    expect(intersection(warFirst, pldConflicting).length).toBeGreaterThan(0);
  });

  it("restores two copies of a non-unique ring without aliasing their fixed hole layouts", () => {
    const ring = gears.find((gear) =>
      gear.slot === "ring" && gear.unique === false &&
      gear.jobs.includes("SAM") && gear.materiaSlots >= 2 &&
      gear.customParameters === undefined && gear.resistanceWeaponAdjust === undefined,
    );
    if (ring === undefined) throw new Error("缺少两安全孔非唯一戒指测试装备");
    const first = Array.from({ length: capacityOf(ring) }, (_, index) =>
      materiaForGrade(index === 0 ? "CRT" : "DET", highestMateriaGrade(ring.level, index <= ring.materiaSlots)),
    );
    const second = [...first];
    [second[0], second[1]] = [first[1]!, first[0]!];
    const config: OptimizationConfig = {
      ...configFor(),
      forcedGear: { ring: { id: ring.id, melds: first }, ring2: { id: ring.id, melds: second } },
    };
    const gearsByIdentity = new Map<string, MeldedGear>();
    const firstCandidate = makeGearCandidates(ring, "ring", config, gearsByIdentity)[0]!;
    const secondCandidate = makeGearCandidates(ring, "ring2", config, gearsByIdentity)[0]!;
    expect(firstCandidate.gear.finalStats).toEqual(secondCandidate.gear.finalStats);
    expect(equipmentIdentity(firstCandidate.equipment)).toBe(equipmentIdentity(secondCandidate.equipment));
    expect(gearsByIdentity.size).toBe(1);
    const prepared = { gearsByIdentity, forcedGear: config.forcedGear };
    expect(candidateGearFromInfo(firstCandidate.equipment, "ring", prepared).melds[0]?.stat).toBe("CRT");
    expect(candidateGearFromInfo(secondCandidate.equipment, "ring2", prepared).melds[0]?.stat).toBe("DET");
  });

  it("rejects inconsistent shared hole settings before searching", async () => {
    await expect(runJointOptimizationLocally({
      objective: "damage",
      jobs: [configFor("WAR"), {
        ...configFor("PLD"),
        forcedGear: { body: { id: 123, melds: [null] } },
      }],
      commonSlots: ["body"], foodStrategy: "shared",
    })).rejects.toThrow("强制配置必须在所有职业中一致");
  });

  it("preserves absolute fixed Resistance stats above an ordinary materia cap", () => {
    const gear = gears.find((item) => item.id === 32671);
    if (gear === undefined || gear.resistanceWeaponAdjust === undefined) {
      throw new Error("缺少 WAR 32671 Resistance 回归装备");
    }
    const base = concretizeGearStats(gear.stats, jobSchemas.WAR);
    const customStats = { CRT: 202 } satisfies Stats;
    const cap = getGearStatCap(gear, "CRT", gear.level);
    const candidates = makeGearCandidates(
      gear,
      "weapon",
      {
        ...configFor("WAR"),
        forcedGear: { weapon: { id: gear.id, customStats } },
      },
      new Map(),
    );

    expect(cap).toBe(201);
    expect(base.CRT ?? 0).toBe(0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.gear.finalStats.CRT).toBe(202);
    expect(candidates[0]!.gear.melds).toEqual([
      { stat: "CRT", value: 202, grade: 0 },
    ]);

    const syncLevel = gameData.levelCaps.level.filter(
      (level) => level < gear.level,
    ).sort((left, right) => right - left)[0];
    if (syncLevel === undefined || syncLevel >= gear.level) {
      throw new Error("缺少 WAR 32671 可用的同步测试品级");
    }
    const synced = makeGearCandidates(
      gear,
      "weapon",
      {
        ...configFor("WAR"),
        sync: { kind: "itemLevel" as const, value: syncLevel },
        forcedGear: { weapon: { id: gear.id, customStats } },
      },
      new Map(),
    );
    expect(synced[0]!.gear.finalStats).toEqual(
      capGearStatsAtLevel(gear, { ...base, ...customStats }, syncLevel),
    );
  });

  it("runs a fixed Resistance allocation through the real optimizer without free allocation metadata", async () => {
    const baseConfig = configFor();
    const resistance = gearOptionsFor(baseConfig, "weapon").find(
      (gear) =>
        gear.resistanceWeaponAdjust !== undefined &&
        gear.resistanceWeaponAdjust.maxEachStat > 0 &&
        gear.resistanceWeaponAdjust.maxTotalStats > 0,
    );
    if (resistance === undefined)
      throw new Error("缺少当前职业可用的 Resistance 武器");

    const forcedGear: OptimizationConfig["forcedGear"] = {};
    for (const slot of slotsForJob("SAM")) {
      if (slot === "weapon") continue;
      const pool = gearOptionsFor(baseConfig, slot);
      const selected = pool.find((gear) =>
        slot === "ring" || slot === "ring2"
          ? gear.unique === false &&
            gear.customParameters === undefined &&
            gear.resistanceWeaponAdjust === undefined
          : gear.customParameters === undefined &&
            gear.resistanceWeaponAdjust === undefined,
      );
      if (selected === undefined) throw new Error(`缺少 ${slot} 搜索测试装备`);
      forcedGear[slot] = selected.id;
    }
    const ringId = forcedGear.ring;
    forcedGear.ring2 = typeof ringId === "number" ? ringId : undefined;
    const stat = resistance.resistanceWeaponAdjust!.stats[0]!;
    const amount = Math.min(
      10,
      resistance.resistanceWeaponAdjust!.maxEachStat,
      resistance.resistanceWeaponAdjust!.maxTotalStats,
    );
    const base = concretizeGearStats(resistance.stats, jobSchemas.SAM);
    forcedGear.weapon = {
      id: resistance.id,
      customStats: { [stat]: (base[stat] ?? 0) + amount },
    };
    const foodId =
      foods.find((food) => food.best && (food.stats.VIT ?? 0) > 0)?.id ?? 0;
    const config: OptimizationConfig = {
      ...baseConfig,
      forcedGear,
      foodId,
      maxSearchMs: 20_000,
    };
    const prepared = prepareSearch(config, {});
    const weaponSlot = prepared.slots.find(({ name }) => name === "weapon");
    expect(weaponSlot).toBeDefined();
    expect(weaponSlot!.candidates).toHaveLength(1);
    expect(weaponSlot!.candidates[0]).not.toHaveProperty(
      "resistanceWeaponAdjust",
    );

    const result = await runOptimizationLocally(config);
    expect(result).toBeDefined();
    const selected = result!.gear.find(({ slot }) => slot === "weapon")!;
    expect(selected.id).toBe(resistance.id);
    expect(selected.melds).toEqual([{ stat, value: amount, grade: 0 }]);
    expect(selected.finalStats[stat]).toBe((base[stat] ?? 0) + amount);
  });
});

function materiaGradeRequiredLevelsIndex(gear: Gear): number {
  const grade = gameData.materiaGradeIsRestricted.findIndex(
    (restricted, index) =>
      index > 0 &&
      restricted === true &&
      gameData.materiaGradeRequiredLevels[index - 1]! <= gear.level,
  );
  if (grade <= 0) throw new Error("测试装备没有适用的受限魔晶石等级");
  return grade;
}
