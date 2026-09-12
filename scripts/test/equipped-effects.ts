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
