import { foods, gameData, materiaGradeRequiredLevels } from "./data.ts";
import {
  jobLevelFor,
  preferCandidateGearLevel,
  type HighestCandidateGearLevel,
} from "./gear-options.ts";
import { jobSchemas } from "./jobs.ts";
import {
  applyFood,
  capGearStatsAtLevel,
  calculateBaseStats,
  concretizeGearStats,
  effectiveGearSyncLevel,
  getGearStatCap,
  getSpeedStat,
} from "./rules.ts";
import {
  equippedEffects,
  equippedToughnessForMitigationPercent,
} from "./search/equipped-effects.ts";
import type {
  Gear,
  GearSlot,
  JobId,
  Materia,
  OptimizationConfig,
  SearchOptions,
  Stat,
  Stats,
} from "./types.ts";

interface GcdTierCalculatorDependencies {
  getJobLevel(
    config: OptimizationConfig,
    highestCandidate?: HighestCandidateGearLevel,
  ): number;
  gearOptionsFor(config: OptimizationConfig, slot: GearSlot): Gear[];
  slotsForJob(jobId: JobId): GearSlot[];
}

interface AssignmentState {
  highCount: number;
  lowCount: number;
  speed: number;
  tenacity: number;
}

type MeldCountOption = AssignmentState;

interface BestRingProfiles {
  itemId: number;
  tenacity: number;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = signal.reason instanceof Error
    ? signal.reason
    : new Error("搜索已取消");
  error.name = "AbortError";
  throw error;
}

function validateConfig(config: OptimizationConfig): void {
  if (
    !Number.isSafeInteger(config.minItemLevel) ||
    !Number.isSafeInteger(config.maxItemLevel) ||
    config.minItemLevel > config.maxItemLevel
  ) {
    throw new RangeError("装备品级范围无效");
  }
  if (
    config.syncLevel !== undefined &&
    (!Number.isSafeInteger(config.syncLevel) || config.syncLevel <= 0)
  ) {
    throw new RangeError("等级同步品级必须是正整数");
  }
}

function statCapAtLevel(gear: Gear, stat: Stat, level: number): number {
  return getGearStatCap(gear, stat, level);
}

function capLevelFor(gear: Gear, jobLevel: number, syncLevel?: number): number {
  return effectiveGearSyncLevel(gear, jobLevel, syncLevel) ?? gear.level;
}

function baseStatFor(
  gear: Gear,
  stat: Stat,
  level: number,
  isSynchronized = false,
): number {
  const value = gear.stats[stat];
  if (value === undefined) return 0;
  return !isSynchronized
    ? value
    : Math.min(value, statCapAtLevel(gear, stat, level));
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
    throw new Error("魔晶石 " + stat + " 缺少 " + grade + " 级数值");
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
      ? "装备品级 " + itemLevel + " 没有可用魔晶石等级"
      : "装备品级 " + itemLevel + " 没有限制孔可用的魔晶石等级",
  );
}

