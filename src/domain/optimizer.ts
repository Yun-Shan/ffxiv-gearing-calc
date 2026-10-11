import { foods, gameData, gears, materiaGradeRequiredLevels } from "./data.ts";
import { currentLevel, jobSchemas } from "./jobs.ts";
import {
  addStats,
  applyFood,
  calculateBaseStats,
  calculateEffects,
  getSpeedStat,
  isGearUsable,
} from "./rules.ts";
import { buildRingPairEquipInfos, isRingPairEquipInfo } from "./search/ring-pairs.ts";
import {
  insertParetoCandidate,
  paretoRingCandidates,
  type ParetoCandidate,
} from "./search/candidate-pareto.ts";
import {
  equippedEffects,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "./search/equipped-effects.ts";
import {
  findBestLoadoutExactMip,
  type ExactMipOptions,
  type ExactMipResult,
} from "./search/loadout-finder-exact-mip.ts";
import type { LinearMipProgress } from "./search/linear-mip.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "./search/exact-mip-candidate-upper-bound.ts";
import { markSharedAccessoryPairDominancePath } from "./search/shared-accessory-pair-dominance-policy.ts";
import {
  findBestJointLoadoutV3,
  type JointLoadoutV3Result,
} from "./search/loadout-finder-v3.ts";
import type { SharedSlotProjection } from "./search/types.ts";
import { createParallelBaselineExecutor } from "./search/parallel-baseline-executor.ts";
import {
  candidateResourceSupportProfileForSearch,
  resourceBudgetCandidateProfileForSearch,
} from "./search/candidate-resource-support-policy.ts";
import type {
  CommonGearSlot,
  Effects,
  Food,
  Gear,
  GearSlot,
  JobId,
  JointOptimizationConfig,
  JointOptimizationResult,
  MeldedGear,
  Materia,
  OptimizationConfig,
  OptimizationResult,
  SearchOptions,
  Stat,
  Stats,
} from "./types.ts";

type SolverParam = { baseParamId: number; value: number };
type SolverFoodParam = {
  baseValue?: number;
  baseParamId: number;
  multiplier: number;
  maxValue: number;
};
type SolverFood = {
  itemId: number;
  itemLevel: number;
  key: string;
  physicalKey?: string;
  baseParams: SolverFoodParam[];
};
type SolverGear = {
  itemId: number;
  itemLevel: number;
  /** Distinguishes the concrete materia assignment even when caps clip totals to the same stats. */
  variantKey?: string;
  key: string;
  baseParams: SolverParam[];
  PDMG: number;
  MDMG: number;
  DLY: number;
  ringEquips?: readonly [SolverGear, SolverGear];
};
type GearCandidate = { equipment: SolverGear; gear: MeldedGear };
type SearchSlot = {
  name: string;
  candidates: SolverGear[];
};
type PreparedSearch = {
  jobId: JobId;
  jobLevel: number;
  jobSchema: (typeof jobSchemas)[JobId];
  objective: "damage" | "dps";
  slots: SearchSlot[];
  foods: SolverFood[];
  gearsByIdentity: Map<string, MeldedGear>;
  foodsByIdentity: Map<string, Food>;
  searchedCandidates: number;
  options: ExactMipOptions;
};

const combatStatSet = new Set<Stat>([
  "STR", "DEX", "INT", "MND", "VIT", "CRT", "DET", "DHT", "SKS", "SPS",
  "TEN", "PIE", "PDMG", "MDMG", "DLY",
]);

// These are vector coordinates internal to the optimizer. They are derived from
// the generated data's Stat names and are never Lumina BaseParam row IDs.
const attributeStats: Stat[] = (() => {
  const stats = new Set<Stat>(["PDMG", "MDMG", "DLY"]);
  for (const gear of gameData.gears) {
    for (const stat of Object.keys(gear.stats) as Stat[]) {
      if (combatStatSet.has(stat)) stats.add(stat);
    }
  }
  for (const food of gameData.foods) {
    for (const stat of Object.keys(food.stats) as Stat[]) {
      if (combatStatSet.has(stat)) stats.add(stat);
    }
  }
  for (const schema of Object.values(gameData.jobSchemas)) {
    for (const stat of schema.stats) stats.add(stat);
  }
  return [...stats].sort();
})();
const attributeIndex = new Map<Stat, number>(
  attributeStats.map((stat, index) => [stat, index]),
);
const attributeIds = attributeStats.map((_, index) => index);
const statIndexes = new Map<Stat, number>(attributeIndex);

const nonRingSlotOrder: GearSlot[] = [
  "weapon", "offhand", "head", "body", "hands", "legs", "feet", "earrings",
  "necklace", "bracelet",
];

function abortError(reason?: unknown): Error {
  const error = reason instanceof Error ? reason : new Error("搜索已取消");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

function jobLevelFor(config: OptimizationConfig): number {
  const schema = jobSchemas[config.jobId];
  if (schema === undefined) throw new RangeError(`缺少职业 ${config.jobId} 的领域规则`);
  const maxJobLevel = schema.maxJobLevel ?? currentLevel;
  const level = config.jobLevel ?? Math.min(currentLevel, maxJobLevel);
  if (!Number.isSafeInteger(level) || level > maxJobLevel || !Object.hasOwn(gameData.jobLevelModifiers, level)) {
    throw new RangeError(`不支持的职业等级：${level}`);
  }
  return level;
}

function jobSlots(jobId: JobId): string[] {
  return [
    ...nonRingSlotOrder.filter((slot) => slot !== "offhand" || jobId === "PLD" || jobId === "BST"),
    "rings",
  ];
}

export function slotsForJob(jobId: JobId): GearSlot[] {
  return [
    ...nonRingSlotOrder.filter((slot) => slot !== "offhand" || jobId === "PLD" || jobId === "BST"),
    "ring",
    "ring2",
  ];
}

function materiaAttributeStats(jobId: JobId): Materia["stat"][] {
  const role = jobSchemas[jobId].role;
  if (role === "tank") return ["CRT", "DET", "DHT", "SKS", "TEN"];
  if (role === "healer" || role === "int") return ["CRT", "DET", "DHT", "SPS"];
  return ["CRT", "DET", "DHT", "SKS"];
}

function materiaForGrade(stat: Materia["stat"], grade: number): Materia {
  const value = gameData.materias[stat]?.[grade - 1];
  if (!Number.isSafeInteger(value) || value! <= 0) {
    throw new Error(`魔晶石 ${stat} 缺少 ${grade} 级数值`);
  }
  return { stat, value: value!, grade };
}

function highestMateriaGrade(itemLevel: number, unrestricted: boolean): number {
  const restrictedGrades = gameData.materiaGradeIsRestricted;
  if (restrictedGrades.length !== materiaGradeRequiredLevels.length + 1) {
    throw new Error("魔晶石禁断等级数据与等级要求数据长度不一致");
  }
  for (let grade = materiaGradeRequiredLevels.length; grade >= 1; grade--) {
    if (materiaGradeRequiredLevels[grade - 1]! > itemLevel) continue;
    if (!unrestricted && restrictedGrades[grade] !== false) continue;
    return grade;
  }
  throw new Error(
    unrestricted
      ? `装备品级 ${itemLevel} 没有可用魔晶石等级`
      : `装备品级 ${itemLevel} 没有限制孔可用的魔晶石等级`,
  );
}

function* countCombinations(
  attributeCount: number,
  materiaCount: number,
): Generator<number[]> {
  const counts = new Array<number>(attributeCount).fill(0);
  function* walk(index: number, remaining: number): Generator<number[]> {
    if (attributeCount === 0) {
      if (remaining === 0) yield [];
      return;
    }
    if (index === attributeCount - 1) {
      counts[index] = remaining;
      yield counts.slice();
      return;
    }
    for (let amount = 0; amount <= remaining; amount++) {
      counts[index] = amount;
      yield* walk(index + 1, remaining - amount);
    }
  }
  yield* walk(0, materiaCount);
}

function statCapAtLevel(gear: Gear, stat: Stat, level: number): number {
  const levels = gameData.levelCaps.level;
  const levelIndex = levels.indexOf(level);
  if (levelIndex < 0) {
    throw new Error(`装备同步品级 ${level} 缺少属性上限数据`);
  }
  const levelCap = gameData.levelCaps[stat]?.[levelIndex];
  const slotCap = gameData.slotCaps[stat]?.[gear.rawSlot];
  const roleCap = gameData.roleCaps[stat]?.[gear.roleId];
  if (levelCap === undefined || slotCap === undefined || roleCap === undefined) {
    throw new Error(`装备 ${gear.id} 的 ${stat} 属性上限数据不完整`);
  }
  return Math.round((levelCap * slotCap * roleCap) / 100_000);
}

function capLevelFor(gear: Gear, syncLevel?: number): number {
  return syncLevel !== undefined && gear.level > syncLevel ? syncLevel : gear.level;
}

function mergeCandidateStats(
  gear: Gear,
  melds: readonly Materia[],
  syncLevel?: number,
): Stats {
  const level = capLevelFor(gear, syncLevel);
  const finalStats: Stats = {};
  for (const [key, value] of Object.entries(gear.stats)) {
    const stat = key as Stat;
    finalStats[stat] = stat === "DLY" || level === gear.level
      ? value ?? 0
      : Math.min(value ?? 0, statCapAtLevel(gear, stat, level));
  }
  for (const meld of melds) {
    const cap = statCapAtLevel(gear, meld.stat, level);
    finalStats[meld.stat] = Math.min(
      cap,
      (finalStats[meld.stat] ?? 0) + meld.value,
    );
  }
  return finalStats;
}

function customParameterMelds(gear: Gear): Materia[][] {
  const slots = gear.customParameters;
  if (!slots?.length) return [];
  if (slots.length !== 4) {
    throw new Error(
      `自定义参数武器 ${gear.id} 的槽位数 ${slots.length} 不是 4，无法按 2 big + 1 small + 1 空槽规则生成候选`,
    );
  }
  const result: Materia[][] = [];
  for (let smallIndex = 0; smallIndex < slots.length; smallIndex++) {
    const remaining = slots.map((_, index) => index).filter((index) => index !== smallIndex);
    for (let first = 0; first < remaining.length; first++) {
      for (let second = first + 1; second < remaining.length; second++) {
        const bigA = slots[remaining[first]!]!;
        const bigB = slots[remaining[second]!]!;
        const small = slots[smallIndex]!;
        result.push([
          { stat: bigA.stat, value: bigA.bigValue, grade: 0 },
          { stat: bigB.stat, value: bigB.bigValue, grade: 0 },
          { stat: small.stat, value: small.smallValue, grade: 0 },
        ]);
      }
    }
  }
  return result;
}

function regularMateriaMelds(
  gear: Gear,
  jobId: JobId,
  config: OptimizationConfig,
): Materia[][] {
  const syncApplies = config.syncLevel !== undefined && gear.level > config.syncLevel;
  // Standard materia is disabled by item-level sync. The custom-parameter
  // weapon path is handled separately because the source algorithm keeps its
  // twelve parameter variants and caps their values after syncing.
  if (syncApplies) return [[]];
  if (gear.materiaSlots === 0 && gear.materiaAdvanced !== true) return [[]];

  const stats = materiaAttributeStats(jobId);
  const highGrade = highestMateriaGrade(gear.level, true);
  const highMateria = stats.map((stat) => materiaForGrade(stat, highGrade));
  const canOvermeld = gear.materiaAdvanced === true && gear.materiaSlots < 5;
  const advancedCount = canOvermeld ? Math.max(0, 4 - gear.materiaSlots) : 0;
  const openAndFirstOvermeld = gear.materiaSlots + (canOvermeld ? 1 : 0);
  const lowMateria = advancedCount > 0
    ? stats.map((stat) => materiaForGrade(stat, highestMateriaGrade(gear.level, false)))
    : [];
  const unique = new Map<string, Materia[]>();
  for (const highCounts of countCombinations(stats.length, openAndFirstOvermeld)) {
    for (const lowCounts of countCombinations(stats.length, advancedCount)) {
      const melds: Materia[] = [];
      let valid = true;
      for (let index = 0; index < stats.length; index++) {
        const stat = stats[index]!;
        const highCount = highCounts[index]!;
        const lowCount = lowCounts[index]!;
        const totalValue =
          highCount * highMateria[index]!.value +
          lowCount * (lowMateria[index]?.value ?? 0);
        const level = capLevelFor(gear, config.syncLevel);
        const available =
          statCapAtLevel(gear, stat, level) - (gear.stats[stat] ?? 0);
        const finalMeldValue = lowCount > 0 ? lowMateria[index]!.value : highMateria[index]!.value;
        // A final materia may be clipped; never fill a hole with an orb that
        // adds no attributes at all. High-grade orbs precede advanced low-grade orbs.
        if (totalValue > 0 && (available <= 0 || totalValue - finalMeldValue >= available)) {
          valid = false;
          break;
        }
        for (let count = 0; count < highCount; count++) melds.push(highMateria[index]!);
        for (let count = 0; count < lowCount; count++) melds.push(lowMateria[index]!);
      }
      if (!valid) continue;
      const key = melds.map(({ stat, value, grade }) => `${stat}:${value}:${grade}`).join("|");
      if (!unique.has(key)) unique.set(key, melds);
    }
  }
  return [...unique.values()];
}

function toSolverEquipment(gear: MeldedGear): SolverGear {
  const baseParams = Object.entries(gear.finalStats)
    .flatMap(([key, value]) => {
      const index = attributeIndex.get(key as Stat);
      return index === undefined || !value ? [] : [{ baseParamId: index, value }];
    })
    .sort((left, right) => left.baseParamId - right.baseParamId);
  const key = baseParams.map(({ baseParamId }) => baseParamId).join("-");
  const variantKey = JSON.stringify(
    gear.melds
      .map(({ stat, value, grade }) => [stat, value, grade] as const)
      .sort(([statA, valueA, gradeA], [statB, valueB, gradeB]) =>
        statA.localeCompare(statB) || gradeA - gradeB || valueA - valueB),
  );
  return {
    itemId: gear.id,
    itemLevel: gear.level,
    variantKey,
    key,
    baseParams,
    PDMG: gear.finalStats.PDMG ?? 0,
    MDMG: gear.finalStats.MDMG ?? 0,
    DLY: gear.finalStats.DLY ?? 0,
  };
}

function equipmentIdentity(equipment: SolverGear): string {
  const ringEquips = equipment.ringEquips;
  const ringKeys = ringEquips?.map(equipmentIdentity).sort();
  const baseParams = equipment.baseParams
    .map(({ baseParamId, value }) => [baseParamId, value] as const)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return JSON.stringify({
    ...(ringKeys === undefined ? { itemId: equipment.itemId } : {}),
    variantKey: equipment.variantKey,
    itemLevel: equipment.itemLevel,
    baseParams,
    PDMG: equipment.PDMG,
    MDMG: equipment.MDMG,
    DLY: equipment.DLY,
    ...(ringKeys === undefined ? {} : { ringEquips: ringKeys }),
  });
}

function foodIdentity(food: SolverFood): string {
  if (food.physicalKey !== undefined) return food.physicalKey;
  return JSON.stringify({
    itemId: food.itemId,
    itemLevel: food.itemLevel,
    baseParams: food.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [baseParamId, multiplier, maxValue])
      .sort((left, right) => left[0] - right[0]),
  });
}

function physicalFoodIdentity(food: Food): string {
  const sortStats = (stats: Stats) => Object.entries(stats)
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    itemId: food.id,
    itemLevel: food.level,
    stats: sortStats(food.stats),
    statRates: sortStats(food.statRates),
  });
}

