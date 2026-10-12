import { useEffect, useState } from "react";
import type { LinearMipProgress } from "../../domain/search/linear-mip";
import singleStyles from "../SingleSearchProgress.module.css";
import type {
  JointSearchProgressJob,
  JointSearchProgressState,
  JointSearchStats,
} from "../JointSearchProgress";
import styles from "../JointSearchProgress.module.css";

type Metric = { label: string; value: string };

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [minutes, seconds].map((part) => String(part).padStart(2, "0"));
  return hours > 0
    ? String(hours).padStart(2, "0") + ":" + clock[0] + ":" + clock[1]
    : clock[0] + ":" + clock[1];
}

function formatDuration(milliseconds: number | undefined): string | undefined {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  return milliseconds >= 1000
    ? (milliseconds / 1000).toFixed(1) + " 秒"
    : Math.round(milliseconds) + " 毫秒";
}

function formatSolverCount(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const count = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(count) && count >= 0 ? formatCount(count) : undefined;
}

function formatSolverValue(value: number | undefined, digits = 7): string | undefined {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : undefined;
}

function getSolverMetrics(solver: LinearMipProgress): Metric[] {
  return [
    { label: "求解耗时 (ms)", value: solver.elapsedMs === undefined ? undefined : formatCount(solver.elapsedMs) },
    { label: "目标值", value: formatSolverValue(solver.objectiveValue) },
    { label: "Best bound", value: formatSolverValue(solver.bestBound) },
    {
      label: "Gap",
      value: solver.gap !== undefined && Number.isFinite(solver.gap) && solver.gap >= 0
        ? (solver.gap * 100).toFixed(2) + "%"
        : undefined,
    },
    { label: "已探索节点", value: formatSolverCount(solver.nodes) },
    { label: "LP 迭代", value: formatSolverCount(solver.totalLpIterations) },
  ].filter((metric): metric is Metric => metric.value !== undefined);
}

function SolverMeta({ solver }: { solver: LinearMipProgress }) {
  const model = solver.model ? `模型 ${solver.model}` : undefined;
  const kind = solver.kind ? `类型 ${solver.kind}` : undefined;
  const backend = solver.backend || undefined;
  const counts = [
    solver.variableCount === undefined ? undefined : `变量 ${formatCount(solver.variableCount)}`,
    solver.rowCount === undefined ? undefined : `行 ${formatCount(solver.rowCount)}`,
    solver.status ? `状态 ${solver.status}` : undefined,
  ].filter((item): item is string => item !== undefined);
  const identity = [backend, model, kind].filter((item): item is string => item !== undefined).join(" · ");

  return (
    <>
      {identity && <p className={styles.solverMeta}>{identity}</p>}
      {counts.length > 0 && <p className={styles.solverMeta}>{counts.join(" · ")}</p>}
      {solver.message && <p className={styles.solverMessage}>消息：{solver.message}</p>}
    </>
  );
}

