import { useEffect, useState } from "react";
import { Clock3, History, RefreshCw } from "lucide-react";
import { jobSchemas } from "../../../domain/index";
import styles from "./SearchHistory.module.scss";
import {
  listSearchHistory,
  type SearchHistoryKind,
  type SearchHistoryRecord,
  type SearchHistoryStatus,
} from "../../services/search-history";

const PAGE_SIZE = 5;

export interface SearchHistoryProps {
  kind: SearchHistoryKind;
  currentDataVersion: string;
  /** Increment after App finishes creating/updating a search record. */
  refreshKey?: number;
  /** Whether the history list should start expanded on the profession selection page. */
  defaultOpen?: boolean;
  /** Hide the disclosure row when the selection page presents the list as its primary content. */
  hideSummary?: boolean;
  onLoadConfig: (record: SearchHistoryRecord) => void;
  onLoadResult: (record: SearchHistoryRecord) => void;
}

const statusLabels: Record<SearchHistoryStatus, string> = {
  running: "未完成",
  completed: "已完成",
  cancelled: "已取消",
  "no-result": "无可行结果",
  failed: "搜索失败",
  interrupted: "已中断",
};

function formatStartedAt(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function objectiveLabel(objective: "damage" | "dps" | undefined): string {
  return objective === "dps" ? "按 GCD 折算" : "每威力伤害期望";
}

function singleSummary(record: Extract<SearchHistoryRecord, { kind: "single" }>): string {
  const config = record.config;
  const job = jobSchemas[config.jobId];
  const target = config.objective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望";
  return `${job.name} · ${target} · 品级 ${config.minItemLevel}–${config.maxItemLevel}`;
}

function jointSummary(record: Extract<SearchHistoryRecord, { kind: "joint" }>): string {
  const config = record.config;
  const jobs = config.jobs.map((jobConfig) => {
    const job = jobSchemas[jobConfig.jobId];
    return `${job.name} ${jobConfig.jobLevel ?? job.maxJobLevel} 级`;
  }).join("、");
  const itemLevels = [...new Set(config.jobs.map(({ minItemLevel, maxItemLevel }) => `${minItemLevel}–${maxItemLevel}`))].join("、");
  return `${jobs} · ${objectiveLabel(config.objective)} · 品级 ${itemLevels}`;
}

function recordSummary(record: SearchHistoryRecord): string {
  return record.kind === "single" ? singleSummary(record) : jointSummary(record);
}

function visibleError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SearchHistory({
  kind,
  currentDataVersion,
  refreshKey = 0,
  defaultOpen = false,
  hideSummary = false,
  onLoadConfig,
  onLoadResult,
}: SearchHistoryProps) {
  const [records, setRecords] = useState<SearchHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [retryKey, setRetryKey] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    setPage(0);
    listSearchHistory(kind).then((loaded) => {
      if (!active) return;
      setRecords(loaded);
      setLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setLoadError(visibleError(error));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [kind, refreshKey, retryKey]);

  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRecords = records.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <details className={`${styles.root}${hideSummary ? ` ${styles.selectionHistory}` : ""}`} open={defaultOpen} aria-label={hideSummary ? "搜索记录" : undefined}>
      <summary className={styles.summary}>
        <History size={16} aria-hidden="true" />
        <span>搜索记录（{loading || loadError ? "—" : records.length} 次）</span>
      </summary>
      {hideSummary && <h2 className={styles.srOnly}>搜索记录</h2>}
      <div className={styles.content}>
        {loading && <p className={styles.message} role="status">正在读取本地搜索记录…</p>}
        {!loading && loadError && (
          <div className={styles.error} role="alert">
            <p>本地搜索记录读取失败：{loadError}</p>
            <button type="button" className={styles.retry} onClick={() => setRetryKey((value) => value + 1)}>
              <RefreshCw size={14} aria-hidden="true" />
              重试
            </button>
          </div>
        )}
        {!loading && !loadError && records.length === 0 && (
          <p className={styles.message}>还没有搜索记录；开始搜索后，记录会保存在此浏览器中。</p>
        )}
        {!loading && !loadError && pageRecords.length > 0 && (
          <>
            <ol className={styles.list}>
              {pageRecords.map((record) => {
                const versionMatches = record.dataVersion === currentDataVersion;
                const canLoadResult = record.status === "completed" && versionMatches && record.result !== undefined;
                return (
                  <li className={`${styles.record} is-${record.status}`} key={record.id}>
                    <div className={styles.recordHeading}>
                      <strong>{recordSummary(record)}</strong>
                      <span className={`${styles.status} is-${record.status}`}>{statusLabels[record.status]}</span>
                    </div>
                    <p className={styles.recordMeta}>
                      <Clock3 size={13} aria-hidden="true" />
                      <time dateTime={record.startedAtISO}>{formatStartedAt(record.startedAtISO)}</time>
                      <span>数据版本 {record.dataVersion}</span>
                    </p>
                    {record.status === "running" && <p className={styles.recordNote}>未完成；可能因页面刷新而中断，也可能仍在其他标签页运行。</p>}
                    {record.status === "failed" && record.error && <p className={styles.recordError}>{record.error}</p>}
                    {record.status === "completed" && !versionMatches && (
                      <p className={styles.recordNote}>当前数据版本已变化；可查看条件摘要，不能载入旧结果参与当前计算。</p>
                    )}
                    <div className={styles.recordActions}>
                      {record.status === "completed" && (
                        <button
                          type="button"
                          disabled={!canLoadResult}
                          title={versionMatches ? undefined : "数据版本已变化，不能载入旧结果。"}
                          onClick={() => canLoadResult && onLoadResult(record)}
                        >
                          载入结果
                        </button>
                      )}
                      <button type="button" onClick={() => onLoadConfig(record)}>
                        载入条件
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {pageCount > 1 && (
              <nav className={styles.pagination} aria-label="搜索记录分页">
                <button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                  上一页
                </button>
                <span>第 {currentPage + 1} / {pageCount} 页 · 共 {records.length} 次</span>
                <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>
                  下一页
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </details>
  );
}