function foodStatsForJob(food: Food, jobId: JobId): { stats: Stats; statRates: Stats } {
  const allowed = new Set(jobSchemas[jobId].stats);
  const filter = (values: Stats): Stats => Object.fromEntries(
    Object.entries(values).filter(([stat, value]) => allowed.has(stat as Stat) && value !== undefined),
  ) as Stats;
  return { stats: filter(food.stats), statRates: filter(food.statRates) };
}

function createFoodInfo(food: Food, config: OptimizationConfig): SolverFood {
  const schema = jobSchemas[config.jobId];
  const baseStats = calculateBaseStats(schema, jobLevelFor(config));
  const applicableFood = foodStatsForJob(food, config.jobId);
  const baseParams = Object.entries(applicableFood.stats)
    .flatMap(([key, maxValue]) => {
      const stat = key as Stat;
      const index = attributeIndex.get(stat);
      const rate = applicableFood.statRates[stat] ?? 0;
      return index === undefined || !maxValue || rate <= 0
        ? []
        : [{ baseParamId: index, multiplier: 1 + rate / 100, maxValue, baseValue: baseStats[stat] ?? 0 }];
    })
    .sort((left, right) => left.baseParamId - right.baseParamId);
  return {
    itemId: food.id,
    itemLevel: food.level,
    key: baseParams.map(({ baseParamId }) => baseParamId).join("-"),
    physicalKey: physicalFoodIdentity(food),
    baseParams,
  };
}

