import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

export type SingleSearchPhase = "prepare" | "solve" | "verify";

export interface SingleSearchSlotCandidateCount {
  label: string;
  count: number;
}

export interface SingleSearchCurrentModelMetrics {
  /** Internal model identifier; used only to associate these metrics with the current model. */
  model?: string;
  /** Solver status, such as HiGHS' Optimal status. */
  status?: string;
  completed?: boolean;
  primalBound?: number;
  dualBound?: number;
  /** Actual solver-reported relative gap, expressed as a fraction. */
  gap?: number;
  nodes?: number;
  lpIterations?: number;
  variables?: number;
  constraints?: number;
}

export interface SingleSearchSecondRoundVerification {
  round: number;
  verifiedCombinations?: number;
}

export interface SingleSearchProgressState {
  phase: SingleSearchPhase;
  /** Human-readable status mapped from real search state; do not pass raw callback payloads. */
  statusMessage: string;
  /** Unix timestamp in milliseconds. */
  startedAt: number;
  hasFeasibleCandidate: boolean;
  slotCandidateCounts?: readonly SingleSearchSlotCandidateCount[];
  foodCandidateCount?: number;
  currentModel?: SingleSearchCurrentModelMetrics;
  secondRoundVerification?: SingleSearchSecondRoundVerification;
}

export interface SingleSearchProgressProps {
  jobName: string;
  progress: SingleSearchProgressState;
  rightSummary: ReactNode;
  onCancel: () => void;
}

const SEARCH_STAGES: ReadonlyArray<{ phase: SingleSearchPhase; label: string }> = [
  { phase: "prepare", label: "准备候选与搜索模型" },
  { phase: "solve", label: "求解并搜索配装" },
  { phase: "verify", label: "核验候选与最优性" },
];

function isNonnegativeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatElapsedTime(startedAt: number, now: number): string {
  const totalSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds].map((part) => String(part).padStart(2, "0"));
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${parts[0]}:${parts[1]}`
    : `${parts[0]}:${parts[1]}`;
}

function isModelComplete(metrics: SingleSearchCurrentModelMetrics): boolean {
  if (metrics.completed === true) return true;
  const status = metrics.status?.trim().toLowerCase();
  return status !== undefined &&
    (/\boptimal\b|\bcompleted\b|\bcomplete\b|最优|完成/.test(status));
}

function formatGap(metrics: SingleSearchCurrentModelMetrics, complete: boolean): string | undefined {
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
  return counts?.filter(
    ({ label, count }) => label.trim().length > 0 && isNonnegativeInteger(count),
  ) ?? [];
}

export function SingleSearchProgress({
  jobName,
  progress,
  rightSummary,
  onCancel,
}: SingleSearchProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stageIndex = SEARCH_STAGES.findIndex(({ phase }) => phase === progress.phase);
  const slotCandidateCounts = getValidSlotCounts(progress.slotCandidateCounts);
  const foodCandidateCount = progress.foodCandidateCount;
  const hasFoodCount = isNonnegativeInteger(foodCandidateCount);
  const hasCandidateCounts = slotCandidateCounts.length > 0 || hasFoodCount;
  const currentModel = progress.currentModel;
  const modelComplete = currentModel ? isModelComplete(currentModel) : false;
  const gap = currentModel ? formatGap(currentModel, modelComplete) : undefined;
  const hasVisibleModelMetrics = currentModel !== undefined && (
    modelComplete ||
    gap !== undefined ||
    isNonnegativeInteger(currentModel.nodes) ||
    isNonnegativeInteger(currentModel.lpIterations) ||
    isNonnegativeInteger(currentModel.variables) ||
    isNonnegativeInteger(currentModel.constraints)
  );
  const roundVerification = progress.secondRoundVerification;
  const verifiedCombinations = roundVerification?.verifiedCombinations;
  const showSecondRoundVerification =
    roundVerification !== undefined &&
    Number.isInteger(roundVerification.round) &&
    roundVerification.round >= 2 &&
    isNonnegativeInteger(verifiedCombinations);
  const searchStatus = progress.hasFeasibleCandidate
    ? "已找到待核验方案，正在检查是否还有更优方案"
    : "正在寻找可行配装";

  return (
    <div className="single-search-progress-page">
      <div className="single-search-progress-layout">
        <main className="single-search-progress-main">
          <header className="single-search-progress-header">
            <div>
              <p className="single-search-progress-eyebrow">单职业配装搜索</p>
              <h1>{jobName}</h1>
            </div>
          </header>

          <ol className="single-search-stage-track" aria-label="搜索阶段">
            {SEARCH_STAGES.map((stage, index) => {
              const isCurrent = index === stageIndex;
              const isComplete = index < stageIndex;
              const stateClass = isCurrent ? "is-current" : isComplete ? "is-complete" : "is-upcoming";
              return (
                <li
                  className={`single-search-stage ${stateClass}`}
                  key={stage.phase}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="single-search-stage-index" aria-hidden="true">
                    {isComplete ? <Check size={14} strokeWidth={3} /> : index + 1}
                  </span>
                  <span>{stage.label}</span>
                </li>
              );
            })}
          </ol>

          {hasCandidateCounts && (
            <section className="single-search-candidate-row" aria-label="候选数量">
              {slotCandidateCounts.length > 0 && (
                <div className="single-search-equipment-candidates">
                  <h2>装备候选</h2>
                  <div
                    className="single-search-candidate-grid"
                    style={{
                      "--single-search-grid-columns": String(Math.max(1, Math.ceil(slotCandidateCounts.length / 2))),
                    } as React.CSSProperties}
                  >
                    {slotCandidateCounts.map(({ label, count }) => (
                      <div className="single-search-candidate-slot" key={label}>
                        <span className="single-search-candidate-slot-label">{label}</span>
                        <strong className="single-search-candidate-slot-count">{formatCount(count)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasFoodCount && (
                <div className="single-search-food-candidates">
                  <h2>食物候选</h2>
                  <strong>{formatCount(foodCandidateCount)}</strong>
                </div>
              )}
            </section>
          )}

          <section className="single-search-live-status" aria-live="polite">
            <p className="single-search-status-primary">{searchStatus}</p>
            {progress.phase === "verify" && (
              <p className="single-search-status-verification">正在核验候选方案</p>
            )}
            {progress.statusMessage.trim().length > 0 && (
              <p className="single-search-status-detail">{progress.statusMessage}</p>
            )}
            <p className="single-search-elapsed-time">
              已用时 {formatElapsedTime(progress.startedAt, now)}
            </p>
          </section>

          {hasVisibleModelMetrics && currentModel && (
            <section className="single-search-model-metrics" aria-label="当前模型求解信息">
              <div className="single-search-model-heading">
                <h2>当前模型工作状态</h2>
                <span>仅描述当前模型</span>
              </div>
              {modelComplete && (
                <p className="single-search-model-complete">当前模型已完成</p>
              )}
              <div className="single-search-model-metric-grid">
                {gap !== undefined && <div><span>当前模型差距</span><strong>{gap}</strong></div>}
                {isNonnegativeInteger(currentModel.nodes) && (
                  <div><span>已探索节点</span><strong>{formatCount(currentModel.nodes)}</strong></div>
                )}
                {isNonnegativeInteger(currentModel.lpIterations) && (
                  <div><span>线性规划迭代数</span><strong>{formatCount(currentModel.lpIterations)}</strong></div>
                )}
                {(isNonnegativeInteger(currentModel.variables) || isNonnegativeInteger(currentModel.constraints)) && (
                  <div>
                    <span>模型规模</span>
                    <strong>
                      {isNonnegativeInteger(currentModel.variables) && `${formatCount(currentModel.variables)} 个变量`}
                      {isNonnegativeInteger(currentModel.variables) && isNonnegativeInteger(currentModel.constraints) && " · "}
                      {isNonnegativeInteger(currentModel.constraints) && `${formatCount(currentModel.constraints)} 条约束`}
                    </strong>
                  </div>
                )}
              </div>
              <p className="single-search-model-note">
                求解数据仅描述当前模型，不代表整场搜索完成比例。
              </p>
            </section>
          )}

          {showSecondRoundVerification && roundVerification && isNonnegativeInteger(verifiedCombinations) && (
            <p className="single-search-round-verification">
              正在第 {roundVerification.round} 轮，已核验 {formatCount(verifiedCombinations)} 组候选组合
            </p>
          )}
        </main>

        <aside className="single-search-progress-rail" aria-label="搜索条件摘要">
          <div className="single-search-progress-summary">{rightSummary}</div>
          <button className="single-search-cancel-button" type="button" onClick={onCancel}>
            取消搜索
          </button>
        </aside>
      </div>
    </div>
  );
}
