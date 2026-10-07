import { RotateCcw } from "lucide-react";
import { SinglePageSidePanel } from "./layout/SinglePageSidePanel";
import styles from "./JobSelectionSidebar.module.css";

export function JobSelectionSidebar({
  dataVersion,
  onReset,
}: {
  dataVersion: string;
  onReset: () => void;
}) {
  return (
    <SinglePageSidePanel className={styles.aside} ariaLabel="公告与应用信息">
      <header className={styles.panelHeader}>
        <h2>信息公告栏</h2>
      </header>
      <section className={styles.announcement} aria-labelledby="selection-announcement-title">
        <h3 id="selection-announcement-title">最新公告</h3>
        <div className={styles.emptyState}>
          <strong>暂无新公告</strong>
          <p>有新内容时会在这里展示</p>
        </div>
      </section>

      <footer className={styles.footer}>
        <p className={styles.version}>数据版本 <strong>{dataVersion}</strong></p>
        <div className={styles.footerMeta}>
          <span>纯前端计算 · 可离线运行</span>
          <details className={styles.advancedSettings}>
            <summary>高级设置</summary>
            <button type="button" onClick={onReset} aria-label="重置当前页面配置">
              <RotateCcw size={13} />
              重置当前页面配置
            </button>
          </details>
        </div>
      </footer>
    </SinglePageSidePanel>
  );
}