function MetricGrid({
  metrics,
  type,
}: {
  metrics: readonly Metric[];
  type: "solver" | "joint";
}) {
  return (
    <dl className={`${styles.metricGrid} ${type === "solver" ? styles.solverMetricGrid : styles.jointMetricGrid}`}>
      {metrics.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PreparationDetail({ jobs }: { jobs: readonly JointSearchProgressJob[] }) {
  return (
    <div className={styles.phaseContent}>
      <header className={styles.phaseSectionHeading}>
        <h3>各职业搜索模型准备状态</h3>
      </header>
      <ul className={styles.preparationList} aria-label="各职业准备状态">
        {jobs.map((job) => {
          const status = job.preparationFailed ? "准备失败" : job.prepared ? "准备完成" : "准备中";
          const statusClass = job.preparationFailed
            ? styles.statusFailed
            : job.prepared
              ? styles.statusReady
              : styles.statusPending;
          return (
            <li className={styles.preparationRow} key={job.jobId}>
              <span className={styles.professionName}>{job.name}</span>
              <span className={styles.statusTag + " " + statusClass}>{status}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BaselineDetail({ jobs }: { jobs: readonly JointSearchProgressJob[] }) {
  return (
    <div className={styles.phaseContent}>
      <header className={styles.phaseSectionHeading}>
        <h3>逐职业单职业最优伤害基线</h3>
        <p>各职业独立显示求解状态</p>
      </header>
      <div className={styles.professionGrid}>
        {jobs.map((job) => {
          const solver = job.solver;
          const metrics = solver ? getSolverMetrics(solver) : [];
          return (
            <article className={styles.professionCard} key={job.jobId}>
              <header className={styles.cardHeading}>
                <h3>{job.name}</h3>
                <span className={styles.modelStatus}>{solver?.status ?? (solver ? "收到求解器回报" : "等待回报")}</span>
              </header>
              {solver ? (
                <>
                  {metrics.length > 0 ? <MetricGrid metrics={metrics} type="solver" /> : <p className={styles.emptyMetrics}>等待可显示的求解指标。</p>}
                  <SolverMeta solver={solver} />
                </>
              ) : (
                <p className={styles.emptyMetrics}>该职业的基线求解尚未回报指标。</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function getJointMetrics(stats: JointSearchStats): Metric[] {
  const metrics = [
    { label: "共享候选估分", value: stats.seedCandidates },
    { label: "枚举上限", value: stats.seedLimit },
    { label: "热启动候选", value: stats.warmStartCandidates },
    { label: "精确尝试", value: stats.exactAttempts },
    { label: "外层节点", value: stats.outerNodes },
    { label: "完成节点", value: stats.completeNodes },
    { label: "上界剪枝", value: stats.upperBoundPrunes },
    { label: "内层 MIP", value: stats.innerMipSolves },
    { label: "父结果复用", value: stats.parentResultReuses },
    { label: "当前最好值", value: stats.incumbent },
    { label: "联合搜索耗时", value: stats.elapsedMs },
  ].filter((metric): metric is { label: string; value: number } =>
    metric.value !== undefined && Number.isFinite(metric.value),
  );

  return metrics.map(({ label, value }) => ({
    label,
    value: label === "联合搜索耗时"
      ? formatDuration(value) ?? formatCount(value)
      : label === "当前最好值"
        ? value.toFixed(7)
        : formatCount(value),
  }));
}

function JointSearchDetail({
  solver,
  stats,
}: {
  solver?: LinearMipProgress;
  stats: JointSearchStats;
}) {
  const solverMetrics = solver ? getSolverMetrics(solver) : [];
  const jointMetrics = getJointMetrics(stats);
  return (
    <div className={styles.phaseContent}>
      <header className={styles.phaseSectionHeading}>
        <div>
          <h3>共享装备条件下搜索最优联合方案</h3>
          <p>联合 MIP 求解状态</p>
        </div>
      </header>
      {solver && (
        <article className={styles.professionCard + " " + styles.jointSolverCard}>
          <header className={styles.cardHeading}>
            <h3>联合 MIP 模型</h3>
            <span className={styles.modelStatus}>{solver.status ?? solver.kind}</span>
          </header>
          {solverMetrics.length > 0
            ? <MetricGrid metrics={solverMetrics} type="solver" />
            : <p className={styles.emptyMetrics}>等待求解器回报指标。</p>}
          <SolverMeta solver={solver} />
        </article>
      )}
      {jointMetrics.length > 0 ? (
        <MetricGrid metrics={jointMetrics} type="joint" />
      ) : (
        <p className={styles.emptyMetrics}>等待联合搜索回报统计。</p>
      )}
    </div>
  );
}

function VerificationDetail({ message }: { message?: string }) {
  return (
    <div className={styles.phaseContent}>
      <header className={styles.phaseSectionHeading}>
        <h3>最优性与候选核验</h3>
      </header>
      <p className={styles.verifyMessage} role="status" aria-live="polite">
        {message ?? "正在等待候选与最优性核验信息。"}
      </p>
      <p className={styles.phaseDescription}>最终配装、公共装备及最优性证明会在搜索完成后显示在结果页。</p>
    </div>
  );
}

export function JointProgressPhaseDetail({ progress }: { progress: JointSearchProgressState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = formatElapsed(progress.startedAt, now);
  const title = progress.phase === "prepare"
    ? "正在准备各职业的搜索模型"
    : progress.phase === "baseline"
      ? "正在计算各职业的单职业最优伤害基线"
      : progress.phase === "joint"
        ? "正在搜索共享装备条件下的联合方案"
        : "正在核验候选与最优性";

  return (
    <section className={styles.detailBoard} aria-labelledby="joint-current-phase-title">
      <header className={`${singleStyles.liveStatus} ${styles.phaseStatus}`}>
        <h2 id="joint-current-phase-title" className={singleStyles.statusPrimary} aria-live="polite">{title}</h2>
        <p className={singleStyles.elapsedTime}>已用时 {elapsed}</p>
      </header>
      {progress.phase === "prepare" && <PreparationDetail jobs={progress.jobs} />}
      {progress.phase === "baseline" && <BaselineDetail jobs={progress.jobs} />}
      {progress.phase === "joint" && <JointSearchDetail solver={progress.jointSolver} stats={progress.jointStats} />}
      {progress.phase === "verify" && <VerificationDetail message={progress.verifyMessage} />}
    </section>
  );
}