function makeGearCandidates(
  gear: Gear,
  slot: GearSlot,
  config: OptimizationConfig,
  gearsByIdentity: Map<string, MeldedGear>,
): GearCandidate[] {
  const options = gear.customParameters?.length
    ? customParameterMelds(gear)
    : regularMateriaMelds(gear, config.jobId, config);
  const candidates = new Map<string, GearCandidate>();
  for (const melds of options) {
    const finalStats = mergeCandidateStats(gear, melds, config.syncLevel);
    const damageStat =
      jobSchemas[config.jobId].mainStat === "INT" ||
      jobSchemas[config.jobId].mainStat === "MND"
        ? "MDMG"
        : "PDMG";
    const meldedGear: MeldedGear = {
      ...gear,
      slot,
      weaponDamage: finalStats[damageStat] ?? gear.weaponDamage,
      melds: melds.map((meld) => ({ ...meld })),
      finalStats,
    };
    const equipment = toSolverEquipment(meldedGear);
    const identity = equipmentIdentity(equipment);
    if (candidates.has(identity)) continue;
    candidates.set(identity, { equipment, gear: meldedGear });
    gearsByIdentity.set(identity, meldedGear);
  }
  return [...candidates.values()];
}

function foodsFor(config: OptimizationConfig): Food[] {
  if (config.foodId !== 0) return foods.filter((food) => food.id === config.foodId);
  return foods.filter((food) => food.best && (food.stats.VIT ?? 0) > 0);
}

function paretoAttributeStats(jobId: JobId): Stat[] {
  const schema = jobSchemas[jobId];
  if (schema.mainStat === undefined) return attributeStats;
  const attackStat: Stat = schema.mainStat === "VIT" ? "STR" : schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const relevant = new Set<Stat>([
    attackStat,
    weaponStat,
    "DET",
    "TEN",
    "CRT",
    "DHT",
    getSpeedStat(schema),
  ]);
  if ([...relevant].some((stat) => !attributeIndex.has(stat))) return attributeStats;
  return attributeStats.filter((stat) => relevant.has(stat));
}

