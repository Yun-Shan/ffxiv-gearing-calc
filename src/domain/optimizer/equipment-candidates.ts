import {
  foods,
  gameData,
  getGearById,
  materiaGradeRequiredLevels,
} from "../data.ts";
import {
  gearOptionsFor,
  jobLevelFor,
  preferCandidateGearLevel,
  type HighestCandidateGearLevel,
} from "../gear-options.ts";
import { jobSchemas } from "../jobs.ts";
import {
  calculateBaseStats,
  capGearStatsAtLevel,
  concretizeGearStats,
  effectiveGearSyncLevel,
  getGearStatCap,
  getSpeedStat,
} from "../rules.ts";
import {
  insertParetoCandidate,
  paretoRingCandidates,
  type ParetoCandidate,
} from "../search/candidate-pareto.ts";
import { equipmentIdentity } from "../search/equipment-identity.ts";
import { buildRingPairEquipInfos } from "../search/ring-pairs.ts";
import type {
  Food,
  Gear,
  GearSlot,
  JobId,
  MeldedGear,
  Materia,
  OptimizationConfig,
  Stat,
  Stats,
} from "../types.ts";
import {
  attributeIndex,
  attributeStats,
  jobSlots,
  type GearCandidate,
  type SearchSlot,
  type SolverFood,
  type SolverGear,
} from "./context.ts";

export { gearOptionsFor };

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
  return getGearStatCap(gear, stat, level);
}

function capLevelFor(gear: Gear, jobLevel: number, syncLevel?: number): number {
  return effectiveGearSyncLevel(gear, jobLevel, syncLevel) ?? gear.level;
}

function mergeCandidateStats(
  gear: Gear,
  melds: readonly Materia[],
  jobLevel: number,
  syncLevel?: number,
): Stats {
  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, syncLevel);
  const level = synchronizedLevel ?? gear.level;
  const finalStats: Stats = synchronizedLevel === undefined
    ? { ...gear.stats }
    : capGearStatsAtLevel(gear, gear.stats, level);
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
    const remaining = slots
      .map((_, index) => index)
      .filter((index) => index !== smallIndex);
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
  jobLevel: number,
): Materia[][] {
  const syncApplies =
    effectiveGearSyncLevel(gear, jobLevel, config.syncLevel) !== undefined;
  // 品级同步时普通装备的魔晶石失效。自定义参数武器按独立路径处理：
  // 上游算法保留其十二种参数组合，并在同步后封顶属性。
  if (syncApplies) return [[]];
  if (gear.materiaSlots === 0 && gear.materiaAdvanced !== true) return [[]];

  const stats = materiaAttributeStats(jobId);
  const highGrade = highestMateriaGrade(gear.level, true);
  const highMateria = stats.map((stat) => materiaForGrade(stat, highGrade));
  const canOvermeld = gear.materiaAdvanced === true && gear.materiaSlots < 5;
  const advancedCount = canOvermeld ? Math.max(0, 4 - gear.materiaSlots) : 0;
  const openAndFirstOvermeld = gear.materiaSlots + (canOvermeld ? 1 : 0);
  const lowMateria =
    advancedCount > 0
      ? stats.map((stat) =>
          materiaForGrade(stat, highestMateriaGrade(gear.level, false)),
        )
      : [];
  const unique = new Map<string, Materia[]>();
  for (const highCounts of countCombinations(
    stats.length,
    openAndFirstOvermeld,
  )) {
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
        const level = capLevelFor(gear, jobLevel, config.syncLevel);
        const available =
          statCapAtLevel(gear, stat, level) - (gear.stats[stat] ?? 0);
        const finalMeldValue =
          lowCount > 0 ? lowMateria[index]!.value : highMateria[index]!.value;
        // 最后一颗魔晶石的属性可能被封顶削减；不要用完全不增加属性的魔晶石填孔。
        // 先尝试高等级魔晶石，再尝试可禁断的低等级魔晶石。
        if (
          totalValue > 0 &&
          (available <= 0 || totalValue - finalMeldValue >= available)
        ) {
          valid = false;
          break;
        }
        for (let count = 0; count < highCount; count++)
          melds.push(highMateria[index]!);
        for (let count = 0; count < lowCount; count++)
          melds.push(lowMateria[index]!);
      }
      if (!valid) continue;
      const key = melds
        .map(({ stat, value, grade }) => `${stat}:${value}:${grade}`)
        .join("|");
      if (!unique.has(key)) unique.set(key, melds);
    }
  }
  return [...unique.values()];
}

