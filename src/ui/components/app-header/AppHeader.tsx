import styles from "./AppHeader.module.scss";
export type AppPage = "single" | "lab" | "joint" | "gear-comparison";
export function AppHeader({ page }: { page: AppPage }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img className={styles.mark} src="/icons/logo-128.png" alt="" />
        <div className={styles.name}>
          <span>最终幻想14</span>
          <span>自动配装器</span>
        </div>
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
