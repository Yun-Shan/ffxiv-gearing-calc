import styles from "@/ui/components/app-header/AppHeader.module.scss";

export type AppPage = "single" | "joint";

export function AppHeader({
  page,
}: {
  page: AppPage;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.mark}>
          <span className={styles.innerMark} aria-hidden="true">✧</span>
        </div>
        <div className={styles.identity}>
          <div className={styles.name}>FFXIV 自动配装器</div>
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
    </header>
  );
}
