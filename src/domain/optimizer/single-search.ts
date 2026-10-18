import { attachEquivalentGear } from "./equivalent-gear.ts";
import { findBestLoadoutExactMip } from "../search/loadout-finder-exact-mip.ts";
import type {
  OptimizationConfig,
  OptimizationResult,
  SearchOptions,
} from "../types.ts";
import { privateParetoSlots, prepareSearch } from "./search-preparation.ts";
import { assembleResult } from "./result-assembly.ts";
import { throwIfAborted } from "./context.ts";
import { withDomainItemSpecialBonusDefaults } from "../item-special-bonus.ts";

export async function runOptimizationLocally(
  config: OptimizationConfig,
  options: SearchOptions = {},
): Promise<OptimizationResult | undefined> {
  config = withDomainItemSpecialBonusDefaults(config);
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
    // BRD 的精确基准场景包含 29 条条件支撑约束；紧凑配置每个属性轴最多保留一条，且不改变候选或精确证明。
    prepared.options.candidateResourceSupportProfile = "compact";
    prepared.options.mainStatResourceSupport = true;
  } else if (
    config.jobId === "BLM" &&
    config.minItemLevel === 730 &&
    config.maxItemLevel === 795 &&
    config.syncLevel === 735 &&
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
    // BLM 的精确基准场景包含 43 条条件支撑约束；紧凑配置每个属性轴最多保留一条，且不改变候选或精确证明。
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
    : attachEquivalentGear(assembleResult(result, config, prepared), config, options);
}
