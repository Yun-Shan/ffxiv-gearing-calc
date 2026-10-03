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
 *   tsx scripts/archive/equipped-effects.ts SAM 100 '{"STR":6007,"CRT":3185,"DET":2093,"DHT":1427,"SKS":0,"VIT":7027,"PDMG":158}'
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

export type CombinedDamageFunction = (
  first: readonly number[],
  second: readonly number[],
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
) => number;

export type CombinedDamageFlatFunction = (
  first: readonly number[],
  suffix: ArrayLike<number>,
  offset: number,
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
) => number;

export type MaxCombinedDamageFlatFunction = (
  first: readonly number[],
  suffix: ArrayLike<number>,
  attributeCount: number,
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  startStateIndex?: number,
  endStateIndex?: number,
  /** Optional precomputed suffix pair offsets for the weapon/attack product. */
  suffixPairIndexes?: ArrayLike<number>,
) => { damage: number; stateIndex: number };

export type MaxCombinedDamageFlatColumnsFunction = (
  first: readonly number[],
  suffixColumns: readonly ArrayLike<number>[],
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  startStateIndex?: number,
  endStateIndex?: number,
  /** Optional precomputed suffix pair offsets for the weapon/attack product. */
  suffixPairIndexes?: ArrayLike<number>,
) => { damage: number; stateIndex: number };

export type MaxCombinedDamageFlatBatchFunction = (
  first: readonly number[],
  suffix: ArrayLike<number>,
  suffixAttributeCount: number,
  transforms: readonly (readonly { attribute: number; maxValue: number; rate: number }[])[],
  startStateIndex?: number,
  endStateIndex?: number,
  suffixPairIndexes?: ArrayLike<number>,
) => readonly { damage: number; stateIndex: number }[];

export type CombinedDamageUpperBoundFunction = (
  first: readonly number[],
  second: readonly number[],
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  secondMinimum: readonly number[],
  secondAttributeSumMaximum: number,
  slotBounds?: readonly {
    minimum: readonly number[];
    maximum: readonly number[];
    attributeSumMaximum: number;
  }[],
) => number;

export type DamageGcdVectorEvaluator = ((
  attributes: readonly number[],
) => { damage: number; gcd: number } | undefined) & {
  combinedDamage?: CombinedDamageFunction;
  combinedDps?: CombinedDamageFunction;
  combinedDamageFlat?: CombinedDamageFlatFunction;
  combinedDpsFlat?: CombinedDamageFlatFunction;
  maxCombinedDamageFlat?: MaxCombinedDamageFlatFunction;
  maxCombinedDamageFlatColumns?: MaxCombinedDamageFlatColumnsFunction;
  maxCombinedDpsFlatColumns?: MaxCombinedDamageFlatColumnsFunction;
  maxCombinedDamageFlatBatch?: MaxCombinedDamageFlatBatchFunction;
  maxCombinedDpsFlatBatch?: MaxCombinedDamageFlatBatchFunction;
  maxCombinedDpsFlat?: MaxCombinedDamageFlatFunction;
  combinedDamageUpperBound?: CombinedDamageUpperBoundFunction;
  combinedDpsUpperBound?: CombinedDamageUpperBoundFunction;
  /** Metadata used by the flat evaluator's optional pair-index fast path. */
  suffixPairAttributes?: readonly [number, number];
  suffixPairStride?: number;
};

/** Integer damage factors for exact comparison without floating point. */
export interface IntegerDamageFactors {
  /** Weapon damage (already includes the BLU INT-dependent addition). */
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
  const baseStats = referenceBaseStats(job, levelMod);
  const mainStat = schema.mainStat;
  const statModifiers = schema.statModifiers;
  const traitMultiplier = schema.traitDamageMultiplier;
  const effects = (attributes: readonly number[]) => {
    const stat = (name: Stat): number => attributes[statIndexes.get(name) ?? -1] ?? 0;
    const attackStat: Stat = mainStat === "VIT" ? "STR" : mainStat;
    const weaponStat: Stat = mainStat === "INT" || mainStat === "MND" ? "MDMG" : "PDMG";
    // The reference formula uses SKS ?? SPS; its base stats may define SKS
    // even on caster jobs, in which case SPS is intentionally ignored.
    const speedStat: Stat = statIndexes.has("SKS") || baseStats.SKS !== undefined
      ? "SKS"
      : "SPS";
    const attackTier = equippedAttributeTier(job, jobLevel, attackStat, stat(attackStat));
    const crtTier = equippedAttributeTier(job, jobLevel, "CRT", stat("CRT"));
    const detTier = equippedAttributeTier(job, jobLevel, "DET", stat("DET"));
    const dhtTier = equippedAttributeTier(job, jobLevel, "DHT", stat("DHT"));
    const tenTier = equippedAttributeTier(job, jobLevel, "TEN", stat("TEN"));
    const speedValue = (baseStats[speedStat] ?? 0) + stat(speedStat);
    const weaponBase = floor((levelMod.main * statModifiers[attackStat]!) / 1000);
    const bluAddition = job === "BLU"
      ? (game.bluMdmgAdditions[stat("INT")] ?? 0)
      : 0;
    const gcdModifier = (jobLevel >= 80 && statModifiers.gcd) || 100;
    const gcdCentiseconds = floor(
      (floor(((1000 - floor((130 * (speedValue - levelMod.sub)) / levelMod.div)) * 2500) / 1000) * gcdModifier) / 1000,
    );
    return {
      weaponDamage: weaponBase + stat(weaponStat) + bluAddition,
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
  const baseStats = referenceBaseStats(job, levelMod);
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
    return calculateFromTotalStats(job, jobLevel, totalStats, baseStats);
  };
}

/**
 * The search only needs damage and GCD. The reference formula depends on one
 * integer tier per stat, so tables preserve its floor positions while avoiding
 * object updates and repeated divisions in the branch-and-bound hot path.
 */
export function createDamageGcdVectorEvaluator(
  job: Job,
  jobLevel: JobLevel,
  statIndexes: ReadonlyMap<Stat, number>,
  maxContributions: readonly number[],
): DamageGcdVectorEvaluator {
  const fallback = createEquippedEffectsVectorEvaluator(job, jobLevel, statIndexes);
  const schema = game.jobSchemas[job];
  const levelMod = game.jobLevelModifiers[jobLevel];
  if (job === "BLU" || schema?.mainStat === undefined || schema.statModifiers === undefined ||
      schema.traitDamageMultiplier === undefined || levelMod === undefined) {
    return fallback;
  }
  const attackStat: Stat = schema.mainStat === "VIT" ? "STR" : schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "MND" || schema.mainStat === "INT" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats?.includes("SKS") ? "SKS" : "SPS";
  const mappedStats = [...statIndexes.entries()];
  const weaponIndex = statIndexes.get(weaponStat);
  const attackIndex = statIndexes.get(attackStat);
  const speedIndex = statIndexes.get(speedStat);
  if (weaponIndex === undefined || attackIndex === undefined || speedIndex === undefined) {
    return fallback;
  }

  const table = (stat: Stat, factor: (tier: number) => number): Float64Array | undefined => {
    const index = statIndexes.get(stat);
    if (index === undefined) return undefined;
    const maximum = maxContributions[index];
    if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 100_000) {
      throw new RangeError(`属性 ${stat} 的档位表范围无效`);
    }
    const values = new Float64Array(maximum + 1);
    for (let value = 0; value <= maximum; value++) {
      values[value] = factor(equippedAttributeTier(job, jobLevel, stat, value));
    }
    return values;
  };
  const mainDamage = table(attackStat, (tier) => tier / 100)!;
  const crtFactor = table("CRT", (tier) =>
    (((tier + 1350) / 1000 - 1) * (tier / 1000) + 1))!;
  const detDamage = table("DET", (tier) => tier / 1000)!;
  const dhtFactor = table("DHT", (tier) => 0.25 * (tier / 1000) + 1)!;
  const tenDamage = table("TEN", (tier) => tier / 1000);
  const gcdModifier = (jobLevel >= 80 && schema.statModifiers.gcd) || 100;
  const gcd = table(speedStat, (tier) =>
    floor((floor(((2000 - tier) * 2500) / 1000) * gcdModifier) / 1000) / 100)!;
  const weaponAddition = floor((levelMod.main * schema.statModifiers[attackStat]!) / 1000);
  const trait = schema.traitDamageMultiplier;
  const result = { damage: 0, gcd: 0 };
  const crtIndex = statIndexes.get("CRT");
  const detIndex = statIndexes.get("DET");
  const dhtIndex = statIndexes.get("DHT");
  const tenIndex = statIndexes.get("TEN");
  const read = (attributes: readonly number[], index: number | undefined,
    values: Float64Array | undefined): number =>
    index === undefined || values === undefined ? 1 : values[attributes[index] ?? 0];

