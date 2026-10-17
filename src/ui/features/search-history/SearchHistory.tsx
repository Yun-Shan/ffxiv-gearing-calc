import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { jobSchemas } from "@/domain";
import { currentDataVersion } from "@/ui/services/app-config";
import {
  listSearchHistory,
  type SearchHistoryKind,
  type SearchHistoryRecord,
} from "@/ui/services/search-history";
import styles from "./SearchHistory.module.scss";
export interface SearchHistoryProps {
  kind: SearchHistoryKind;
  onLoadConfig(record: SearchHistoryRecord): void;
  onLoadResult(record: SearchHistoryRecord): void;
}
const labels = {
  running: "未完成",
  completed: "已完成",
  cancelled: "已取消",
  "no-result": "无可行结果",
  failed: "搜索失败",
  interrupted: "已中断",
};
export function SearchHistory({
  kind,
  onLoadConfig,
  onLoadResult,
}: SearchHistoryProps) {
  const [records, setRecords] = useState<SearchHistoryRecord[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(12);
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const read = () => {
      setLoading(true);
      void listSearchHistory(kind)
        .then((values) => {
          if (active) {
            setRecords(values);
            setError(undefined);
          }
        })
        .catch((e: unknown) => {
          if (active) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    read();
    window.addEventListener("search-history-changed", read);
    return () => {
      active = false;
      window.removeEventListener("search-history-changed", read);
    };
  }, [kind]);
  useEffect(() => {
    if (!sentinel.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) setCount((x) => x + 12);
      },
      { root: root.current },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [count, records.length]);
  return (
    <section className={styles.root} aria-label="搜索记录">
      <h2>搜索记录</h2>
      <div className={styles.list} ref={root}>
        {loading && <p role="status">正在读取搜索记录…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && !records.length && <p>还没有搜索记录。</p>}
        {records.slice(0, count).map((record) => (
          <article key={record.id} className={styles.record}>
            <div className={styles.heading}>
              <strong>
                {record.kind === "single"
                  ? jobSchemas[record.config.jobId].name
                  : record.config.jobs
                      .map((j) => jobSchemas[j.jobId].name)
                      .join(" / ")}
              </strong>
              <span>{labels[record.status]}</span>
            </div>
            <p>
              {record.kind === "single"
                ? `品级 ${record.config.minItemLevel}–${record.config.maxItemLevel}`
                : `${record.config.jobs.length} 职业 · ${record.config.commonSlots.length} 共享部位`}
            </p>
            <p>
              {new Date(record.startedAtISO).toLocaleString("zh-CN")}{" "}
              {record.finishedAtISO &&
                ` · ${Math.max(0, (Date.parse(record.finishedAtISO) - Date.parse(record.startedAtISO)) / 1000).toFixed(1)} 秒`}{" "}
              · 数据 {record.dataVersion}
            </p>
            {record.error && (
              <p className={styles.error} title={record.error}>
                {record.error}
              </p>
            )}
            {record.dataVersion !== currentDataVersion && (
              <p>历史版本结果；编辑后使用当前数据重新搜索。</p>
            )}
            <div className={styles.actions}>
              <button onClick={() => onLoadConfig(record)}>编辑条件</button>
              {record.status === "completed" && record.result && (
                <button onClick={() => onLoadResult(record)}>查看结果</button>
              )}
            </div>
          </article>
        ))}
        {count < records.length && (
          <div ref={sentinel}>
            <button onClick={() => setCount((x) => x + 12)}>
              显示更多记录
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
export function HistoryOverlay({
  open,
  onOpenChange,
  ...props
}: SearchHistoryProps & { open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.overlay}>
          <div className={styles.heading}>
            <Dialog.Title>本地搜索记录</Dialog.Title>
            <Dialog.Close>关闭</Dialog.Close>
          </div>
          <Dialog.Description>
            查看保存的结果或重新编辑条件。
          </Dialog.Description>
          <SearchHistory {...props} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
