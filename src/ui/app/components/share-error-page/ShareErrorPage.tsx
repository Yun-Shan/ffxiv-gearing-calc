import styles from "./ShareErrorPage.module.scss";

export function ShareErrorPage({
  error,
  onReturnHome,
}: {
  error: string;
  onReturnHome(): void;
}) {
  return (
    <main
      className={styles.page}
      data-share-error
      aria-labelledby="share-error-title"
    >
      <div className={styles.content}>
        <p className={styles.brand}>最终幻想14 · 自动配装器</p>
        <div role="alert" aria-live="assertive">
          <span className={styles.indicator} aria-hidden="true">
            !
          </span>
          <h1 id="share-error-title" className={styles.title}>
            分享链接恢复失败
          </h1>
          <p className={styles.message}>
            无法恢复此分享链接，请返回首页重新开始。
          </p>
        </div>
        <pre className={styles.error}>{error}</pre>
        <button className={styles.action} type="button" onClick={onReturnHome}>
          返回首页
        </button>
      </div>
    </main>
  );
}