  const evaluate = ((attributes) => {
    for (const [stat, index] of mappedStats) {
      const value = attributes[index] ?? 0;
      if (!Number.isInteger(value) || value < 0 || value > maxContributions[index]) {
        return fallback(attributes);
      }
    }
    const weaponDamage = weaponAddition + (attributes[weaponIndex] ?? 0);
    result.damage = 0.01 * weaponDamage *
      mainDamage[attributes[attackIndex] ?? 0] *
      read(attributes, detIndex, detDamage) *
      read(attributes, tenIndex, tenDamage) *
      trait *
      read(attributes, crtIndex, crtFactor) *
      read(attributes, dhtIndex, dhtFactor);
    result.gcd = gcd[attributes[speedIndex] ?? 0];
    return result;
  }) as DamageGcdVectorEvaluator;

  // Food transforms are stable for one search branch.  Compose their exact
  // truncation/cap operations once per transform array so the flat suffix
  // evaluator only performs integer table reads in its hot loop.
  const flatFoodLookupCache = new Map<
    readonly { attribute: number; maxValue: number; rate: number }[],
    (Int32Array | undefined)[]
  >();
  const getFlatFoodLookups = (
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  ): (Int32Array | undefined)[] => {
    const cached = flatFoodLookupCache.get(transforms);
    if (cached !== undefined) return cached;
    const lookups = new Array<Int32Array | undefined>(
      maxContributions.length,
    );
    const byAttribute = new Map<
      number,
      { attribute: number; maxValue: number; rate: number }[]
    >();
    for (const transform of transforms) {
      if (!Number.isInteger(transform.attribute) ||
          transform.attribute < 0 ||
          transform.attribute >= maxContributions.length) {
        continue;
      }
      const existing = byAttribute.get(transform.attribute);
      if (existing === undefined) byAttribute.set(transform.attribute, [transform]);
      else byAttribute.set(transform.attribute, [...existing, transform]);
    }
    for (const [attribute, attributeTransforms] of byAttribute) {
      const maximum = maxContributions[attribute]!;
      if (!Number.isSafeInteger(maximum) || maximum < 0) continue;
      const lookup = new Int32Array(maximum + 1);
      for (let value = 0; value <= maximum; value++) {
        let transformed = value;
        for (const transform of attributeTransforms) {
          transformed += Math.min(
            transform.maxValue,
            Math.trunc(transformed * transform.rate + 1e-7),
          );
        }
        lookup[value] = transformed;
      }
      lookups[attribute] = lookup;
    }
    flatFoodLookupCache.set(transforms, lookups);
    return lookups;
  };

  /**
   * Compose food application with the per-attribute damage tables once for a
   * food branch.  The suffix hot loop can then index the final factor tables
   * directly with `prefix + suffix`, avoiding a transform lookup followed by
   * a second table lookup for every candidate state.
   */
  type FlatFoodFactors = {
    weapon: Float64Array;
    attack: Float64Array;
    weaponAttack: Float64Array;
    det?: Float64Array;
    ten?: Float64Array;
    crt?: Float64Array;
    dht?: Float64Array;
    speed: Float64Array;
  };
  const flatFoodFactorCache = new Map<
    readonly { attribute: number; maxValue: number; rate: number }[],
    FlatFoodFactors
  >();
  const getFlatFoodFactors = (
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  ): FlatFoodFactors => {
    const cached = flatFoodFactorCache.get(transforms);
    if (cached !== undefined) return cached;
    const lookups = getFlatFoodLookups(transforms);
    const compose = (
      attribute: number,
      factor: (value: number) => number,
    ): Float64Array => {
      const table = new Float64Array(maxContributions[attribute]! + 1);
      const lookup = lookups[attribute];
      for (let value = 0; value < table.length; value++) {
        table[value] = factor(lookup === undefined ? value : lookup[value]!);
      }
      return table;
    };
    const factors: FlatFoodFactors = {
      weapon: compose(weaponIndex, (value) => weaponAddition + value),
      attack: compose(attackIndex, (value) => mainDamage[value]!),
      weaponAttack: new Float64Array(0),
      speed: compose(speedIndex, (value) => {
        const gcdValue = gcd[value]!;
        return gcdValue > 0 && Number.isFinite(gcdValue)
          ? gcdValue
          : Number.NEGATIVE_INFINITY;
      }),
    };
    const attackWidth = maxContributions[attackIndex]! + 1;
    const weaponAttack = new Float64Array(
      (maxContributions[weaponIndex]! + 1) * attackWidth,
    );
    for (let weaponValue = 0; weaponValue < factors.weapon.length; weaponValue++) {
      const weaponFactor = factors.weapon[weaponValue]!;
      const rowOffset = weaponValue * attackWidth;
      for (let attackValue = 0; attackValue < factors.attack.length; attackValue++) {
        weaponAttack[rowOffset + attackValue] =
          0.01 * weaponFactor * factors.attack[attackValue]!;
      }
    }
    factors.weaponAttack = weaponAttack;
    if (detIndex !== undefined && detDamage !== undefined) {
      factors.det = compose(detIndex, (value) => detDamage[value]!);
    }
    if (tenIndex !== undefined && tenDamage !== undefined) {
      factors.ten = compose(tenIndex, (value) => tenDamage[value]!);
    }
    if (crtIndex !== undefined && crtFactor !== undefined) {
      factors.crt = compose(crtIndex, (value) => crtFactor[value]!);
    }
    if (dhtIndex !== undefined && dhtFactor !== undefined) {
      factors.dht = compose(dhtIndex, (value) => dhtFactor[value]!);
    }
    flatFoodFactorCache.set(transforms, factors);
    return factors;
  };

