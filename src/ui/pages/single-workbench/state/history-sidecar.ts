import type { OptimizationConfig, OptimizationResult } from "@/domain";
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
  const settle = (result: OptimizationResult, settledAt: number) => {
    saved = saveCompletedSearchHistory({
      kind: "single",
      config,
      dataVersion,
      startedAtISO: new Date(startedAt).toISOString(),
      finishedAtISO: new Date(settledAt).toISOString(),
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
export function historyDuration(record: SearchHistoryRecord): number {
  return Math.max(
    0,
    Date.parse(record.finishedAtISO) - Date.parse(record.startedAtISO),
  );
}
export type SingleRunOutcome = { result?: OptimizationResult; error?: unknown };
