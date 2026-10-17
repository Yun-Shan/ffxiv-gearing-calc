import type { Effects, OptimizationResult } from "@/domain";
import styles from "./CoreMetricBar.module.scss";

export interface CoreMetricDifference {
  absolute: number;
  percent: number;
}

export interface CoreMetricDeltas {
  damagePerPotency?: CoreMetricDifference;
  damagePerSecond?: CoreMetricDifference;
  gcd?: number;
  tenacityMitigationPp?: number;
}

export interface CoreMetricEntry {
  key: string;
  label: string;
  damagePerPotency: number;
  damagePerSecond: number;
  gcd: number;
  criticalRate: number;
  directHitRate: number;
  tenacityMitigation?: number;
  deltas?: CoreMetricDeltas;
}

export interface CoreMetricBarProps {
  objective?: "damage" | "dps";
  entries: readonly CoreMetricEntry[];
  showTenacity: boolean;
  compact?: boolean;
}

export function buildResultMetricEntry(
  result: Pick<OptimizationResult, "effects" | "damagePerSecond">,
  key = "result",
  label = "当前结果",
): CoreMetricEntry {
  const effects: Effects = result.effects;
  return {
    key,
    label,
    damagePerPotency: effects.damage,
    damagePerSecond: result.damagePerSecond,
    gcd: effects.gcd,
    criticalRate: effects.crtChance,
    directHitRate: effects.dhtChance,
    tenacityMitigation: effects.tenMitigation,
  };
}

function formatMetric(value: number): string {
  return value.toFixed(7);
}

function signed(value: number, precision: number): string {
  const rounded = Number(value.toFixed(precision));
  if (Object.is(rounded, -0) || rounded === 0) return (0).toFixed(precision);
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(precision)}`;
}

function differenceText(
  difference: CoreMetricDifference | undefined,
): string | undefined {
  if (!difference) return undefined;
  return `${signed(difference.absolute, 7)} / ${signed(difference.percent, 2)}%`;
}

function MetricValues({
  entries,
  value,
  delta,
  formatter,
  showLabels,
}: {
  entries: readonly CoreMetricEntry[];
  value: (entry: CoreMetricEntry) => number;
  delta?: (entry: CoreMetricEntry) => string | undefined;
  formatter: (value: number) => string;
  showLabels: boolean;
}) {
  return (
    <ul className={styles.values}>
      {entries.map((entry) => {
        const deltaText = delta?.(entry);
        return (
          <li key={entry.key}>
            {showLabels && (
              <span className={styles.entryLabel}>{entry.label}</span>
            )}
            <strong>{formatter(value(entry))}</strong>
            {deltaText && <small>{deltaText}</small>}
          </li>
        );
      })}
    </ul>
  );
}

export function CoreMetricBar({
  objective,
  entries,
  showTenacity,
  compact = false,
}: CoreMetricBarProps) {
  const showLabels = compact || entries.length > 1;
  return (
    <section
      className={`${styles.metrics} ${compact ? styles.compact : ""} ${!showLabels ? styles.single : ""}`}
      aria-label="核心指标"
    >
      <article
        className={`${styles.metric} ${styles.damageCard}`}
        aria-label="伤害指标"
      >
        <h2>伤害</h2>
        <div
          className={`${styles.damageMetric} ${objective === "damage" ? styles.targetMetric : ""}`}
        >
          <span>每威力伤害期望</span>
          <MetricValues
            showLabels={showLabels}
            entries={entries}
            value={(entry) => entry.damagePerPotency}
            formatter={formatMetric}
            delta={(entry) => differenceText(entry.deltas?.damagePerPotency)}
          />
        </div>
        <div
          className={`${styles.damageMetric} ${objective === "dps" ? styles.targetMetric : ""}`}
        >
          <span>按 GCD 折算伤害</span>
          <MetricValues
            showLabels={showLabels}
            entries={entries}
            value={(entry) => entry.damagePerSecond}
            formatter={formatMetric}
            delta={(entry) => differenceText(entry.deltas?.damagePerSecond)}
          />
        </div>
      </article>

      <article className={styles.metric} aria-label="GCD">
        <h2>GCD</h2>
        <MetricValues
          showLabels={showLabels}
          entries={entries}
          value={(entry) => entry.gcd}
          formatter={(value) => `${value.toFixed(2)} 秒`}
          delta={(entry) =>
            entry.deltas?.gcd === undefined
              ? undefined
              : signed(entry.deltas.gcd, 2)
          }
        />
        {showTenacity && (
          <div className={styles.subMetric}>
            <span>坚韧减伤</span>
            <MetricValues
              showLabels={showLabels}
              entries={entries}
              value={(entry) => (entry.tenacityMitigation ?? 0) * 100}
              formatter={(value) => `${value.toFixed(2)}%`}
              delta={(entry) =>
                entry.deltas?.tenacityMitigationPp === undefined
                  ? undefined
                  : `${signed(entry.deltas.tenacityMitigationPp, 2)}pp`
              }
            />
          </div>
        )}
      </article>

      <article className={styles.metric} aria-label="暴击率">
        <h2>暴击率</h2>
        <MetricValues
          showLabels={showLabels}
          entries={entries}
          value={(entry) => entry.criticalRate * 100}
          formatter={(value) => `${value.toFixed(1)}%`}
        />
      </article>

      <article className={styles.metric} aria-label="直击率">
        <h2>直击率</h2>
        <MetricValues
          showLabels={showLabels}
          entries={entries}
          value={(entry) => entry.directHitRate * 100}
          formatter={(value) => `${value.toFixed(1)}%`}
        />
      </article>
    </section>
  );
}