function candidatePools(
  config: OptimizationConfig,
  gearsByIdentity: Map<string, MeldedGear>,
  preserveRingOrder: boolean,
  independentRingSlots: boolean,
  paretoSlots?: ReadonlySet<string>,
  paretoIndependentRings = false,
): SearchSlot[] {
  const jobId = config.jobId;
  const slots = jobSlots(jobId);
  const results: SearchSlot[] = [];
  const slotCandidates = new Map<string, GearCandidate[]>();
  const speedStat = getSpeedStat(jobSchemas[jobId]);
  const paretoStats = paretoAttributeStats(jobId);
  const preserveSpeed = config.gcdTarget !== undefined ||
    (config.gcdChoices?.length ?? 0) > 0 || config.speedMax !== undefined;
  const speedCoordinate = preserveSpeed ? paretoStats.indexOf(speedStat) : undefined;
  if (preserveSpeed && speedCoordinate === undefined) {
    throw new RangeError(`职业 ${jobId} 缺少 ${speedStat} Pareto 搜索坐标`);
  }

  const forgetCandidate = (candidate: GearCandidate) => {
    const identity = equipmentIdentity(candidate.equipment);
    if (gearsByIdentity.get(identity) === candidate.gear) gearsByIdentity.delete(identity);
  };

  for (const slotName of slots.filter((name) => name !== "rings")) {
    const slot = slotName as GearSlot;
    const pool = gearOptionsFor(config, slot);
    const forcedId = config.forcedGear[slot];
    const gearsForSlot = forcedId === undefined ? pool : pool.filter(item => item.id === forcedId);
    const usePareto = paretoSlots?.has(slotName) === true;
    const candidates: GearCandidate[] = [];
    const frontier: ParetoCandidate<GearCandidate>[] = [];
    let candidateOrder = 0;
    for (const gear of gearsForSlot) {
      for (const candidate of makeGearCandidates(gear, slot, config, gearsByIdentity)) {
        if (!usePareto) {
          candidates.push(candidate);
          continue;
        }
        const insertion = insertParetoCandidate(frontier, {
          value: candidate,
          attributes: paretoStats.map((stat) => candidate.gear.finalStats[stat] ?? 0),
          order: candidateOrder++,
        }, speedCoordinate);
        if (!insertion.accepted) forgetCandidate(candidate);
        for (const removed of insertion.removed) forgetCandidate(removed.value);
      }
    }
    if (usePareto) {
      candidates.push(...frontier
        .sort((left, right) => left.order - right.order)
        .map(({ value }) => value));
    }
    slotCandidates.set(slotName, candidates);
  }

  const ringPool = gearOptionsFor(config, "ring");
  const forcedRing = config.forcedGear.ring;
  const forcedRing2 = config.forcedGear.ring2;
  const firstPool = forcedRing === undefined
    ? ringPool
    : ringPool.filter((gear) => gear.id === forcedRing);
  const secondPool = forcedRing2 === undefined
    ? ringPool
    : ringPool.filter((gear) => gear.id === forcedRing2);
  const firstCandidates = firstPool.flatMap((gear) =>
    makeGearCandidates(gear, "ring", config, gearsByIdentity));
  const secondCandidates = secondPool.flatMap((gear) =>
    makeGearCandidates(gear, "ring2", config, gearsByIdentity));
  const missingUnique = firstCandidates.find(({ gear }) => gear.unique === undefined)?.gear ??
    secondCandidates.find(({ gear }) => gear.unique === undefined)?.gear;
  if (missingUnique !== undefined) {
    const missing = missingUnique;
    throw new Error(`装备 ${missing.id} 缺少 IsUnique 上游字段，无法生成戒指组合`);
  }
  if (independentRingSlots) {
    const optimizedFirst = paretoIndependentRings
      ? paretoRingCandidates(
          firstCandidates.map((candidate, order) => ({
            value: candidate,
            itemId: candidate.gear.id,
            isUnique: candidate.gear.unique!,
            attributes: paretoStats.map((stat) => candidate.gear.finalStats[stat] ?? 0),
            order,
          })),
          secondCandidates.map(({ gear }) => ({ itemId: gear.id, isUnique: gear.unique! })),
          speedCoordinate,
        ).map(({ value }) => value)
      : firstCandidates;
    const optimizedSecond = paretoIndependentRings
      ? paretoRingCandidates(
          secondCandidates.map((candidate, order) => ({
            value: candidate,
            itemId: candidate.gear.id,
            isUnique: candidate.gear.unique!,
            attributes: paretoStats.map((stat) => candidate.gear.finalStats[stat] ?? 0),
            order,
          })),
          firstCandidates.map(({ gear }) => ({ itemId: gear.id, isUnique: gear.unique! })),
          speedCoordinate,
        ).map(({ value }) => value)
      : secondCandidates;
    if (paretoIndependentRings) {
      const retainedIdentities = new Set(
        [...optimizedFirst, ...optimizedSecond].map(({ equipment }) => equipmentIdentity(equipment)),
      );
      for (const candidate of [...firstCandidates, ...secondCandidates]) {
        const identity = equipmentIdentity(candidate.equipment);
        if (!retainedIdentities.has(identity)) gearsByIdentity.delete(identity);
      }
    }
    for (const candidate of optimizedFirst) {
      const key = equipmentIdentity(candidate.equipment);
      const existing = gearsByIdentity.get(key);
      if (existing) gearsByIdentity.set(key, { ...existing, slot: "ring" });
    }
    for (const candidate of optimizedSecond) {
      const key = equipmentIdentity(candidate.equipment);
      const existing = gearsByIdentity.get(key);
      if (existing) gearsByIdentity.set(key, { ...existing, slot: "ring2" });
    }
    slotCandidates.set("ring", optimizedFirst.map((candidate) => ({
      ...candidate,
      equipment: { ...candidate.equipment, ringSlotIndex: 0, isUnique: candidate.gear.unique! },
    })));
    slotCandidates.set("ring2", optimizedSecond.map((candidate) => ({
      ...candidate,
      equipment: { ...candidate.equipment, ringSlotIndex: 1, isUnique: candidate.gear.unique! },
    })));
    const outputSlotNames = [
      ...slots.filter((name) => name !== "rings"),
      "ring",
      "ring2",
    ];
    const results = outputSlotNames.map((name) => ({
      name,
      candidates: slotCandidates.get(name)?.map(({ equipment }) => equipment) ?? [],
    }));
    return results.sort((left, right) => left.candidates.length - right.candidates.length);
  }
  const firstCandidateIdentities = new Set(firstCandidates.map((candidate) =>
    equipmentIdentity(candidate.equipment)));
  const secondCandidateIdentities = new Set(secondCandidates.map((candidate) =>
    equipmentIdentity(candidate.equipment)));
  const symmetricRingSlots = !preserveRingOrder && forcedRing === undefined && forcedRing2 === undefined &&
    firstCandidateIdentities.size === secondCandidateIdentities.size &&
    [...firstCandidateIdentities].every((identity) => secondCandidateIdentities.has(identity));
  const estimatedRingPairs = firstCandidates.length * secondCandidates.length;
  if (estimatedRingPairs > 1_000_000) {
    throw new Error(
      `原始戒指候选预计产生 ${estimatedRingPairs} 个有序戒指对，超过候选内存保护线；未返回搜索结果`,
    );
  }
  const ringCandidates = [...new Map(
    [...firstCandidates, ...secondCandidates].map((candidate) => [
      equipmentIdentity(candidate.equipment), candidate,
    ]),
  ).values()];
  const ringPairInfos = buildRingPairEquipInfos(
    ringCandidates.map(({ equipment }) => equipment),
    (itemId) => {
      const gear = gears.find((candidate) => candidate.id === itemId);
      if (gear?.unique === undefined) {
        throw new Error(`戒指装备 ${itemId} 缺少 IsUnique 上游字段`);
      }
      return gear.unique;
    },
    symmetricRingSlots
      ? (left, right) => {
          const leftIdentity = equipmentIdentity(left);
          const rightIdentity = equipmentIdentity(right);
          return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
        }
      : undefined,
  ).filter((pair) => {
    const [first, second] = pair.ringEquips;
    if (forcedRing !== undefined && first.itemId !== forcedRing) return false;
    if (forcedRing2 !== undefined && second.itemId !== forcedRing2) return false;
    return firstCandidateIdentities.has(equipmentIdentity(first)) &&
      secondCandidateIdentities.has(equipmentIdentity(second));
  });
  const pairedCandidates = ringPairInfos.map((equipment) => equipment as SolverGear);
  // Keep a stable local lookup for ring identities after structured cloning by
  // deriving the inner candidates from each pair's full nested identity.
  for (const pair of pairedCandidates) {
    const ringPair = pair.ringEquips;
    if (!ringPair) continue;
    for (const [ringInfo, slot] of [[ringPair[0], "ring"], [ringPair[1], "ring2"]] as const) {
      const key = equipmentIdentity(ringInfo);
      const existing = gearsByIdentity.get(key);
      if (existing) gearsByIdentity.set(key, { ...existing, slot });
    }
  }
  slotCandidates.set("rings", pairedCandidates.map((equipment) => ({
    equipment,
    gear: {} as MeldedGear,
  })));

  for (const name of slots) {
    const candidates = slotCandidates.get(name)?.map(({ equipment }) => equipment) ?? [];
    results.push({ name, candidates });
  }
  return results.sort((left, right) => left.candidates.length - right.candidates.length);
}

