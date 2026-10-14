import type { JobId } from "@/domain";
import styles from "./SingleWorkbenchSelectionScreen.module.scss";
import { JobSelection } from '@/ui/components/job-selection/JobSelection.tsx';

export function SingleWorkbenchSelectionScreen({
  onChooseJob,
}: {
  onChooseJob: (jobId: JobId) => void;
}) {
  return (
    <section className={styles.jobSelection} aria-labelledby="single-selection-title">
      <header className={styles.selectionHeading}>
        <p className={styles.sectionKicker}>单职业配装 · 配装流程</p>
        <h1 id="single-selection-title">选择职业</h1>
      </header>
      <JobSelection groupType={'role'} onSelectJob={onChooseJob} />
    </section>
  );
}
