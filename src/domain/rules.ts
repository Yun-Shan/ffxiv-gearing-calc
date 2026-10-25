import { gameData } from "./data.ts";
import { assertClanIndex, defaultClanIndex } from "./clans.ts";
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
  SyncTarget,
} from "./types.ts";

// 在浮点数接近整数的边界处与上游公式保持一致。
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

export function calculateBaseStats(
  job: JobSchema,
  level: number,
  clanIndex: number = defaultClanIndex,
): Stats {
  assertClanIndex(clanIndex);
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

/** 根据选定职业解析上游 Item 数据中的主属性和副属性占位符。 */
export function concretizeGearStats(stats: GearStats, job: JobSchema): Stats {
  const result: Stats = {};
  for (const [rawStat, value] of Object.entries(stats)) {
    if (value === undefined) continue;
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

/**
 * 按参考实现的 Gear.syncedLevel 规则处理普通装备和可变等级装备。
 * `jobLevel` 对应参考实现的 store.jobLevel：同步搜索中应传入同步映射等级
 * （calculationJobLevelFor），而不是职业可穿戴上限。
 */
export function effectiveGearSyncLevel(
  gear: Gear,
  jobLevel: number,
  sync?: SyncTarget,
): number | undefined {
  const levelRule = gameData.sync.levels.find(({ jobLevel: level }) => level === jobLevel);
  const jobLevelSync = levelRule?.defaultItemLevel;
  const explicitSyncLevel = sync?.kind === "itemLevel" ? sync.value : undefined;
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
  clanIndex,
}: CalculationInput): Effects {
  const levelMod = levelModifierFor(level);
  const attackModifier = job.statModifiers[job.mainStat];
  const hpModifier = job.statModifiers.hp;
  if (attackModifier === undefined) throw new Error(`职业 ${job.id} 缺少主属性修正`);
  if (hpModifier === undefined) throw new Error(`职业 ${job.id} 缺少生命值修正`);
  assertClanIndex(clanIndex);
  const { main, sub, div, det, detTrunc } = levelMod;
  const crt = stats.CRT ?? sub;
  const detStat = stats.DET ?? main;
  const dht = stats.DHT ?? sub;
  const ten = stats.TEN ?? sub;
  const vit = stats.VIT ?? main;
  const attack = stats[job.mainStat] ?? main;
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
      ((job.role === "tank" ? levelMod.apTank : levelMod.ap) *
        (adjustedAttack - main)) /
        main +
        100,
    ) / 100;
  const adjustedWeaponDamage =
    weaponDamage + floor((main * attackModifier) / 1000) +
    (job.id === "BLU" ? blueMageWeaponDamageAddition((stats.INT ?? 0) - (calculateBaseStats(job, level, clanIndex).INT ?? 0)) : 0);
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
      (job.role === "tank" ? levelMod.vitTank : levelMod.vit) * (vit - main),
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
  return calculateEffects({ stats, job, level, weaponDamage: 100, clanIndex: 0 }).gcd;
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

/** 对已解析的装备属性应用参考项目中的等级、槽位和职责上限。 */
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

// 参考界面会在未镶嵌装备的副属性已达到该装备上限时高亮显示；镶嵌到上限不会改变高亮状态。
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
