import type { ReactNode } from "react";
import { Play } from "lucide-react";
import styles from "./SingleWorkbenchSidebar.module.css";

export function SingleWorkbenchSidebar({
  summary,
  status,
  canStartSearch,
  onStartSearch,
  history,
}: {
  summary: ReactNode;
  status: string;
  canStartSearch: boolean;
  onStartSearch: () => void;
  history: ReactNode;
}) {
  return (
    <aside className={styles.sidebar} aria-label="当前搜索条件摘要">
      <div className={styles.summary}>{summary}</div>
      <div className={styles.actionbar}>
        <span className={canStartSearch ? styles.ready : styles.pending}>{status}</span>
        <button type="button" className={styles.runButton} disabled={!canStartSearch} onClick={onStartSearch}>
          <Play size={16} fill="currentColor" />
          开始搜索
        </button>
      </div>
      <footer className={styles.footer}>
        <span>纯前端计算 · 可离线运行</span>
        <details className={styles.advanced}>
          <summary>高级设置</summary>
          <div className={styles.history}>{history}</div>
        </details>
      </footer>
    </aside>
  );
}