  const combinedAttributes = new Array<number>(maxContributions.length).fill(0);
  const combinedScore = (
    first: readonly number[],
    second: readonly number[],
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    useDps: boolean,
  ): number => {
    for (let index = 0; index < combinedAttributes.length; index++) {
      const value = (first[index] ?? 0) + (second[index] ?? 0);
      if (!Number.isInteger(value) || value < 0 || value > maxContributions[index]) {
        const fallbackResult = evaluate(combinedAttributes);
        return fallbackResult === undefined ||
          !Number.isFinite(fallbackResult.damage) ||
          !Number.isFinite(fallbackResult.gcd) ||
          fallbackResult.gcd <= 0
          ? Number.NEGATIVE_INFINITY
          : useDps
            ? fallbackResult.damage / fallbackResult.gcd
            : fallbackResult.damage;
      }
      combinedAttributes[index] = value;
    }
    for (const transform of transforms) {
      const index = transform.attribute;
      combinedAttributes[index] += Math.min(
        transform.maxValue,
        Math.trunc(combinedAttributes[index] * transform.rate + 1e-7),
      );
    }
    const damage = 0.01 * (weaponAddition + (combinedAttributes[weaponIndex] ?? 0)) *
      mainDamage[combinedAttributes[attackIndex] ?? 0] *
      read(combinedAttributes, detIndex, detDamage) *
      read(combinedAttributes, tenIndex, tenDamage) *
      trait *
      read(combinedAttributes, crtIndex, crtFactor) *
      read(combinedAttributes, dhtIndex, dhtFactor);
    if (!useDps) return damage;
    const gcdValue = gcd[combinedAttributes[speedIndex] ?? 0];
    return gcdValue > 0 && Number.isFinite(gcdValue)
      ? damage / gcdValue
      : Number.NEGATIVE_INFINITY;
  };
  const scoreWithTotals = (
    weaponValue: number,
    attackValue: number,
    detValue: number,
    tenValue: number,
    crtValue: number,
    dhtValue: number,
    speedValue: number,
    foodLookups: readonly (Int32Array | undefined)[],
    useDps: boolean,
  ): number => {
    const weaponLookup = foodLookups[weaponIndex];
    if (weaponLookup !== undefined) weaponValue = weaponLookup[weaponValue]!;
    const attackLookup = foodLookups[attackIndex];
    if (attackLookup !== undefined) attackValue = attackLookup[attackValue]!;
    const detLookup = detIndex === undefined ? undefined : foodLookups[detIndex];
    if (detLookup !== undefined) detValue = detLookup[detValue]!;
    const tenLookup = tenIndex === undefined ? undefined : foodLookups[tenIndex];
    if (tenLookup !== undefined) tenValue = tenLookup[tenValue]!;
    const crtLookup = crtIndex === undefined ? undefined : foodLookups[crtIndex];
    if (crtLookup !== undefined) crtValue = crtLookup[crtValue]!;
    const dhtLookup = dhtIndex === undefined ? undefined : foodLookups[dhtIndex];
    if (dhtLookup !== undefined) dhtValue = dhtLookup[dhtValue]!;
    const speedLookup = foodLookups[speedIndex];
    if (speedLookup !== undefined) speedValue = speedLookup[speedValue]!;
    const damage = 0.01 * (weaponAddition + weaponValue) *
      mainDamage[attackValue] *
      (detIndex === undefined ? 1 : detDamage![detValue]!) *
      (tenIndex === undefined || tenDamage === undefined ? 1 : tenDamage[tenValue]!) *
      trait *
      (crtIndex === undefined ? 1 : crtFactor![crtValue]!) *
      (dhtIndex === undefined ? 1 : dhtFactor![dhtValue]!);
    if (!useDps) return damage;
    const gcdValue = gcd[speedValue];
    return gcdValue > 0 && Number.isFinite(gcdValue)
      ? damage / gcdValue
      : Number.NEGATIVE_INFINITY;
  };

