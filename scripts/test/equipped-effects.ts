import { createRequire } from "node:module";
import type {
  Job,
  JobLevel,
  Stat,
  Stats,
} from "../../reference/ffxiv-gearing/src/game.ts";

/**
 * Standalone entry point for the reference project's equippedEffects getter.
 *
 * The reference module is ESM, but its game.ts loads data with require().
 * Bind require to game.ts before importing it so the reference module can run
 * unchanged under tsx. This script does not import any application module.
 *
 * Source: https://github.com/Asvel/ffxiv-gearing/blob/78f6cbb568bdd3341ec793bbc17f4582e32d2ba8/src/stores/Store.ts#L286-L315
 * Reference commit: 78f6cbb568bdd3341ec793bbc17f4582e32d2ba8
 *
 * CLI:
 *   tsx scripts/test/equipped-effects.ts SAM 100 '{"STR":6007,"CRT":3185,"DET":2093,"DHT":1427,"SKS":0,"VIT":7027,"PDMG":158}'
 *
 * The third argument is the sum of gear and food attributes. Character base
 * attributes are reconstructed from the reference job and level constants.
 */

const referenceGameUrl = new URL(
  "../../reference/ffxiv-gearing/src/game.ts",
  import.meta.url,
);

type GlobalWithRequire = typeof globalThis & { require: NodeRequire };
(globalThis as GlobalWithRequire).require = createRequire(referenceGameUrl);

const referenceGame = await import("../../reference/ffxiv-gearing/src/game.ts");

export type EquippedStats = Stats;

export interface EquippedEffects {
  crtChance: number;
  crtDamage: number;
  detDamage: number;
  dhtChance: number;
  tenDamage: number;
  tenMitigation: number;
  damage: number;
  gcd: number;
  ssDamage: number;
  hp: number;
  mp: number;
}

export interface EquippedSpeedRange {
  min: number;
  max: number;
}

/**
 * Returns the exact integer tier used by the equipped-effects formula for one
 * damage-related attribute. The input is the gear + food contribution only.
 */
export function equippedAttributeTier(
  job: Job,
  jobLevel: JobLevel,
  stat: Stat,
  gearAndFoodValue: number,
): number {
  const schema = game.jobSchemas[job];
  if (schema === undefined) throw new Error(`未知职业: ${job}`);
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  const { statModifiers, mainStat, partyBonus } = schema;
  if (statModifiers === undefined || mainStat === undefined) {
    throw new Error(`职业 ${job} 不支持战斗属性阈值计算`);
  }

  const { main, sub, div, det, detTrunc } = levelMod;
  const baseStats = referenceBaseStats(job, levelMod);
  const value = (baseStats[stat] ?? 0) + gearAndFoodValue;
  const attackMainStat = mainStat === "VIT" ? "STR" : mainStat;
  const bluAetherialMimicry = job === "BLU" ? 200 : 0;

  if (stat === attackMainStat) {
    return floor(
      ((mainStat === "VIT" ? levelMod.apTank : levelMod.ap) *
        (floor(value * (partyBonus ?? 1.05)) - main)) /
        main +
        100,
    );
  }
  if (stat === "CRT") {
    return floor((200 * (value - sub)) / div + 50 + bluAetherialMimicry);
  }
  if (stat === "DET") {
    return floor(((140 * (value - main)) / det + 1000) / detTrunc) * detTrunc;
  }
  if (stat === "DHT") {
    return floor((550 * (value - sub)) / div + bluAetherialMimicry);
  }
  if (stat === "TEN") {
    return floor((112 * (value - sub)) / div + 1000);
  }
  if (stat === "SKS" || stat === "SPS") {
    return floor((130 * (value - sub)) / div + 1000);
  }
  throw new RangeError(`属性 ${stat} 不参与伤害阈值 Pareto`);
}

const game = referenceGame;
type LevelModifier = (typeof game.jobLevelModifiers)[JobLevel];

// The reference project uses this epsilon-aware truncation helper everywhere.
function floor(value: number): number {
  return Math.trunc(value + 1e-7);
}

