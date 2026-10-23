import { gameData } from "../data.ts";
import { assertClanIndex, defaultClanIndex } from "../clans.ts";
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
/** 用于无浮点误差精确比较的整数伤害因子。 */
export interface IntegerDamageFactors {
  /** 武器伤害，包含职业对应的基础武器修正。 */
  weaponDamage: number;
  /** 主属性因子分子，分母为 100。 */
  mainStat: number;
  /** 信念因子，分母为 1000。 */
  determination: number;
  /** 坚韧因子，分母为 1000。 */
  tenacity: number;
  /** 暴击期望因子，分母为 1,000,000。 */
  critical: number;
  /** 直击期望因子，分母为 4000。 */
  directHit: number;
  /** 职业特性倍率；对该求值器的所有属性向量都相同。 */
  traitMultiplier: number;
  /** 精确 GCD 的百分秒整数值，与 equippedEffects 一致。 */
  gcdCentiseconds: number;
}

export type IntegerDamageFactorEvaluator = (
  gearAndFoodContributions: readonly number[],
) => IntegerDamageFactors | undefined;

/**
 * 根据伤害求值器使用的同一装备与食物贡献向量，构造精确整数因子。
 * 因子乘积的分母和职业特性倍率对同一职业及等级保持不变，因此能保留精确伤害排序。
 */