function toSolverEquipment(
  gear: MeldedGear,
  resistanceWeaponAdjust = gear.resistanceWeaponAdjust,
): SolverGear {
  const baseParams = Object.entries(gear.finalStats)
    .flatMap(([key, value]) => {
      const index = attributeIndex.get(key as Stat);
      return index === undefined || !value
        ? []
        : [{ baseParamId: index, value }];
    })
    .sort((left, right) => left.baseParamId - right.baseParamId);
  const key = baseParams.map(({ baseParamId }) => baseParamId).join("-");
  const variantKey = JSON.stringify(
    gear.melds
      .map(({ stat, value, grade }) => [stat, value, grade] as const)
      .sort(
        ([statA, valueA, gradeA], [statB, valueB, gradeB]) =>
          statA.localeCompare(statB) || gradeA - gradeB || valueA - valueB,
      ),
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
    ...(resistanceWeaponAdjust === undefined ? {} : { resistanceWeaponAdjust }),
  };
}

function resistanceAdjustmentForSearch(
  gear: Gear,
  finalStats: Stats,
  jobLevel: number,
  syncLevel?: number,
) {
  const adjustment = gear.resistanceWeaponAdjust;
  if (adjustment === undefined) return undefined;
  const effectiveLevel = effectiveGearSyncLevel(gear, jobLevel, syncLevel);
  if (effectiveLevel === undefined) return adjustment;
  const statMaximums = Object.fromEntries(adjustment.stats.map((stat) => [
    stat,
    Math.min(
      adjustment.maxEachStat,
      Math.max(0, statCapAtLevel(gear, stat, effectiveLevel) - (finalStats[stat] ?? 0)),
    ),
  ])) as Partial<Record<(typeof adjustment.stats)[number], number>>;
  return { ...adjustment, statMaximums };
}

export function foodIdentity(food: SolverFood): string {
  if (food.physicalKey !== undefined) return food.physicalKey;
  return JSON.stringify({
    itemId: food.itemId,
    itemLevel: food.itemLevel,
    baseParams: food.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [
        baseParamId,
        multiplier,
        maxValue,
      ])
      .sort((left, right) => left[0] - right[0]),
  });
}

function physicalFoodIdentity(food: Food): string {
  const sortStats = (stats: Stats) =>
    Object.entries(stats)
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    itemId: food.id,
    itemLevel: food.level,
    stats: sortStats(food.stats),
    statRates: sortStats(food.statRates),
  });
}

export function foodStatsForJob(
  food: Food,
  jobId: JobId,
): { stats: Stats; statRates: Stats } {
  const allowed = new Set(jobSchemas[jobId].stats);
  const filter = (values: Stats): Stats =>
    Object.fromEntries(
      Object.entries(values).filter(
        ([stat, value]) => allowed.has(stat as Stat) && value !== undefined,
      ),
    ) as Stats;
  return { stats: filter(food.stats), statRates: filter(food.statRates) };
}

