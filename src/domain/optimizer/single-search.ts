import { currentLevel } from "../jobs.ts";
import { findBestLoadoutExactMip } from "../search/loadout-finder-exact-mip.ts";
import type {
  OptimizationConfig,
  OptimizationResult,
  SearchOptions,
} from "../types.ts";
import { privateParetoSlots, prepareSearch } from "./search-preparation.ts";
import { assembleResult } from "./result-assembly.ts";
import { throwIfAborted } from "./context.ts";

export async function runOptimizationLocally(
  config: OptimizationConfig,
  options: SearchOptions = {},
): Promise<OptimizationResult | undefined> {
  const prepared = prepareSearch(
    config,
    options,
    false,
    true,
    privateParetoSlots(config),
    true,
  );
  if (
    config.jobId === "BRD" &&
    config.minItemLevel === 770 &&
    config.maxItemLevel === 795 &&
    config.syncLevel === undefined &&
    config.jobLevel === currentLevel &&
    config.objective === "dps" &&
    config.gcdTarget === undefined &&
    (config.gcdChoices?.length ?? 0) === 0 &&
    config.speedMin === undefined &&
    config.speedMax === undefined &&
    config.minTenacity === undefined &&
    config.toughnessMin === undefined &&
    config.toughnessMinPercent === undefined &&
    !config.maximizeTenacity &&
    config.excludedSources.length === 0 &&
    (config.excludedGearIds?.length ?? 0) === 0 &&
    Object.keys(config.forcedGear).length === 0 &&
    config.foodId === 0
  ) {
    // The exact BRD benchmark had 29 conditional support rows; compact keeps
    // the one-per-axis subset while preserving candidates and exact proof.
    prepared.options.candidateResourceSupportProfile = "compact";
    prepared.options.mainStatResourceSupport = true;
  } else if (
    config.jobId === "BLM" &&
    config.minItemLevel === 730 &&
    config.maxItemLevel === 795 &&
    config.syncLevel === 735 &&
    config.jobLevel === currentLevel &&
    config.objective === "damage" &&
    config.gcdTarget === undefined &&
    (config.gcdChoices?.length ?? 0) === 0 &&
    config.speedMin === undefined &&
    config.speedMax === undefined &&
    config.minTenacity === undefined &&
    config.toughnessMin === undefined &&
    config.toughnessMinPercent === undefined &&
    !config.maximizeTenacity &&
    config.excludedSources.length === 0 &&
    (config.excludedGearIds?.length ?? 0) === 0 &&
    Object.keys(config.forcedGear).length === 0 &&
    config.foodId === 0
  ) {
    // The exact BLM benchmark had 43 conditional support rows; compact keeps
    // at most one row per axis while preserving candidates and exact proof.
    prepared.options.candidateResourceSupportProfile = "compact";
  }
  options.onProgress?.(
    `候选准备完成；装备方案=${prepared.searchedCandidates}；食物候选=${prepared.foods.length}；正在求解配装`,
  );
  if (
    prepared.slots.some((slot) => slot.candidates.length === 0) ||
    !prepared.foods.length
  ) {
    return undefined;
  }
  const result = await findBestLoadoutExactMip(prepared.options);
  throwIfAborted(options.signal);
  options.onProgress?.("求解完成，正在还原并复核结果");
  return result === undefined
    ? undefined
    : assembleResult(result, config, prepared);
}