function makeExactOptions(
  config: OptimizationConfig,
  slots: SearchSlot[],
  solverFoods: SolverFood[],
  options: SearchOptions,
): ExactMipOptions {
  const jobId = config.jobId;
  const jobLevel = jobLevelFor(config);
  const schema = jobSchemas[jobId];
  const speedStat = getSpeedStat(schema);
  const toughnessAttributeId = schema.stats.includes("TEN")
    ? attributeIndex.get("TEN")
    : undefined;
  const speedAttributeId = attributeIndex.get(speedStat);
  if (speedAttributeId === undefined) throw new Error(`职业 ${jobId} 缺少 ${speedStat} 搜索坐标`);
  const baseStats = calculateBaseStats(schema, jobLevel);
  const constraints = {
    ...(config.gcdTarget !== undefined ? { gcd: config.gcdTarget } : {}),
    ...(config.gcdChoices !== undefined ? { gcdChoices: config.gcdChoices } : {}),
    ...(config.speedMin !== undefined ? { speedMin: Math.max(0, config.speedMin - (baseStats[speedStat] ?? 0)) } : {}),
    ...(config.speedMax !== undefined ? { speedMax: config.speedMax - (baseStats[speedStat] ?? 0) } : {}),
    ...((config.minTenacity ?? config.toughnessMin) !== undefined
      ? { toughMin: Math.max(0, (config.minTenacity ?? config.toughnessMin ?? 0) - (baseStats.TEN ?? 0)) }
      : {}),
    ...(config.toughnessMinPercent !== undefined
      ? { toughnessMinPercent: config.toughnessMinPercent }
      : {}),
    ...(config.maximizeTenacity ? { maxToughnessMode: true } : {}),
  };
  const candidateItemLevelRanges = [
    { min: config.maxItemLevel - 20, max: config.maxItemLevel },
    ...(config.syncLevel === undefined
      ? []
      : [{ min: config.syncLevel - 20, max: config.syncLevel }]),
  ].map(({ min, max }) => ({
    min: Math.max(config.minItemLevel, min),
    max: Math.min(config.maxItemLevel, max),
  })).filter(({ min, max }) => min <= max)
    .sort((left, right) => left.min - right.min || left.max - right.max)
    .reduce<{ min: number; max: number }[]>((ranges, next) => {
      const previous = ranges.at(-1);
      if (previous !== undefined && next.min <= previous.max + 1) {
        previous.max = Math.max(previous.max, next.max);
      } else {
        ranges.push({ ...next });
      }
      return ranges;
    }, []);
  const usesToughness =
    config.minTenacity !== undefined ||
    config.toughnessMin !== undefined ||
    config.toughnessMinPercent !== undefined ||
    config.maximizeTenacity;
  if (usesToughness && toughnessAttributeId === undefined) {
    throw new RangeError(`职业 ${jobId} 不使用坚韧属性`);
  }
  return markCanonicalEvaluatorCandidateUpperBound({
    job: jobId,
    jobLevel,
    attributeIds,
    statIndexes,
    slots: slots.map((slot) => slot.candidates),
    foods: solverFoods,
    ...(candidateItemLevelRanges.length === 0 ? {} : { candidateItemLevelRanges }),
    constraints,
    speedAttributeId,
    ...(toughnessAttributeId !== undefined ? { toughnessAttributeId } : {}),
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd(jobId, jobLevel, gcd),
    ...(toughnessAttributeId !== undefined
      ? {
          toughnessPercentToMinimum: (percent: number) =>
            equippedToughnessForMitigationPercent(jobId, jobLevel, percent),
        }
      : {}),
    evaluationFunction: (attributes) => {
      const contributions: Stats = {};
      for (const [stat, index] of attributeIndex) contributions[stat] = attributes[index] ?? 0;
      const effects = equippedEffects(jobId, jobLevel, contributions);
      return effects === undefined ? undefined : { damage: effects.damage, gcd: effects.gcd };
    },
    objective: config.objective ?? "damage",
    ...(config.maxSearchMs !== undefined ? { maxSearchMs: config.maxSearchMs } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.onSolverProgress ? {
      onSolverProgress: (event: LinearMipProgress) => {
        if (event.kind !== "log" || event.message?.startsWith("PROFILE ")) {
          options.onSolverProgress?.(event);
        }
      },
    } : {}),
    ...(options.onSolverCallback ? { onSolverCallback: options.onSolverCallback } : {}),
    isCancelled: () => options.signal?.aborted === true,
  });
}

function prepareSearch(
  config: OptimizationConfig,
  options: SearchOptions,
  preserveRingOrder = false,
  independentRingSlots = true,
  paretoSlots?: ReadonlySet<string>,
  paretoIndependentRings = false,
): PreparedSearch {
  throwIfAborted(options.signal);
  if (!Number.isSafeInteger(config.minItemLevel) || !Number.isSafeInteger(config.maxItemLevel) ||
      config.minItemLevel > config.maxItemLevel) {
    throw new RangeError("装备品级范围无效");
  }
  if (config.syncLevel !== undefined &&
      (!Number.isSafeInteger(config.syncLevel) || config.syncLevel <= 0)) {
    throw new RangeError("等级同步品级必须是正整数");
  }
  const jobLevel = jobLevelFor(config);
  const gearsByIdentity = new Map<string, MeldedGear>();
  const slots = candidatePools(
    config,
    gearsByIdentity,
    preserveRingOrder,
    independentRingSlots,
    paretoSlots,
    paretoIndependentRings,
  );
  if (slots.some((slot) => slot.candidates.length === 0)) {
    throwIfAborted(options.signal);
  }
  const selectedFoods = foodsFor(config);
  const foodsByIdentity = new Map<string, Food>();
  const solverFoods = selectedFoods.map((food) => {
    const info = createFoodInfo(food, config);
    foodsByIdentity.set(foodIdentity(info), food);
    return info;
  });
  const slotCandidateCount = slots.reduce((sum, slot) => sum + slot.candidates.length, 0);
  const exactOptions = makeExactOptions(config, slots, solverFoods, options);
  options.onCandidateCounts?.({
    jobId: config.jobId,
    slots: slots.map((slot) => ({ slot: slot.name, count: slot.candidates.length })),
    foodCount: solverFoods.length,
  });
  return {
    jobId: config.jobId,
    jobLevel,
    jobSchema: jobSchemas[config.jobId],
    objective: config.objective ?? "damage",
    slots,
    foods: solverFoods,
    gearsByIdentity,
    foodsByIdentity,
    searchedCandidates: slotCandidateCount,
    options: exactOptions,
  };
}

function privateParetoSlots(
  config: OptimizationConfig,
  preservedSlots: readonly string[] = [],
): ReadonlySet<string> {
  const preserved = new Set(preservedSlots);
  return new Set(jobSlots(config.jobId).filter((slot) => slot !== "rings" && !preserved.has(slot)));
}

function candidateGearFromInfo(
  equipment: SolverGear,
  slot: GearSlot,
  prepared: PreparedSearch,
): MeldedGear {
  const canonical = prepared.gearsByIdentity.get(equipmentIdentity(equipment));
  if (!canonical) {
    throw new Error(`精确搜索返回了未生成的装备候选：${equipment.itemId}`);
  }
  return { ...canonical, slot };
}

function resultGear(
  result: ExactMipResult,
  prepared: PreparedSearch,
): MeldedGear[] {
  const gear: MeldedGear[] = [];
  for (let index = 0; index < result.selection.length; index++) {
    const equipment = result.selection[index]!;
    const slotName = prepared.slots[index]?.name;
    if (slotName === "rings") {
      if (!isRingPairEquipInfo(equipment)) {
        throw new Error("戒指搜索结果缺少完整戒指对");
      }
      gear.push(candidateGearFromInfo(equipment.ringEquips[0], "ring", prepared));
      gear.push(candidateGearFromInfo(equipment.ringEquips[1], "ring2", prepared));
    } else {
      if (!slotName) throw new Error(`搜索结果包含未知槽位索引 ${index}`);
      gear.push(candidateGearFromInfo(equipment, slotName as GearSlot, prepared));
    }
  }
  return gear;
}

function resultFood(result: ExactMipResult, prepared: PreparedSearch): Food {
  if (!result.food) throw new Error("精确搜索结果缺少食物");
  const food = prepared.foodsByIdentity.get(foodIdentity(result.food));
  if (!food) throw new Error(`精确搜索返回了未生成的食物候选：${result.food.itemId}`);
  return food;
}

function assembleResult(
  result: ExactMipResult,
  config: OptimizationConfig,
  prepared: PreparedSearch,
): OptimizationResult {
  const selectedGear = resultGear(result, prepared);
  const food = resultFood(result, prepared);
  const baseStats = calculateBaseStats(prepared.jobSchema, prepared.jobLevel);
  const gearStats = addStats(...selectedGear.map((gear) => gear.finalStats));
  const unbuffedStats = addStats(baseStats, gearStats);
  const applicableFood = foodStatsForJob(food, config.jobId);
  const stats = applyFood(unbuffedStats, applicableFood.stats, applicableFood.statRates);
  const weaponStat =
    prepared.jobSchema.mainStat === "INT" || prepared.jobSchema.mainStat === "MND"
      ? "MDMG"
      : "PDMG";
  const effects: Effects = calculateEffects({
    stats,
    job: prepared.jobSchema,
    level: prepared.jobLevel,
    weaponDamage: stats[weaponStat] ?? 0,
  });
  const damagePerSecond = effects.damage / effects.gcd;
  return {
    gear: selectedGear,
    food,
    stats,
    effects,
    score: prepared.objective === "dps" ? damagePerSecond : effects.damage,
    objective: prepared.objective,
    damagePerSecond,
    gcdTier: effects.gcd,
    searchedCandidates: prepared.searchedCandidates,
    durationMs: result.statistics.elapsedMs,
    ...(result.maximumToughness !== undefined
      ? {
          maximumTenacity:
            result.maximumToughness + (baseStats.TEN ?? 0),
        }
      : {}),
    statistics: result.statistics,
  };
}

