import { gameData, getGearAtRecordIndex } from "./data.ts";
import { currentLevel, jobSchemas } from "./jobs.ts";
import { isGearUsable } from "./rules.ts";
import type { Gear, GearSlot, OptimizationConfig } from "./types.ts";

const nonRingSlotOrder: GearSlot[] = [
  "weapon", "offhand", "head", "body", "hands", "legs", "feet", "earrings",
  "necklace", "bracelet",
];

export function jobLevelFor(config: OptimizationConfig): number {
  const schema = jobSchemas[config.jobId];
  if (schema === undefined) throw new RangeError(`缺少职业 ${config.jobId} 的领域规则`);
  const maxJobLevel = schema.maxJobLevel ?? currentLevel;
  const level = config.jobLevel ?? Math.min(currentLevel, maxJobLevel);
  if (!Number.isSafeInteger(level) || level > maxJobLevel || !Object.hasOwn(gameData.jobLevelModifiers, level)) {
    throw new RangeError(`不支持的职业等级：${level}`);
  }
  return level;
}

export type CandidateGearLevel = Pick<Gear, "level" | "equipLevel">;

export interface HighestCandidateGearLevel {
  itemLevel: number;
  equipLevel: number;
}

/** Keeps the highest item-level candidate, using equip level as a stable tie-breaker. */
export function preferCandidateGearLevel(
  current: HighestCandidateGearLevel | undefined,
  candidate: CandidateGearLevel,
): HighestCandidateGearLevel | undefined {
  // Items whose game-data equip level is 1 are treated as available at every
  // level and must not lower or raise the formula baseline.
  if (candidate.equipLevel === 1) return current;
  return current === undefined ||
    candidate.level > current.itemLevel ||
    (candidate.level === current.itemLevel && candidate.equipLevel > current.equipLevel)
    ? { itemLevel: candidate.level, equipLevel: candidate.equipLevel }
    : current;
}

/**
 * Resolves the formula level independently from the configured level used to
 * decide whether equipment can be worn.
 */
export function calculationJobLevelFor(
  config: OptimizationConfig,
  highestCandidate?: HighestCandidateGearLevel,
): number {
  const wearableLevel = jobLevelFor(config);
  let level: number;

  if (config.syncLevel !== undefined) {
    const syncGroup = Object.entries(gameData.syncLevels).find(([, levels]) =>
      levels.includes(config.syncLevel!),
    );
    const exactMatch = Object.entries(gameData.syncLevelOfJobLevels).find(
      ([, syncLevel]) => syncLevel === config.syncLevel,
    );
    const mappedLevel = syncGroup?.[0] ?? exactMatch?.[0];
    if (mappedLevel === undefined) {
      throw new RangeError(`不支持的等级同步品级：${config.syncLevel}`);
    }
    level = Number(mappedLevel);
  } else if (highestCandidate !== undefined) {
    // Game data has formula modifiers by ten-level breakpoints. Lower to the
    // containing breakpoint; values below the lowest supported breakpoint fail below.
    level = Math.floor(highestCandidate.equipLevel / 10) * 10;
  } else {
    // With no eligible gear the optimizer will return no result; this keeps that
    // path non-throwing while avoiding a fabricated level for any computed result.
    return wearableLevel;
  }

  const schema = jobSchemas[config.jobId];
  const maxJobLevel = schema.maxJobLevel ?? currentLevel;
  if (
    !Number.isSafeInteger(level) ||
    level > maxJobLevel ||
    !Object.hasOwn(gameData.jobLevelModifiers, level)
  ) {
    throw new RangeError(`不支持的职业等级：${level}`);
  }
  return level;
}

export function slotsForJob(jobId: OptimizationConfig["jobId"]): GearSlot[] {
  return [
    ...nonRingSlotOrder.filter((slot) => slot !== "offhand" || jobId === "PLD" || jobId === "BST"),
    "ring",
    "ring2",
  ];
}

export function gearOptionsFor(config: OptimizationConfig, slot: GearSlot): Gear[] {
  const actualSlot = slot === "ring2" ? "ring" : slot;
  const job = jobSchemas[config.jobId];
  const characterLevel = jobLevelFor(config);
  const excluded = new Set(config.excludedGearIds ?? []);
  const candidateIndexes = gameData.gearIndexesByMainStat[job.mainStat];
  const ignoreWeaponItemLevel = actualSlot === "weapon" && job.ignoreWeaponItemLevel;
  const minItemLevel = ignoreWeaponItemLevel ? 0 : config.minItemLevel;
  const maxItemLevel = ignoreWeaponItemLevel ? Number.POSITIVE_INFINITY : config.maxItemLevel;
  let lower = 0;
  let upper = candidateIndexes.length;
  if (!ignoreWeaponItemLevel) {
    let left = 0;
    let right = candidateIndexes.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      const level = gameData.gearLevelByRecordIndex[candidateIndexes[middle]!]!;
      if (level < minItemLevel) left = middle + 1;
      else right = middle;
    }
    lower = left;
    left = lower;
    right = candidateIndexes.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      const level = gameData.gearLevelByRecordIndex[candidateIndexes[middle]!]!;
      if (level <= maxItemLevel) left = middle + 1;
      else right = middle;
    }
    upper = left;
  }

  const candidates: Gear[] = [];
  for (let offset = lower; offset < upper; offset++) {
    const gear = getGearAtRecordIndex(candidateIndexes[offset]!);
    if (
      gear.slot === actualSlot &&
      gear.equipLevel <= characterLevel &&
      !excluded.has(gear.id) &&
      isGearUsable(gear, job, minItemLevel, maxItemLevel, config.excludedSources)
    ) candidates.push(gear);
  }
  return candidates;
}
