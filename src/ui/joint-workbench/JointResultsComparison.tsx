import { jobSchemas, type JobId, type JointOptimizationConfig, type JointOptimizationResult } from "../../domain";
import styles from "./JointResultsScreen.module.css";

function formatScore(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(7) : "—";
}

function getRetentionPercent(result: JointOptimizationResult, jobId: JobId): number | undefined {
  const baseline = result.optima[jobId]?.score;
  const joint = result.jobResults[jobId]?.score;
  if (baseline === undefined || joint === undefined || !Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(joint)) {
    return undefined;
  }
  return (joint / baseline) * 100;
}

function formatPercent(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

export function JointResultsComparison({
  result,
  config,
  titleId,
}: {
  result: JointOptimizationResult;
  config: JointOptimizationConfig;
  titleId: string;
}) {
  return (
    <section className={styles.comparison} aria-labelledby={`${titleId}-comparison`}>
      <div className={styles.sectionHeading}>
        <h2 id={`${titleId}-comparison`}>联合收益对比</h2>
        <span className={styles.normalizedValue}>
          归一化目标 {Number.isFinite(result.value.approximate) ? result.value.approximate.toFixed(8) : "—"}
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.comparisonTable}>
          <caption className={styles.visuallyHidden}>各参与职业的单职业基线、联合目标值、基线保留比例和 GCD</caption>
          <thead>
            <tr>
              <th scope="col">职业</th>
              <th scope="col">单职业基线</th>
              <th scope="col">联合目标值</th>
              <th scope="col">基线保留</th>
              <th scope="col">GCD</th>
            </tr>
          </thead>
          <tbody>
            {config.jobs.map(({ jobId }) => {
              const jointScore = result.jobResults[jobId]?.score;
              const gcd = result.jobResults[jobId]?.effects.gcd;
              const retention = getRetentionPercent(result, jobId);
              return (
                <tr key={jobId}>
                  <th scope="row">
                    <span className={styles.jobName}>{jobSchemas[jobId].name}</span>
                    <span className={styles.jobCode}>{jobId}</span>
                  </th>
                  <td className={styles.numeric}>{formatScore(result.optima[jobId]?.score)}</td>
                  <td className={`${styles.numeric} ${styles.jointValue}`}>{formatScore(jointScore)}</td>
                  <td className={styles.retentionCell}>
                    {retention === undefined ? "—" : <span className={styles.retentionTag}>{formatPercent(retention)}</span>}
                  </td>
                  <td className={`${styles.numeric} ${styles.gcdCell}`}>
                    {gcd !== undefined && Number.isFinite(gcd) ? `${gcd.toFixed(2)} 秒` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.comparisonNote}>结果已核验 · {result.proof.optimalityScope}</p>
    </section>
  );
}