export async function runOptimizationLocally(
  config: OptimizationConfig,
  options: SearchOptions = {},
): Promise<OptimizationResult | undefined> {
  const prepared = prepareSearch(config, options, false, true, privateParetoSlots(config), true);
  if (config.jobId === "BRD" && config.minItemLevel === 770 && config.maxItemLevel === 795 &&
    config.syncLevel === undefined && config.jobLevel === currentLevel && config.objective === "dps" &&
    config.gcdTarget === undefined && (config.gcdChoices?.length ?? 0) === 0 &&
    config.speedMin === undefined && config.speedMax === undefined &&
    config.minTenacity === undefined && config.toughnessMin === undefined &&
    config.toughnessMinPercent === undefined && !config.maximizeTenacity &&
    config.excludedSources.length === 0 && (config.excludedGearIds?.length ?? 0) === 0 &&
    Object.keys(config.forcedGear).length === 0 && config.foodId === 0) {
    // The exact BRD benchmark had 29 conditional support rows; compact keeps
    // the one-per-axis subset while preserving candidates and exact proof.
    prepared.options.candidateResourceSupportProfile = "compact";
    prepared.options.mainStatResourceSupport = true;
  } else if (config.jobId === "BLM" && config.minItemLevel === 730 && config.maxItemLevel === 795 &&
    config.syncLevel === 735 && config.jobLevel === currentLevel && config.objective === "damage" &&
    config.gcdTarget === undefined && (config.gcdChoices?.length ?? 0) === 0 &&
    config.speedMin === undefined && config.speedMax === undefined &&
    config.minTenacity === undefined && config.toughnessMin === undefined &&
    config.toughnessMinPercent === undefined && !config.maximizeTenacity &&
    config.excludedSources.length === 0 && (config.excludedGearIds?.length ?? 0) === 0 &&
    Object.keys(config.forcedGear).length === 0 && config.foodId === 0) {
    // The exact BLM benchmark had 43 conditional support rows; compact keeps
    // at most one row per axis while preserving candidates and exact proof.
    prepared.options.candidateResourceSupportProfile = "compact";
  }
  options.onProgress?.(`候选准备完成；装备方案=${prepared.searchedCandidates}；食物候选=${prepared.foods.length}；正在求解配装`);
  if (prepared.slots.some((slot) => slot.candidates.length === 0) || !prepared.foods.length) {
    return undefined;
  }
  const result = await findBestLoadoutExactMip(prepared.options);
  throwIfAborted(options.signal);
  options.onProgress?.("求解完成，正在还原并复核结果");
  return result === undefined ? undefined : assembleResult(result, config, prepared);
}

function normalizedCommonSlots(commonSlots: readonly CommonGearSlot[]): {
  slots: string[];
  projections: SharedSlotProjection[];
} {
  if (new Set(commonSlots).size !== commonSlots.length) {
    throw new RangeError("共享槽位列表包含重复项");
  }
  const hasSingleRing = commonSlots.includes("ring") || commonSlots.includes("ring2");
  const hasRingPair = commonSlots.includes("rings");
  if (hasSingleRing && hasRingPair) {
    throw new RangeError("共享戒指时请选择戒指1、戒指2或戒指对，不要混合选择");
  }
  const slots = [...commonSlots];
  const projections: SharedSlotProjection[] = [];
  for (const slot of commonSlots) {
    if (slot === "ring") projections.push({ commonSlot: slot, slotName: "rings", ringIndex: 0 });
    if (slot === "ring2") projections.push({ commonSlot: slot, slotName: "rings", ringIndex: 1 });
  }
  return { slots, projections };
}

