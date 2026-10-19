import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { Link } from "lucide-react";
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
  hp: number;
  referenceUrl?: string;
  clanIndex?: number;
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
    hp: effects.hp,
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

function ReferenceLink({
  entry,
  showLabel,
}: {
  entry: CoreMetricEntry;
  showLabel: boolean;
}) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <Link size="1em" aria-hidden="true" />
      {showLabel ? `${entry.label} · 在配装器打开` : "在配装器打开"}
    </>
  );
  if ((entry.clanIndex ?? 0) === 0) {
    return (
      <a
        href={entry.referenceUrl}
        target="_blank"
        rel="noreferrer"
        className={styles.openLink}
      >
        {content}
      </a>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={styles.openLink}>{content}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className={styles.sharePositioner}>
          <Popover.Popup className={styles.sharePopup}>
            <Popover.Title className={styles.shareTitle}>
              种族设置提醒
            </Popover.Title>
            <Popover.Description className={styles.shareDescription}>
              配装器分享链接不包含种族信息，打开后默认使用人族·中原之民。请在打开配装器后手动调整为当前结果所用的种族，以确保属性和计算结果一致。
            </Popover.Description>
            <div className={styles.shareActions}>
              <Popover.Close className={styles.openLink}>取消</Popover.Close>
              <a
                href={entry.referenceUrl}
                target="_blank"
                rel="noreferrer"
                className={styles.openLink}
                onClick={() => setOpen(false)}
              >
                确认并打开
              </a>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CoreMetricBar({
  objective,
  entries,
  showTenacity,
  compact = false,
}: CoreMetricBarProps) {
  const showLabels = compact || entries.length > 1;
  function metric(
    label: string,
    value: (entry: CoreMetricEntry) => string,
    delta?: (entry: CoreMetricEntry) => string | undefined,
    target = false,
  ) {
    return (
      <div
        className={`${styles.metricRow} ${target ? styles.targetMetric : ""}`}
      >
        <span>{label}</span>
        <div className={styles.values}>
          {entries.map((entry) => (
            <div className={styles.value} key={entry.key}>
              {showLabels && (
                <span className={styles.entryLabel}>{entry.label}</span>
              )}
              <strong>{value(entry)}</strong>
              {delta?.(entry) && <small>{delta(entry)}</small>}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const divider = <div className={styles.divider} aria-hidden="true" />;
  return (
    <section
      className={`${styles.metrics} ${compact ? styles.compact : ""}`}
      aria-label="核心指标"
    >
      <article className={styles.metric} aria-label="伤害指标">
        {metric(
          "每威力伤害期望",
          (entry) => formatMetric(entry.damagePerPotency),
          (entry) => differenceText(entry.deltas?.damagePerPotency),
          objective === "damage",
        )}
        {divider}
        {metric(
          "每秒每威力伤害期望",
          (entry) => formatMetric(entry.damagePerSecond),
          (entry) => differenceText(entry.deltas?.damagePerSecond),
          objective === "dps",
        )}
      </article>
      <article className={styles.metric} aria-label="暴击率">
        {metric(
          "暴击率",
          (entry) => `${(entry.criticalRate * 100).toFixed(1)}%`,
        )}
        {divider}
        {metric(
          "直击率",
          (entry) => `${(entry.directHitRate * 100).toFixed(1)}%`,
        )}
      </article>
      <article className={styles.metric} aria-label="GCD">
        {metric(
          "GCD",
          (entry) => `${entry.gcd.toFixed(2)} 秒`,
          (entry) =>
            entry.deltas?.gcd === undefined
              ? undefined
              : signed(entry.deltas.gcd, 2),
        )}
        {divider}
        {showTenacity ? (
          metric(
            "坚韧减伤",
            (entry) => `${((entry.tenacityMitigation ?? 0) * 100).toFixed(1)}%`,
            (entry) =>
              entry.deltas?.tenacityMitigationPp === undefined
                ? undefined
                : `${signed(entry.deltas.tenacityMitigationPp, 2)}pp`,
          )
        ) : (
          <div />
        )}
      </article>
      <article className={styles.metric} aria-label="生命值">
        {metric("生命值", (entry) => entry.hp.toFixed(0))}
        {divider}
        <div className={styles.openActions}>
          {entries.map(
            (entry) =>
              entry.referenceUrl && (
                <ReferenceLink
                  key={entry.key}
                  entry={entry}
                  showLabel={showLabels}
                />
              ),
          )}
        </div>
      </article>
    </section>
  );
}