  const flatScoreWithPrefix = (
    weaponPrefix: number,
    attackPrefix: number,
    detPrefix: number,
    tenPrefix: number,
    crtPrefix: number,
    dhtPrefix: number,
    speedPrefix: number,
    suffix: ArrayLike<number>,
    offset: number,
    foodLookups: readonly (Int32Array | undefined)[],
    useDps: boolean,
  ): number => {
    const weaponValue =
      weaponPrefix + (suffix[offset + weaponIndex] ?? 0);
    const attackValue =
      attackPrefix + (suffix[offset + attackIndex] ?? 0);
    const detValue =
      detIndex === undefined
        ? 0
        : detPrefix + (suffix[offset + detIndex] ?? 0);
    const tenValue =
      tenIndex === undefined
        ? 0
        : tenPrefix + (suffix[offset + tenIndex] ?? 0);
    const crtValue =
      crtIndex === undefined
        ? 0
        : crtPrefix + (suffix[offset + crtIndex] ?? 0);
    const dhtValue =
      dhtIndex === undefined
        ? 0
        : dhtPrefix + (suffix[offset + dhtIndex] ?? 0);
    const speedValue =
      speedPrefix + (suffix[offset + speedIndex] ?? 0);
    return scoreWithTotals(
      weaponValue,
      attackValue,
      detValue,
      tenValue,
      crtValue,
      dhtValue,
      speedValue,
      foodLookups,
      useDps,
    );
  };
  const flatCombinedScore = (
    first: readonly number[],
    suffix: ArrayLike<number>,
    offset: number,
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    useDps: boolean,
  ): number =>
    flatScoreWithPrefix(
      first[weaponIndex] ?? 0,
      first[attackIndex] ?? 0,
      detIndex === undefined ? 0 : first[detIndex] ?? 0,
      tenIndex === undefined ? 0 : first[tenIndex] ?? 0,
      crtIndex === undefined ? 0 : first[crtIndex] ?? 0,
      dhtIndex === undefined ? 0 : first[dhtIndex] ?? 0,
      first[speedIndex] ?? 0,
      suffix,
      offset,
      getFlatFoodLookups(transforms),
      useDps,
    );
  evaluate.combinedDamage = (first, second, transforms) =>
    combinedScore(first, second, transforms, false);
  evaluate.combinedDps = (first, second, transforms) =>
    combinedScore(first, second, transforms, true);
  evaluate.combinedDamageFlat = (first, suffix, offset, transforms) =>
    flatCombinedScore(first, suffix, offset, transforms, false);
  evaluate.combinedDpsFlat = (first, suffix, offset, transforms) =>
    flatCombinedScore(first, suffix, offset, transforms, true);
  const maxFlatScore = (
    first: readonly number[],
    suffix: ArrayLike<number>,
    suffixAttributeCount: number,
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    useDps: boolean,
    startStateIndex = 0,
    endStateIndex = Number.POSITIVE_INFINITY,
    suffixPairIndexes?: ArrayLike<number>,
  ): { damage: number; stateIndex: number } => {
    let damage = Number.NEGATIVE_INFINITY;
    let stateIndex = -1;
    const factors = getFlatFoodFactors(transforms);
    const weaponPrefix = first[weaponIndex] ?? 0;
    const attackPrefix = first[attackIndex] ?? 0;
    const detPrefix = detIndex === undefined ? 0 : first[detIndex] ?? 0;
    const tenPrefix = tenIndex === undefined ? 0 : first[tenIndex] ?? 0;
    const crtPrefix = crtIndex === undefined ? 0 : first[crtIndex] ?? 0;
    const dhtPrefix = dhtIndex === undefined ? 0 : first[dhtIndex] ?? 0;
    const speedPrefix = first[speedIndex] ?? 0;
    const weaponAttackFactors = factors.weaponAttack;
    const attackWidth = maxContributions[attackIndex]! + 1;
    const pairPrefix = weaponPrefix * attackWidth + attackPrefix;
    const detFactors = factors.det;
    const tenFactors = factors.ten;
    const crtFactors = factors.crt;
    const dhtFactors = factors.dht;
    if (useDps) {
      const speedFactors = factors.speed;
      // Caster DPS has no TEN factor. Keep this common shape outside the hot
      // loop so every suffix state uses only direct table reads.
      if (
        detFactors !== undefined &&
        tenFactors === undefined &&
        crtFactors !== undefined &&
        dhtFactors !== undefined
      ) {
        for (
          let index = startStateIndex,
            offset = startStateIndex * suffixAttributeCount;
          index < endStateIndex && offset + suffixAttributeCount <= suffix.length;
          index++, offset += suffixAttributeCount
        ) {
          const weaponValue = weaponPrefix + suffix[offset + weaponIndex]!;
          const attackValue = attackPrefix + suffix[offset + attackIndex]!;
          const candidateDamage = weaponAttackFactors[
            suffixPairIndexes === undefined
              ? weaponValue * attackWidth + attackValue
              : pairPrefix + suffixPairIndexes[index]!
          ]! *
            detFactors[detPrefix + suffix[offset + detIndex!]!]! *
            trait *
            crtFactors[crtPrefix + suffix[offset + crtIndex!]!]! *
            dhtFactors[dhtPrefix + suffix[offset + dhtIndex!]!]!;
          const gcdValue = speedFactors[
            speedPrefix + suffix[offset + speedIndex]!
          ]!;
          const candidate = gcdValue > 0 && Number.isFinite(gcdValue)
            ? candidateDamage / gcdValue
            : Number.NEGATIVE_INFINITY;
          if (candidate > damage) {
            damage = candidate;
            stateIndex = index;
          }
        }
        return { damage, stateIndex };
      }
      for (
        let index = startStateIndex,
          offset = startStateIndex * suffixAttributeCount;
        index < endStateIndex && offset + suffixAttributeCount <= suffix.length;
        index++, offset += suffixAttributeCount
      ) {
        const weaponValue = weaponPrefix + suffix[offset + weaponIndex]!;
        const attackValue = attackPrefix + suffix[offset + attackIndex]!;
        const damageValue = weaponAttackFactors[
          suffixPairIndexes === undefined
            ? weaponValue * attackWidth + attackValue
            : pairPrefix + suffixPairIndexes[index]!
        ]! *
          (detFactors === undefined
            ? 1
            : detFactors[detPrefix + suffix[offset + detIndex!]!]!) *
          (tenFactors === undefined
            ? 1
            : tenFactors[tenPrefix + suffix[offset + tenIndex!]!]!) *
          trait *
          (crtFactors === undefined
            ? 1
            : crtFactors[crtPrefix + suffix[offset + crtIndex!]!]!) *
          (dhtFactors === undefined
            ? 1
            : dhtFactors[dhtPrefix + suffix[offset + dhtIndex!]!]!);
        const gcdValue = speedFactors[
          speedPrefix + suffix[offset + speedIndex]!
        ]!;
        const candidate = gcdValue > 0 && Number.isFinite(gcdValue)
          ? damageValue / gcdValue
          : Number.NEGATIVE_INFINITY;
        if (candidate > damage) {
          damage = candidate;
          stateIndex = index;
        }
      }
    } else {
      for (
        let index = startStateIndex,
          offset = startStateIndex * suffixAttributeCount;
        index < endStateIndex && offset + suffixAttributeCount <= suffix.length;
        index++, offset += suffixAttributeCount
      ) {
        const weaponValue = weaponPrefix + suffix[offset + weaponIndex]!;
        const attackValue = attackPrefix + suffix[offset + attackIndex]!;
        const candidate = weaponAttackFactors[
          suffixPairIndexes === undefined
            ? weaponValue * attackWidth + attackValue
            : pairPrefix + suffixPairIndexes[index]!
        ]! *
          (detFactors === undefined
            ? 1
            : detFactors[detPrefix + suffix[offset + detIndex!]!]!) *
          (tenFactors === undefined
            ? 1
            : tenFactors[tenPrefix + suffix[offset + tenIndex!]!]!) *
          trait *
          (crtFactors === undefined
            ? 1
            : crtFactors[crtPrefix + suffix[offset + crtIndex!]!]!) *
          (dhtFactors === undefined
            ? 1
            : dhtFactors[dhtPrefix + suffix[offset + dhtIndex!]!]!);
        if (candidate > damage) {
          damage = candidate;
          stateIndex = index;
        }
      }
    }
    return { damage, stateIndex };
  };
  const maxFlatScoreColumns = (
    first: readonly number[],
    suffixColumns: readonly ArrayLike<number>[],
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    useDps: boolean,
    startStateIndex = 0,
    endStateIndex = Number.POSITIVE_INFINITY,
    suffixPairIndexes?: ArrayLike<number>,
  ): { damage: number; stateIndex: number } => {
    let damage = Number.NEGATIVE_INFINITY;
    let stateIndex = -1;
    const factors = getFlatFoodFactors(transforms);
    const weaponPrefix = first[weaponIndex] ?? 0;
    const attackPrefix = first[attackIndex] ?? 0;
    const detPrefix = detIndex === undefined ? 0 : first[detIndex] ?? 0;
    const tenPrefix = tenIndex === undefined ? 0 : first[tenIndex] ?? 0;
    const crtPrefix = crtIndex === undefined ? 0 : first[crtIndex] ?? 0;
    const dhtPrefix = dhtIndex === undefined ? 0 : first[dhtIndex] ?? 0;
    const speedPrefix = first[speedIndex] ?? 0;
    const weaponValues = suffixColumns[weaponIndex]!;
    const attackValues = suffixColumns[attackIndex]!;
    const detValues = detIndex === undefined ? undefined : suffixColumns[detIndex]!;
    const tenValues = tenIndex === undefined ? undefined : suffixColumns[tenIndex]!;
    const crtValues = crtIndex === undefined ? undefined : suffixColumns[crtIndex]!;
    const dhtValues = dhtIndex === undefined ? undefined : suffixColumns[dhtIndex]!;
    const speedValues = suffixColumns[speedIndex]!;
    // All suffix columns are built from the same state list, but keep the
    // shortest-column semantics for custom evaluators without allocating a
    // temporary array on every block scan.
    let end = endStateIndex;
    for (const column of suffixColumns) {
      if (column.length < end) end = column.length;
    }
    const weaponAttackFactors = factors.weaponAttack;
    const attackWidth = maxContributions[attackIndex]! + 1;
    const pairPrefix = weaponPrefix * attackWidth + attackPrefix;
    const detFactors = factors.det;
    const tenFactors = factors.ten;
    const crtFactors = factors.crt;
    const dhtFactors = factors.dht;
    if (
      useDps &&
      detFactors !== undefined &&
      tenFactors === undefined &&
      crtFactors !== undefined &&
      dhtFactors !== undefined &&
      detValues !== undefined &&
      crtValues !== undefined &&
      dhtValues !== undefined
    ) {
      const speedFactors = factors.speed;
      for (let index = startStateIndex; index < end; index++) {
        const weaponValue = weaponPrefix + weaponValues[index]!;
        const attackValue = attackPrefix + attackValues[index]!;
        const candidateDamage = weaponAttackFactors[
          suffixPairIndexes === undefined
            ? weaponValue * attackWidth + attackValue
            : pairPrefix + suffixPairIndexes[index]!
        ]! *
          detFactors[detPrefix + detValues[index]!]! *
          trait *
          crtFactors[crtPrefix + crtValues[index]!]! *
          dhtFactors[dhtPrefix + dhtValues[index]!]!;
        const gcdValue = speedFactors[speedPrefix + speedValues[index]!]!;
        const candidate = gcdValue > 0 && Number.isFinite(gcdValue)
          ? candidateDamage / gcdValue
          : Number.NEGATIVE_INFINITY;
        if (candidate > damage) {
          damage = candidate;
          stateIndex = index;
        }
      }
      return { damage, stateIndex };
    }
    // RDM's no-GCD objective is the hottest production path.  All of its
    // multiplicative factors are present except TEN, so keep that shape out
    // of the generic optional-factor loop below.  The two inner variants also
    // avoid checking the optional pair-index table for every suffix state.
    if (
      !useDps &&
      detFactors !== undefined &&
      tenFactors === undefined &&
      crtFactors !== undefined &&
      dhtFactors !== undefined &&
      detValues !== undefined &&
      crtValues !== undefined &&
      dhtValues !== undefined
    ) {
      if (suffixPairIndexes !== undefined) {
        for (let index = startStateIndex; index < end; index++) {
          const candidate = weaponAttackFactors[
            pairPrefix + suffixPairIndexes[index]!
          ]! *
            detFactors[detPrefix + detValues[index]!]! *
            trait *
            crtFactors[crtPrefix + crtValues[index]!]! *
            dhtFactors[dhtPrefix + dhtValues[index]!]!;
          if (candidate > damage) {
            damage = candidate;
            stateIndex = index;
          }
        }
      } else {
        for (let index = startStateIndex; index < end; index++) {
          const weaponValue = weaponPrefix + weaponValues[index]!;
          const attackValue = attackPrefix + attackValues[index]!;
          const candidate = weaponAttackFactors[
            weaponValue * attackWidth + attackValue
          ]! *
            detFactors[detPrefix + detValues[index]!]! *
            trait *
            crtFactors[crtPrefix + crtValues[index]!]! *
            dhtFactors[dhtPrefix + dhtValues[index]!]!;
          if (candidate > damage) {
            damage = candidate;
            stateIndex = index;
          }
        }
      }
      return { damage, stateIndex };
    }
    const speedFactors = factors.speed;
    for (let index = startStateIndex; index < end; index++) {
      const weaponValue = weaponPrefix + weaponValues[index]!;
      const attackValue = attackPrefix + attackValues[index]!;
      const candidateDamage = weaponAttackFactors[
        suffixPairIndexes === undefined
          ? weaponValue * attackWidth + attackValue
          : pairPrefix + suffixPairIndexes[index]!
      ]! *
        (detFactors === undefined || detValues === undefined
          ? 1
          : detFactors[detPrefix + detValues[index]!]!) *
        (tenFactors === undefined || tenValues === undefined
          ? 1
          : tenFactors[tenPrefix + tenValues[index]!]!) *
        trait *
        (crtFactors === undefined || crtValues === undefined
          ? 1
          : crtFactors[crtPrefix + crtValues[index]!]!) *
        (dhtFactors === undefined || dhtValues === undefined
          ? 1
          : dhtFactors[dhtPrefix + dhtValues[index]!]!);
      let candidate = candidateDamage;
      if (useDps) {
        const gcdValue = speedFactors[speedPrefix + speedValues[index]!]!;
        candidate = gcdValue > 0 && Number.isFinite(gcdValue)
          ? candidateDamage / gcdValue
          : Number.NEGATIVE_INFINITY;
      }
      if (candidate > damage) {
        damage = candidate;
        stateIndex = index;
      }
    }
    return { damage, stateIndex };
  };
  evaluate.maxCombinedDamageFlat = (
    first,
    suffix,
    suffixAttributeCount,
    transforms,
    startStateIndex,
    endStateIndex,
    suffixPairIndexes,
  ) =>
    maxFlatScore(
      first,
      suffix,
      suffixAttributeCount,
      transforms,
      false,
      startStateIndex,
      endStateIndex,
      suffixPairIndexes,
    );
  evaluate.maxCombinedDamageFlatColumns = (
    first,
    suffixColumns,
    transforms,
    startStateIndex,
    endStateIndex,
    suffixPairIndexes,
  ) =>
    maxFlatScoreColumns(
      first,
      suffixColumns,
      transforms,
      false,
      startStateIndex,
      endStateIndex,
      suffixPairIndexes,
    );
  evaluate.maxCombinedDpsFlat = (
    first,
    suffix,
    suffixAttributeCount,
    transforms,
    startStateIndex,
    endStateIndex,
    suffixPairIndexes,
  ) =>
    maxFlatScore(
      first,
      suffix,
      suffixAttributeCount,
      transforms,
      true,
      startStateIndex,
      endStateIndex,
      suffixPairIndexes,
    );
  evaluate.maxCombinedDpsFlatColumns = (
    first,
    suffixColumns,
    transforms,
    startStateIndex,
    endStateIndex,
    suffixPairIndexes,
  ) =>
    maxFlatScoreColumns(
      first,
      suffixColumns,
      transforms,
      true,
      startStateIndex,
      endStateIndex,
      suffixPairIndexes,
    );
  const maxFlatScoreBatch = (
    first: readonly number[],
    suffix: ArrayLike<number>,
    suffixAttributeCount: number,
    transformSets: readonly (readonly { attribute: number; maxValue: number; rate: number }[])[],
    useDps: boolean,
    startStateIndex = 0,
    endStateIndex = Number.POSITIVE_INFINITY,
    suffixPairIndexes?: ArrayLike<number>,
  ): readonly { damage: number; stateIndex: number }[] => {
    const results = transformSets.map(() => ({
      damage: Number.NEGATIVE_INFINITY,
      stateIndex: -1,
    }));
    const factors = transformSets.map((transforms) =>
      getFlatFoodFactors(transforms),
    );
    const weaponPrefix = first[weaponIndex] ?? 0;
    const attackPrefix = first[attackIndex] ?? 0;
    const detPrefix = detIndex === undefined ? 0 : first[detIndex] ?? 0;
    const tenPrefix = tenIndex === undefined ? 0 : first[tenIndex] ?? 0;
    const crtPrefix = crtIndex === undefined ? 0 : first[crtIndex] ?? 0;
    const dhtPrefix = dhtIndex === undefined ? 0 : first[dhtIndex] ?? 0;
    const speedPrefix = first[speedIndex] ?? 0;
    const attackWidth = maxContributions[attackIndex]! + 1;
    const pairPrefix = weaponPrefix * attackWidth + attackPrefix;
    for (
      let index = startStateIndex,
        offset = startStateIndex * suffixAttributeCount;
      index < endStateIndex && offset + suffixAttributeCount <= suffix.length;
      index++, offset += suffixAttributeCount
    ) {
      const weaponValue = weaponPrefix + suffix[offset + weaponIndex]!;
      const attackValue = attackPrefix + suffix[offset + attackIndex]!;
      const detValue = detIndex === undefined
        ? 0
        : detPrefix + suffix[offset + detIndex]!;
      const tenValue = tenIndex === undefined
        ? 0
        : tenPrefix + suffix[offset + tenIndex]!;
      const crtValue = crtIndex === undefined
        ? 0
        : crtPrefix + suffix[offset + crtIndex]!;
      const dhtValue = dhtIndex === undefined
        ? 0
        : dhtPrefix + suffix[offset + dhtIndex]!;
      const speedValue = speedPrefix + suffix[offset + speedIndex]!;
      for (let foodIndex = 0; foodIndex < results.length; foodIndex++) {
        const foodFactors = factors[foodIndex]!;
        const candidateDamage = foodFactors.weaponAttack[
          suffixPairIndexes === undefined
            ? weaponValue * attackWidth + attackValue
            : pairPrefix + suffixPairIndexes[index]!
        ]! *
          (foodFactors.det === undefined ? 1 : foodFactors.det[detValue]!) *
          (foodFactors.ten === undefined ? 1 : foodFactors.ten[tenValue]!) *
          trait *
          (foodFactors.crt === undefined ? 1 : foodFactors.crt[crtValue]!) *
          (foodFactors.dht === undefined ? 1 : foodFactors.dht[dhtValue]!);
        let candidate = candidateDamage;
        if (useDps) {
          const gcdValue = foodFactors.speed[speedValue]!;
          candidate = gcdValue > 0 && Number.isFinite(gcdValue)
            ? candidateDamage / gcdValue
            : Number.NEGATIVE_INFINITY;
        }
        if (candidate > results[foodIndex]!.damage) {
          results[foodIndex]!.damage = candidate;
          results[foodIndex]!.stateIndex = index;
        }
      }
    }
    return results;
  };
  evaluate.maxCombinedDamageFlatBatch = (
    first,
    suffix,
    suffixAttributeCount,
    transforms,
    startStateIndex,
    endStateIndex,
    suffixPairIndexes,
  ) =>
    maxFlatScoreBatch(
      first,
      suffix,
      suffixAttributeCount,
      transforms,
      false,
      startStateIndex,
      endStateIndex,
      suffixPairIndexes,
    );
  evaluate.maxCombinedDpsFlatBatch = (
    first,
    suffix,
    suffixAttributeCount,
    transforms,
    startStateIndex,
    endStateIndex,
    suffixPairIndexes,
  ) =>
    maxFlatScoreBatch(
      first,
      suffix,
      suffixAttributeCount,
      transforms,
      true,
      startStateIndex,
      endStateIndex,
      suffixPairIndexes,
    );

