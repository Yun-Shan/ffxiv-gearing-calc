import {
  foods,
  gameData,
  getGearById,
  materiaGradeRequiredLevels,
} from "./data.ts";
import { calculationJobLevelFor, jobLevelFor } from "./job-level.ts";
import { jobSchemas } from "./jobs.ts";
import { slotsForJob } from "./gear-options.ts";
import {
  customParameterMelds,
  foodStatsForJob,
  materiaAttributeStats,
  mergeCandidateStats,
} from "./optimizer/equipment-candidates.ts";
import {
  addStats,
  applyFood,
  calculateBaseStats,
  calculateEffects,
  capGearStatsAtLevel,
  concretizeGearStats,
  effectiveGearSyncLevel,
} from "./rules.ts";
import { describeFoodResult } from "./food-result.ts";
import type {
  CustomizableStat,
  Effects,
  FoodResult,
  Gear,
  GearSlot,
  JobId,
  JobSchema,
  MeldedGear,
  Materia,
  Stat,
  Stats,
} from "./types.ts";

export type FixedGearsetMateria = readonly [Stat, number] | null;

export interface FixedGearsetGearInput {
  id: number;
  /** One entry per encoded materia position; null preserves an empty slot. */
  materias: readonly FixedGearsetMateria[];
  /** Absolute customizable-stat values as encoded by the reference share format. */
  customStats?: Stats;
}

export interface FixedGearsetInput {
  jobId: JobId;
  /** Formula level carried by the share link. */
  jobLevel: number;
  syncLevel?: number;
  gears: readonly FixedGearsetGearInput[];
  foodId: number;
}

/** Snapshot returned by evaluating the supplied loadout without a search. */
export interface FixedGearsetResult {
  jobId: JobId;
  calculationLevel: number;
  syncItemLevel?: number;
  gear: MeldedGear[];
  food: FoodResult;
  stats: Stats;
  effects: Effects;
  damagePerPotency: number;
  damagePerSecond: number;
}

const nonMateriaStats = new Set<Stat>([
  "STR", "DEX", "INT", "MND", "VIT", "PDMG", "MDMG", "DLY",
]);

function fail(message: string): never {
  throw new Error(message);
}

function validateCustomStats(customStats: Stats | undefined): Stats {
  const validated: Stats = {};
  for (const [rawStat, value] of Object.entries(customStats ?? {})) {
    if (
      nonMateriaStats.has(rawStat as Stat) ||
      !Number.isSafeInteger(value) ||
      value! < 0 ||
      value! > 1000
    ) {
      fail(`自定义装备属性 ${rawStat} 的数值无效`);
    }
    validated[rawStat as Stat] = value;
  }
  return validated;
}

function statTotals(melds: readonly Materia[]): Stats {
  const result: Stats = {};
  for (const meld of melds) {
    result[meld.stat] = (result[meld.stat] ?? 0) + meld.value;
  }
  return result;
}

function sameStatTotals(left: Stats, right: Stats): boolean {
  const stats = new Set([...Object.keys(left), ...Object.keys(right)] as Stat[]);
  return [...stats].every((stat) => (left[stat] ?? 0) === (right[stat] ?? 0));
}

function fixedCustomParameterMelds(
  gear: Gear,
  customStats: Stats | undefined,
  job: JobSchema,
): Materia[] {
  if (customStats === undefined) {
    return fail(`自定义参数武器 ${gear.id} 缺少完整参数`);
  }
  const overrides = validateCustomStats(customStats);
  const allowedStats = new Set(gear.customParameters?.map(({ stat }) => stat));
  for (const stat of Object.keys(overrides) as Stat[]) {
    if (!allowedStats.has(stat as CustomizableStat)) {
      return fail(`自定义参数武器 ${gear.id} 不支持 ${stat} 参数`);
    }
  }
  const baseStats = concretizeGearStats(gear.stats, job);
  const requestedTotals: Stats = {};
  for (const stat of allowedStats) {
    const absoluteValue = overrides[stat] ?? baseStats[stat] ?? 0;
    const allocation = absoluteValue - (baseStats[stat] ?? 0);
    if (!Number.isSafeInteger(allocation) || allocation < 0) {
      return fail(`自定义参数武器 ${gear.id} 的 ${stat} 参数低于装备基础属性`);
    }
    if (allocation > 0) requestedTotals[stat] = allocation;
  }
  const validOptions = customParameterMelds(gear);
  const selected = validOptions.find((melds) =>
    sameStatTotals(requestedTotals, statTotals(melds)),
  );
  if (selected === undefined) {
    return fail(`自定义参数武器 ${gear.id} 的参数不符合 2 大 + 1 小分配规则`);
  }
  return selected;
}

