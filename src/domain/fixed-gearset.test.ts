import { describe, expect, it } from "vitest";
import {
  foods,
  gameData,
  gears,
  getGearById,
  materiaGradeRequiredLevels,
} from "./data.ts";
import {
  calculationJobLevelFor,
  jobLevelFor,
} from "./job-level.ts";
import { jobSchemas } from "./jobs.ts";
import { slotsForJob } from "./gear-options.ts";
import {
  customParameterMelds,
  foodStatsForJob,
} from "./optimizer/equipment-candidates.ts";
import {
  addStats,
  applyFood,
  calculateBaseStats,
  capGearStatsAtLevel,
  concretizeGearStats,
  effectiveGearSyncLevel,
  getGearStatCap,
} from "./rules.ts";
import {
  calculateFixedGearset,
  type FixedGearsetGearInput,
  type FixedGearsetInput,
} from "./fixed-gearset.ts";
import type { GearSlot, JobId, Materia, Stats } from "./types.ts";

const defaultJob: JobId = "SAM";

function inputFor(
  jobId: JobId = defaultJob,
  syncLevel?: number,
  overrides: Partial<Record<GearSlot, FixedGearsetGearInput>> = {},
): FixedGearsetInput {
  const jobLevel = calculationJobLevelFor({
    jobId,
    ...(syncLevel === undefined ? {} : { syncLevel }),
  });
  const characterLevel = jobLevelFor({ jobId });
  const usedRings = new Set<number>();
  const gearInputs = slotsForJob(jobId).map((slot): FixedGearsetGearInput => {
    const override = overrides[slot];
    if (override !== undefined) return override;
    const sourceSlot = slot === "ring2" ? "ring" : slot;
    const gear = gears
      .filter((candidate) =>
        candidate.jobs.includes(jobId) &&
        candidate.slot === sourceSlot &&
        candidate.equipLevel <= characterLevel &&
        candidate.customParameters === undefined &&
        candidate.resistanceWeaponAdjust === undefined &&
        (sourceSlot !== "ring" || !usedRings.has(candidate.id)),
      )
      .toSorted((left, right) => right.level - left.level || left.id - right.id)[0];
    if (gear === undefined) throw new Error(`缺少测试装备 ${jobId}/${slot}`);
    if (sourceSlot === "ring") usedRings.add(gear.id);
    return { id: gear.id, materias: [] };
  });
  const food = foods.find((candidate) => candidate.id > 0);
  if (food === undefined) throw new Error("缺少测试食物");
  return {
    jobId,
    jobLevel,
    ...(syncLevel === undefined ? {} : { syncLevel }),
    gears: gearInputs,
    foodId: food.id,
  };
}

function gearInput(input: FixedGearsetInput, slot: GearSlot): FixedGearsetGearInput {
  const gear = input.gears.find(({ id }) => {
    const item = getGearById(id)!;
    return item.slot === (slot === "ring2" ? "ring" : slot);
  });
  if (gear === undefined) throw new Error(`缺少槽位 ${slot}`);
  return gear;
}

function replaceGear(
  input: FixedGearsetInput,
  slot: GearSlot,
  replacement: FixedGearsetGearInput,
): FixedGearsetInput {
  const existing = gearInput(input, slot);
  return {
    ...input,
    gears: input.gears.map((entry) => entry === existing ? replacement : entry),
  };
}