  type LogConcaveSegment = {
    start: number;
    end: number;
    slope: number;
    intercept: number;
  };
  type LogConcaveUpper = {
    segments: LogConcaveSegment[];
    valueAt: (value: number) => number;
    slopeAt: (value: number) => number;
    segmentAt: (value: number) => number;
    valueTable: Float64Array;
    slopeTable: Float64Array;
  };
  const buildLogConcaveUpper = (values: Float64Array): LogConcaveUpper => {
    const points: { x: number; y: number }[] = [];
    for (let value = 0; value < values.length; value++) {
      const point = { x: value, y: Math.log(values[value]!) };
      while (points.length >= 2) {
        const previous = points[points.length - 2]!;
        const last = points[points.length - 1]!;
        const previousSlope =
          (last.y - previous.y) / (last.x - previous.x);
        const nextSlope = (point.y - last.y) / (point.x - last.x);
        if (previousSlope + 1e-15 >= nextSlope) break;
        points.pop();
      }
      points.push(point);
    }
    const segments: LogConcaveSegment[] = [];
    for (let index = 0; index + 1 < points.length; index++) {
      const first = points[index]!;
      const second = points[index + 1]!;
      const slope = (second.y - first.y) / (second.x - first.x);
      segments.push({
        start: first.x,
        end: second.x,
        slope,
        intercept: first.y - slope * first.x,
      });
    }
    if (segments.length === 0) {
      segments.push({
        start: 0,
        end: 1,
        slope: 0,
        intercept: Math.log(values[0]!),
      });
    }
    const segmentIndexes = new Int32Array(values.length);
    let segmentIndex = 0;
    for (let value = 0; value < values.length; value++) {
      while (
        segmentIndex + 1 < segments.length &&
        segments[segmentIndex + 1]!.start <= value
      ) {
        segmentIndex++;
      }
      segmentIndexes[value] = segmentIndex;
    }
    const segmentAt = (value: number): number => {
      const index = Math.min(
        segmentIndexes.length - 1,
        Math.max(0, Math.trunc(value)),
      );
      return segmentIndexes[index]!;
    };
    const valueTable = new Float64Array(values.length);
    const slopeTable = new Float64Array(values.length);
    for (let value = 0; value < values.length; value++) {
      const segment = segments[segmentIndexes[value]!]!;
      valueTable[value] = segment.intercept + segment.slope * value;
      slopeTable[value] = segment.slope;
    }
    const valueAt = (value: number): number => {
      const clamped = Math.min(
        values.length - 1,
        Math.max(0, value),
      );
      const index = Math.trunc(clamped);
      return valueTable[index]! + slopeTable[index]! * (clamped - index);
    };
    const slopeAt = (value: number): number =>
      slopeTable[Math.min(
        values.length - 1,
        Math.max(0, Math.trunc(value)),
      )]!;
    return {
      segments,
      valueAt,
      slopeAt,
      segmentAt,
      valueTable,
      slopeTable,
    };
  };

