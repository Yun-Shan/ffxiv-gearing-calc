import type { ReactNode } from "react";
import { Share2 } from "lucide-react";
import type { OptimizationResult } from "../../domain";
import styles from "./SingleJobResultView.module.css";

export function SingleJobResultView({
  result,
  table,
  summary,
  referenceUrl,
}: {
  result: OptimizationResult;
  table: ReactNode;
  summary: ReactNode;
  referenceUrl: string;
}) {
  return (
    <div className={`${styles.workspace} single-result-workspace`}>
      <main className={styles.main}>
        <header className={styles.titlebar}>
          <div>
            <h1>配装结果</h1>
            <p>
              目标值 {result.score.toFixed(7)}（
              {result.objective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望"}
              ） · 用时 {(result.durationMs / 1000).toFixed(1)} 秒
            </p>
          </div>
        </header>

        <section className={styles.metrics} aria-label="伤害指标">
          <Metric label="每威力伤害期望" value={result.effects.damage.toFixed(7)} />
          <Metric label="GCD" value={`${result.effects.gcd.toFixed(2)} 秒`} />
          <Metric label="暴击率" value={`${(result.effects.crtChance * 100).toFixed(1)}%`} />
          <Metric label="直击率" value={`${(result.effects.dhtChance * 100).toFixed(1)}%`} />
          <Metric label="每秒每威力伤害期望" value={result.damagePerSecond.toFixed(7)} accent />
        </section>

        <div className={styles.tableHeading}>
          <h2>推荐配装</h2>
          {referenceUrl && (
            <a className={styles.openLink} href={referenceUrl} target="_blank" rel="noreferrer">
              <span>在配装器打开</span>
              <Share2 size={14} aria-hidden="true" />
            </a>
          )}
        </div>
        <div className={styles.tableScope}>{table}</div>
      </main>

      <aside className={styles.aside} aria-label="配装条件摘要">
        {summary}
      </aside>
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`${styles.metric}${accent ? ` ${styles.metricAccent}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
