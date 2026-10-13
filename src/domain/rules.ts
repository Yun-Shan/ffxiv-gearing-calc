import { gameData } from "./data.ts";
import { blueMageWeaponDamageAddition } from "./search/equipped-effects.ts";
import { jobLevelModifiers } from "./jobs.ts";
import type {
  CalculationInput,
  Effects,
  Gear,
  GearStat,
  GearStats,
  JobSchema,
  Stat,
  Stats,
} from "./types.ts";

// Match the source formula at floating-point integer boundaries.
const floor = (value: number) => Math.trunc(value + 1e-7);

function levelModifierFor(level: number) {
  const modifier = jobLevelModifiers[level];
  if (modifier === undefined) throw new RangeError(`不支持的职业等级：${level}`);
  return modifier;
}

export function addStats(...items: Stats[]): Stats {
  const result: Stats = {};
  for (const item of items)
    for (const [key, value] of Object.entries(item))
      result[key as keyof Stats] =
        (result[key as keyof Stats] ?? 0) + (value ?? 0);
  return result;
}

export function applyFood(
  stats: Stats,
  foodStats: Stats,
  foodRates: Stats,
): Stats {
  const result = { ...stats };
  for (const stat of Object.keys(foodStats) as (keyof Stats)[]) {
    const fixed = foodStats[stat] ?? 0;
    const rate = foodRates[stat] ?? 0;
    result[stat] =
      (result[stat] ?? 0) +
      Math.min(fixed, floor(((result[stat] ?? 0) * rate) / 100));
  }
  return result;
}

export function calculateBaseStats(job: JobSchema, level: number, clanIndex = 0): Stats {
  const modifier = levelModifierFor(level);
  const stats: Stats = { PDMG: 0, MDMG: 0 };
  for (const stat of job.stats) {
    const base = gameData.baseStats[stat] ?? 0;
    stats[stat] = typeof base === "number"
      ? base
      : floor((modifier[base] * (job.statModifiers[stat] ?? 100)) / 100) +
        (gameData.clanStats[stat]?.[clanIndex] ?? 0);
  }
  return stats;
}

/** Resolve the upstream main/secondary Item tokens for one selected job. */
export function concretizeGearStats(stats: GearStats, job: JobSchema): Stats {
  const result: Stats = {};
  for (const [rawStat, value] of Object.entries(stats)) {
    const stat: GearStat = rawStat as GearStat;
    const concreteStat = stat === "main"
      ? job.mainStat
      : stat === "secondary"
        ? job.secondaryStat
        : stat;
    result[concreteStat] = value;
  }
  return result;
}

/** Mirrors the reference Gear.syncedLevel rules for ordinary and variable-level gear. */
export function effectiveGearSyncLevel(
  gear: Gear,
  jobLevel: number,
  explicitSyncLevel?: number,
): number | undefined {
  const jobLevelSync = gameData.syncLevelOfJobLevels[jobLevel];
  let targetSyncLevel = explicitSyncLevel ?? Number.POSITIVE_INFINITY;
  if (gear.equipLevelVariable === true) {
    if (jobLevelSync === undefined) {
      throw new RangeError(`可变等级装备 ${gear.id} 缺少职业等级 ${jobLevel} 的同步品级映射`);
    }
    targetSyncLevel = Math.min(targetSyncLevel, jobLevelSync);
  }
  if (targetSyncLevel < gear.level) return targetSyncLevel;
  if (jobLevel < gear.equipLevel) {
    if (jobLevelSync === undefined) {
      throw new RangeError(`装备 ${gear.id} 缺少职业等级 ${jobLevel} 的同步品级映射`);
    }
    return Math.min(gear.level, jobLevelSync);
  }
  return undefined;
}