function resistanceAllocation(
  gear: Gear,
  customStats: Stats | undefined,
  job: JobSchema,
): Materia[] {
  const adjustment = gear.resistanceWeaponAdjust!;
  const resolvedStats = concretizeGearStats(gear.stats, job);
  const overrides = validateCustomStats(customStats);
  const allowedStats = new Set(adjustment.stats);
  for (const stat of Object.keys(overrides) as Stat[]) {
    if (!allowedStats.has(stat as CustomizableStat)) {
      return fail(`义军武器 ${gear.id} 不支持 ${stat} 参数`);
    }
  }
  const allocations: Materia[] = [];
  let total = 0;
  for (const stat of adjustment.stats) {
    const absoluteValue = overrides[stat] ?? resolvedStats[stat] ?? 0;
    const allocation = absoluteValue - (resolvedStats[stat] ?? 0);
    if (
      !Number.isSafeInteger(allocation) ||
      allocation < 0 ||
      allocation > adjustment.maxEachStat
    ) {
      return fail(`义军武器 ${gear.id} 的 ${stat} 分配超过单项上限`);
    }
    total += allocation;
    if (allocation > 0) allocations.push({ stat, value: allocation, grade: 0 });
  }
  if (!Number.isSafeInteger(total) || total > adjustment.maxTotalStats) {
    return fail(`义军武器 ${gear.id} 的总分配属性超过 ResistanceWeaponAdjust 上限`);
  }
  return allocations;
}

function regularMelds(
  gear: Gear,
  input: FixedGearsetGearInput,
  jobId: JobId,
  jobLevel: number,
  syncLevel?: number,
): Materia[] {
  const hasCustom = gear.customParameters !== undefined || gear.resistanceWeaponAdjust !== undefined;
  if (hasCustom) {
    if (gear.customParameters !== undefined && gear.resistanceWeaponAdjust !== undefined) {
      return fail(`装备 ${gear.id} 同时包含两种自定义参数规则`);
    }
    if (input.materias.some((entry) => entry !== null)) {
      return fail(`自定义参数装备 ${gear.id} 不能同时配置普通魔晶石`);
    }
    if (gear.customParameters !== undefined) {
      return fixedCustomParameterMelds(gear, input.customStats, jobSchemas[jobId]);
    }
    return resistanceAllocation(
      gear,
      input.customStats,
      jobSchemas[jobId],
    );
  }
  if (input.customStats !== undefined) {
    return fail(`普通装备 ${gear.id} 不支持自定义参数`);
  }

  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, syncLevel);
  const encodedMelds = input.materias;
  if (synchronizedLevel !== undefined) {
    // The reference share writer omits regular materia whenever an item is synced.
    if (encodedMelds.some((entry) => entry !== null)) {
      return fail(`已同步装备 ${gear.id} 不能包含普通魔晶石`);
    }
    return [];
  }

  const capacity = gear.materiaAdvanced === true ? 5 : gear.materiaSlots;
  if (encodedMelds.length > capacity) {
    return fail(`装备 ${gear.id} 的魔晶石槽位数超过可用槽位`);
  }
  const allowedStats = new Set(materiaAttributeStats(jobId));
  // Healer gear can also carry PIE materia in the reference gearset format;
  // the optimizer omits it because it does not affect the damage objective.
  if (jobSchemas[jobId].role === "healer") allowedStats.add("PIE");
  const result: Materia[] = [];
  encodedMelds.forEach((entry, slotIndex) => {
    if (entry === null) return;
    if (!Array.isArray(entry) || entry.length !== 2) {
      return fail(`装备 ${gear.id} 的第 ${slotIndex + 1} 个魔晶石数据无效`);
    }
    const [stat, grade] = entry;
    if (!allowedStats.has(stat as Materia["stat"])) {
      return fail(`职业 ${jobId} 不能镶嵌 ${String(stat)} 属性魔晶石`);
    }
    if (!Number.isSafeInteger(grade) || grade < 1 || grade > materiaGradeRequiredLevels.length) {
      return fail(`装备 ${gear.id} 的第 ${slotIndex + 1} 个魔晶石等级无效`);
    }
    if (materiaGradeRequiredLevels[grade - 1]! > gear.level) {
      return fail(`装备 ${gear.id} 的品级不能使用 ${grade} 级魔晶石`);
    }
    if (
      slotIndex > gear.materiaSlots &&
      gameData.materiaGradeIsRestricted[grade] !== false
    ) {
      return fail(`装备 ${gear.id} 的第 ${slotIndex + 1} 个禁断槽不能使用 ${grade} 级魔晶石`);
    }
    const value = gameData.materias[stat as Materia["stat"]]?.[grade - 1];
    if (!Number.isSafeInteger(value) || value! <= 0) {
      return fail(`魔晶石 ${String(stat)} 缺少 ${grade} 级数值`);
    }
    result.push({ stat: stat as Materia["stat"], grade, value: value!, slotIndex });
  });
  return result;
}

