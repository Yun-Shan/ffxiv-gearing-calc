import { useElapsedTime } from "@/ui/components/search-progress/use-elapsed-time";
import styles from "@/ui/components/search-progress/SearchWorkflowProgress.module.scss";

export type SingleSearchPhase = "prepare" | "solve" | "verify";

export interface SingleSearchSlotCandidateCount {
  label: string;
  count: number;
}

export interface SingleSearchCurrentModelMetrics {
  /** 内部模型标识，仅用于将指标关联到当前模型。 */
  model?: string;
  /** 求解器状态，例如 HiGHS 报告的最优状态。 */
  status?: string;
  completed?: boolean;
  primalBound?: number;
  dualBound?: number;
  /** 求解器报告的实际相对间隙，以小数表示。 */
  gap?: number;
  nodes?: number;
  lpIterations?: number;
  variables?: number;
  constraints?: number;
}

export interface SingleSearchProgressState {
  phase: SingleSearchPhase;
  /** 起始时间戳，单位为毫秒。 */
  startedAt: number;
  hasFeasibleCandidate: boolean;
  slotCandidateCounts?: readonly SingleSearchSlotCandidateCount[];
  foodCandidateCount?: number;
  currentModel?: SingleSearchCurrentModelMetrics;
}

export interface SingleSearchProgressProps {
  jobName: string;
  progress: SingleSearchProgressState;
}

const SEARCH_STAGES: ReadonlyArray<{
  phase: SingleSearchPhase;
  label: string;
}> = [
  { phase: "prepare", label: "准备候选与搜索模型" },
  { phase: "solve", label: "求解并搜索配装" },
  { phase: "verify", label: "核验候选与最优性" },
];

