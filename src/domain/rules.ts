import { gameData } from "./data";
import { jobLevelModifiers } from "./jobs";
import type {
  CalculationInput,
  Effects,
  Gear,
  JobSchema,
  Stat,
  Stats,
} from "./types";

const floor = Math.floor;

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
  const modifier = jobLevelModifiers[level] ?? jobLevelModifiers[100];
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

export function calculateEffects({
  stats,
  job,
  level,
  weaponDamage,
}: CalculationInput): Effects {
  const levelMod = jobLevelModifiers[level] ?? jobLevelModifiers[100];
  const { main, sub, div, det, detTrunc } = levelMod;
  const crt = stats.CRT ?? sub;
  const detStat = stats.DET ?? main;
  const dht = stats.DHT ?? sub;
  const ten = stats.TEN ?? sub;
  const vit = stats.VIT ?? main;
  const attack = stats[job.attackStat] ?? main;
  const crtChance = floor((200 * (crt - sub)) / div + 50) / 1000;
  const crtDamage = floor((200 * (crt - sub)) / div + 1400) / 1000;
  const detDamage =
    (floor(((140 * (detStat - main)) / det + 1000) / detTrunc) * detTrunc) /
    1000;
  const dhtChance = floor((550 * (dht - sub)) / div) / 1000;
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
    weaponDamage + floor((main * (job.statModifiers[job.attackStat] ?? 100)) / 1000);
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
        job.gcdModifier) /
        1000,
    ) / 100;
  const hp =
    levelMod.hp * (job.statModifiers.hp ?? 100) +
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

export function mergeGearStats(gear: Gear, melds: Stats[]): Stats {
  const result = { ...gear.stats };
  const levelIndex = gameData.levelCaps.level.indexOf(gear.level);
  if (levelIndex < 0) throw new Error(`装备品级 ${gear.level} 缺少属性上限`);
  for (const meld of melds)
    for (const [stat, value] of Object.entries(meld)) {
      const cap = getGearStatCap(gear, stat as Stat);
      result[stat as keyof Stats] = Math.min(cap, (result[stat as keyof Stats] ?? 0) + (value ?? 0));
    }
  return result;
}

export function getGearStatCap(gear: Gear, stat: Stat): number {
  const levelIndex = gameData.levelCaps.level.indexOf(gear.level);
  if (levelIndex < 0) throw new Error(`装备品级 ${gear.level} 缺少属性上限`);
  const levelCap = gameData.levelCaps[stat]?.[levelIndex];
  const slotCap = gameData.slotCaps[stat]?.[gear.rawSlot];
  const roleCap = gameData.roleCaps[stat]?.[gear.roleId];
  if (levelCap === undefined || slotCap === undefined || roleCap === undefined)
    throw new Error(`装备 ${gear.id} 的 ${stat} 属性上限数据不完整`);
  return Math.round((levelCap * slotCap * roleCap) / 100_000);
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
