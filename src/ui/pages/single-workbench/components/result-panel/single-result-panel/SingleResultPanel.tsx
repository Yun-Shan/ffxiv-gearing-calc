import { Check, Play, X } from "lucide-react";
import {
  jobSchemas,
  type OptimizationConfig,
  type OptimizationResult,
  type Stat,
} from "../../../../../../domain/index";
import { defaultJobLevel } from "../../../../../services/app-config";
import { statName, statValue } from "../../../../../services/labels";
import { SearchProgress } from "../search-progress/SearchProgress";
import { ConfigSnapshot } from "../../../../../components/config-snapshot/ConfigSnapshot";
import { SingleConditionSummary } from "../../summary/single-condition-summary/SingleConditionSummary";
import { stringifyReferenceGearset } from "../../../../../services/reference-gearset-share";
import { SingleJobResultView } from "../single-job-result-view/SingleJobResultView";
import { GearTable } from "../../../../../components/results/gear-table/GearTable";
import styles from "./SingleResultPanel.module.css";

export function StatusPanel({
  running,
  progress,
  rawProgress,
  error,
  message,
  onCancel,
}: {
  running: boolean;
  progress: string;
  rawProgress?: string;
  error?: string;
  message?: string;
  onCancel: () => void;
}) {
  if (!running && !error && !message) return null;
  const statusClass = error ? styles.hasError : running ? styles.isRunning : "";
  return (
    <div
      className={`${styles.searchStatus} ${statusClass}`.trim()}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      <div className={styles.searchStatusCopy}>
        <span className={styles.statusDot} />
        <div>
          <strong>{error ? "搜索失败" : running ? "正在搜索" : message?.includes("取消") ? "搜索已取消" : message?.includes("没有") ? "没有可行配装" : message?.includes("完成") ? "搜索已完成" : "搜索状态"}</strong>
          <p>{error ?? (running ? progress : message ?? progress)}</p>
        </div>
      </div>
      {running && (
        <>
          <SearchProgress message={rawProgress ?? progress} />
          <button className={styles.cancelButton} onClick={onCancel}>
            <X size={14} />
            取消搜索
          </button>
        </>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`${styles.statPill}${accent ? ` ${styles.accent}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function referenceGearsetUrl(result: OptimizationResult, config: OptimizationConfig): string {
  const job = jobSchemas[config.jobId];
  const gears = result.gear.map((gear) => {
    const synced = config.syncLevel !== undefined && gear.level > config.syncLevel;
    const resistanceStats = gear.resistanceWeaponAdjust?.stats ?? [];
    const resistanceValues = [...new Set(resistanceStats)]
      .map((stat) => [stat, gear.melds
        .filter((meld) => meld.stat === stat && meld.grade === 0)
        .reduce((total, meld) => total + meld.value, 0)] as const)
      .filter(([, value]) => value > 0);
    const customStats: Partial<Record<Stat, number>> | undefined = gear.customParameters?.length
      ? Object.fromEntries([...new Set(gear.customParameters.map(({ stat }) => stat))]
          .map((stat) => [stat, Math.max(0, (gear.finalStats[stat] ?? 0) - (gear.stats[stat] ?? 0))] as const)
          .filter(([, value]) => value > 0))
      : resistanceValues.length > 0
        ? Object.fromEntries(resistanceValues)
        : undefined;
    return {
      id: gear.id,
      materias: customStats || synced ? [] : gear.melds.map(({ stat, grade }) => [stat, grade] as const),
      ...(customStats ? { customStats } : {}),
    };
  });
  const share = stringifyReferenceGearset({
    job: config.jobId,
    role: job.role,
    jobLevel: result.calculationLevel ?? config.jobLevel ?? job.maxJobLevel ?? defaultJobLevel,
    ...(config.syncLevel === undefined ? {} : { syncLevel: config.syncLevel }),
    gears,
  });
  return share ? `https://asvel.github.io/ffxiv-gearing/?${share}` : "";
}
export function ResultPanel({
  result,
  config,
  baseline,
  attempted = false,
  failed = false,
  statusMessage,
  stale = false,
  onEditConfig,
  compact = false,
  searchStartedAt,
  resultDataVersion,
}: {
  result?: OptimizationResult;
  config: OptimizationConfig;
  baseline?: OptimizationResult;
  attempted?: boolean;
  failed?: boolean;
  statusMessage?: string;
  stale?: boolean;
  onEditConfig?: () => void;
  compact?: boolean;
  searchStartedAt?: string;
  resultDataVersion?: string;
}) {
  if (!result) {
    const cancelled = statusMessage?.includes("取消") ?? false;
    return (
      <div className={`${styles.emptyState} ${styles.resultStatus}`}>
        <div className={styles.emptyIcon}>
          {attempted || cancelled || failed ? <X size={19} /> : <Play size={19} />}
        </div>
        <h2>{failed ? "搜索未完成" : cancelled ? "搜索已取消" : attempted ? "没有可行配装" : "尚未搜索"}</h2>
        <p>
          {failed
            ? "请查看上方错误信息，修正条件后重新搜索。"
            : cancelled
              ? "本次搜索已停止，当前没有新的推荐结果；确认条件后可以重新开始。"
            : attempted
                ? "当前约束下没有可行结果，请调整条件后重试。"
                : "设置搜索条件后，点击“开始搜索”生成结果。"}
        </p>
      </div>
    );
  }
  const ratio =
    baseline && baseline.score > 0
      ? ((result.score / baseline.score) * 100).toFixed(4) + "%"
      : undefined;
  if (compact) {
    return <SingleJobResultView
      result={result}
      referenceUrl={referenceGearsetUrl(result, config)}
      table={<GearTable result={result} config={config} compact />}
      summary={<SingleConditionSummary
        config={config}
        view="result"
        result={result}
        startedAtISO={searchStartedAt}
        dataVersion={resultDataVersion}
      />}
      onEditConfig={onEditConfig}
    />;
  }
  return (
    <div className={styles.resultWorkspace}>
      <div>
      <div className={styles.resultCompletion} role="status">
        <Check size={18} aria-hidden="true" />
        <div>
          <strong>{stale ? "历史搜索已完成 · 当前条件待更新" : "搜索已完成"}</strong>
          <p>求解与结果复核已完成；最优结果限于本次候选与约束。</p>
        </div>
      </div>
      {stale && <div className={styles.staleNotice} role="status">
        条件已修改，以下配装对应上一组条件，不代表当前设置的推荐结果。
      </div>}
      <div className={`${styles.metricStrip} ${styles.resultConclusion}`}>
        <Metric
          label="每威力伤害期望"
          value={result.effects.damage.toFixed(7)}
        />
        <Metric label="GCD" value={result.effects.gcd.toFixed(2) + " 秒"} />
        <Metric label="暴击率" value={(result.effects.crtChance * 100).toFixed(1) + "%"} />
        <Metric label="直击率" value={(result.effects.dhtChance * 100).toFixed(1) + "%"} />
        <Metric label="按 GCD 折算" value={result.damagePerSecond.toFixed(7)} />
      </div>
      <div className="result-toolbar">
        <div>
          <h2>推荐配装</h2>
          <span className="muted">
            {`目标值 ${result.score.toFixed(7)}${ratio ? " · 单职业基线比例 " + ratio : ""} · ${result.searchedCandidates.toLocaleString()} 个候选 · ${result.durationMs.toFixed(0)} 毫秒`}
          </span>
        </div>
        {result.maximumTenacity !== undefined && (
          <span className={styles.computeChip}>
            最高坚韧 {result.maximumTenacity.toLocaleString()}
          </span>
        )}
      </div>
      <GearTable result={result} config={config} />
      </div>
      <div>
      <div className={styles.resultSection}>
        <div className="result-toolbar">
          <div>
            <h2>配装总属性</h2>
            <span className="muted">已计入食物比例加成与装备魔晶石</span>
          </div>
        </div>
        <div className={styles.statSummaryGrid}>
          {Object.entries(result.stats)
            .filter(([, value]) => value && value > 0)
            .map(([stat, value]) => (
              <div className={styles.statCard} key={stat}>
                <span>{statName(stat)}</span>
                <strong>{statValue(stat, value)}</strong>
              </div>
            ))}
        </div>
        <div className={styles.effectSummary}>
          <div>
            <span>坚韧伤害加成</span>
            <strong>{(result.effects.tenDamage * 100).toFixed(2)}%</strong>
          </div>
          <div>
            <span>坚韧减伤</span>
            <strong>{(result.effects.tenMitigation * 100).toFixed(2)}%</strong>
          </div>
          <div>
            <span>生命值</span>
            <strong>{result.effects.hp.toLocaleString()}</strong>
          </div>
          <div>
            <span>每3秒魔力恢复</span>
            <strong>{result.effects.mp.toLocaleString()}</strong>
          </div>
        </div>
      </div>
      <ConfigSnapshot config={config} onEdit={onEditConfig} />
      </div>
    </div>
  );
}
