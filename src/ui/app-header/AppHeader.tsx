import { RotateCcw } from "lucide-react";
import styles from "./AppHeader.module.css";

export type AppPage = "single" | "joint";

export function AppHeader({
  page,
  dataVersion,
  onReset,
}: {
  page: AppPage;
  dataVersion: string;
  onReset: () => void;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.mark}>
          <span aria-hidden="true">✧</span>
        </div>
        <div className={styles.identity}>
          <div className={styles.name}>青瓷分析台</div>
          <div className={styles.subtitle}>最终幻想14 配装优化工具</div>
        </div>
      </div>
      <nav className={styles.nav} aria-label="搜索页面">
        <a
          href="#/single"
          className={`${styles.navLink} ${page === "single" ? styles.active : ""}`}
          aria-current={page === "single" ? "page" : undefined}
        >
          单职业配装
        </a>
        <a
          href="#/joint"
          className={`${styles.navLink} ${page === "joint" ? styles.active : ""}`}
          aria-current={page === "joint" ? "page" : undefined}
        >
          多职业联合搜索
        </a>
      </nav>
      <div className={styles.meta}>
        <span className={styles.dot} />
        <span>数据版本 {dataVersion}</span>
        <span className={styles.separator} />
        <button
          className={styles.reset}
          aria-label="重置当前页面配置"
          title="重置当前页面配置"
          onClick={onReset}
        >
          <RotateCcw size={17} />
        </button>
      </div>
    </header>
  );
}
