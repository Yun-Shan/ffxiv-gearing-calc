import { gameData, getGearAtRecordIndex } from "./data.ts";
import { jobSchemas } from "./jobs.ts";
import { jobLevelFor } from "./job-level.ts";
import { isGearUsable } from "./rules.ts";
import type { Gear, GearSlot, OptimizationConfig } from "./types.ts";

const nonRingSlotOrder: GearSlot[] = [
  "weapon", "offhand", "head", "body", "hands", "legs", "feet", "earrings",
  "necklace", "bracelet",
];

export { jobLevelFor, calculationJobLevelFor } from "./job-level.ts";

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
      isGearUsable(gear, job, minItemLevel, maxItemLevel, config.excludedSources ?? [])
    ) candidates.push(gear);
  }
  return candidates;
}