  const weaponValues = new Float64Array(maxContributions[weaponIndex]! + 1);
  for (let value = 0; value < weaponValues.length; value++) {
    weaponValues[value] = weaponAddition + value;
  }
  const envelopes: (LogConcaveUpper | undefined)[] = new Array(
    maxContributions.length,
  );
  envelopes[weaponIndex] = buildLogConcaveUpper(weaponValues);
  envelopes[attackIndex] = buildLogConcaveUpper(mainDamage);
  if (detIndex !== undefined && detDamage !== undefined) {
    envelopes[detIndex] = buildLogConcaveUpper(detDamage);
  }
  if (tenIndex !== undefined && tenDamage !== undefined) {
    envelopes[tenIndex] = buildLogConcaveUpper(tenDamage);
  }
  if (crtIndex !== undefined && crtFactor !== undefined) {
    envelopes[crtIndex] = buildLogConcaveUpper(crtFactor);
  }
  if (dhtIndex !== undefined && dhtFactor !== undefined) {
    envelopes[dhtIndex] = buildLogConcaveUpper(dhtFactor);
  }

  let cachedTransforms:
    | readonly { attribute: number; maxValue: number; rate: number }[]
    | undefined;
  const cachedMultipliers = new Array<number>(maxContributions.length).fill(1);
  const getFoodMultipliers = (
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  ): number[] => {
    if (transforms === cachedTransforms) return cachedMultipliers;
    cachedTransforms = transforms;
    cachedMultipliers.fill(1);
    for (const transform of transforms) {
      cachedMultipliers[transform.attribute] *= 1 + Math.max(0, transform.rate);
    }
    return cachedMultipliers;
  };
  const upperMinimumVector = new Array<number>(maxContributions.length).fill(0);
  const upperSlotCapacities = new Array<number>(maxContributions.length).fill(0);
  // Each attribute contributes at most two pieces to the concave resource
  // allocation below.  Keeping these as parallel arrays avoids allocating
  // objects in the upper-bound hot path.
  const upperPieceCapacities = new Array<number>(maxContributions.length * 2).fill(0);
  const upperPieceSlopes = new Array<number>(maxContributions.length * 2).fill(0);
  const upperAllocationOrder: number[] = [];

