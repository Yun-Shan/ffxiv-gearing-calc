import styles from "./JobSelectionSidebar.module.scss";

export function JobSelectionSidebar({
  dataVersion,
}: {
  dataVersion: string;
}) {
  return (
    <>
      <section className={styles.announcement} aria-labelledby="selection-announcement-title">
        <h3 id="selection-announcement-title">最新公告</h3>
        <div className={styles.emptyState}>
          <strong>暂无新公告</strong>
          <p>有新内容时会在这里展示</p>
        </div>
      </section>
      <p className={styles.version}>数据版本 <strong>{dataVersion}</strong></p>
    </>
  );
}
