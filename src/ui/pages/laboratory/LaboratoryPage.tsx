import styles from "./LaboratoryPage.module.scss";

export function LaboratoryPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p>实验室</p>
        <h1>多职业工具</h1>
        <span>选择联合搜索或对比已有配装结果。</span>
      </header>
      <nav className={styles.tools} aria-label="实验室工具">
        <a href="/joint" className={styles.tool}>
          <span>联合搜索</span>
          <strong>为多个职业共同搜索配装</strong>
          <small>在共享装备与各职业条件下寻找联合方案。</small>
        </a>
        <a href="/gear-comparison" className={styles.tool}>
          <span>装备对比</span>
          <strong>比较同职业的多套配装</strong>
          <small>从历史结果添加方案，查看核心指标与装备差异。</small>
        </a>
      </nav>
    </main>
  );
}