export function createFoodInfo(
  food: Food,
  config: OptimizationConfig,
  jobLevel: number,
): SolverFood {
  const schema = jobSchemas[config.jobId];
  const baseStats = calculateBaseStats(schema, jobLevel);
  const applicableFood = foodStatsForJob(food, config.jobId);
  const baseParams = Object.entries(applicableFood.stats)
    .flatMap(([key, maxValue]) => {
      const stat = key as Stat;
      const index = attributeIndex.get(stat);
      const rate = applicableFood.statRates[stat] ?? 0;
      return index === undefined || !maxValue || rate <= 0
        ? []
        : [
            {
              baseParamId: index,
              multiplier: 1 + rate / 100,
              maxValue,
              baseValue: baseStats[stat] ?? 0,
            },
          ];
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
  const job = jobSchemas[config.jobId];
  const jobLevel = jobLevelFor(config);
  const resolvedGear: Gear = {
    ...gear,
    stats: concretizeGearStats(gear.stats, job),
  };
  const options = resolvedGear.resistanceWeaponAdjust !== undefined
    ? [[]]
    : resolvedGear.customParameters?.length
    ? customParameterMelds(resolvedGear)
    : regularMateriaMelds(resolvedGear, config.jobId, config, jobLevel);
  const candidates = new Map<string, GearCandidate>();
  for (const melds of options) {
    const finalStats = mergeCandidateStats(
      resolvedGear,
      melds,
      jobLevel,
      config.syncLevel,
    );
    const damageStat =
      job.mainStat === "INT" || job.mainStat === "MND"
        ? "MDMG"
        : "PDMG";
    const meldedGear: MeldedGear = {
      ...resolvedGear,
      slot,
      weaponDamage: finalStats[damageStat] ?? gear.weaponDamage,
      melds: melds.map((meld) => ({ ...meld })),
      finalStats,
    };
    const equipment = toSolverEquipment(
      meldedGear,
      resistanceAdjustmentForSearch(
        resolvedGear,
        finalStats,
        jobLevel,
        config.syncLevel,
      ),
    );
    const identity = equipmentIdentity(equipment);
    if (candidates.has(identity)) continue;
    candidates.set(identity, { equipment, gear: meldedGear });
    gearsByIdentity.set(identity, meldedGear);
  }
  return [...candidates.values()];
}

export function foodsFor(config: OptimizationConfig): Food[] {
  if (config.foodId !== 0)
    return foods.filter((food) => food.id === config.foodId);
  return foods.filter((food) => food.best && (food.stats.VIT ?? 0) > 0);
}

function paretoAttributeStats(jobId: JobId): Stat[] {
  const schema = jobSchemas[jobId];
  if (schema.mainStat === undefined) return attributeStats;
  const attackStat: Stat = schema.mainStat === "VIT" ? "STR" : schema.mainStat;
  const weaponStat: Stat =
    schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const relevant = new Set<Stat>([
    attackStat,
    weaponStat,
    "DET",
    "TEN",
    "CRT",
    "DHT",
    getSpeedStat(schema),
  ]);
  if ([...relevant].some((stat) => !attributeIndex.has(stat)))
    return attributeStats;
  return attributeStats.filter((stat) => relevant.has(stat));
}

export function candidatePools(
  config: OptimizationConfig,
  gearsByIdentity: Map<string, MeldedGear>,
  preserveRingOrder: boolean,
  independentRingSlots: boolean,
  paretoSlots?: ReadonlySet<string>,
  paretoIndependentRings = false,
): { slots: SearchSlot[]; highestCandidateGearLevel?: HighestCandidateGearLevel } {
  const jobId = config.jobId;
  const slots = jobSlots(jobId);
  const results: SearchSlot[] = [];
  const slotCandidates = new Map<string, GearCandidate[]>();
  let highestCandidateGearLevel: HighestCandidateGearLevel | undefined;
  const speedStat = getSpeedStat(jobSchemas[jobId]);
  const paretoStats = paretoAttributeStats(jobId);
  const preserveSpeed =
    config.gcdTarget !== undefined ||
    (config.gcdChoices?.length ?? 0) > 0 ||
    config.speedMax !== undefined;
  const speedCoordinate = preserveSpeed
    ? paretoStats.indexOf(speedStat)
    : undefined;
  if (preserveSpeed && speedCoordinate === undefined) {
    throw new RangeError(`职业 ${jobId} 缺少 ${speedStat} Pareto 搜索坐标`);
  }

  const forgetCandidate = (candidate: GearCandidate) => {
    const identity = equipmentIdentity(candidate.equipment);
    if (gearsByIdentity.get(identity) === candidate.gear)
      gearsByIdentity.delete(identity);
  };

  for (const slotName of slots.filter((name) => name !== "rings")) {
    const slot = slotName as GearSlot;
    const pool = gearOptionsFor(config, slot);
    const forcedId = config.forcedGear[slot];
    const gearsForSlot =
      forcedId === undefined
        ? pool
        : pool.filter((item) => item.id === forcedId);
    const usePareto = paretoSlots?.has(slotName) === true;
    const candidates: GearCandidate[] = [];
    const frontier: ParetoCandidate<GearCandidate>[] = [];
    let candidateOrder = 0;
    for (const gear of gearsForSlot) {
      highestCandidateGearLevel = preferCandidateGearLevel(
        highestCandidateGearLevel,
        gear,
      );
      for (const candidate of makeGearCandidates(
        gear,
        slot,
        config,
        gearsByIdentity,
      )) {
        // 求解器用有界整数变量分配这些属性；若拿零分配的基础候选比较，会错误地将它剪枝。
        if (usePareto && candidate.gear.resistanceWeaponAdjust !== undefined) {
          candidates.push(candidate);
          continue;
        }
        if (!usePareto) {
          candidates.push(candidate);
          continue;
        }
        const insertion = insertParetoCandidate(
          frontier,
          {
            value: candidate,
            attributes: paretoStats.map(
              (stat) => candidate.gear.finalStats[stat] ?? 0,
            ),
            order: candidateOrder++,
          },
          speedCoordinate,
        );
        if (!insertion.accepted) forgetCandidate(candidate);
        for (const removed of insertion.removed) forgetCandidate(removed.value);
      }
    }
    if (usePareto) {
      candidates.push(
        ...frontier
          .sort((left, right) => left.order - right.order)
          .map(({ value }) => value),
      );
    }
    slotCandidates.set(slotName, candidates);
  }

  const ringPool = gearOptionsFor(config, "ring");
  const forcedRing = config.forcedGear.ring;
  const forcedRing2 = config.forcedGear.ring2;
  const firstPool =
    forcedRing === undefined
      ? ringPool
      : ringPool.filter((gear) => gear.id === forcedRing);
  const secondPool =
    forcedRing2 === undefined
      ? ringPool
      : ringPool.filter((gear) => gear.id === forcedRing2);
  for (const gear of firstPool) {
    highestCandidateGearLevel = preferCandidateGearLevel(
      highestCandidateGearLevel,
      gear,
    );
  }
  for (const gear of secondPool) {
    highestCandidateGearLevel = preferCandidateGearLevel(
      highestCandidateGearLevel,
      gear,
    );
  }
  const firstCandidates = firstPool.flatMap((gear) =>
    makeGearCandidates(gear, "ring", config, gearsByIdentity),
  );
  const secondCandidates = secondPool.flatMap((gear) =>
    makeGearCandidates(gear, "ring2", config, gearsByIdentity),
  );
  if (independentRingSlots) {
    const optimizedFirst = paretoIndependentRings
      ? paretoRingCandidates(
          firstCandidates.map((candidate, order) => ({
            value: candidate,
            itemId: candidate.gear.id,
            isUnique: candidate.gear.unique === true,
            attributes: paretoStats.map(
              (stat) => candidate.gear.finalStats[stat] ?? 0,
            ),
            order,
          })),
          secondCandidates.map(({ gear }) => ({
            itemId: gear.id,
            isUnique: gear.unique === true,
          })),
          speedCoordinate,
        ).map(({ value }) => value)
      : firstCandidates;
    const optimizedSecond = paretoIndependentRings
      ? paretoRingCandidates(
          secondCandidates.map((candidate, order) => ({
            value: candidate,
            itemId: candidate.gear.id,
            isUnique: candidate.gear.unique === true,
            attributes: paretoStats.map(
              (stat) => candidate.gear.finalStats[stat] ?? 0,
            ),
            order,
          })),
          firstCandidates.map(({ gear }) => ({
            itemId: gear.id,
            isUnique: gear.unique === true,
          })),
          speedCoordinate,
        ).map(({ value }) => value)
      : secondCandidates;
    if (paretoIndependentRings) {
      const retainedIdentities = new Set(
        [...optimizedFirst, ...optimizedSecond].map(({ equipment }) =>
          equipmentIdentity(equipment),
        ),
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
    slotCandidates.set(
      "ring",
      optimizedFirst.map((candidate) => ({
        ...candidate,
        equipment: {
          ...candidate.equipment,
          ringSlotIndex: 0,
          isUnique: candidate.gear.unique === true,
        },
      })),
    );
    slotCandidates.set(
      "ring2",
      optimizedSecond.map((candidate) => ({
        ...candidate,
        equipment: {
          ...candidate.equipment,
          ringSlotIndex: 1,
          isUnique: candidate.gear.unique === true,
        },
      })),
    );
    const outputSlotNames = [
      ...slots.filter((name) => name !== "rings"),
      "ring",
      "ring2",
    ];
    const results = outputSlotNames.map((name) => ({
      name,
      candidates:
        slotCandidates.get(name)?.map(({ equipment }) => equipment) ?? [],
    }));
    return {
      slots: results.sort(
        (left, right) => left.candidates.length - right.candidates.length,
      ),
      highestCandidateGearLevel,
    };
  }
  const firstCandidateIdentities = new Set(
    firstCandidates.map((candidate) => equipmentIdentity(candidate.equipment)),
  );
  const secondCandidateIdentities = new Set(
    secondCandidates.map((candidate) => equipmentIdentity(candidate.equipment)),
  );
  const symmetricRingSlots =
    !preserveRingOrder &&
    forcedRing === undefined &&
    forcedRing2 === undefined &&
    firstCandidateIdentities.size === secondCandidateIdentities.size &&
    [...firstCandidateIdentities].every((identity) =>
      secondCandidateIdentities.has(identity),
    );
  const estimatedRingPairs = firstCandidates.length * secondCandidates.length;
  if (estimatedRingPairs > 1_000_000) {
    throw new Error(
      `原始戒指候选预计产生 ${estimatedRingPairs} 个有序戒指对，超过候选内存保护线；未返回搜索结果`,
    );
  }
  const ringCandidates = [
    ...new Map(
      [...firstCandidates, ...secondCandidates].map((candidate) => [
        equipmentIdentity(candidate.equipment),
        candidate,
      ]),
    ).values(),
  ];
  const ringPairInfos = buildRingPairEquipInfos(
    ringCandidates.map(({ equipment }) => equipment),
    (itemId) => {
      return getGearById(itemId)?.unique === true;
    },
    symmetricRingSlots
      ? (left, right) => {
          const leftIdentity = equipmentIdentity(left);
          const rightIdentity = equipmentIdentity(right);
          return leftIdentity < rightIdentity
            ? -1
            : leftIdentity > rightIdentity
              ? 1
              : 0;
        }
      : undefined,
  ).filter((pair) => {
    const [first, second] = pair.ringEquips;
    if (forcedRing !== undefined && first.itemId !== forcedRing) return false;
    if (forcedRing2 !== undefined && second.itemId !== forcedRing2)
      return false;
    return (
      firstCandidateIdentities.has(equipmentIdentity(first)) &&
      secondCandidateIdentities.has(equipmentIdentity(second))
    );
  });
  const pairedCandidates = ringPairInfos.map(
    (equipment) => equipment as SolverGear,
  );
  // 从戒指对的完整嵌套身份派生其中的候选，以便结构化克隆后仍能稳定查找戒指身份。
  for (const pair of pairedCandidates) {
    const ringPair = pair.ringEquips;
    if (!ringPair) continue;
    for (const [ringInfo, slot] of [
      [ringPair[0], "ring"],
      [ringPair[1], "ring2"],
    ] as const) {
      const key = equipmentIdentity(ringInfo);
      const existing = gearsByIdentity.get(key);
      if (existing) gearsByIdentity.set(key, { ...existing, slot });
    }
  }
  slotCandidates.set(
    "rings",
    pairedCandidates.map((equipment) => ({
      equipment,
      gear: {} as MeldedGear,
    })),
  );

  for (const name of slots) {
    const candidates =
      slotCandidates.get(name)?.map(({ equipment }) => equipment) ?? [];
    results.push({ name, candidates });
  }
  return {
    slots: results.sort(
      (left, right) => left.candidates.length - right.candidates.length,
    ),
    highestCandidateGearLevel,
  };
}
