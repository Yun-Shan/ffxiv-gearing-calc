import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { JobId } from "@/domain/types";
import styles from "./JointJobSelection.module.scss";
import { JobSelection } from '@/ui/components/job-selection/JobSelection.tsx';

export interface JointJobSelectionProps {
  selectedJobs: JobId[];
  onSelectJobChange: (jobIds: Set<JobId>) => void;
  onContinue: () => void;
  canContinue: boolean;
  dataVersion: string;
  onReset?: () => void;
  selectionMessage?: string;
  errorMessage?: string;
  history?: ReactNode;
}

export function JointJobSelection({
  selectedJobs,
  onSelectJobChange,
  onContinue,
  canContinue,
  dataVersion,
  onReset,
  selectionMessage,
  errorMessage,
  history,
}: JointJobSelectionProps) {
  const statusMessage = selectionMessage ?? errorMessage ?? (
    canContinue
      ? `已选择 ${selectedJobs.length} 个职业，可以继续设置条件。`
      : "请选择同一分组内的至少两个职业。"
  );

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.heading}>
            <p className={styles.kicker}>多职业联合搜索 · 第 1 步</p>
            <h1>选择参与联合搜索的职业</h1>
            <p className={styles.description}>请选择同一分组内的至少两个职业。</p>
          </header>

          <JobSelection groupType={'gear'} onSelectJobChange={onSelectJobChange} />

          <footer className={styles.actions}>
            <p className={`${styles.selectionMessage} ${errorMessage || selectionMessage ? styles.selectionError : ""}`} role={errorMessage ? "alert" : "status"}>{statusMessage}</p>
            <button
              className={styles.continueButton}
              type="button"
              disabled={!canContinue}
              onClick={onContinue}
            >
              前往条件设置
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </footer>
        </div>
      </main>

      <aside className={styles.rail} aria-label="联合搜索说明">
        <div className={styles.railHeading}>
          <h2>联合搜索说明</h2>
        </div>

        <section className={styles.selectionRule} aria-labelledby="joint-selection-rule-title">
          <h3 id="joint-selection-rule-title">选择职业</h3>
          <div className={styles.ruleCard}>
            <strong>至少选择 2 个职业</strong>
            <p>请选择同一分组的职业，再设置各职业条件与共享部位。</p>
          </div>
        </section>

        <div className={styles.railFooter}>
          <div className={styles.version}>
            <span>当前数据版本</span>
            <strong>{dataVersion}</strong>
          </div>
          <span className={styles.offlineNote}>纯前端计算 · 可离线运行</span>
          {(history !== undefined || onReset !== undefined) && (
            <details className={styles.advanced}>
              <summary>高级设置</summary>
              <div className={styles.historyContent}>
                {onReset && (
                  <button className={styles.resetButton} type="button" onClick={onReset}>
                    重置当前页面配置
                  </button>
                )}
                {history}
              </div>
            </details>
          )}
        </div>
      </aside>
    </div>
  );
}
