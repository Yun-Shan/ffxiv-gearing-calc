import type { OptimizationResult } from "@/domain";
import type { UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";
import {
  saveCompletedSearchHistory,
  replaceSearchHistoryResult,
  type SearchHistoryRecord,
} from "@/ui/services/search-history";

/** Each run owns its history promise, so late storage cannot attach to another run. */
export function startHistorySidecar(
  config: OptimizationConfig,
  dataVersion: string,
  startedAt: number,
  warn: (message: string) => void,
  onId: (id: string) => void,
) {
  let saved: Promise<SearchHistoryRecord | undefined> =
    Promise.resolve(undefined);
  let writes: Promise<unknown> = Promise.resolve();
  const warning = (error: unknown) =>
    warn(
      `搜索记录保存失败：${error instanceof Error ? error.message : String(error)}`,
    );
  const settle = (result: OptimizationResult) => {
    saved = saveCompletedSearchHistory({
      kind: "single",
      config,
      dataVersion,
      startedAtISO: new Date(startedAt).toISOString(),
      result,
    })
      .then((record) => {
        onId(record.id);
        return record;
      })
      .catch((error: unknown) => {
        warning(error);
        return undefined;
      });
    writes = saved;
  };
  const replace = (result: OptimizationResult) => {
    writes = writes
      .then(() => saved)
      .then((record) => record && replaceSearchHistoryResult(record.id, result))
      .catch(warning);
  };
  return Object.assign(settle, { replace });
}
export type SingleRunOutcome = { result?: OptimizationResult; error?: unknown };
