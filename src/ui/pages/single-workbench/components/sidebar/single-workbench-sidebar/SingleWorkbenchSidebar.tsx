import type { ReactNode } from "react";
import { Play, RotateCcw } from "lucide-react";
import { SinglePageSidePanel } from "../../../../../components/side-panel/SinglePageSidePanel";
import styles from "./SingleWorkbenchSidebar.module.css";

export function SingleWorkbenchSidebar({
  summary,
  status,
  canStartSearch,
  onStartSearch,
  onReset,
  history,
}: {
  summary: ReactNode;
  status: string;
  canStartSearch: boolean;
  onStartSearch: () => void;
  onReset: () => void;
  history: ReactNode;
}) {
  return (
    <SinglePageSidePanel className={styles.sidebar} ariaLabel="当前搜索条件摘要">
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
          <button type="button" className={styles.resetButton} onClick={onReset}>
            <RotateCcw size={13} />
            重置当前页面配置
          </button>
          <div className={styles.history}>{history}</div>
        </details>
      </footer>
    </SinglePageSidePanel>
  );
}
