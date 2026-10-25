import { foods, gameData, searchFoods } from "./data.ts";
import { assertOptimizationConfig } from "./config-validation.ts";
import { enabledItemSpecialBonusesForJob, itemSpecialBonusAdditions } from "./item-special-bonus.ts";
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
  SyncTarget,
} from "./types.ts";
import { assertForcedGearValue, forcedGearId } from "./types.ts";
import {
  makeGearCandidates,
  materiaAttributeStats,
  materiaForGrade,
  highestMateriaGrade,
} from "./optimizer/equipment-candidates.ts";
import { customParameterMelds } from "./custom-gear-parameters.ts";
import type { MeldedGear, ForcedGearValue } from "./types.ts";

interface GcdTierCalculatorDependencies {
  getJobLevel(config: OptimizationConfig): number;
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

/** 面向用户的槽位名称；两枚戒指共用一个候选池，错误信息中合并显示。 */
const gcdSlotLabels: Record<GearSlot, string> = {
  weapon: "武器",
  offhand: "盾牌",
  head: "头部",
  body: "身体",
  hands: "手部",
  legs: "腿部",
  feet: "脚部",
  earrings: "耳饰",
  necklace: "项链",
  bracelet: "手镯",
  ring: "戒指",
  ring2: "戒指",
};

function gcdSlotLabel(slot: GearSlot): string {
  return gcdSlotLabels[slot];
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
  assertOptimizationConfig(config);
}

function forcedGearSignature(value: ForcedGearValue | undefined): string {
  if (value === undefined) return "unforced";
  if (typeof value === "number") return JSON.stringify(["id", value]);
  if ("melds" in value) {
    return JSON.stringify([
      value.id,
      "melds",
      value.melds.map((meld) => meld === null
        ? null
        : Object.entries(meld).sort(([left], [right]) => left.localeCompare(right))),
    ]);
  }
  return JSON.stringify([
    value.id,
    "customStats",
    Object.entries(value.customStats).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}

function profileForCandidateStats(
  gears: readonly MeldedGear[],
  speedStat: "SKS" | "SPS",
): Map<number, number> {
  const profiles = new Map<number, number>();
  for (const gear of gears) {
    addProfile(
      profiles,
      gear.finalStats[speedStat] ?? 0,
      gear.finalStats.TEN ?? 0,
    );
  }
  return profiles;
}

function statCapAtLevel(gear: Gear, stat: Stat, level: number): number {
  return getGearStatCap(gear, stat, level);
}

function capLevelFor(gear: Gear, jobLevel: number, sync?: SyncTarget): number {
  return effectiveGearSyncLevel(gear, jobLevel, sync) ?? gear.level;
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
  sync?: SyncTarget,
): Map<number, number> {
  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, sync);
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

function profilesForResistanceWeapon(
  gear: Gear,
  speedStat: "SKS" | "SPS",
  jobLevel: number,
  sync?: SyncTarget,
): Map<number, number> {
  const adjustment = gear.resistanceWeaponAdjust!;
  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, sync);
  const level = synchronizedLevel ?? gear.level;
  const baseSpeed = baseStatFor(gear, speedStat, level, synchronizedLevel !== undefined);
  const baseTenacity = baseStatFor(gear, "TEN", level, synchronizedLevel !== undefined);
  const eligibleSpeed = adjustment.stats.includes(speedStat);
  const eligibleTenacity = adjustment.stats.includes("TEN");
  const speedMaximum = eligibleSpeed
    ? Math.min(
      adjustment.maxEachStat,
      adjustment.maxTotalStats,
      synchronizedLevel === undefined
        ? adjustment.maxEachStat
        : Math.max(0, statCapAtLevel(gear, speedStat, level) - baseSpeed),
    )
    : 0;
  const tenacityMaximum = eligibleTenacity
    ? Math.min(
      adjustment.maxEachStat,
      synchronizedLevel === undefined
        ? adjustment.maxEachStat
        : Math.max(0, statCapAtLevel(gear, "TEN", level) - baseTenacity),
    )
    : 0;
  const profiles = new Map<number, number>();
  for (let speedAllocation = 0; speedAllocation <= speedMaximum; speedAllocation++) {
    const tenacityAllocation = Math.min(
      tenacityMaximum,
      adjustment.maxTotalStats - speedAllocation,
    );
    addProfile(profiles, baseSpeed + speedAllocation, baseTenacity + tenacityAllocation);
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

function addBonusToProfiles(
  profiles: Map<number, number>,
  additions: Stats,
  speedStat: "SKS" | "SPS",
): Map<number, number> {
  const speedBonus = additions[speedStat] ?? 0;
  const tenacityBonus = additions.TEN ?? 0;
  if (speedBonus === 0 && tenacityBonus === 0) return profiles;
  // 参考实现在同步封顶与镶嵌封顶之后追加特殊加成，因此这里不再封顶。
  const result = new Map<number, number>();
  for (const [speed, tenacity] of profiles) {
    const nextSpeed = speed + speedBonus;
    result.set(
      nextSpeed,
      Math.max(result.get(nextSpeed) ?? Number.NEGATIVE_INFINITY, tenacity + tenacityBonus),
    );
  }
  return result;
}

function gearProfiles(
  gear: Gear,
  config: OptimizationConfig,
  jobId: JobId,
  speedStat: "SKS" | "SPS",
  jobLevel: number,
): Map<number, number> {
  const job = jobSchemas[jobId];
  const resolvedGear: Gear = {
    ...gear,
    stats: concretizeGearStats(gear.stats, job),
  };
  let profiles: Map<number, number>;
  if (resolvedGear.resistanceWeaponAdjust !== undefined) {
    profiles = profilesForResistanceWeapon(
      resolvedGear,
      speedStat,
      jobLevel,
      config.sync,
    );
  } else if (resolvedGear.customParameters?.length) {
    profiles = profilesForCustomParameters(
      resolvedGear,
      speedStat,
      jobLevel,
      config.sync,
    );
  } else {
    const syncApplies =
      effectiveGearSyncLevel(resolvedGear, jobLevel, config.sync) !== undefined;
    if (syncApplies || (resolvedGear.materiaSlots === 0 && resolvedGear.materiaAdvanced !== true)) {
      const level = capLevelFor(resolvedGear, jobLevel, config.sync);
      const stats = syncApplies
        ? capGearStatsAtLevel(resolvedGear, resolvedGear.stats, level)
        : resolvedGear.stats;
      profiles = new Map<number, number>();
      addProfile(
        profiles,
        stats[speedStat] ?? 0,
        stats.TEN ?? 0,
      );
    } else {
      profiles = profilesForRegularMateria(resolvedGear, jobId, speedStat);
    }
  }
  return addBonusToProfiles(
    profiles,
    itemSpecialBonusAdditions(
      resolvedGear,
      job,
      enabledItemSpecialBonusesForJob(config.jobId),
    ),
    speedStat,
  );
}

function slotProfiles(
  gears: readonly Gear[],
  slot: GearSlot,
  profilesForGear: (gear: Gear, slot: GearSlot) => Map<number, number>,
  signal?: AbortSignal,
): Map<number, number> {
  const profiles = new Map<number, number>();
  for (let index = 0; index < gears.length; index++) {
    abortIfNeeded(signal);
    const gear = gears[index]!;
    for (const [speed, tenacity] of profilesForGear(gear, slot)) {
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
  profilesForGear: (gear: Gear, slot: GearSlot) => Map<number, number>,
  signal?: AbortSignal,
): Map<number, number> {
  if (firstCandidates.length === 0 || secondCandidates.length === 0) return new Map();

  const secondBySpeed = new Map<number, BestRingProfiles[]>();
  for (let index = 0; index < secondCandidates.length; index++) {
    abortIfNeeded(signal);
    const gear = secondCandidates[index]!;
    for (const [speed, tenacity] of profilesForGear(gear, "ring2")) {
      updateBestRingProfiles(secondBySpeed, speed, { itemId: gear.id, tenacity });
    }
  }

  const pairs = new Map<number, number>();
  for (let index = 0; index < firstCandidates.length; index++) {
    abortIfNeeded(signal);
    const gear = firstCandidates[index]!;
    const firstProfiles = profilesForGear(gear, "ring");
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
    : searchFoods.filter((food) => food.best === true && (food.stats.VIT ?? 0) > 0);
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
  const jobLevel = dependencies.getJobLevel(config);
  const job = jobSchemas[config.jobId];
  const speedStat = getSpeedStat(job);
  const allSlots = dependencies.slotsForJob(config.jobId);
  const nonRingSlots = allSlots.filter((slot) => slot !== "ring" && slot !== "ring2");
  const candidatePools = new Map<GearSlot, Gear[]>();
  const emptySlots: GearSlot[] = [];
  const eligiblePoolForSlot = (slot: GearSlot, pool: Gear[]): Gear[] => {
    const forcedValue: unknown = config.forcedGear?.[slot];
    try {
      assertForcedGearValue(forcedValue);
    } catch (error) {
      throw new TypeError(
        `槽位 ${slot} 的强制装备配置无效：${(error as Error).message}`,
      );
    }
    const forcedId = forcedGearId(forcedValue);
    const eligible = forcedId === undefined
      ? pool
      : pool.filter((gear) => gear.id === forcedId);
    if (eligible.length === 0) emptySlots.push(slot);
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
  if (emptySlots.length > 0) {
    const labels = [...new Set(emptySlots.map((slot) => gcdSlotLabel(slot)))];
    throw new RangeError(
      `以下槽位没有可用候选装备：${labels.join("、")}。请调整装备品级范围或装备限制条件。`,
    );
  }
  const usesTenacity =
    config.minTenacity !== undefined ||
    config.toughnessMinPercent !== undefined ||
    config.maximizeTenacity;
  if (usesTenacity && !job.stats.includes("TEN")) {
    throw new RangeError("职业 " + config.jobId + " 不使用坚韧属性");
  }

  const clanIndex = config.clanIndex;
  const baseStats = calculateBaseStats(job, jobLevel, clanIndex);
  const baseSpeed = baseStats[speedStat] ?? 0;
  const baseTenacity = baseStats.TEN ?? 0;
  const minimumTenacity = Math.max(
    Math.max(0, (config.minTenacity ?? 0) - baseTenacity),
    config.toughnessMinPercent === undefined
      ? 0
      : equippedToughnessForMitigationPercent(
          config.jobId,
          jobLevel,
          config.toughnessMinPercent,
          clanIndex,
        ),
  );
  const selectedFoods = foodStatsForJob(config.foodId, config.jobId);
  if (selectedFoods.length === 0) return [];

  options.onProgress?.("正在按装备二进制索引准备 GCD 候选");

  const profilesByGearSlotAndRestriction = new Map<string, Map<number, number>>();
  const profilesForGear = (gear: Gear, slot: GearSlot): Map<number, number> => {
    const forcedValue = config.forcedGear?.[slot];
    const cacheKey = JSON.stringify([
      gear.id,
      slot,
      forcedGearSignature(forcedValue),
    ]);
    let profiles = profilesByGearSlotAndRestriction.get(cacheKey);
    if (profiles === undefined) {
      if (forcedValue !== undefined && typeof forcedValue !== "number") {
        const candidateMap = new Map<string, MeldedGear>();
        const candidates = makeGearCandidates(gear, slot, config, candidateMap);
        profiles = profileForCandidateStats(
          candidates.map(({ gear: candidateGear }) => candidateGear),
          speedStat,
        );
      } else {
        profiles = gearProfiles(
          gear,
          config,
          config.jobId,
          speedStat,
          jobLevel,
        );
      }
      profilesByGearSlotAndRestriction.set(cacheKey, profiles);
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
        slot,
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
    }, clanIndex);
    if (effects !== undefined) gcds.add(effects.gcd);
  }
  return [...gcds].sort((left, right) => right - left);
}