function addStats(...items: EquippedStats[]): EquippedStats {
  const result: EquippedStats = {};
  for (const item of items) {
    for (const [stat, value] of Object.entries(item)) {
      result[stat as Stat] = (result[stat as Stat] ?? 0) + (value ?? 0);
    }
  }
  return result;
}

function referenceBaseStats(job: Job, levelMod: LevelModifier): EquippedStats {
  const schema = game.jobSchemas[job];
  if (schema?.stats === undefined || schema.statModifiers === undefined) {
    return {};
  }

  const stats: EquippedStats = { PDMG: 0, MDMG: 0, DLY: 0 };
  for (const stat of schema.stats) {
    const baseStat = game.baseStats[stat] ?? 0;
    if (typeof baseStat === "number") {
      stats[stat as Stat] = baseStat;
      continue;
    }

    stats[stat as Stat] =
      floor(
        (levelMod[baseStat] *
          ((schema.statModifiers as Partial<Record<Stat, number>>)[stat] ??
            100)) /
          100,
      ) + (game.clanStats[stat]?.[0] ?? 0);
  }
  return stats;
}

function calculateFromTotalStats(
  job: Job,
  jobLevel: JobLevel,
  equippedStats: EquippedStats,
  baseStats: EquippedStats,
): EquippedEffects | undefined {
  const schema = game.jobSchemas[job];
  if (schema === undefined) throw new Error(`未知职业: ${job}`);

  const { statModifiers, mainStat, traitDamageMultiplier, partyBonus } = schema;
  if (
    statModifiers === undefined ||
    mainStat === undefined ||
    traitDamageMultiplier === undefined
  ) {
    return undefined;
  }

  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);

  const { main, sub, div, det, detTrunc } = levelMod;
  const { CRT, DET, DHT, TEN, SKS, SPS, VIT, PIE, PDMG, MDMG } = equippedStats;
  const attackMainStat = mainStat === "VIT" ? "STR" : mainStat;
  const bluAetherialMimicry = job === "BLU" ? 200 : 0;
  const crtChance =
    floor((200 * (CRT! - sub)) / div + 50 + bluAetherialMimicry) / 1000;
  const crtDamage = floor((200 * (CRT! - sub)) / div + 1400) / 1000;
  const detDamage =
    (floor(((140 * (DET! - main)) / det + 1000) / detTrunc) * detTrunc) / 1000;
  const dhtChance =
    floor((550 * (DHT! - sub)) / div + bluAetherialMimicry) / 1000;
  const tenDamage = floor((112 * ((TEN ?? sub) - sub)) / div + 1000) / 1000;
  const tenMitigation = floor((200 * ((TEN ?? sub) - sub)) / div) / 1000;
  const weaponDamage =
    floor((main * statModifiers[attackMainStat]!) / 1000) +
    ((mainStat === "MND" || mainStat === "INT" ? MDMG : PDMG) ?? 0) +
    (job === "BLU"
      ? (game.bluMdmgAdditions[
          (equippedStats.INT ?? 0) - (baseStats.INT ?? 0)
        ] ?? 0)
      : 0);
  const mainDamage =
    floor(
      ((mainStat === "VIT" ? levelMod.apTank : levelMod.ap) *
        (floor(
          (equippedStats[attackMainStat as Stat] ?? 0) * (partyBonus ?? 1.05),
        ) -
          main)) /
        main +
        100,
    ) / 100;
  const damage =
    0.01 *
    weaponDamage *
    mainDamage *
    detDamage *
    tenDamage *
    traitDamageMultiplier *
    ((crtDamage - 1) * crtChance + 1) *
    (0.25 * dhtChance + 1);
  const gcd =
    floor(
      (floor(
        ((1000 - floor((130 * ((SKS ?? SPS)! - sub)) / div)) * 2500) / 1000,
      ) *
        ((jobLevel >= 80 && statModifiers.gcd) || 100)) /
        1000,
    ) / 100;
  const ssDamage = floor((130 * ((SKS ?? SPS)! - sub)) / div + 1000) / 1000;
  const hp =
    levelMod.hp * statModifiers.hp +
    floor(
      (mainStat === "VIT" ? levelMod.vitTank : levelMod.vit) * (VIT! - main),
    );
  const mp = floor((150 * ((PIE ?? main) - main)) / div + 200);
  return {
    crtChance,
    crtDamage,
    detDamage,
    dhtChance,
    tenDamage,
    tenMitigation,
    damage,
    gcd,
    ssDamage,
    hp,
    mp,
  };
}

