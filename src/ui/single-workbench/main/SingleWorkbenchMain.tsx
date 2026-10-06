import type { ReactNode } from "react";
import styles from "./SingleWorkbenchMain.module.css";

export function SingleWorkbenchMain({
  roleLabel,
  jobName,
  onChangeJob,
  notices,
  status,
  fields,
  outcome,
}: {
  roleLabel: string;
  jobName: string;
  onChangeJob: () => void;
  notices?: ReactNode;
  status?: ReactNode;
  fields: ReactNode;
  outcome?: ReactNode;
}) {
  return (
    <section className={styles.main} aria-label="单职业搜索参数">
      <header className={styles.heading}>
        <div>
          <p className={styles.kicker}>单职业配装 · {roleLabel}</p>
          <h1>{jobName} 搜索条件</h1>
        </div>
        <button type="button" className={styles.changeJob} onClick={onChangeJob}>更换职业</button>
      </header>
      {notices}
      {status}
      <div className={styles.settings}>{fields}</div>
      {outcome}
    </section>
  );
}