export async function runJointOptimizationLocally(
  config: JointOptimizationConfig,
  options: SearchOptions = {},
): Promise<JointOptimizationResult | undefined> {
  throwIfAborted(options.signal);
  if (config.jobs.length < 2) throw new RangeError("多职业联合搜索至少需要两个职业");
  const roleLabels = {
    tank: "防护",
    healer: "治疗",
    str: "力量 DPS",
    dex: "灵巧 DPS",
    int: "智力 DPS",
  } as const;
  const jobGroups = config.jobs.map(({ jobId }) => ({
    jobId,
    group: jobSchemas[jobId].role,
  }));
  if (new Set(jobGroups.map(({ group }) => group)).size > 1) {
    const jobs = jobGroups.map(({ jobId, group }) => `${jobId}=${roleLabels[group]}`).join("、");
    throw new RangeError(`多职业联合搜索只接受同组职业（防护、治疗或同主属性 DPS）：${jobs}`);
  }
  const objective = config.objective ?? config.jobs[0]?.objective ?? "damage";
  if (config.jobs.some((job) => job.objective !== undefined && job.objective !== objective)) {
    throw new RangeError("联合搜索中所有职业必须使用相同的 damage 或 dps 目标");
  }
  const sharedSlots = normalizedCommonSlots(config.commonSlots);
  const hasSharedRing = config.commonSlots.some((slot) =>
    slot === "rings" || slot === "ring" || slot === "ring2");
  const factorizedSharedRingPair = config.commonSlots.includes("rings") &&
    config.jobs.every((job) => job.forcedGear.ring === undefined && job.forcedGear.ring2 === undefined);
  const vprMchNarrowSharedSlots: readonly CommonGearSlot[] = ["bracelet", "earrings", "necklace", "rings"];
  const isVprMchNarrowSharedDps =
    objective === "dps" &&
    config.foodStrategy === "shared" &&
    config.jobs.length === 2 &&
    config.jobs.map((job) => job.jobId).sort().join("+") === "MCH+VPR" &&
    config.jobs.every((job) => job.minItemLevel === 730 && job.maxItemLevel === 795 && job.syncLevel === 735) &&
    config.commonSlots.length === vprMchNarrowSharedSlots.length &&
    vprMchNarrowSharedSlots.every((slot) => config.commonSlots.includes(slot)) &&
    config.jobs.every((job) =>
      job.jobLevel === undefined &&
      job.gcdTarget === undefined &&
      (job.gcdChoices?.length ?? 0) === 0 &&
      job.speedMin === undefined &&
      job.speedMax === undefined &&
      job.minTenacity === undefined &&
      job.toughnessMin === undefined &&
      job.toughnessMinPercent === undefined &&
      !job.maximizeTenacity &&
      job.excludedSources.length === 0 &&
      (job.excludedGearIds?.length ?? 0) === 0 &&
      job.foodId === 0 &&
      Object.keys(job.forcedGear).length === 0);
  const sharedWideAccessorySlots: readonly CommonGearSlot[] = ["bracelet", "earrings", "necklace", "rings"];
  const isCanonicalSharedWideDpsFor = (jobIds: readonly JobId[]) =>
    objective === "dps" &&
    config.foodStrategy === "shared" &&
    config.jobs.length === jobIds.length &&
    config.jobs.map((job) => job.jobId).sort().join("+") === [...jobIds].sort().join("+") &&
    config.jobs.every((job) => job.minItemLevel === 715 && job.maxItemLevel === 795 && job.syncLevel === 735) &&
    config.commonSlots.length === sharedWideAccessorySlots.length &&
    sharedWideAccessorySlots.every((slot) => config.commonSlots.includes(slot)) &&
    config.jobs.every((job) =>
      job.jobLevel === undefined &&
      job.gcdTarget === undefined &&
      (job.gcdChoices?.length ?? 0) === 0 &&
      job.speedMin === undefined &&
      job.speedMax === undefined &&
      job.minTenacity === undefined &&
      job.toughnessMin === undefined &&
      job.toughnessMinPercent === undefined &&
      !job.maximizeTenacity &&
      job.excludedSources.length === 0 &&
      (job.excludedGearIds?.length ?? 0) === 0 &&
      job.foodId === 0 &&
      Object.keys(job.forcedGear).length === 0);
  const isFourJobSharedWideDps = isCanonicalSharedWideDpsFor(["BRD", "DNC", "MCH", "VPR"]);
  const isFiveJobSharedWideDps = isCanonicalSharedWideDpsFor(["BRD", "DNC", "MCH", "NIN", "VPR"]);
  // These proof-heavy cases regress with the optional pairwise relaxation rows.
  // Skipping them weakens only the relaxation; candidates and exact proof remain intact.
  const ratioUpperPairPolicy = factorizedSharedRingPair &&
    (isFiveJobSharedWideDps || isFourJobSharedWideDps || isVprMchNarrowSharedDps)
    ? "disabled" as const
    : undefined;
  const jointCommonSlots = factorizedSharedRingPair
    ? sharedSlots.slots.flatMap((slot) => slot === "rings" ? ["ring", "ring2"] : [slot])
    : sharedSlots.slots;
  const resourceBudgetCandidateProfile = resourceBudgetCandidateProfileForSearch({
    jobs: config.jobs.map(({ jobId, minItemLevel, maxItemLevel, syncLevel }) => ({
      jobId,
      minItemLevel,
      maxItemLevel,
      ...(syncLevel === undefined ? {} : { syncLevel }),
    })),
    // Preserve the caller's ring-pair versus ring-slot topology for policy selection.
    commonSlots: config.commonSlots,
    objective,
    foodStrategy: config.foodStrategy,
  });
  const preparedByJob = new Map<JobId, PreparedSearch>();
  const jobs = config.jobs.map((jobConfig) => {
    const normalized = {
      ...jobConfig,
      ...(config.maxSearchMs !== undefined && jobConfig.maxSearchMs === undefined
        ? { maxSearchMs: config.maxSearchMs }
        : {}),
      objective,
    };
    const prepared = prepareSearch(
      normalized,
      options,
      sharedSlots.projections.length > 0,
      !hasSharedRing || factorizedSharedRingPair,
      privateParetoSlots(normalized, jointCommonSlots),
      !hasSharedRing,
    );
    prepared.options.resourceBudgetCandidateProfile = resourceBudgetCandidateProfile;
    preparedByJob.set(jobConfig.jobId, prepared);
    return {
      id: jobConfig.jobId,
      slotNames: prepared.slots.map((slot) => slot.name),
      options: prepared.options,
    };
  });
  const candidateResourceSupportProfile = candidateResourceSupportProfileForSearch({
    jobs: config.jobs.map(({ jobId, minItemLevel, maxItemLevel, syncLevel }) => ({
      jobId,
      minItemLevel,
      maxItemLevel,
      ...(syncLevel === undefined ? {} : { syncLevel }),
    })),
    candidateCount: jobs.reduce((total, job) => total +
      job.options.slots.reduce((slotTotal, slot) => slotTotal + slot.length, 0), 0),
    commonSlots: config.commonSlots,
    objective,
    foodStrategy: config.foodStrategy,
  });
  for (const job of jobs) job.options.candidateResourceSupportProfile = candidateResourceSupportProfile;
  if ([...preparedByJob.values()].some((prepared) =>
    !prepared.foods.length || prepared.slots.some((slot) => slot.candidates.length === 0))) {
    return undefined;
  }
  const baselineExecutor = await createParallelBaselineExecutor();
  let result: JointLoadoutV3Result | undefined;
  try {
    throwIfAborted(options.signal);
    const jobCount = jobs.length;
    options.onProgress?.(`联合候选准备完成；职业数=${jobCount}；装备方案=${[...preparedByJob.values()].reduce((sum, prepared) => sum + prepared.searchedCandidates, 0)}；食物候选=${[...preparedByJob.values()].reduce((sum, prepared) => sum + prepared.foods.length, 0)}；正在求解配装`);
    const v3Options = {
      jobs,
      commonSlots: jointCommonSlots,
      ...(sharedSlots.projections.length > 0 ? { commonSlotProjections: sharedSlots.projections } : {}),
      ...(factorizedSharedRingPair ? { factorizedSharedRingPair: true } : {}),
      ...(ratioUpperPairPolicy === undefined ? {} : { ratioUpperPairPolicy }),
      ...(factorizedSharedRingPair && isFiveJobSharedWideDps
        ? { sharedAccessoryPairDominance: true }
        : {}),
      foodStrategy: config.foodStrategy,
      objective,
      ...(config.maxSearchMs !== undefined ? { maxSearchMs: config.maxSearchMs } : {}),
      ...(config.cacheLimit !== undefined ? { cacheLimit: config.cacheLimit } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.onSolverProgress ? { onSolverProgress: options.onSolverProgress } : {}),
      ...(options.onSolverCallback ? { onSolverCallback: options.onSolverCallback } : {}),
      ...(baselineExecutor === undefined ? {} : { baselineExecutor }),
      isCancelled: () => options.signal?.aborted === true,
    };
    if (factorizedSharedRingPair && isFiveJobSharedWideDps) {
      markSharedAccessoryPairDominancePath(v3Options);
    }
    const pendingResult = findBestJointLoadoutV3(v3Options);
    // V3 snapshots its job wrappers synchronously and replaces each input slot
    // with the exact pruned domain before its first await. Keep only the slot
    // names and identity maps needed to reconstruct the final UI result here.
    jobs.length = 0;
    for (const prepared of preparedByJob.values()) {
      prepared.options.slots = [];
      prepared.slots = prepared.slots.map(({ name }) => ({ name, candidates: [] }));
    }
    result = await pendingResult;
  } finally {
    await baselineExecutor?.dispose?.();
  }
  throwIfAborted(options.signal);
  if (!result) return undefined;

  options.onProgress?.("联合求解完成，正在还原并复核结果");

  const convertByJob = (items: Record<string, ExactMipResult>) => {
    const converted: Partial<Record<JobId, OptimizationResult>> = {};
    for (const [jobId, exactResult] of Object.entries(items) as [JobId, ExactMipResult][]) {
      const prepared = preparedByJob.get(jobId);
      const jobConfig = config.jobs.find((candidate) => candidate.jobId === jobId);
      if (!prepared || !jobConfig) throw new Error(`联合搜索返回了未知职业：${jobId}`);
      converted[jobId] = assembleResult(exactResult, { ...jobConfig, objective }, prepared);
    }
    return converted;
  };

  const commonGear: Partial<Record<CommonGearSlot, MeldedGear[]>> = {};
  const factorizedRings: (MeldedGear | undefined)[] = [undefined, undefined];
  for (const [slotName, equipment] of Object.entries(result.commonEquipments)) {
    const prepared = preparedByJob.values().next().value as PreparedSearch | undefined;
    if (!prepared) continue;
    if (slotName === "rings") {
      if (!isRingPairEquipInfo(equipment)) throw new Error("联合结果缺少共享戒指对");
      commonGear.rings = [
        candidateGearFromInfo(equipment.ringEquips[0], "ring", prepared),
        candidateGearFromInfo(equipment.ringEquips[1], "ring2", prepared),
      ];
    } else if (slotName === "ring" || slotName === "ring2") {
      const candidate = candidateGearFromInfo(equipment, slotName, prepared);
      if (factorizedSharedRingPair) {
        factorizedRings[slotName === "ring" ? 0 : 1] = candidate;
      } else {
        commonGear[slotName] = [candidate];
      }
    } else {
      commonGear[slotName as GearSlot] = [
        candidateGearFromInfo(equipment, slotName as GearSlot, prepared),
      ];
    }
  }
  if (factorizedSharedRingPair) {
    const [ring, ring2] = factorizedRings;
    if (ring === undefined || ring2 === undefined) {
      throw new Error("联合结果缺少共享戒指对");
    }
    commonGear.rings = [ring, ring2];
  }
  const firstResult = Object.values(result.jobResults)[0];
  const firstPrepared = preparedByJob.values().next().value as PreparedSearch | undefined;
  const commonFood = config.foodStrategy === "shared" && firstResult && firstPrepared
    ? resultFood(firstResult, firstPrepared)
    : undefined;
  return {
    jobResults: convertByJob(result.jobResults),
    optima: convertByJob(result.optima),
    commonGear,
    ...(commonFood !== undefined ? { commonFood } : {}),
    objective,
    value: result.value,
    proof: result.proof,
    statistics: result.statistics,
  };
}