function customParameterMelds(gear: Gear): Materia[][] {
  const slots = gear.customParameters;
  if (!slots?.length) return [];
  if (slots.length !== 4) {
    throw new Error(
      "自定义参数武器 " + gear.id +
      " 的槽位数 " + slots.length +
      " 不是 4，无法按 2 big + 1 small + 1 空槽规则生成候选",
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

function addProfile(
  profiles: Map<number, number>,
  speed: number,
  tenacity: number,
): void {
  profiles.set(speed, Math.max(profiles.get(speed) ?? Number.NEGATIVE_INFINITY, tenacity));
}

function profilesForCustomParameters(
  gear: Gear,
  speedStat: "SKS" | "SPS",
  jobLevel: number,
  syncLevel?: number,
): Map<number, number> {
  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, syncLevel);
  const level = synchronizedLevel ?? gear.level;
  const baseSpeed = baseStatFor(gear, speedStat, level, synchronizedLevel !== undefined);
  const baseTenacity = baseStatFor(gear, "TEN", level, synchronizedLevel !== undefined);
  const profiles = new Map<number, number>();
  for (const melds of customParameterMelds(gear)) {
    let speed = baseSpeed;
    let tenacity = baseTenacity;
    for (const meld of melds) {
      if (meld.stat === speedStat) {
        speed = Math.min(
          statCapAtLevel(gear, speedStat, level),
          speed + meld.value,
        );
      } else if (meld.stat === "TEN") {
        tenacity = Math.min(
          statCapAtLevel(gear, "TEN", level),
          tenacity + meld.value,
        );
      }
    }
    addProfile(profiles, speed, tenacity);
  }
  return profiles;
}

function countOptionsForStat(
  gear: Gear,
  stat: Materia["stat"],
  speedStat: "SKS" | "SPS",
  tenacityStatEnabled: boolean,
  highValue: number,
  lowValue: number,
  highLimit: number,
  lowLimit: number,
): MeldCountOption[] {
  const cap = statCapAtLevel(gear, stat, gear.level);
  const baseValue = gear.stats[stat] ?? 0;
  const available = cap - baseValue;
  const options: MeldCountOption[] = [];
  for (let highCount = 0; highCount <= highLimit; highCount++) {
    for (let lowCount = 0; lowCount <= lowLimit; lowCount++) {
      const totalValue = highCount * highValue + lowCount * lowValue;
      const finalMeldValue = lowCount > 0 ? lowValue : highValue;
      if (
        totalValue > 0 &&
        (available <= 0 || totalValue - finalMeldValue >= available)
      ) {
        continue;
      }
      const addedValue = totalValue === 0
        ? 0
        : Math.min(cap, baseValue + totalValue) - baseValue;
      options.push({
        highCount,
        lowCount,
        speed: stat === speedStat ? addedValue : 0,
        tenacity: tenacityStatEnabled && stat === "TEN" ? addedValue : 0,
      });
    }
  }
  return options;
}

function assignmentKey(state: AssignmentState): string {
  return state.highCount + ":" + state.lowCount + ":" + state.speed + ":" + state.tenacity;
}

function profilesForRegularMateria(
  gear: Gear,
  jobId: JobId,
  speedStat: "SKS" | "SPS",
): Map<number, number> {
  const baseSpeed = gear.stats[speedStat] ?? 0;
  const baseTenacity = gear.stats.TEN ?? 0;
  const stats = materiaAttributeStats(jobId);
  const highGrade = highestMateriaGrade(gear.level, true);
  const highMateria = stats.map((stat) => materiaForGrade(stat, highGrade));
  const canOvermeld = gear.materiaAdvanced === true && gear.materiaSlots < 5;
  const lowLimit = canOvermeld ? Math.max(0, 4 - gear.materiaSlots) : 0;
  const highLimit = gear.materiaSlots + (canOvermeld ? 1 : 0);
  const lowMateria = lowLimit > 0
    ? stats.map((stat) => materiaForGrade(stat, highestMateriaGrade(gear.level, false)))
    : [];

  const optionsByStat = stats.map((stat, index) =>
    countOptionsForStat(
      gear,
      stat,
      speedStat,
      jobSchemas[jobId].stats.includes("TEN"),
      highMateria[index]!.value,
      lowMateria[index]?.value ?? 0,
      highLimit,
      lowLimit,
    ),
  );
  let states: AssignmentState[] = [{
    highCount: 0,
    lowCount: 0,
    speed: 0,
    tenacity: 0,
  }];
  for (const options of optionsByStat) {
    const next = new Map<string, AssignmentState>();
    for (const state of states) {
      for (const option of options) {
        const highCount = state.highCount + option.highCount;
        const lowCount = state.lowCount + option.lowCount;
        if (highCount > highLimit || lowCount > lowLimit) continue;
        const merged = {
          highCount,
          lowCount,
          speed: state.speed + option.speed,
          tenacity: state.tenacity + option.tenacity,
        };
        next.set(assignmentKey(merged), merged);
      }
    }
    states = [...next.values()];
  }

  const profiles = new Map<number, number>();
  for (const state of states) {
    if (state.highCount !== highLimit || state.lowCount !== lowLimit) continue;
    addProfile(
      profiles,
      baseSpeed + state.speed,
      baseTenacity + state.tenacity,
    );
  }
  return profiles;
}

function gearProfiles(
  gear: Gear,
  config: OptimizationConfig,
  jobId: JobId,
  speedStat: "SKS" | "SPS",
): Map<number, number> {
  const resolvedGear: Gear = {
    ...gear,
    stats: concretizeGearStats(gear.stats, jobSchemas[jobId]),
  };
  const jobLevel = jobLevelFor(config);
  if (resolvedGear.customParameters?.length) {
    return profilesForCustomParameters(
      resolvedGear,
      speedStat,
      jobLevel,
      config.syncLevel,
    );
  }
  const syncApplies =
    effectiveGearSyncLevel(resolvedGear, jobLevel, config.syncLevel) !== undefined;
  if (syncApplies || (resolvedGear.materiaSlots === 0 && resolvedGear.materiaAdvanced !== true)) {
    const level = capLevelFor(resolvedGear, jobLevel, config.syncLevel);
    const stats = syncApplies
      ? capGearStatsAtLevel(resolvedGear, resolvedGear.stats, level)
      : resolvedGear.stats;
    const profiles = new Map<number, number>();
    addProfile(
      profiles,
      stats[speedStat] ?? 0,
      stats.TEN ?? 0,
    );
    return profiles;
  }
  return profilesForRegularMateria(resolvedGear, jobId, speedStat);
}

function slotProfiles(
  gears: readonly Gear[],
  profilesForGear: (gear: Gear) => Map<number, number>,
  signal?: AbortSignal,
): Map<number, number> {
  const profiles = new Map<number, number>();
  for (let index = 0; index < gears.length; index++) {
    abortIfNeeded(signal);
    const gear = gears[index]!;
    for (const [speed, tenacity] of profilesForGear(gear)) {
      addProfile(profiles, speed, tenacity);
    }
  }
  return profiles;
}

function updateBestRingProfiles(
  profilesBySpeed: Map<number, BestRingProfiles[]>,
  speed: number,
  candidate: BestRingProfiles,
): void {
  const top = profilesBySpeed.get(speed) ?? [];
  const existingIndex = top.findIndex((profile) => profile.itemId === candidate.itemId);
  if (existingIndex >= 0) {
    if (candidate.tenacity > top[existingIndex]!.tenacity) {
      top[existingIndex] = candidate;
    }
  } else {
    top.push(candidate);
  }
  top.sort((left, right) => right.tenacity - left.tenacity);
  if (top.length > 2) top.length = 2;
  profilesBySpeed.set(speed, top);
}

function ringPairProfiles(
  firstCandidates: readonly Gear[],
  secondCandidates: readonly Gear[],
  profilesForGear: (gear: Gear) => Map<number, number>,
  signal?: AbortSignal,
): Map<number, number> {
  if (firstCandidates.length === 0 || secondCandidates.length === 0) return new Map();

  const secondBySpeed = new Map<number, BestRingProfiles[]>();
  for (let index = 0; index < secondCandidates.length; index++) {
    abortIfNeeded(signal);
    const gear = secondCandidates[index]!;
    for (const [speed, tenacity] of profilesForGear(gear)) {
      updateBestRingProfiles(secondBySpeed, speed, { itemId: gear.id, tenacity });
    }
  }

  const pairs = new Map<number, number>();
  for (let index = 0; index < firstCandidates.length; index++) {
    abortIfNeeded(signal);
    const gear = firstCandidates[index]!;
    const firstProfiles = profilesForGear(gear);
    for (const [firstSpeed, firstTenacity] of firstProfiles) {
      for (const [secondSpeed, ranked] of secondBySpeed) {
        const second = gear.unique === true && ranked[0]?.itemId === gear.id
          ? ranked[1]
          : ranked[0];
        if (!second) continue;
        addProfile(
          pairs,
          firstSpeed + secondSpeed,
          firstTenacity + second.tenacity,
        );
      }
    }
  }
  return pairs;
}

function foodStatsForJob(foodId: number, jobId: JobId) {
  const selected = foodId !== 0
    ? foods.filter((food) => food.id === foodId)
    : foods.filter((food) => food.best === true && (food.stats.VIT ?? 0) > 0);
  const allowed = new Set(jobSchemas[jobId].stats);
  return selected.map((food) => {
    const filter = (stats: Stats): Stats => Object.fromEntries(
      Object.entries(stats).filter(
        ([stat, value]) => allowed.has(stat as Stat) && value !== undefined,
      ),
    ) as Stats;
    return {
      stats: filter(food.stats),
      statRates: filter(food.statRates),
    };
  });
}

export function calculateFeasibleGcdTiers(
  config: OptimizationConfig,
  options: SearchOptions,
  dependencies: GcdTierCalculatorDependencies,
): number[] {
  abortIfNeeded(options.signal);
  validateConfig(config);
  const job = jobSchemas[config.jobId];
  const speedStat = getSpeedStat(job);
  const allSlots = dependencies.slotsForJob(config.jobId);
  const nonRingSlots = allSlots.filter((slot) => slot !== "ring" && slot !== "ring2");
  const candidatePools = new Map<GearSlot, Gear[]>();
  let highestCandidateGearLevel: HighestCandidateGearLevel | undefined;
  const eligiblePoolForSlot = (slot: GearSlot, pool: Gear[]): Gear[] => {
    const forcedId = config.forcedGear[slot];
    const eligible = forcedId === undefined
      ? pool
      : pool.filter((gear) => gear.id === forcedId);
    for (const gear of eligible) {
      highestCandidateGearLevel = preferCandidateGearLevel(
        highestCandidateGearLevel,
        gear,
      );
    }
    candidatePools.set(slot, eligible);
    return eligible;
  };
  for (const slot of nonRingSlots) {
    abortIfNeeded(options.signal);
    eligiblePoolForSlot(slot, dependencies.gearOptionsFor(config, slot));
  }
  const ringPool = dependencies.gearOptionsFor(config, "ring");
  const firstRingCandidates = eligiblePoolForSlot("ring", ringPool);
  const secondRingCandidates = eligiblePoolForSlot("ring2", ringPool);
  const jobLevel = dependencies.getJobLevel(config, highestCandidateGearLevel);
  const usesTenacity =
    config.minTenacity !== undefined ||
    config.toughnessMin !== undefined ||
    config.toughnessMinPercent !== undefined ||
    config.maximizeTenacity;
  if (usesTenacity && !job.stats.includes("TEN")) {
    throw new RangeError("职业 " + config.jobId + " 不使用坚韧属性");
  }

  const baseStats = calculateBaseStats(job, jobLevel);
  const baseSpeed = baseStats[speedStat] ?? 0;
  const baseTenacity = baseStats.TEN ?? 0;
  const minimumTenacity = Math.max(
    Math.max(0, (config.minTenacity ?? config.toughnessMin ?? 0) - baseTenacity),
    config.toughnessMinPercent === undefined
      ? 0
      : equippedToughnessForMitigationPercent(
          config.jobId,
          jobLevel,
          config.toughnessMinPercent,
        ),
  );
  const selectedFoods = foodStatsForJob(config.foodId, config.jobId);
  if (selectedFoods.length === 0) return [];

  options.onProgress?.("正在按装备二进制索引准备 GCD 候选");

  const profilesByGearId = new Map<number, Map<number, number>>();
  const profilesForGear = (gear: Gear): Map<number, number> => {
    let profiles = profilesByGearId.get(gear.id);
    if (profiles === undefined) {
      profiles = gearProfiles(gear, config, config.jobId, speedStat);
      profilesByGearId.set(gear.id, profiles);
    }
    return profiles;
  };

  const candidates: { name: string; profiles: Map<number, number> }[] = [];
  for (const slot of nonRingSlots) {
    abortIfNeeded(options.signal);
    candidates.push({
      name: slot,
      profiles: slotProfiles(
        candidatePools.get(slot) ?? [],
        profilesForGear,
        options.signal,
      ),
    });
  }

  candidates.push({
    name: "rings",
    profiles: ringPairProfiles(
      firstRingCandidates,
      secondRingCandidates,
      profilesForGear,
      options.signal,
    ),
  });
  if (candidates.some((slot) => slot.profiles.size === 0)) return [];
  candidates.sort((left, right) => left.profiles.size - right.profiles.size);

  let states = new Map<number, number>([[0, 0]]);
  for (let slotIndex = 0; slotIndex < candidates.length; slotIndex++) {
    abortIfNeeded(options.signal);
    const slot = candidates[slotIndex]!;
    const next = new Map<number, number>();
    for (const [speed, tenacity] of states) {
      for (const [slotSpeed, slotTenacity] of slot.profiles) {
        const totalSpeed = speed + slotSpeed;
        const totalTenacity = tenacity + slotTenacity;
        next.set(
          totalSpeed,
          Math.max(next.get(totalSpeed) ?? Number.NEGATIVE_INFINITY, totalTenacity),
        );
      }
    }
    states = next;
    if (states.size === 0) return [];
    options.onProgress?.(
      "GCD速度与坚韧状态：" + (slotIndex + 1) + "/" + candidates.length,
    );
  }

  const finalStates = new Map<number, number>();
  for (const [speedContribution, tenacityContribution] of states) {
    for (const food of selectedFoods) {
      const totalStats = applyFood(
        {
          ...baseStats,
          [speedStat]: baseSpeed + speedContribution,
          TEN: baseTenacity + tenacityContribution,
        },
        food.stats,
        food.statRates,
      );
      const effectiveSpeed =
        (totalStats[speedStat] ?? 0) - baseSpeed;
      const effectiveTenacity =
        (totalStats.TEN ?? 0) - baseTenacity;
      if (config.speedMin !== undefined && (totalStats[speedStat] ?? 0) < config.speedMin) continue;
      if (config.speedMax !== undefined && (totalStats[speedStat] ?? 0) > config.speedMax) continue;
      if (effectiveTenacity < minimumTenacity) continue;
      finalStates.set(
        effectiveSpeed,
        Math.max(finalStates.get(effectiveSpeed) ?? Number.NEGATIVE_INFINITY, effectiveTenacity),
      );
    }
    abortIfNeeded(options.signal);
  }

  const maximumTenacity = config.maximizeTenacity && job.role === "tank"
    ? Math.max(Number.NEGATIVE_INFINITY, ...finalStates.values())
    : undefined;
  const gcds = new Set<number>();
  for (const [speedContribution, tenacity] of finalStates) {
    if (maximumTenacity !== undefined && tenacity !== maximumTenacity) continue;
    const effects = equippedEffects(config.jobId, jobLevel, {
      [speedStat]: speedContribution,
    });
    if (effects !== undefined) gcds.add(effects.gcd);
  }
  return [...gcds].sort((left, right) => right - left);
}

