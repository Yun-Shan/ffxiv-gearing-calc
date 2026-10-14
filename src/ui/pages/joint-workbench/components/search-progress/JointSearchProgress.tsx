import type { ReactNode } from "react";
import type { JobId } from "../../../../../domain/types";
import type { LinearMipProgress } from "../../../../../domain/search/linear-mip";
import { SinglePageSidePanel } from "../../../../components/side-panel/SinglePageSidePanel";
import { JointProgressPhaseDetail } from "./components/joint-progress-phase-detail/JointProgressPhaseDetail";
import progressStyles from "../../../../components/search-progress/SearchWorkflowProgress.module.scss";
import styles from "./JointSearchProgress.module.scss";

export type JointSearchPhase = "prepare" | "baseline" | "joint" | "verify";

export interface JointSearchStats {
  seedCandidates?: number;
  seedLimit?: number;
  warmStartCandidates?: number;
  exactAttempts?: number;
  outerNodes?: number;
  completeNodes?: number;
  upperBoundPrunes?: number;
  innerMipSolves?: number;
  parentResultReuses?: number;
  incumbent?: number;
  elapsedMs?: number;
}

export interface JointSearchProgressJob {
  jobId: JobId;
  name: string;
  prepared: boolean;
  preparationFailed?: boolean;
  /** The latest baseline solver event selected by the caller. */
  solver?: LinearMipProgress;
}

export interface JointSearchProgressState {
  phase: JointSearchPhase;
  /** Unix timestamp in milliseconds. */
  startedAt: number;
  jobs: readonly JointSearchProgressJob[];
  /** The latest joint-model solver event, when available. */
  jointSolver?: LinearMipProgress;
  jointStats: JointSearchStats;
  /** The current verification callback text, passed through without interpretation. */
  verifyMessage?: string;
}

export interface JointSearchSummaryJob {
  jobId: JobId;
  name: string;
  details: readonly { label: string; value: string }[];
}

export interface JointSearchSummary {
  jobs: readonly JointSearchSummaryJob[];
  objective: string;
  commonSlots: readonly string[];
  foodStrategy: string;
}

export interface JointSearchProgressProps {
  progress: JointSearchProgressState;
  summary: JointSearchSummary;
  history?: ReactNode;
  onCancel: () => void;
  onReset?: () => void;
}

const SEARCH_STAGES: ReadonlyArray<{ phase: JointSearchPhase; label: string }> = [
  { phase: "prepare", label: "准备候选与搜索模型" },
  { phase: "baseline", label: "求解并搜索配装" },
  { phase: "verify", label: "核验候选与最优性" },
];

function getStageIndex(phase: JointSearchPhase): number {
  return phase === "prepare" ? 0 : phase === "verify" ? 2 : 1;
}

export function JointSearchProgress({
  progress,
  summary,
  history,
  onCancel,
  onReset,
}: JointSearchProgressProps) {
  const stageIndex = getStageIndex(progress.phase);
  const showAdvancedMenu = onReset !== undefined || history !== undefined;

  return (
    <div className={progressStyles.page}>
      <div className={progressStyles.layout}>
        <section className={progressStyles.main} aria-labelledby="joint-search-progress-title">
          <div className={styles.overview}>
            <header className={progressStyles.header}>
              <div>
                <p className={progressStyles.eyebrow}>多职业配装搜索</p>
                <h1 id="joint-search-progress-title">搜索进度</h1>
              </div>
            </header>

            <ol className={progressStyles.stageTrack} aria-label="搜索阶段">
              {SEARCH_STAGES.map((stage, index) => {
                const isCurrent = index === stageIndex;
                const isComplete = index < stageIndex;
                const stateClass = isCurrent
                  ? progressStyles.isCurrent
                  : isComplete
                    ? progressStyles.isComplete
                    : progressStyles.isUpcoming;
                return (
                  <li
                    className={progressStyles.stage + " " + stateClass}
                    key={stage.phase}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    <span className={progressStyles.stageIndex} aria-hidden="true">
                      {isComplete ? "✓" : index + 1}
                    </span>
                    <span>{stage.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <JointProgressPhaseDetail progress={progress} />
        </section>

        <SinglePageSidePanel className={progressStyles.rail} ariaLabel="联合搜索条件摘要">
          <div className={progressStyles.summary + " " + styles.conditionSummary}>
            <header className={styles.summaryHeading}>
              <p className={progressStyles.eyebrow}>搜索条件</p>
              <h2>联合搜索</h2>
            </header>

            <section className={styles.summarySection} aria-label="参与职业">
              <h3>参与职业</h3>
              {summary.jobs.map((job) => (
                <article className={styles.summaryJob} key={job.jobId}>
                  <h4>{job.name}</h4>
                  {job.details.map(({ label, value }) => (
                    <div className={styles.summaryDetail} key={label}>
                      <span>{label}</span>
                      <strong>{value || "—"}</strong>
                    </div>
                  ))}
                </article>
              ))}
            </section>

            <section className={styles.summarySection} aria-label="联合条件">
              <h3>联合条件</h3>
              <div className={styles.summaryDetail}>
                <span>优化目标</span>
                <strong>{summary.objective || "—"}</strong>
              </div>
              <div className={styles.summaryDetail}>
                <span>共享部位</span>
                <strong>{summary.commonSlots.length ? summary.commonSlots.join("、") : "—"}</strong>
              </div>
              <div className={styles.summaryDetail}>
                <span>食物策略</span>
                <strong>{summary.foodStrategy || "—"}</strong>
              </div>
            </section>
          </div>

          <button className={progressStyles.cancelButton} type="button" onClick={onCancel}>
            取消搜索
          </button>
          <footer className={progressStyles.railFooter}>
            <span>纯前端计算 · 可离线运行</span>
            {showAdvancedMenu && (
              <details className={progressStyles.advanced}>
                <summary>更多</summary>
                <div className={progressStyles.advancedMenu}>
                  {onReset && (
                    <button type="button" className={progressStyles.resetButton} onClick={onReset}>
                      重置当前页面配置
                    </button>
                  )}
                  {history && <div className={progressStyles.history}>{history}</div>}
                </div>
              </details>
            )}
          </footer>
        </SinglePageSidePanel>
      </div>
    </div>
  );
}