export function createIntegerDamageFactorEvaluator(
  job: Job,
  jobLevel: JobLevel,
  statIndexes: ReadonlyMap<Stat, number>,
  clanIndex: number = defaultClanIndex,
): IntegerDamageFactorEvaluator {
  assertClanIndex(clanIndex);
  const schema = game.jobSchemas[job];
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (schema === undefined) throw new Error(`未知职业: ${job}`);
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  if (schema.mainStat === undefined || schema.statModifiers === undefined ||
      schema.traitDamageMultiplier === undefined) return () => undefined;
  const baseStats = getBaseStats(job, levelMod, clanIndex);
  const mainStat = schema.mainStat;
  const statModifiers = schema.statModifiers;
  const traitMultiplier = schema.traitDamageMultiplier;
  const effects = (attributes: readonly number[]) => {
    const stat = (name: Stat): number => attributes[statIndexes.get(name) ?? -1] ?? 0;
    const weaponStat: Stat = mainStat === "INT" || mainStat === "MND" ? "MDMG" : "PDMG";
    const speedStat: Stat = schema.stats.includes("SKS")
      ? "SKS"
      : "SPS";
    const attackTier = equippedAttributeTier(job, jobLevel, mainStat, stat(mainStat), clanIndex);
    const crtTier = equippedAttributeTier(job, jobLevel, "CRT", stat("CRT"), clanIndex);
    const detTier = equippedAttributeTier(job, jobLevel, "DET", stat("DET"), clanIndex);
    const dhtTier = equippedAttributeTier(job, jobLevel, "DHT", stat("DHT"), clanIndex);
    const tenTier = equippedAttributeTier(job, jobLevel, "TEN", stat("TEN"), clanIndex);
    const speedValue = (baseStats[speedStat] ?? 0) + stat(speedStat);
    const weaponBase = floor((levelMod.main * statModifiers[mainStat]!) / 1000);
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
 * 返回 equippedEffects 公式中某项伤害相关属性使用的精确整数档位。
 * 输入仅包含装备与食物带来的属性贡献。
 */
export function equippedAttributeTier(
  job: Job,
  jobLevel: JobLevel,
  stat: Stat,
  gearAndFoodValue: number,
  clanIndex: number = defaultClanIndex,
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
  const baseStats = getBaseStats(job, levelMod, clanIndex);
  const value = (baseStats[stat] ?? 0) + gearAndFoodValue;
  if (stat === mainStat) {
    return floor(
      ((schema.role === "tank" ? levelMod.apTank : levelMod.ap) *
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

// 在公式边界保留上游游戏对浮点误差的容忍截断方式。
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

function getBaseStats(
  job: Job,
  levelMod: LevelModifier,
  clanIndex: number = defaultClanIndex,
): EquippedStats {
  assertClanIndex(clanIndex);
  const schema = game.jobSchemas[job];
  if (schema?.stats === undefined || schema.statModifiers === undefined) {
    return {};
  }

  // 非坦克职业的属性结构不含 TEN；总属性公式会将其默认设为等级副属性。
  // 向量求值器也使用相同的中性基准值。
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
      ) + (game.clanStats[stat]?.[clanIndex] ?? 0);
  }
  return stats;
}

function calculateFromTotalStats(
  job: Job,
  jobLevel: JobLevel,
  equippedStats: EquippedStats,
  clanIndex: number = defaultClanIndex,
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
  const crtChance =
    floor((200 * (CRT! - sub)) / div + 50 + (job === "BLU" ? 200 : 0)) / 1000;
  const crtDamage = floor((200 * (CRT! - sub)) / div + 1400) / 1000;
  const detDamage =
    (floor(((140 * (DET! - main)) / det + 1000) / detTrunc) * detTrunc) / 1000;
  const dhtChance = floor((550 * (DHT! - sub)) / div + (job === "BLU" ? 200 : 0)) / 1000;
  const tenDamage = floor((112 * ((TEN ?? sub) - sub)) / div + 1000) / 1000;
  const tenMitigation = floor((200 * ((TEN ?? sub) - sub)) / div) / 1000;
  const weaponDamage =
    floor((main * statModifiers[mainStat]!) / 1000) +
    ((mainStat === "MND" || mainStat === "INT" ? MDMG : PDMG) ?? 0) +
    (job === "BLU" ? blueMageWeaponDamageAddition((equippedStats.INT ?? 0) - (getBaseStats(job, levelMod, clanIndex).INT ?? 0)) : 0);
  const mainDamage =
    floor(
      ((schema.role === "tank" ? levelMod.apTank : levelMod.ap) *
        (floor(
          (equippedStats[mainStat] ?? 0) * (partyBonus ?? 1.05),
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
      (schema.role === "tank" ? levelMod.vitTank : levelMod.vit) * (VIT! - main),
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
 * 仅接收装备与食物属性总和，并据此计算属性效果。
 * 调用方必须先排除不属于职业属性结构的属性（见 `job-stats.ts`）；本求值器只按公式使用传入值。
 */
export function equippedEffects(
  job: Job,
  jobLevel: JobLevel,
  gearAndFoodStats: EquippedStats,
  clanIndex: number = defaultClanIndex,
): EquippedEffects | undefined {
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  const baseStats = getBaseStats(job, levelMod, clanIndex);
  return calculateFromTotalStats(
    job,
    jobLevel,
    addStats(baseStats, gearAndFoodStats),
    clanIndex,
  );
}

/**
 * 创建 V2 搜索热路径使用的无额外分配求值器。
 * `attributes` 按调用方的向量顺序保存装备与食物贡献。
 * 返回的函数同步执行，因此可以在多次求值之间安全复用固定结构的属性对象。
 */
export function createEquippedEffectsVectorEvaluator(
  job: Job,
  jobLevel: JobLevel,
  statIndexes: ReadonlyMap<Stat, number>,
  clanIndex: number = defaultClanIndex,
): (attributes: readonly number[]) => EquippedEffects | undefined {
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (levelMod === undefined) throw new Error(`不支持的等级: ${jobLevel}`);
  assertClanIndex(clanIndex);
  const baseStats = getBaseStats(job, levelMod, clanIndex);
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
    return calculateFromTotalStats(job, jobLevel, totalStats, clanIndex);
  };
}

/** 为指定职业和等级创建同步的伤害与 GCD 求值器。 */
export function createDamageGcdVectorEvaluator(
  job: Job,
  jobLevel: JobLevel,
  statIndexes: ReadonlyMap<Stat, number>,
  _maxContributions?: readonly number[],
  clanIndex: number = defaultClanIndex,
): DamageGcdVectorEvaluator {
  const evaluate = createEquippedEffectsVectorEvaluator(job, jobLevel, statIndexes, clanIndex);
  return (attributes) => {
    const effects = evaluate(attributes);
    return effects === undefined ? undefined : { damage: effects.damage, gcd: effects.gcd };
  };
}
export function equippedSpeedRangeForGcd(
  job: Job,
  jobLevel: JobLevel,
  gcdSeconds: number,
  clanIndex: number = defaultClanIndex,
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
    }, clanIndex);
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

/** 将减伤百分比（例如 5）换算为所需的最低坚韧贡献值。 */
export function equippedToughnessForMitigationPercent(
  job: Job,
  jobLevel: JobLevel,
  mitigationPercent: number,
  clanIndex: number = defaultClanIndex,
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
    }, clanIndex);
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


/** 由可复现的数据更新程序导入的精确实测查表数据。 */
export function blueMageWeaponDamageAddition(intelligenceContribution: number): number {
  if (!Number.isSafeInteger(intelligenceContribution) || intelligenceContribution < 0) {
    throw new RangeError("青魔法师智力装备贡献必须为非负安全整数");
  }
  const value = gameData.bluMdmgAdditions[intelligenceContribution];
  if (value === undefined) throw new RangeError(`青魔法师智力装备贡献 ${intelligenceContribution} 超出已验证武器伤害数据范围`);
  return value;
}