  const upperBoundScore = (
    first: readonly number[],
    second: readonly number[],
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    secondMinimum: readonly number[],
    secondAttributeSumMaximum: number,
    slotBounds: readonly {
      minimum: readonly number[];
      maximum: readonly number[];
      attributeSumMaximum: number;
    }[] | undefined,
    useDps: boolean,
  ): number => {
    const multipliers = getFoodMultipliers(transforms);
    const minimumVector = upperMinimumVector;
    minimumVector.fill(0);
    let budget = 0;
    let minimumSum = 0;
    const slotCapacities = upperSlotCapacities;
    slotCapacities.fill(0);
    for (let index = 0; index < maxContributions.length; index++) {
      minimumVector[index] = secondMinimum[index] ?? 0;
      minimumSum += minimumVector[index]!;
    }
    if (slotBounds !== undefined && slotBounds.length > 0) {
      for (const bound of slotBounds) {
        let boundMinimumSum = 0;
        for (let index = 0; index < maxContributions.length; index++) {
          const minimum = bound.minimum[index] ?? 0;
          boundMinimumSum += minimum;
        }
        const slotBudget = Math.max(0, bound.attributeSumMaximum - boundMinimumSum);
        budget += slotBudget;
        for (let index = 0; index < maxContributions.length; index++) {
          slotCapacities[index] += Math.min(
            Math.max(0, (bound.maximum[index] ?? 0) - (bound.minimum[index] ?? 0)),
            slotBudget,
          );
        }
      }
    } else {
      for (let index = 0; index < maxContributions.length; index++) {
        slotCapacities[index] = Math.max(
          0,
          (second[index] ?? 0) - minimumVector[index]!,
        );
      }
      budget = Math.max(0, secondAttributeSumMaximum - minimumSum);
    }
    // The aggregate lower vector above is the safe baseline.  Slot minima
    // are only used to cap how much of the shared budget each attribute can
    // receive; adding their sums to the baseline would make the bound looser.
    budget = Math.min(budget, Math.max(0, secondAttributeSumMaximum - minimumSum));
    let logUpper = Math.log(0.01 * trait);
    const allocationOrder = upperAllocationOrder;
    allocationOrder.length = 0;
    let pieceCount = 0;

    for (let index = 0; index < maxContributions.length; index++) {
      const envelope = envelopes[index];
      const prefix = first[index] ?? 0;
      const minimum = minimumVector[index]!;
      const multiplier = multipliers[index]!;
      const maximumFinal = maxContributions[index]!;
      const baseline = Math.min(
        maximumFinal,
        (prefix + minimum) * multiplier,
      );
      const remainingCapacity = Math.max(
        0,
        Math.min(
          slotCapacities[index]!,
          (maximumFinal - baseline) / multiplier,
        ),
      );
      if (envelope !== undefined) {
        const end = Math.min(
          maximumFinal,
          baseline + remainingCapacity * multiplier,
        );
        const startValue = envelope.valueAt(baseline);
        if (!(remainingCapacity > 0) || !(end > baseline)) {
          logUpper += startValue;
          continue;
        }

        // For a concave log-factor, the minimum of the tangents at the
        // interval endpoints is still an upper bound, but is much tighter
        // than extending only the tangent at the baseline.  The minimum is
        // piecewise linear with at most one slope change.
        const startSlope = envelope.slopeAt(baseline);
        const endValue = envelope.valueAt(end);
        const endSlope = envelope.slopeAt(end);
        const endTangentAtStart = endValue + endSlope * (baseline - end);
        const slopeDifference = startSlope - endSlope;
        let baseUpper = startValue;
        let firstEnd = end;
        let firstSlope = startSlope;
        let secondSlope = 0;
        if (slopeDifference > 1e-15) {
          const intersection =
            (endValue - startValue + startSlope * baseline - endSlope * end) /
            slopeDifference;
          if (intersection > baseline && intersection < end) {
            firstEnd = intersection;
            secondSlope = endSlope;
          } else if (intersection <= baseline) {
            baseUpper = Math.max(startValue, endTangentAtStart);
            firstEnd = baseline;
            firstSlope = endSlope;
            secondSlope = endSlope;
          }
        } else if (endTangentAtStart < startValue) {
          // Rounding can make the two tangent slopes equal while their
          // intercepts differ by a few ulps.  Keep the tangent that starts
          // above the envelope.
          baseUpper = endTangentAtStart;
          firstSlope = endSlope;
        }
        logUpper += baseUpper;
        const firstCapacity = Math.max(
          0,
          (firstEnd - baseline) / multiplier,
        );
        if (firstCapacity > 0 && firstSlope > 0) {
          upperPieceCapacities[pieceCount] = firstCapacity;
          upperPieceSlopes[pieceCount] = firstSlope * multiplier;
          allocationOrder.push(pieceCount++);
        }
        const secondCapacity = Math.max(
          0,
          (end - firstEnd) / multiplier,
        );
        if (secondCapacity > 0 && secondSlope > 0) {
          upperPieceCapacities[pieceCount] = secondCapacity;
          upperPieceSlopes[pieceCount] = secondSlope * multiplier;
          allocationOrder.push(pieceCount++);
        }
      }
    }

    for (let orderIndex = 1; orderIndex < allocationOrder.length; orderIndex++) {
      const index = allocationOrder[orderIndex]!;
      const score = upperPieceSlopes[index]!;
      let insertAt = orderIndex;
      while (insertAt > 0) {
        const previousIndex = allocationOrder[insertAt - 1]!;
        const previousScore = upperPieceSlopes[previousIndex]!;
        if (previousScore >= score) break;
        allocationOrder[insertAt] = previousIndex;
        insertAt--;
      }
      allocationOrder[insertAt] = index;
    }
    for (const index of allocationOrder) {
      const amount = Math.min(budget, upperPieceCapacities[index]!);
      if (!(amount > 0)) continue;
      logUpper += upperPieceSlopes[index]! * amount;
      budget -= amount;
      if (budget <= 0) break;
    }

    const speedMinimum = statIndexes.get(speedStat);
    if (useDps && speedMinimum !== undefined) {
      const speedIndexValue = speedMinimum;
      let speedGear = first[speedIndexValue] ?? 0;
      speedGear += second[speedIndexValue] ?? 0;
      let speedFinal = speedGear;
      for (const transform of transforms) {
        if (transform.attribute !== speedIndexValue) continue;
        speedFinal += Math.min(
          transform.maxValue,
          speedGear * Math.max(0, transform.rate),
        );
      }
      const speedTable = gcd;
      const speed = Math.min(
        speedTable.length - 1,
        Math.max(0, Math.ceil(speedFinal)),
      );
      const gcdLower = speedTable[speed]!;
      if (!(gcdLower > 0) || !Number.isFinite(gcdLower)) {
        return Number.NEGATIVE_INFINITY;
      }
      return Math.exp(logUpper + 1e-12) / gcdLower;
    }
    // The tangent/intersection arithmetic is deliberately conservative.  A
    // tiny log-space cushion protects the upper-bound contract from a final
    // floating-point ulp at a tangent intersection.
    return Math.exp(logUpper + 1e-12);
  };

  evaluate.combinedDamageUpperBound = (
    first,
    second,
    transforms,
    secondMinimum,
    secondAttributeSumMaximum,
    slotBounds,
  ) =>
    upperBoundScore(
      first,
      second,
      transforms,
      secondMinimum,
      secondAttributeSumMaximum,
      slotBounds,
      false,
    );
  evaluate.combinedDpsUpperBound = (
    first,
    second,
    transforms,
    secondMinimum,
    secondAttributeSumMaximum,
    slotBounds,
  ) =>
    upperBoundScore(
      first,
      second,
      transforms,
      secondMinimum,
      secondAttributeSumMaximum,
      slotBounds,
      true,
    );
  return evaluate;
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