export function calculateEffects({
  stats,
  job,
  level,
  weaponDamage,
}: CalculationInput): Effects {
  const levelMod = levelModifierFor(level);
  const attackModifier = job.statModifiers[job.attackStat];
  const hpModifier = job.statModifiers.hp;
  if (attackModifier === undefined) throw new Error(`职业 ${job.id} 缺少主属性修正`);
  if (hpModifier === undefined) throw new Error(`职业 ${job.id} 缺少生命值修正`);
  const { main, sub, div, det, detTrunc } = levelMod;
  const crt = stats.CRT ?? sub;
  const detStat = stats.DET ?? main;
  const dht = stats.DHT ?? sub;
  const ten = stats.TEN ?? sub;
  const vit = stats.VIT ?? main;
  const attack = stats[job.attackStat] ?? main;
  const crtChance = floor((200 * (crt - sub)) / div + 50 + (job.id === "BLU" ? 200 : 0)) / 1000;
  const crtDamage = floor((200 * (crt - sub)) / div + 1400) / 1000;
  const detDamage =
    (floor(((140 * (detStat - main)) / det + 1000) / detTrunc) * detTrunc) /
    1000;
  const dhtChance = floor((550 * (dht - sub)) / div + (job.id === "BLU" ? 200 : 0)) / 1000;
  const tenDamage = floor((112 * (ten - sub)) / div + 1000) / 1000;
  const tenMitigation = floor((200 * (ten - sub)) / div) / 1000;
  const adjustedAttack = floor(attack * (job.partyBonus ?? 1.05));
  const mainDamage =
    floor(
      ((job.mainStat === "VIT" ? levelMod.apTank : levelMod.ap) *
        (adjustedAttack - main)) /
        main +
        100,
    ) / 100;
  const adjustedWeaponDamage =
    weaponDamage + floor((main * attackModifier) / 1000) +
    (job.id === "BLU" ? blueMageWeaponDamageAddition((stats.INT ?? 0) - (calculateBaseStats(job, level).INT ?? 0)) : 0);
  const damage =
    0.01 *
    adjustedWeaponDamage *
    mainDamage *
    detDamage *
    tenDamage *
    job.traitDamageMultiplier *
    ((crtDamage - 1) * crtChance + 1) *
    (0.25 * dhtChance + 1);
  const speed = stats[getSpeedStat(job)] ?? sub;
  const gcd =
    floor(
      (floor(((1000 - floor((130 * (speed - sub)) / div)) * 2500) / 1000) *
        (level >= 80 ? job.gcdModifier : 100)) /
        1000,
    ) / 100;
  const hp =
    levelMod.hp * hpModifier +
    floor(
      (job.mainStat === "VIT" ? levelMod.vitTank : levelMod.vit) * (vit - main),
    );
  const mp = floor((150 * ((stats.PIE ?? main) - main)) / div + 200);
  return {
    crtChance,
    crtDamage,
    detDamage,
    dhtChance,
    tenDamage,
    tenMitigation,
    damage,
    gcd,
    hp,
    mp,
  };
}

export function calculateGcdTier(
  stats: Stats,
  job: JobSchema,
  level = 100,
): number {
  return calculateEffects({ stats, job, level, weaponDamage: 100 }).gcd;
}

export function getSpeedStat(job: JobSchema): "SKS" | "SPS" {
  return job.role === "int" || job.role === "healer" ? "SPS" : "SKS";
}

export function gcdThresholds(
  minSpeed: number,
  maxSpeed: number,
  job: JobSchema,
  level = 100,
): number[] {
  const seen = new Set<number>();
  for (let speed = minSpeed; speed <= maxSpeed; speed++)
    seen.add(
      calculateGcdTier(
        { [getSpeedStat(job)]: speed },
        job,
        level,
      ),
    );
  return [...seen].sort((a, b) => b - a);
}

export function mergeGearStats(gear: Gear, melds: Stats[]): GearStats {
  const result: GearStats = { ...gear.stats };
  const levelIndex = gameData.levelCaps.level.indexOf(gear.level);
  if (levelIndex < 0) throw new Error(`装备品级 ${gear.level} 缺少属性上限`);
  for (const meld of melds)
    for (const [stat, value] of Object.entries(meld)) {
      const cap = getGearStatCap(gear, stat as Stat);
      result[stat as keyof Stats] = Math.min(cap, (result[stat as keyof Stats] ?? 0) + (value ?? 0));
    }
  return result;
}

export function getGearStatCap(
  gear: Gear,
  stat: Stat,
  level = gear.level,
): number {
  const levelIndex = gameData.levelCaps.level.indexOf(level);
  if (levelIndex < 0) throw new Error(`装备同步品级 ${level} 缺少属性上限`);
  const levelCap = gameData.levelCaps[stat]?.[levelIndex];
  const slotCap = gameData.slotCaps[stat]?.[gear.rawSlot];
  const roleCap = gameData.roleCaps[stat]?.[gear.roleId];
  if (levelCap === undefined || slotCap === undefined || roleCap === undefined)
    throw new Error(`装备 ${gear.id} 的 ${stat} 属性上限数据不完整`);
  return Math.round((levelCap * slotCap * roleCap) / 100_000);
}

/** Applies the reference project's level/slot/role caps to resolved item stats. */
export function capGearStatsAtLevel(
  gear: Gear,
  stats: Stats,
  level: number,
): Stats {
  const result = { ...stats };
  for (const [rawStat, value] of Object.entries(stats)) {
    if (value === undefined || rawStat === "DLY") continue;
    const stat = rawStat as Stat;
    result[stat] = Math.min(value, getGearStatCap(gear, stat, level));
  }
  return result;
}

// The reference UI highlights a secondary stat when the unmelded gear value
// already reaches that item's cap; melding it to the cap does not change this highlight.
export function isGearBaseStatAtCap(gear: Gear, stat: Stat): boolean {
  return (gear.stats[stat] ?? 0) >= getGearStatCap(gear, stat);
}

export function isGearUsable(
  gear: Gear,
  job: JobSchema,
  minLevel: number,
  maxLevel: number,
  excludedSources: string[],
): boolean {
  return (
    gear.jobs.includes(job.id) &&
    gear.level >= minLevel &&
    gear.level <= maxLevel &&
    !excludedSources.some((source) => gear.source?.startsWith(source))
  );
}
