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
import { normalizeOptimizationConfig } from "../config-validation.ts";

export async function runOptimizationLocally(
  input: OptimizationConfig,
  options: SearchOptions = {},
): Promise<OptimizationResult | undefined> {
  const startedAt = performance.now();
  const config = normalizeOptimizationConfig(input);
  const prepared = prepareSearch(
    config,
    options,
    false,
    true,
    privateParetoSlots(config),
    true,
  );
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
  if (result === undefined) return undefined;
  const completed = attachEquivalentGear(assembleResult(result, config, prepared), config, options);
  completed.statistics.elapsedMs = performance.now() - startedAt;
  return completed;
}
