import { Popover } from "@base-ui/react/popover";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import {
  listSearchHistory,
  deleteSearchHistory,
  clearSearchHistory,
  type SearchHistoryKind,
  type SearchHistoryRecord,
} from "@/ui/services/search-history";
import styles from "./SearchHistory.module.scss";
import { HistoryRecord } from "./components/history-record/HistoryRecord";
export interface SearchHistoryProps {
  kind: SearchHistoryKind;
  onLoadConfig(record: SearchHistoryRecord): void;
  onLoadResult(record: SearchHistoryRecord): void;
}
export function SearchHistory({
  kind,
  onLoadConfig,
  onLoadResult,
}: SearchHistoryProps) {
  const [records, setRecords] = useState<SearchHistoryRecord[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(12);
  const [mutating, setMutating] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  async function remove(id?: string) {
    setMutating(true);
    setMutationError(undefined);
    try {
      if (id !== undefined) await deleteSearchHistory(id);
      else await clearSearchHistory(kind);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setMutating(false);
    }
  }
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
      <div className={styles.heading}>
        <h2>搜索记录</h2>
        <Popover.Root open={clearOpen} onOpenChange={setClearOpen}>
          <Popover.Trigger
            className={styles.actionButton}
            disabled={loading || mutating || records.length === 0}
          >
            清空
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              sideOffset={8}
              align="end"
              className={styles.confirmPositioner}
            >
              <Popover.Popup className={styles.confirmPopup}>
                <Popover.Title className={styles.confirmTitle}>
                  清空历史记录？
                </Popover.Title>
                <Popover.Description className={styles.confirmDescription}>
                  将删除全部{kind === "single" ? "单职业" : "多职业"}
                  历史记录，此操作无法撤销。
                </Popover.Description>
                <div className={styles.confirmActions}>
                  <Popover.Close className={styles.actionButton}>
                    取消
                  </Popover.Close>
                  <button
                    className={styles.actionButton}
                    disabled={mutating}
                    onClick={() => {
                      setClearOpen(false);
                      void remove();
                    }}
                  >
                    确认清空
                  </button>
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {mutationError && <p role="alert">{mutationError}</p>}
      <div className={styles.list} ref={root}>
        {loading && <p role="status">正在读取搜索记录…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && !records.length && <p>还没有搜索记录。</p>}
        {records.slice(0, count).map((record) => (
          <HistoryRecord
            key={record.id}
            record={record}
            deleting={mutating}
            onLoadConfig={() => onLoadConfig(record)}
            onLoadResult={() => onLoadResult(record)}
            onDelete={() => void remove(record.id)}
          />
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
            <Dialog.Close
              className={styles.closeButton}
              aria-label="关闭搜索记录"
              title="关闭搜索记录"
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
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
