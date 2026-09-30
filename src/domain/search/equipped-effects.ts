import { gameData } from "../data.ts";
import type { JobId, LevelModifier, Stat, Stats } from "../types";

export type Job = JobId;
export type JobLevel = number;

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

export type DamageGcdVectorEvaluator = (
  attributes: readonly number[],
) => { damage: number; gcd: number } | undefined;
/** Integer damage factors for exact comparison without floating point. */
export interface IntegerDamageFactors {
  /** Weapon damage, including the base job-specific weapon modifier. */
  weaponDamage: number;
  /** Main-stat factor numerator, denominator 100. */
  mainStat: number;
  /** Determination numerator, denominator 1000. */
  determination: number;
  /** Tenacity numerator, denominator 1000. */
  tenacity: number;
  /** Critical expectation numerator, denominator 1,000,000. */
  critical: number;
  /** Direct-hit expectation numerator, denominator 4000. */
  directHit: number;
  /** Job trait multiplier, constant for every vector of this evaluator. */
  traitMultiplier: number;
  /** Exact GCD rounded to centiseconds, matching equippedEffects. */
  gcdCentiseconds: number;
}

export type IntegerDamageFactorEvaluator = (
  gearAndFoodContributions: readonly number[],
) => IntegerDamageFactors | undefined;

/**
 * Builds exact integer factors from the same gear+food contribution vector as
 * the damage evaluators. Their product has a job/level-constant denominator
 * and trait multiplier, so it preserves exact damage ordering.
 */
export function createIntegerDamageFactorEvaluator(
  job: Job,
  jobLevel: JobLevel,
  statIndexes: ReadonlyMap<Stat, number>,
): IntegerDamageFactorEvaluator {
  const schema = game.jobSchemas[job];
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (schema === undefined) throw new Error(`未知职业: ${job}`);
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  if (schema.mainStat === undefined || schema.statModifiers === undefined ||
      schema.traitDamageMultiplier === undefined) return () => undefined;
  const baseStats = getBaseStats(job, levelMod);
  const mainStat = schema.mainStat;
  const statModifiers = schema.statModifiers;
  const traitMultiplier = schema.traitDamageMultiplier;
  const effects = (attributes: readonly number[]) => {
    const stat = (name: Stat): number => attributes[statIndexes.get(name) ?? -1] ?? 0;
    const attackStat: Stat = mainStat === "VIT" ? "STR" : mainStat;
    const weaponStat: Stat = mainStat === "INT" || mainStat === "MND" ? "MDMG" : "PDMG";
    const speedStat: Stat = schema.stats.includes("SKS")
      ? "SKS"
      : "SPS";
    const attackTier = equippedAttributeTier(job, jobLevel, attackStat, stat(attackStat));
    const crtTier = equippedAttributeTier(job, jobLevel, "CRT", stat("CRT"));
    const detTier = equippedAttributeTier(job, jobLevel, "DET", stat("DET"));
    const dhtTier = equippedAttributeTier(job, jobLevel, "DHT", stat("DHT"));
    const tenTier = equippedAttributeTier(job, jobLevel, "TEN", stat("TEN"));
    const speedValue = (baseStats[speedStat] ?? 0) + stat(speedStat);
    const weaponBase = floor((levelMod.main * statModifiers[attackStat]!) / 1000);
    const gcdModifier = (jobLevel >= 80 && statModifiers.gcd) || 100;
    const gcdCentiseconds = floor(
      (floor(((1000 - floor((130 * (speedValue - levelMod.sub)) / levelMod.div)) * 2500) / 1000) * gcdModifier) / 1000,
    );
    return {
      weaponDamage: weaponBase + stat(weaponStat) + (job === "BLU" ? blueMageWeaponDamageAddition(stat("INT")) : 0),
      mainStat: attackTier,
      determination: detTier,
      tenacity: tenTier,
      critical: 1_000_000 + crtTier * (crtTier + (job === "BLU" ? 150 : 350)),
      directHit: 4000 + dhtTier,
      traitMultiplier,
      gcdCentiseconds,
    };
  };
  return effects;
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
  const baseStats = getBaseStats(job, levelMod);
  const value = (baseStats[stat] ?? 0) + gearAndFoodValue;
  const attackMainStat = mainStat === "VIT" ? "STR" : mainStat;

  if (stat === attackMainStat) {
    return floor(
      ((mainStat === "VIT" ? levelMod.apTank : levelMod.ap) *
        (floor(value * (partyBonus ?? 1.05)) - main)) /
        main +
        100,
    );
  }
  if (stat === "CRT") {
    return floor((200 * (value - sub)) / div + 50 + (job === "BLU" ? 200 : 0));
  }
  if (stat === "DET") {
    return floor(((140 * (value - main)) / det + 1000) / detTrunc) * detTrunc;
  }
  if (stat === "DHT") {
    return floor((550 * (value - sub)) / div + (job === "BLU" ? 200 : 0));
  }
  if (stat === "TEN") {
    return floor((112 * (value - sub)) / div + 1000);
  }
  if (stat === "SKS" || stat === "SPS") {
    return floor((130 * (value - sub)) / div + 1000);
  }
  throw new RangeError(`属性 ${stat} 不参与伤害阈值 Pareto`);
}