describe("calculateFixedGearset", () => {
  it("calculates a complete real loadout with the production food and damage rules", () => {
    const input = inputFor();
    const result = calculateFixedGearset(input);
    const job = jobSchemas[input.jobId];
    const baseStats = calculateBaseStats(job, input.jobLevel);
    const unbuffedStats = addStats(
      baseStats,
      ...result.gear.map(({ finalStats }) => finalStats),
    );
    const applicableFood = foodStatsForJob(result.food, input.jobId);
    const expectedStats = applyFood(
      unbuffedStats,
      applicableFood.stats,
      applicableFood.statRates,
    );

    expect(result.gear.map(({ slot }) => slot)).toEqual(slotsForJob(input.jobId));
    expect(result.stats).toEqual(expectedStats);
    expect(result.food.actualStats).toEqual(
      Object.fromEntries(
        Object.keys(result.food.stats).map((stat) => [
          stat,
          (expectedStats[stat as keyof Stats] ?? 0) -
            (unbuffedStats[stat as keyof Stats] ?? 0),
        ]),
      ),
    );
    expect(result.food.utilization).toBeGreaterThanOrEqual(0);
    expect(result.food.utilization).toBeLessThanOrEqual(100);
    expect(result.damagePerPotency).toBe(result.effects.damage);
    expect(result.damagePerSecond).toBe(result.effects.damage / result.effects.gcd);
  });

  it("uses the unified sync formula level while retaining the job cap for wearability", () => {
    const syncLevel = gameData.syncLevelOfJobLevels[80]!;
    const input = inputFor(defaultJob, syncLevel);
    const result = calculateFixedGearset(input);

    expect(result.calculationLevel).toBe(80);
    expect(result.syncItemLevel).toBe(syncLevel);
    expect(() => calculateFixedGearset({ ...input, jobLevel: 100 })).toThrow(
      "与当前统一计算等级 80 不一致",
    );
    expect(() => calculateFixedGearset({ ...input, syncLevel: 0 })).toThrow(
      "等级同步品级必须是正整数",
    );
  });

  it("keeps a level-94, item-level-663 piece wearable and unsynced at sync 665", () => {
    const item = getGearById(42_177);
    if (item === undefined) throw new Error("缺少 42177 回归装备");
    const jobId = "SAM" as const;
    expect(item.jobs).toContain(jobId);
    expect(item.level).toBe(663);
    expect(item.equipLevel).toBe(94);
    const input = inputFor(jobId, 665, {
      [item.slot]: { id: item.id, materias: [["CRT", 1]] },
    });
    const result = calculateFixedGearset(input);
    const selected = result.gear.find(({ id }) => id === item.id)!;
    const base = concretizeGearStats(item.stats, jobSchemas[jobId]);
    const expectedCrit = Math.min(
      getGearStatCap(item, "CRT", item.level),
      (base.CRT ?? 0) + gameData.materias.CRT![0]!,
    );

    expect(effectiveGearSyncLevel(item, jobLevelFor({ jobId }), 665)).toBeUndefined();
    expect(result.calculationLevel).toBe(input.jobLevel);
    expect(selected.melds[0]).toMatchObject({ stat: "CRT", grade: 1, slotIndex: 0 });
    expect(selected.finalStats.CRT).toBe(expectedCrit);
  });

  it("evaluates variable-level item 52439 using the job cap's equipment sync mapping", () => {
    const item = getGearById(52_439);
    if (item === undefined) throw new Error("缺少 52439 变量装备回归项");
    const jobId = item.jobs[0]!;
    const input = inputFor(jobId, 665, {
      [item.slot]: { id: item.id, materias: [] },
    });
    const result = calculateFixedGearset(input);
    const selected = result.gear.find(({ id }) => id === item.id)!;
    const base = concretizeGearStats(item.stats, jobSchemas[jobId]);
    const equipmentSync = effectiveGearSyncLevel(item, jobLevelFor({ jobId }), 665);
    const expected = equipmentSync === undefined
      ? base
      : capGearStatsAtLevel(item, base, equipmentSync);

    expect(item.equipLevelVariable).toBe(true);
    expect(selected.finalStats).toEqual(expected);
    expect(result.calculationLevel).toBe(input.jobLevel);
  });

  it("retains empty materia slots and low-grade materia at their original indices", () => {
    const input = inputFor();
    const bodyCandidates = gears.filter((candidate) =>
      candidate.jobs.includes(input.jobId) &&
      candidate.slot === "body" &&
      candidate.materiaAdvanced === true &&
      candidate.materiaSlots >= 1 &&
      candidate.materiaSlots <= 3 &&
      candidate.equipLevel <= jobLevelFor({ jobId: input.jobId }),
    );
    const selected = bodyCandidates[0];
    if (selected === undefined) throw new Error("缺少带禁断孔的测试装备");
    const grade = materiaGradeRequiredLevels.findIndex((required, index) =>
      required <= selected.level && gameData.materiaGradeIsRestricted[index + 1] === false,
    ) + 1;
    if (grade <= 0) throw new Error("缺少适用于测试装备的低级魔晶石");
    const lastSlot = selected.materiaSlots + 1;
    const materias: (readonly [Materia["stat"], number] | null)[] =
      new Array(lastSlot + 1).fill(null);
    materias[0] = ["CRT", grade];
    materias[lastSlot] = ["DET", grade];
    const configured = replaceGear(input, "body", {
      id: selected.id,
      materias,
    });

    const result = calculateFixedGearset(configured);
    const body = result.gear.find(({ slot }) => slot === "body")!;
    expect(body.melds.map(({ slotIndex }) => slotIndex)).toEqual([0, lastSlot]);
    expect(body.melds.map(({ grade: actualGrade }) => actualGrade)).toEqual([grade, grade]);
    expect(body.finalStats.CRT).toBeGreaterThanOrEqual(selected.stats.CRT ?? 0);
    expect(body.finalStats.DET).toBeGreaterThanOrEqual(selected.stats.DET ?? 0);
  });

  it("accepts two copies of a non-unique ring and rejects a duplicate unique ring", () => {
    const input = inputFor();
    const nonUniqueRing = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.slot === "ring" && candidate.unique === false,
    );
    if (nonUniqueRing === undefined) throw new Error("缺少非唯一戒指测试装备");
    const duplicateNonUnique = {
      ...input,
      gears: input.gears.map((entry) =>
        getGearById(entry.id)?.slot === "ring" ? { id: nonUniqueRing.id, materias: [] } : entry,
      ),
    };
    expect(calculateFixedGearset(duplicateNonUnique).gear.filter(({ slot }) => slot.startsWith("ring"))).toHaveLength(2);

    const uniqueRing = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.slot === "ring" && candidate.unique === true,
    );
    if (uniqueRing === undefined) throw new Error("缺少唯一戒指测试装备");
    const duplicateUnique = {
      ...input,
      gears: input.gears.map((entry) =>
        getGearById(entry.id)?.slot === "ring" ? { id: uniqueRing.id, materias: [] } : entry,
      ),
    };
    expect(() => calculateFixedGearset(duplicateUnique)).toThrow("唯一装备");
  });

  it("applies absolute Manderville parameters before the synchronization cap", () => {
    const syncLevel = gameData.syncLevelOfJobLevels[80]!;
    const input = inputFor(defaultJob, syncLevel);
    const weapon = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.slot === "weapon" &&
      candidate.customParameters?.length === 4,
    );
    if (weapon === undefined) throw new Error("缺少 Manderville 测试武器");
    const selectedMelds = customParameterMelds(weapon)[0]!;
    const base = concretizeGearStats(weapon.stats, jobSchemas[input.jobId]);
    const customStats: Stats = {};
    const absoluteStats: Stats = { ...base };
    for (const meld of selectedMelds) {
      absoluteStats[meld.stat] = (absoluteStats[meld.stat] ?? 0) + meld.value;
      customStats[meld.stat] = absoluteStats[meld.stat];
    }
    const configured = replaceGear(input, "weapon", {
      id: weapon.id,
      materias: [],
      customStats,
    });
    const result = calculateFixedGearset(configured);
    const importedWeapon = result.gear.find(({ slot }) => slot === "weapon")!;
    const sync = effectiveGearSyncLevel(weapon, input.jobLevel, syncLevel);
    const expected = sync === undefined
      ? absoluteStats
      : capGearStatsAtLevel(weapon, absoluteStats, sync);

    expect(importedWeapon.melds.map(({ grade }) => grade)).toEqual([0, 0, 0]);
    expect(importedWeapon.finalStats).toEqual(expected);
  });

  it("accepts zero and valid Resistance allocations and caps the absolute override after sync", () => {
    const syncLevel = gameData.syncLevelOfJobLevels[80]!;
    const input = inputFor(defaultJob, syncLevel);
    const weapon = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.slot === "weapon" &&
      candidate.resistanceWeaponAdjust !== undefined,
    );
    if (weapon === undefined) throw new Error("缺少 Resistance 测试武器");
    const stat = weapon.resistanceWeaponAdjust!.stats[0]!;
    const base = concretizeGearStats(weapon.stats, jobSchemas[input.jobId]);
    const amount = Math.min(10, weapon.resistanceWeaponAdjust!.maxEachStat);
    const configured = replaceGear(input, "weapon", {
      id: weapon.id,
      materias: [],
      customStats: { [stat]: (base[stat] ?? 0) + amount },
    });
    const result = calculateFixedGearset(configured);
    const importedWeapon = result.gear.find(({ slot }) => slot === "weapon")!;
    const sync = effectiveGearSyncLevel(weapon, input.jobLevel, syncLevel);
    const absolute = { ...base, [stat]: (base[stat] ?? 0) + amount };
    const expected = sync === undefined
      ? absolute
      : capGearStatsAtLevel(weapon, absolute, sync);
    expect(importedWeapon.melds).toEqual([{ stat, value: amount, grade: 0 }]);
    expect(importedWeapon.finalStats).toEqual(expected);

    const zeroAllocation = replaceGear(input, "weapon", {
      id: weapon.id,
      materias: [],
      customStats: {},
    });
    expect(calculateFixedGearset(zeroAllocation).gear.find(({ slot }) => slot === "weapon")!.melds).toEqual([]);
  });

  it("rejects invalid job levels, missing gear or food, and unknown gear", () => {
    const input = inputFor();
    expect(() => calculateFixedGearset({ ...input, jobLevel: 99 })).toThrow("统一计算等级");
    expect(() => calculateFixedGearset({ ...input, gears: input.gears.slice(1) })).toThrow("配装槽位不完整");
    expect(() => calculateFixedGearset({ ...input, foodId: 999_999 })).toThrow("不存在食物");
    expect(() => calculateFixedGearset({ ...input, foodId: 0 })).toThrow("必须包含有效食物");
    expect(() => calculateFixedGearset({ ...input, gears: input.gears.map((entry, index) => index === 0 ? { ...entry, id: 999_999 } : entry) })).toThrow("不存在装备");
  });

  it("rejects illegal ordinary materia and custom-stat input", () => {
    const input = inputFor();
    const body = gearInput(input, "body");
    const invalidMateria = replaceGear(input, "body", {
      ...body,
      materias: [["STR", 1]],
    });
    expect(() => calculateFixedGearset(invalidMateria)).toThrow("不能镶嵌 STR");
    const invalidCustom = replaceGear(input, "body", {
      ...body,
      customStats: { CRT: -1 },
    });
    expect(() => calculateFixedGearset(invalidCustom)).toThrow("不支持自定义参数");
  });

  it("rejects malformed materia, overmelds, and materia on synchronized gear", () => {
    const input = inputFor();
    const body = gearInput(input, "body");
    const overCapacity = replaceGear(input, "body", {
      ...body,
      materias: new Array(6).fill(null),
    });
    expect(() => calculateFixedGearset(overCapacity)).toThrow("槽位数超过可用槽位");

    const malformed = replaceGear(input, "body", {
      ...body,
      materias: [["CRT"]] as unknown as FixedGearsetGearInput["materias"],
    });
    expect(() => calculateFixedGearset(malformed)).toThrow("魔晶石数据无效");

    const invalidGrade = replaceGear(input, "body", {
      ...body,
      materias: [["CRT", 0]],
    });
    expect(() => calculateFixedGearset(invalidGrade)).toThrow("魔晶石等级无效");

    const tooHighGrade = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.slot === "body" &&
      candidate.level < Math.max(...materiaGradeRequiredLevels),
    );
    if (tooHighGrade === undefined) throw new Error("缺少低品级测试装备");
    const gradeUnavailable = replaceGear(input, "body", {
      id: tooHighGrade.id,
      materias: [["CRT", materiaGradeRequiredLevels.length]],
    });
    expect(() => calculateFixedGearset(gradeUnavailable)).toThrow("品级不能使用");

    const advancedGear = getGearById(42_177);
    if (advancedGear === undefined) throw new Error("缺少禁断测试装备");
    const restrictedGrade = 10;
    expect(advancedGear.materiaAdvanced).toBe(true);
    expect(advancedGear.materiaSlots).toBeLessThan(4);
    expect(materiaGradeRequiredLevels[restrictedGrade - 1]).toBeLessThanOrEqual(advancedGear.level);
    expect(gameData.materiaGradeIsRestricted[restrictedGrade]).toBe(true);
    const overmeldIndex = advancedGear.materiaSlots + 1;
    const illegalOvermeld = replaceGear(input, "body", {
      id: advancedGear.id,
      materias: new Array(overmeldIndex + 1).fill(null).map((_, index) =>
        index === overmeldIndex ? ["CRT", restrictedGrade] as const : null,
      ),
    });
    expect(() => calculateFixedGearset(illegalOvermeld)).toThrow("禁断槽不能使用");

    const syncLevel = gameData.syncLevelOfJobLevels[80]!;
    const syncedInput = inputFor(input.jobId, syncLevel);
    const syncedBody = gearInput(syncedInput, "body");
    const syncedWithMateria = replaceGear(syncedInput, "body", {
      ...syncedBody,
      materias: [["CRT", 1]],
    });
    expect(() => calculateFixedGearset(syncedWithMateria)).toThrow("已同步装备");
  });

  it("rejects invalid custom allocations and validates the complete fixed gearset shape", () => {
    const input = inputFor();
    expect(() => calculateFixedGearset({ ...input, jobId: "not-a-job" as JobId })).toThrow("不支持的职业");
    expect(() => calculateFixedGearset({ ...input, jobLevel: 0 })).toThrow("职业等级无效");
    expect(() => calculateFixedGearset({ ...input, gears: undefined as never })).toThrow("缺少装备列表");
    expect(() => calculateFixedGearset({ ...input, syncLevel: 1.5 })).toThrow("正整数");

    const zeroId = { ...input, gears: input.gears.map((entry, index) => index === 0 ? { ...entry, id: 0 } : entry) };
    expect(() => calculateFixedGearset(zeroId)).toThrow("装备编号无效");

    const wrongJobGear = gears.find((candidate) =>
      candidate.slot === "body" && !candidate.jobs.includes(input.jobId),
    );
    if (wrongJobGear === undefined) throw new Error("缺少职业不适用装备");
    const wrongJob = replaceGear(input, "body", { id: wrongJobGear.id, materias: [] });
    expect(() => calculateFixedGearset(wrongJob)).toThrow("不适用于职业");

    const missingMaterias = replaceGear(input, "body", {
      ...gearInput(input, "body"),
      materias: undefined as never,
    });
    expect(() => calculateFixedGearset(missingMaterias)).toThrow("缺少镶嵌槽位数据");

    const manderville = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.customParameters?.length === 4,
    );
    if (manderville === undefined) throw new Error("缺少自定义参数测试装备");
    const noCustomStats = replaceGear(input, "weapon", { id: manderville.id, materias: [] });
    expect(() => calculateFixedGearset(noCustomStats)).toThrow("缺少完整参数");
    const unsupportedCustomStat = replaceGear(input, "weapon", {
      id: manderville.id,
      materias: [],
      customStats: { PIE: 1 },
    });
    expect(() => calculateFixedGearset(unsupportedCustomStat)).toThrow("不支持 PIE 参数");
    const belowBase = replaceGear(input, "weapon", {
      id: manderville.id,
      materias: [],
      customStats: { [manderville.customParameters![0]!.stat]: -1 },
    });
    expect(() => calculateFixedGearset(belowBase)).toThrow("数值无效");
    const invalidBudget = replaceGear(input, "weapon", {
      id: manderville.id,
      materias: [],
      customStats: {},
    });
    expect(() => calculateFixedGearset(invalidBudget)).toThrow("2 大 + 1 小");

    const resistance = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.resistanceWeaponAdjust !== undefined,
    );
    if (resistance === undefined) throw new Error("缺少 Resistance 测试装备");
    const resistanceBase = concretizeGearStats(resistance.stats, jobSchemas[input.jobId]);
    const invalidResistanceStat = replaceGear(input, "weapon", {
      id: resistance.id,
      materias: [],
      customStats: { PIE: 1 },
    });
    expect(() => calculateFixedGearset(invalidResistanceStat)).toThrow("不支持 PIE 参数");
    const excessiveSingle = replaceGear(input, "weapon", {
      id: resistance.id,
      materias: [],
      customStats: { [resistance.resistanceWeaponAdjust!.stats[0]!]: resistance.resistanceWeaponAdjust!.maxEachStat + 1 },
    });
    expect(() => calculateFixedGearset(excessiveSingle)).toThrow("单项上限");
    const excessiveTotal = replaceGear(input, "weapon", {
      id: resistance.id,
      materias: [],
      customStats: Object.fromEntries(resistance.resistanceWeaponAdjust!.stats.map((stat) => [
        stat,
        (resistanceBase[stat] ?? 0) + resistance.resistanceWeaponAdjust!.maxEachStat,
      ])),
    });
    expect(() => calculateFixedGearset(excessiveTotal)).toThrow("总分配属性");

    const ordinaryWithCustom = replaceGear(input, "body", {
      ...gearInput(input, "body"),
      customStats: { CRT: 1 },
    });
    expect(() => calculateFixedGearset(ordinaryWithCustom)).toThrow("不支持自定义参数");

    const nonUniqueRing = gears.find((candidate) =>
      candidate.jobs.includes(input.jobId) && candidate.slot === "ring" && candidate.unique === false,
    );
    if (nonUniqueRing === undefined) throw new Error("缺少非唯一戒指测试装备");
    const duplicateSlot = {
      ...input,
      gears: input.gears.map((entry, index) => index === 0
        ? { id: nonUniqueRing.id, materias: [] }
        : entry),
    };
    expect(() => calculateFixedGearset(duplicateSlot)).toThrow("重复包含 ring");
  });
});