/**
 * Reproduces Store.equippedEffects while accepting only gear+food stat sums.
 */
export function equippedEffects(
  job: Job,
  jobLevel: JobLevel,
  gearAndFoodStats: EquippedStats,
): EquippedEffects | undefined {
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  const baseStats = referenceBaseStats(job, levelMod);
  return calculateFromTotalStats(
    job,
    jobLevel,
    addStats(baseStats, gearAndFoodStats),
    baseStats,
  );
}

/** Returns the inclusive gear-and-food speed contribution for an exact GCD. */
export function equippedSpeedRangeForGcd(
  job: Job,
  jobLevel: JobLevel,
  gcdSeconds: number,
): EquippedSpeedRange | undefined {
  if (!Number.isFinite(gcdSeconds) || gcdSeconds <= 0) {
    throw new RangeError("GCD 必须是正的有限秒数");
  }
  const gcdHundredths = Math.round(gcdSeconds * 100);
  if (Math.abs(gcdSeconds - gcdHundredths / 100) > 1e-9) {
    throw new RangeError("GCD 最多支持两位小数");
  }

  const schema = game.jobSchemas[job];
  if (schema?.stats === undefined) throw new Error(`职业 ${job} 缺少属性配置`);
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const gcdAt = (speedContribution: number): number => {
    const effects = equippedEffects(job, jobLevel, {
      [speedStat]: speedContribution,
    });
    if (effects === undefined || !Number.isFinite(effects.gcd)) {
      throw new Error(`职业 ${job} 不支持 GCD 计算`);
    }
    return Math.round(effects.gcd * 100);
  };

  if (gcdAt(0) < gcdHundredths) return undefined;
  const minimum = firstNonnegativeInteger(
    (speedContribution) => gcdAt(speedContribution) <= gcdHundredths,
    "GCD 速度下限",
  );
  if (gcdAt(minimum) !== gcdHundredths) return undefined;
  const nextTier = firstNonnegativeInteger(
    (speedContribution) => gcdAt(speedContribution) < gcdHundredths,
    "GCD 速度上限",
  );
  return { min: minimum, max: nextTier - 1 };
}

/** Converts a mitigation percentage such as 5 into a minimum TEN contribution. */
export function equippedToughnessForMitigationPercent(
  job: Job,
  jobLevel: JobLevel,
  mitigationPercent: number,
): number {
  if (!Number.isFinite(mitigationPercent) || mitigationPercent < 0) {
    throw new RangeError("坚韧减伤百分比必须是非负有限数字");
  }
  const schema = game.jobSchemas[job];
  if (!schema?.stats?.includes("TEN")) {
    throw new RangeError(`职业 ${job} 不使用坚韧属性`);
  }

  const requiredPerMille = Math.ceil(mitigationPercent * 10 - 1e-7);
  return firstNonnegativeInteger((toughnessContribution) => {
    const effects = equippedEffects(job, jobLevel, {
      TEN: toughnessContribution,
    });
    if (effects === undefined || !Number.isFinite(effects.tenMitigation)) {
      throw new Error(`职业 ${job} 不支持坚韧计算`);
    }
    return Math.round(effects.tenMitigation * 1000) >= requiredPerMille;
  }, "坚韧下限");
}

function firstNonnegativeInteger(
  predicate: (value: number) => boolean,
  name: string,
): number {
  if (predicate(0)) return 0;
  let upper = 1;
  while (!predicate(upper)) {
    if (upper > Math.trunc(Number.MAX_SAFE_INTEGER / 2)) {
      throw new RangeError(`${name}超出安全整数范围`);
    }
    upper *= 2;
  }

  let lower = 0;
  while (upper - lower > 1) {
    const middle = Math.trunc((lower + upper) / 2);
    if (predicate(middle)) upper = middle;
    else lower = middle;
  }
  return upper;
}