const game = {
  jobSchemas: gameData.jobSchemas,
  jobLevelModifiers: gameData.jobLevelModifiers,
  baseStats: gameData.baseStats,
  clanStats: gameData.clanStats,
};

// Preserve the upstream game's epsilon-aware truncation at formula boundaries.
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

function getBaseStats(job: Job, levelMod: LevelModifier): EquippedStats {
  const schema = game.jobSchemas[job];
  if (schema?.stats === undefined || schema.statModifiers === undefined) {
    return {};
  }

  // TEN is absent from non-tank schemas; the total-stat formula defaults it
  // to the level substat. Keep the same neutral baseline in vector evaluators.
  const stats: EquippedStats = { PDMG: 0, MDMG: 0, DLY: 0, TEN: levelMod.sub };
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
  if (statModifiers.hp === undefined) {
    throw new Error(`职业 ${job} 缺少生命值修正`);
  }

  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);

  const { main, sub, div, det, detTrunc } = levelMod;
  const { CRT, DET, DHT, TEN, VIT, PIE, PDMG, MDMG } = equippedStats;
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const speed = equippedStats[speedStat]!;
  const attackMainStat = mainStat === "VIT" ? "STR" : mainStat;
  const crtChance =
    floor((200 * (CRT! - sub)) / div + 50 + (job === "BLU" ? 200 : 0)) / 1000;
  const crtDamage = floor((200 * (CRT! - sub)) / div + 1400) / 1000;
  const detDamage =
    (floor(((140 * (DET! - main)) / det + 1000) / detTrunc) * detTrunc) / 1000;
  const dhtChance = floor((550 * (DHT! - sub)) / div + (job === "BLU" ? 200 : 0)) / 1000;
  const tenDamage = floor((112 * ((TEN ?? sub) - sub)) / div + 1000) / 1000;
  const tenMitigation = floor((200 * ((TEN ?? sub) - sub)) / div) / 1000;
  const weaponDamage =
    floor((main * statModifiers[attackMainStat]!) / 1000) +
    ((mainStat === "MND" || mainStat === "INT" ? MDMG : PDMG) ?? 0) +
    (job === "BLU" ? blueMageWeaponDamageAddition((equippedStats.INT ?? 0) - (getBaseStats(job, levelMod).INT ?? 0)) : 0);
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
        ((1000 - floor((130 * (speed - sub)) / div)) * 2500) / 1000,
      ) *
        ((jobLevel >= 80 && statModifiers.gcd) || 100)) /
        1000,
    ) / 100;
  const ssDamage = floor((130 * (speed - sub)) / div + 1000) / 1000;
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
 * Calculates effects while accepting only gear and food stat sums.
 */
export function equippedEffects(
  job: Job,
  jobLevel: JobLevel,
  gearAndFoodStats: EquippedStats,
): EquippedEffects | undefined {
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  const baseStats = getBaseStats(job, levelMod);
  return calculateFromTotalStats(
    job,
    jobLevel,
    addStats(baseStats, gearAndFoodStats),
  );
}

/**
 * Creates the allocation-free evaluator used by the V2 search hot path.
 * `attributes` contains gear and food contributions in the caller's vector
 * order. The returned function is synchronous, so its fixed-shape stats object
 * can be safely reused between evaluations.
 */
export function createEquippedEffectsVectorEvaluator(
  job: Job,
  jobLevel: JobLevel,
  statIndexes: ReadonlyMap<Stat, number>,
): (attributes: readonly number[]) => EquippedEffects | undefined {
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  const baseStats = getBaseStats(job, levelMod);
  const totalStats: EquippedStats = { ...baseStats };
  const mappedStats = [...statIndexes.entries()];

  for (const [stat, index] of mappedStats) {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError(`属性 ${stat} 的向量索引必须是非负整数`);
    }
    if (!(stat in totalStats)) totalStats[stat] = baseStats[stat] ?? 0;
  }

  return (attributes) => {
    for (const [stat, index] of mappedStats) {
      totalStats[stat] = (baseStats[stat] ?? 0) + (attributes[index] ?? 0);
    }
    return calculateFromTotalStats(job, jobLevel, totalStats);
  };
}

/** Builds a synchronous damage and GCD evaluator for one job and level. */
export function createDamageGcdVectorEvaluator(
  job: Job,
  jobLevel: JobLevel,
  statIndexes: ReadonlyMap<Stat, number>,
  _maxContributions?: readonly number[],
): DamageGcdVectorEvaluator {
  const evaluate = createEquippedEffectsVectorEvaluator(job, jobLevel, statIndexes);
  return (attributes) => {
    const effects = evaluate(attributes);
    return effects === undefined ? undefined : { damage: effects.damage, gcd: effects.gcd };
  };
}
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


/** Exact measured lookup imported by the reproducible data updater. */
export function blueMageWeaponDamageAddition(intelligenceContribution: number): number {
  if (!Number.isSafeInteger(intelligenceContribution) || intelligenceContribution < 0) {
    throw new RangeError("青魔法师智力装备贡献必须为非负安全整数");
  }
  const value = gameData.bluMdmgAdditions[intelligenceContribution];
  if (value === undefined) throw new RangeError(`青魔法师智力装备贡献 ${intelligenceContribution} 超出已验证武器伤害数据范围`);
  return value;
}
