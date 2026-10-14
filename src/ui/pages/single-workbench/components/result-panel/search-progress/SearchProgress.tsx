import { useEffect, useState } from "react";
import styles from "./SearchProgress.module.scss";

/** 阶段与耗时只用于估算，不表示已知的搜索空间总量。 */
export function SearchProgress({ message }: { message: string }) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [milestone, setMilestone] = useState(5);
  const [verified, setVerified] = useState<number>();
  const [candidateCounts, setCandidateCounts] = useState<{ equipment: number; food: number; joint: boolean }>();

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    const phase = /还原并复核/.test(message)
      ? 95
      : /签名带|上界证明|复核完成/.test(message)
      ? 85
      : /精确候选已核验|已检查签名/.test(message)
        ? 65
        : /状态=|当前最优|incumbent|外层|候选准备完成/.test(message)
          ? 35
          : /基线|最高坚韧/.test(message)
            ? 15
            : 5;
    setMilestone((previous) => Math.max(previous, phase));
    const count = message.match(/(?:精确候选已核验\s*|已检查签名=)(\d+)/);
    if (count) setVerified(Number(count[1]));
    const poolCounts = message.match(/装备方案=(\d+)；食物候选=(\d+)/);
    if (poolCounts) setCandidateCounts({ equipment: Number(poolCounts[1]), food: Number(poolCounts[2]), joint: message.startsWith("联合") });
  }, [message]);

  // 求解器会在搜索过程中逐步发现工作量，因此结合阶段和耗时平滑估算；
  // 只有调用方确认结果后才表示完成。
  const estimate = Math.min(95, Math.floor(milestone + (95 - milestone) * (1 - Math.exp(-elapsed / 90))));
  const stage = /基线/.test(message)
    ? "计算各职业基线"
    : /最高坚韧/.test(message)
      ? "搜索坚韧边界"
    : /签名|核验|复核|上界证明/.test(message)
        ? "核验候选与最优性"
        : /状态=|当前最优|incumbent|外层|候选准备完成/.test(message)
          ? "求解并搜索配装"
          : "准备候选与搜索模型";

  return (
    <div className={styles.root} aria-label="搜索进度">
      <div className={styles.heading}>
        <strong>{stage}</strong>
        <span>估算 {estimate}%</span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="估算搜索进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={estimate}
        aria-valuetext={`估算已完成 ${estimate}%，尚余 ${100 - estimate}%；正在${stage}`}
      >
        <div className={styles.fill} style={{ width: `${estimate}%` }} />
      </div>
      <div className={styles.data}>
        <span>已用时 {Math.floor(elapsed)} 秒</span>
        <span>估算已完成 {estimate}% · 尚余 {100 - estimate}%</span>
        {candidateCounts && <span>已准备 {candidateCounts.equipment.toLocaleString()} 个装备方案 · {candidateCounts.food.toLocaleString()} 个食物候选{candidateCounts.joint ? "（各职业合计）" : ""}</span>}
        <span>{verified === undefined ? "已核验候选数：等待求解器报告" : `最近核验报告：该轮已检查 ${verified.toLocaleString()} 个候选签名`}</span>
        <span>未完成：继续搜索并确认最优性；候选总数尚未确定。</span>
      </div>
      <p className={styles.note}>按搜索阶段和耗时估算，可能停留或放缓；百分比不是候选完成比例，求解与复核完成前不会显示 100%。</p>
    </div>
  );
}
