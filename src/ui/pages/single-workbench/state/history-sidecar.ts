import type { OptimizationConfig, OptimizationResult } from "@/domain";
import {
  createSearchHistory,
  finishSearchHistory,
  replaceSearchHistoryResult,
  type SearchHistoryRecord,
  type FinishSearchHistoryInput,
} from "@/ui/services/search-history";

/** Each run owns its history promise, so late storage cannot attach to another run. */
export function startHistorySidecar(
  config: OptimizationConfig,
  dataVersion: string,
  startedAt: number,
  warn: (message: string) => void,
  onId: (id: string) => void,
) {
  const start = createSearchHistory({
    kind: "single",
    config,
    dataVersion,
    startedAtISO: new Date(startedAt).toISOString(),
  })
    .then((record) => {
      onId(record.id);
      return record;
    })
    .catch((error: unknown) => {
      warn(
        `搜索记录保存失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    });
  let lastRepresentation: OptimizationResult | undefined;
  let writes: Promise<unknown> = Promise.resolve();
  const warning = (error: unknown) =>
    warn(
      `搜索记录更新失败：${error instanceof Error ? error.message : String(error)}`,
    );
  const settle = (outcome: FinishSearchHistoryInput, settledAt: number) => {
    writes = start
      .then(
        (record) =>
          record &&
          finishSearchHistory(record.id, {
            ...outcome,
            ...(outcome.status === "completed"
              ? { result: lastRepresentation ?? outcome.result }
              : {}),
            finishedAtISO: new Date(settledAt).toISOString(),
          }),
      )
      .catch(warning);
  };
  const replace = (result: OptimizationResult) => {
    lastRepresentation = result;
    writes = writes
      .then(() => start)
      .then((record) => record && replaceSearchHistoryResult(record.id, result))
      .catch(warning);
  };
  return Object.assign(settle, { replace });
}
export function historyDuration(record: SearchHistoryRecord): number {
  return record.finishedAtISO
    ? Math.max(
        0,
        Date.parse(record.finishedAtISO) - Date.parse(record.startedAtISO),
      )
    : 0;
}
export type SingleRunOutcome = { result?: OptimizationResult; error?: unknown };
