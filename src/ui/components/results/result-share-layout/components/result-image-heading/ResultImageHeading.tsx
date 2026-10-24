import { jobSchemas, type JobId } from "@/domain";
import styles from "./ResultImageHeading.module.scss";

export function ResultImageHeading({
  jobId,
  damage,
}: {
  jobId: JobId;
  damage: number;
}) {
  return (
    <header className={styles.heading}>
      <h2 className={styles.title}>{jobSchemas[jobId].name} · 推荐配装</h2>
      <div className={styles.damage} aria-label="每威力伤害期望">
        <span>每威力伤害期望</span>
        <strong>{damage.toFixed(7)}</strong>
      </div>
    </header>
  );
}
