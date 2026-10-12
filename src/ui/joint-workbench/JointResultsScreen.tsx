import { useId, type ReactNode } from "react";
import {
  jobSchemas,
  type JointOptimizationConfig,
  type JointOptimizationResult,
} from "../../domain";
import { JointResultsComparison } from "./JointResultsComparison";
import { commonSlotLabels } from "./JointCommonGearSection";
import styles from "./JointResultsScreen.module.css";

export interface JointResultsScreenProps {
  result: JointOptimizationResult;
  config: JointOptimizationConfig;
  details: ReactNode;
  onAdjust: () => void;
  dataVersion: string;
  history?: ReactNode;
  onReset?: () => void;
}

function getObjectiveLabel(objective: JointOptimizationConfig["objective"]): string {
  return objective === "dps" ? "按 GCD 折算" : "每威力伤害期望";
}

export function JointResultsScreen({
  result,
  config,
  details,
  onAdjust,
  dataVersion,
  history,
  onReset,
}: JointResultsScreenProps) {
  const titleId = useId();
  const conditionsId = useId();

  return (
    <div className={styles.page}>
      <main className={styles.main} aria-labelledby={titleId}>
        <header className={styles.pageHeader}>
          <div className={styles.headingCopy}>
            <p className={styles.eyebrow}>多职业联合搜索 · 搜索结果</p>
            <h1 id={titleId}>联合配装结果</h1>
          </div>
          <button className={styles.headerAction} type="button" onClick={onAdjust}>
            调整条件
          </button>
        </header>

        <JointResultsComparison result={result} config={config} titleId={titleId} />

        <div className={styles.details} aria-label="联合配装详情">
          {details}
        </div>
      </main>

      <aside className={styles.rail} aria-labelledby={`${titleId}-rail-title`}>
        <header className={styles.railHeader}>
          <p className={styles.sectionEyebrow}>本次搜索</p>
          <h2 id={`${titleId}-rail-title`}>联合结果摘要</h2>
        </header>

        <section className={styles.participants} aria-labelledby={`${titleId}-participants`}>
          <h3 id={`${titleId}-participants`}>参与职业</h3>
          <ul className={styles.participantList}>
            {config.jobs.map(({ jobId }) => (
              <li key={jobId}>
                <span className={styles.participantDot} aria-hidden="true" />
                <span>{jobSchemas[jobId].name}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.conditions} aria-labelledby={conditionsId}>
          <h3 id={conditionsId}>搜索条件快照</h3>
          <dl className={styles.snapshot}>
            <div>
              <dt>联合目标</dt>
              <dd>{getObjectiveLabel(config.objective)}</dd>
            </div>
            <div>
              <dt>共享部位</dt>
              <dd>{config.commonSlots.length > 0 ? config.commonSlots.map((slot) => commonSlotLabels[slot]).join("、") : "不共享"}</dd>
            </div>
            <div>
              <dt>食物策略</dt>
              <dd>{config.foodStrategy === "shared" ? "所有职业共用" : "各职业独立选择"}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.resultStatus} aria-label="搜索结果状态">
          <div className={styles.statusLine}>
            <span className={styles.statusMark} aria-hidden="true">✓</span>
            <strong>搜索完成</strong>
          </div>
          <p>归一化联合目标值 {Number.isFinite(result.value.approximate) ? result.value.approximate.toFixed(8) : "—"}</p>
          <p className={styles.statusMeta}>有理数 {result.value.numerator} / {result.value.denominator}</p>
          <p className={styles.statusMeta}>
            {result.statistics.elapsedMs.toLocaleString("zh-CN")} 毫秒 · {result.statistics.completeNodes.toLocaleString("zh-CN")} 个完成节点
          </p>
          <p className={styles.statusMeta}>{result.proof.optimalityScope}</p>
        </section>

        <dl className={styles.versionRow}>
          <div>
            <dt>数据版本</dt>
            <dd>{dataVersion || "—"}</dd>
          </div>
        </dl>

        <p className={styles.offlineNote}>纯前端计算 · 可离线运行</p>

        <div className={styles.railActions}>
          <button className={styles.adjustAction} type="button" onClick={onAdjust}>
            调整条件
          </button>
          {(onReset || history) && (
            <details className={styles.advanced}>
              <summary>更多</summary>
              <div className={styles.advancedMenu}>
                {onReset && (
                  <button className={styles.resetAction} type="button" onClick={onReset}>
                    重置当前页面配置
                  </button>
                )}
                {history && <section className={styles.history} aria-label="搜索历史">{history}</section>}
              </div>
            </details>
          )}
        </div>
      </aside>
    </div>
  );
}
