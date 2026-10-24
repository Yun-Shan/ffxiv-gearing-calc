import { jobSchemas, type Effects, type JobId } from "@/domain";
import styles from "./ResultShareMetrics.module.scss";

export function ResultShareMetrics({
  effects,
  jobId,
}: {
  effects: Effects;
  jobId: JobId;
}) {
  const metrics = [
    { label: "GCD", value: `${effects.gcd.toFixed(2)} 秒` },
    { label: "暴击率", value: `${(effects.crtChance * 100).toFixed(1)}%` },
    { label: "直击率", value: `${(effects.dhtChance * 100).toFixed(1)}%` },
    ...(jobSchemas[jobId].role === "tank"
      ? [
          {
            label: "坚韧减伤",
            value: `${(effects.tenMitigation * 100).toFixed(1)}%`,
          },
        ]
      : []),
    { label: "生命值", value: effects.hp.toFixed(0) },
  ];
  return (
    <section className={styles.metrics} aria-label="核心指标">
      {metrics.map(({ label, value }) => (
        <div key={label} className={styles.metric}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}
