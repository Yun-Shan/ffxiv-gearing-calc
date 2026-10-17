import styles from "./AppHeader.module.scss";
export type AppPage = "single" | "lab" | "joint" | "gear-comparison";
export function AppHeader({ page }: { page: AppPage }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.mark}>
          <span className={styles.innerMark}>✧</span>
        </div>
        <div className={styles.name}>FFXIV 自动配装器</div>
      </div>
      <nav className={styles.nav} aria-label="主导航">
        <a
          href="/single"
          className={`${styles.navLink} ${page === "single" ? styles.active : ""}`}
          aria-current={page === "single" ? "page" : undefined}
        >
          单职业搜索
        </a>
        <a
          href="/lab"
          className={`${styles.navLink} ${page === "lab" ? styles.active : ""}`}
          aria-current={page === "lab" ? "page" : undefined}
        >
          实验室
        </a>
      </nav>
    </header>
  );
}