function isNonnegativeInteger(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

function isModelComplete(metrics: SingleSearchCurrentModelMetrics): boolean {
  if (metrics.completed === true) return true;
  const status = metrics.status?.trim().toLowerCase();
  return (
    status !== undefined &&
    /\boptimal\b|\bcompleted\b|\bcomplete\b|最优|完成/.test(status)
  );
}

function formatGap(
  metrics: SingleSearchCurrentModelMetrics,
  complete: boolean,
): string | undefined {
  const primalBound = metrics.primalBound;
  const dualBound = metrics.dualBound;
  const relativeGap = metrics.gap;
  if (
    complete ||
    typeof primalBound !== "number" ||
    !Number.isFinite(primalBound) ||
    typeof dualBound !== "number" ||
    !Number.isFinite(dualBound) ||
    typeof relativeGap !== "number" ||
    !Number.isFinite(relativeGap) ||
    relativeGap <= 0
  ) {
    return undefined;
  }
  return `${(relativeGap * 100).toFixed(1)}%`;
}

function getValidSlotCounts(
  counts: readonly SingleSearchSlotCandidateCount[] | undefined,
): readonly SingleSearchSlotCandidateCount[] {
  return (
    counts?.filter(
      ({ label, count }) =>
        label.trim().length > 0 && isNonnegativeInteger(count),
    ) ?? []
  );
}

export function SingleSearchProgress({
  jobName,
  progress,
}: SingleSearchProgressProps) {
  const elapsed = useElapsedTime(progress.startedAt);

  const stageIndex = SEARCH_STAGES.findIndex(
    ({ phase }) => phase === progress.phase,
  );
  const slotCandidateCounts = getValidSlotCounts(progress.slotCandidateCounts);
  const foodCandidateCount = progress.foodCandidateCount;
  const hasFoodCount = isNonnegativeInteger(foodCandidateCount);
  const hasCandidateCounts = slotCandidateCounts.length > 0 || hasFoodCount;
  const candidateCounts = [
    ...slotCandidateCounts.map((candidate) => ({
      ...candidate,
      kind: "equipment" as const,
    })),
    ...(hasFoodCount
      ? [{ label: "食物", count: foodCandidateCount, kind: "food" as const }]
      : []),
  ];
  const currentModel = progress.currentModel;
  const modelComplete = currentModel ? isModelComplete(currentModel) : false;
  const gap = currentModel ? formatGap(currentModel, modelComplete) : undefined;
  const hasVisibleModelMetrics =
    currentModel !== undefined &&
    (modelComplete ||
      gap !== undefined ||
      isNonnegativeInteger(currentModel.nodes) ||
      isNonnegativeInteger(currentModel.lpIterations) ||
      isNonnegativeInteger(currentModel.variables) ||
      isNonnegativeInteger(currentModel.constraints));
  const modelNodes = currentModel?.nodes;
  const lpIterations = currentModel?.lpIterations;
  const statusMessage =
    progress.phase === "prepare"
      ? "正在准备候选与搜索模型"
      : progress.phase === "verify"
        ? "已找到待核验方案，正在检查是否还有更优方案"
        : progress.hasFeasibleCandidate
          ? "已找到可行方案，正在继续搜索更优配装"
          : "正在寻找符合条件的最优配装";

  return (
    <section className={styles.main} aria-label={`${jobName}搜索进度`}>
      <ol className={styles.stageTrack} aria-label="搜索阶段">
        {SEARCH_STAGES.map((stage, index) => {
          const isCurrent = index === stageIndex;
          const isComplete = index < stageIndex;
          const stateClass = isCurrent
            ? styles.isCurrent
            : isComplete
              ? styles.isComplete
              : styles.isUpcoming;
          return (
            <li
              className={`${styles.stage} ${stateClass}`}
              key={stage.phase}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className={styles.stageIndex} aria-hidden="true">
                {isComplete ? "✓" : index + 1}
              </span>
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ol>

      {hasCandidateCounts && (
        <section className={styles.candidateRow} aria-label="候选数量">
          <div className={styles.equipmentCandidates}>
            <div className={styles.candidateGrid}>
              {candidateCounts.map(({ label, count, kind }, index) => (
                <div
                  className={`${styles.candidateSlot}${kind === "food" ? ` ${styles.isFoodCandidate}` : ""}`}
                  key={`${kind}-${index}`}
                >
                  <span className={styles.candidateSlotLabel}>{label}</span>
                  <strong className={styles.candidateSlotCount}>
                    {formatCount(count)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
          <h2 className={styles.candidateHeading}>装备与食物候选</h2>
        </section>
      )}

      <section className={styles.liveStatus} aria-live="polite">
        <p className={styles.statusPrimary}>{statusMessage}</p>
        <p className={styles.elapsedTime}>
          已用时 {elapsed}
        </p>
      </section>

      {hasVisibleModelMetrics && currentModel && (
        <section className={styles.modelMetrics} aria-label="当前算法搜索状态">
          <div className={styles.modelHeading}>
            <h2>当前算法搜索状态</h2>
          </div>
          <div className={styles.modelMetricGrid}>
            {gap !== undefined && (
              <div>
                <span>当前模型差距</span>
                <strong>{gap}</strong>
              </div>
            )}
            {isNonnegativeInteger(modelNodes) && (
              <div>
                <span>已探索节点</span>
                <strong>{formatCount(modelNodes)}</strong>
              </div>
            )}
            {isNonnegativeInteger(lpIterations) && (
              <div>
                <span>线性规划迭代数</span>
                <strong>{formatCount(lpIterations)}</strong>
              </div>
            )}
            {(isNonnegativeInteger(currentModel.variables) ||
              isNonnegativeInteger(currentModel.constraints)) && (
              <div className={styles.modelScale}>
                <span>模型规模</span>
                <strong>
                  {isNonnegativeInteger(currentModel.variables) &&
                    `${formatCount(currentModel.variables)} 个变量`}
                  {isNonnegativeInteger(currentModel.variables) &&
                    isNonnegativeInteger(currentModel.constraints) &&
                    " · "}
                  {isNonnegativeInteger(currentModel.constraints) &&
                    `${formatCount(currentModel.constraints)} 条约束`}
                </strong>
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
