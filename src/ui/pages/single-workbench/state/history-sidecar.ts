import type { OptimizationResult } from "@/domain";
import type { UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";
import {
  saveCompletedSearchHistory,
} from "@/ui/services/search-history";

/** Each run owns its history promise, so late storage cannot attach to another run. */
export function startHistorySidecar(
  config: OptimizationConfig,
  dataVersion: string,
  startedAt: number,
  warn: (message: string) => void,
) {
  const warning = (error: unknown) =>
    warn(
      `搜索记录保存失败：${error instanceof Error ? error.message : String(error)}`,
    );
  const settle = (result: OptimizationResult) => {
    return saveCompletedSearchHistory({
      kind: "single",
      config,
      dataVersion,
      startedAtISO: new Date(startedAt).toISOString(),
      result,
    }).catch((error: unknown) => {
      warning(error);
      return undefined;
    });
  };
  return settle;
}