function assembleGear(
  input: FixedGearsetGearInput,
  slot: GearSlot,
  jobId: JobId,
  characterLevel: number,
  calculationLevel: number,
  syncLevel?: number,
): MeldedGear {
  if (!Number.isSafeInteger(input.id) || input.id <= 0) {
    return fail(`装备编号无效：${input.id}`);
  }
  const gear = getGearById(input.id);
  if (gear === undefined) return fail(`当前游戏数据中不存在装备 ${input.id}`);
  if (!gear.jobs.includes(jobId)) return fail(`装备 ${gear.id} 不适用于职业 ${jobId}`);
  if (gear.equipLevel > characterLevel) {
    return fail(`职业 ${jobId} 的等级上限不能穿戴装备 ${gear.id}`);
  }
  const actualSlot = gear.slot;
  if (actualSlot !== (slot === "ring2" ? "ring" : slot)) {
    return fail(`装备 ${gear.id} 的部位与配装槽位 ${slot} 不匹配`);
  }
  if (!Array.isArray(input.materias)) {
    return fail(`装备 ${gear.id} 缺少镶嵌槽位数据`);
  }
  const resolvedGear: Gear = {
    ...gear,
    stats: concretizeGearStats(gear.stats, jobSchemas[jobId]),
  };
  // 穿戴资格按职业上限判定；装备同步按参考实现的 store.jobLevel
  // （同步搜索中即同步映射等级）计算。
  const melds = regularMelds(
    resolvedGear,
    input,
    jobId,
    calculationLevel,
    syncLevel,
  );
  const finalStats = resolvedGear.customParameters !== undefined || resolvedGear.resistanceWeaponAdjust !== undefined
    ? customFinalStats(resolvedGear, input.customStats, calculationLevel, syncLevel)
    : mergeCandidateStats(resolvedGear, melds, calculationLevel, syncLevel);
  const weaponStat = jobSchemas[jobId].mainStat === "INT" || jobSchemas[jobId].mainStat === "MND"
    ? "MDMG"
    : "PDMG";
  return {
    ...resolvedGear,
    slot,
    weaponDamage: finalStats[weaponStat] ?? gear.weaponDamage,
    melds,
    finalStats,
  };
}

function customFinalStats(
  gear: Gear,
  customStats: Stats | undefined,
  jobLevel: number,
  syncLevel?: number,
): Stats {
  const finalStats = {
    ...gear.stats,
    ...validateCustomStats(customStats),
  };
  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, syncLevel);
  return synchronizedLevel === undefined
    ? finalStats
    : capGearStatsAtLevel(gear, finalStats, synchronizedLevel);
}

