import {
  concretizeGearStats,
  concretizeGearStatsWithAdditions,
} from "./rules.ts";
import type { Gear, JobId, JobSchema, OptimizationConfig, Stats } from "./types.ts";

const beastmasterItemSpecialBonuses = [11] as const;

/** Entry-point defaults currently enable the supported bonus only for Beastmaster. */
export function enabledItemSpecialBonusesForJob(jobId: JobId): number[] {
  return jobId === "BST" ? [...beastmasterItemSpecialBonuses] : [];
}

/** Ignore caller-provided settings until per-search configuration is exposed. */
export function withDomainItemSpecialBonusDefaults<T extends OptimizationConfig>(
  config: T,
): T {
  return {
    ...config,
    enabledItemSpecialBonuses: enabledItemSpecialBonusesForJob(config.jobId),
  };
}

/** Resolve raw stats and add enabled bonus contributions before sync or materia. */
export function gearStatsWithEnabledItemSpecialBonus(
  gear: Gear,
  job: JobSchema,
  enabledBonuses: readonly number[] = [],
): Stats {
  if (
    gear.itemSpecialBonus === undefined ||
    !enabledBonuses.includes(gear.itemSpecialBonus) ||
    gear.specialStats === undefined
  ) {
    return concretizeGearStats(gear.stats, job);
  }
  return concretizeGearStatsWithAdditions(gear.stats, gear.specialStats, job);
}
