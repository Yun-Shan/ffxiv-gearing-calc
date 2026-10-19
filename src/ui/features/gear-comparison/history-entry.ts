import {
  jobSchemas,
  type JobId,
  type OptimizationConfig,
  type OptimizationResult,
} from "@/domain";
import type { SearchHistoryRecord } from "@/ui/services/search-history";
import type { ComparisonEntry, GearsetResultSnapshot } from "./types";
import { createComparisonEntryId } from "./types";

export interface HistoryComparisonOption {
  historyId: string;
  label: string;
  record: SearchHistoryRecord;
}

interface MatchingHistoryResult {
  result: OptimizationResult;
  config: OptimizationConfig;
}

function matchingHistoryResult(
  record: SearchHistoryRecord,
  jobId: JobId,
): MatchingHistoryResult | undefined {
  if (record.kind === "single") {
    if (record.config.jobId !== jobId) return undefined;
    return { result: record.result, config: record.config };
  }

  const config = record.config.jobs.find((job) => job.jobId === jobId);
  const result = record.result.jobResults[jobId];
  if (!config || !result) return undefined;
  return { result, config };
}

function hasSnapshotLevel(result: OptimizationResult): boolean {
  return (
    typeof result.calculationLevel === "number" &&
    Number.isFinite(result.calculationLevel)
  );
}

export function historyComparisonOptions(
  records: readonly SearchHistoryRecord[],
  jobId: JobId,
): HistoryComparisonOption[] {
  return records.flatMap((record) => {
    const match = matchingHistoryResult(record, jobId);
    if (!match || !hasSnapshotLevel(match.result)) return [];
    const mode = record.kind === "single" ? "单职业" : "联合结果";
    const started = new Date(record.startedAtISO);
    const date = Number.isFinite(started.getTime())
      ? started.toLocaleString("zh-CN", {
          dateStyle: "short",
          timeStyle: "short",
        })
      : "时间未知";
    return [
      {
        historyId: record.id,
        label: `${mode} · ${jobSchemas[jobId].name} · ${date}`,
        record,
      },
    ];
  });
}

export function historyComparisonEntry(
  record: SearchHistoryRecord,
  jobId: JobId,
): ComparisonEntry {
  const match = matchingHistoryResult(record, jobId);
  if (!match || !hasSnapshotLevel(match.result)) {
    throw new Error("该历史记录没有可用于当前职业对比的已完成结果。");
  }

  const { result, config } = match;
  const snapshot: GearsetResultSnapshot = {
    jobId,
    calculationLevel: result.calculationLevel!,
    ...(config.syncLevel === undefined
      ? {}
      : { syncItemLevel: config.syncLevel }),
    gear: result.gear,
    food: result.food,
    stats: result.stats,
    effects: result.effects,
    // OptimizationResult stores the domain-computed expected damage directly.
    damagePerPotency: result.effects.damage,
    damagePerSecond: result.damagePerSecond,
  };
  return {
    entryId: createComparisonEntryId(),
    snapshot,
    dataVersion: record.dataVersion,
    source: { kind: "history", historyId: record.id },
  };
}