function assembleFullGear(
  input: FixedGearsetInput,
  characterLevel: number,
  calculationLevel: number,
): MeldedGear[] {
  const requiredSlots = slotsForJob(input.jobId);
  if (input.gears.length !== requiredSlots.length) {
    return fail(`配装槽位不完整：需要 ${requiredSlots.length} 件装备，收到 ${input.gears.length} 件`);
  }
  const seenIds = new Map<number, Gear>();
  const slots = new Map<GearSlot, FixedGearsetGearInput>();
  let ringIndex = 0;
  for (const gearInput of input.gears) {
    if (!Number.isSafeInteger(gearInput.id) || gearInput.id <= 0) {
      return fail(`装备编号无效：${gearInput.id}`);
    }
    const gear = getGearById(gearInput.id);
    if (gear === undefined) return fail(`当前游戏数据中不存在装备 ${gearInput.id}`);
    const previous = seenIds.get(gear.id);
    if (previous !== undefined && gear.unique === true) {
      return fail(`唯一装备 ${gear.id} 不能重复穿戴`);
    }
    seenIds.set(gear.id, gear);
    const slot: GearSlot = gear.slot === "ring"
      ? (ringIndex++ === 0 ? "ring" : "ring2")
      : gear.slot;
    if (!requiredSlots.includes(slot)) return fail(`职业 ${input.jobId} 没有 ${gear.slot} 部位`);
    if (slots.has(slot)) return fail(`配装重复包含 ${slot} 部位`);
    slots.set(slot, gearInput);
  }
  const missing = requiredSlots.find((slot) => !slots.has(slot));
  if (missing !== undefined) return fail(`配装缺少 ${missing} 部位装备`);
  return requiredSlots.map((slot) =>
    assembleGear(
      slots.get(slot)!,
      slot,
      input.jobId,
      characterLevel,
      calculationLevel,
      input.syncLevel,
    ),
  );
}

function validateInput(input: FixedGearsetInput): {
  characterLevel: number;
  calculationLevel: number;
} {
  if (!Object.hasOwn(jobSchemas, input.jobId)) return fail(`不支持的职业：${input.jobId}`);
  if (
    input.syncLevel !== undefined &&
    (!Number.isSafeInteger(input.syncLevel) || input.syncLevel <= 0)
  ) {
    return fail("等级同步品级必须是正整数");
  }
  if (!Number.isSafeInteger(input.jobLevel) || input.jobLevel <= 0) {
    return fail("分享链接中的职业等级无效");
  }
  const calculationLevel = calculationJobLevelFor({
    jobId: input.jobId,
    ...(input.syncLevel === undefined ? {} : { syncLevel: input.syncLevel }),
  });
  if (input.jobLevel !== calculationLevel) {
    return fail(
      `分享链接等级 ${input.jobLevel} 与当前统一计算等级 ${calculationLevel} 不一致`,
    );
  }
  if (!Array.isArray(input.gears)) return fail("分享链接缺少装备列表");
  if (!Number.isSafeInteger(input.foodId) || input.foodId <= 0) {
    return fail("分享链接必须包含有效食物");
  }
  return { characterLevel: jobLevelFor({ jobId: input.jobId }), calculationLevel };
}

/** Calculates a complete supplied loadout with the production domain formulas. */
export function calculateFixedGearset(input: FixedGearsetInput): FixedGearsetResult {
  const { characterLevel, calculationLevel } = validateInput(input);
  const food = foods.find(({ id }) => id === input.foodId);
  if (food === undefined) return fail(`当前游戏数据中不存在食物 ${input.foodId}`);
  const gear = assembleFullGear(input, characterLevel, calculationLevel);
  const job = jobSchemas[input.jobId];
  const baseStats = calculateBaseStats(job, calculationLevel);
  const gearStats = addStats(...gear.map(({ finalStats }) => finalStats));
  const unbuffedStats = addStats(baseStats, gearStats);
  const applicableFood = foodStatsForJob(food, input.jobId);
  const stats = applyFood(unbuffedStats, applicableFood.stats, applicableFood.statRates);
  const weaponStat = job.mainStat === "INT" || job.mainStat === "MND" ? "MDMG" : "PDMG";
  const effects = calculateEffects({
    stats,
    job,
    level: calculationLevel,
    weaponDamage: stats[weaponStat] ?? 0,
  });
  return {
    jobId: input.jobId,
    calculationLevel,
    ...(input.syncLevel === undefined ? {} : { syncItemLevel: input.syncLevel }),
    gear,
    food: describeFoodResult(food, unbuffedStats, stats),
    stats,
    effects,
    damagePerPotency: effects.damage,
    damagePerSecond: effects.damage / effects.gcd,
  };
}
