import type { JobId } from "@/domain";
import { JobPicker } from "../job-selection/wizard-navigation/WizardNavigation";
import styles from "./SingleWorkbenchSelectionScreen.module.scss";

export function SingleWorkbenchSelectionScreen({
  selectedJob,
  onChooseJob,
}: {
  selectedJob: JobId | null;
  onChooseJob: (jobId: JobId) => void;
}) {
  return (
    <section className={styles.jobSelection} aria-labelledby="single-selection-title">
      <header className={styles.selectionHeading}>
        <p className={styles.sectionKicker}>单职业配装 · 配装流程</p>
        <h1 id="single-selection-title">选择职业</h1>
      </header>
      <JobPicker value={selectedJob} onChange={onChooseJob} />
    </section>
  );
}