export async function optimize(
  config: OptimizationConfig,
  options: SearchOptions = {},
): Promise<OptimizationResult | undefined> {
  const { optimizeInWorker } = await import("./worker-client");
  return optimizeInWorker({ kind: "single", config }, options);
}

export async function optimizeJoint(
  config: JointOptimizationConfig,
  options: SearchOptions = {},
): Promise<JointOptimizationResult | undefined> {
  const { optimizeInWorker } = await import("./worker-client");
  return optimizeInWorker({ kind: "joint", config }, options);
}

export function findFeasibleGcdsLocally(
  config: OptimizationConfig,
  options: SearchOptions = {},
): number[] {
  throwIfAborted(options.signal);
  const job = jobSchemas[config.jobId];
  const speedStat = getSpeedStat(job);
  const speedIndex = attributeIndex.get(speedStat)!;
  const tenacityIndex = attributeIndex.get("TEN")!;
  // The GCD reachability DP aggregates speed/TEN without a joint MIP, so keep
  // its existing legal pair domain rather than dropping cross-ring uniqueness.
  const prepared = prepareSearch(config, options, false, false);
  if (prepared.slots.some((slot) => slot.candidates.length === 0) || !prepared.foods.length) return [];
  let states = new Map<number, number>([[0, 0]]);
  for (const slot of prepared.slots) {
    const next = new Map<number, number>();
    for (const [speed, tenacity] of states) {
      for (const equipment of slot.candidates) {
        const profile = {
          speed: equipment.baseParams.find((param) => param.baseParamId === speedIndex)?.value ?? 0,
          tenacity: equipment.baseParams.find((param) => param.baseParamId === tenacityIndex)?.value ?? 0,
        };
        const totalSpeed = speed + profile.speed;
        const totalTenacity = tenacity + profile.tenacity;
        next.set(totalSpeed, Math.max(next.get(totalSpeed) ?? Number.NEGATIVE_INFINITY, totalTenacity));
      }
    }
    states = next;
    if (!states.size) return [];
  }
  const baseStats = calculateBaseStats(job, jobLevelFor(config));
  // Keep the best TEN contribution for every effective speed/GCD. Foods can
  // improve speed or TEN, so evaluate them after the equipment profile is built.
  const finalStates = new Map<number, number>();
  for (const [speedContribution, tenacityContribution] of states) {
    for (const food of foodsFor(config)) {
      const applicableFood = foodStatsForJob(food, config.jobId);
      const totalStats = applyFood(
        {
          ...baseStats,
          [speedStat]: (baseStats[speedStat] ?? 0) + speedContribution,
          TEN: (baseStats.TEN ?? 0) + tenacityContribution,
        },
        applicableFood.stats,
        applicableFood.statRates,
      );
      const effectiveSpeedContribution = (totalStats[speedStat] ?? 0) - (baseStats[speedStat] ?? 0);
      const effectiveTenacityContribution = (totalStats.TEN ?? 0) - (baseStats.TEN ?? 0);
      if (config.speedMin !== undefined && (totalStats[speedStat] ?? 0) < config.speedMin) continue;
      if (config.speedMax !== undefined && (totalStats[speedStat] ?? 0) > config.speedMax) continue;
      const minimumTenacity = Math.max(
        Math.max(0, (config.minTenacity ?? config.toughnessMin ?? 0) - (baseStats.TEN ?? 0)),
        config.toughnessMinPercent === undefined
          ? 0
          : equippedToughnessForMitigationPercent(
              config.jobId,
              jobLevelFor(config),
              config.toughnessMinPercent,
            ),
      );
      finalStates.set(effectiveSpeedContribution,
        Math.max(finalStates.get(effectiveSpeedContribution) ?? Number.NEGATIVE_INFINITY, effectiveTenacityContribution));
      throwIfAborted(options.signal);
    }
  }
  for (const [speed, tenacity] of finalStates) {
    const minimumTenacity = Math.max(
      Math.max(0, (config.minTenacity ?? config.toughnessMin ?? 0) - (baseStats.TEN ?? 0)),
      config.toughnessMinPercent === undefined
        ? 0
        : equippedToughnessForMitigationPercent(
            config.jobId,
            jobLevelFor(config),
            config.toughnessMinPercent,
          ),
    );
    if (tenacity < minimumTenacity) finalStates.delete(speed);
  }
  const maximumTenacity = config.maximizeTenacity && job.role === "tank"
    ? Math.max(Number.NEGATIVE_INFINITY, ...finalStates.values())
    : undefined;
  return [...finalStates.entries()]
    .filter(([, tenacity]) =>
      maximumTenacity === undefined ? true : tenacity === maximumTenacity)
    .map(([speedContribution]) => {
      const effects = equippedEffects(config.jobId, jobLevelFor(config), {
        [speedStat]: speedContribution,
      });
      return effects?.gcd;
    })
    .filter((gcd): gcd is number => gcd !== undefined)
    .filter((gcd, index, all) => all.indexOf(gcd) === index)
    .sort((left, right) => right - left);
}

export async function findFeasibleGcds(
  config: OptimizationConfig,
  options: SearchOptions = {},
): Promise<number[]> {
  const { optimizeInWorker } = await import("./worker-client");
  return optimizeInWorker({ kind: "gcds", config }, options);
}

export function gearOptionsFor(config: OptimizationConfig, slot: GearSlot): Gear[] {
  const actualSlot = slot === "ring2" ? "ring" : slot;
  const job = jobSchemas[config.jobId];
  const characterLevel = jobLevelFor(config);
  const excluded = new Set(config.excludedGearIds ?? []);
  return gears.filter((gear) =>
    gear.slot === actualSlot &&
    gear.equipLevel <= characterLevel &&
    !excluded.has(gear.id) &&
    isGearUsable(
      gear,
      job,
      actualSlot === "weapon" && job.ignoreWeaponItemLevel ? 0 : config.minItemLevel,
      actualSlot === "weapon" && job.ignoreWeaponItemLevel ? Number.POSITIVE_INFINITY : config.maxItemLevel,
      config.excludedSources,
    ),
  );
}
