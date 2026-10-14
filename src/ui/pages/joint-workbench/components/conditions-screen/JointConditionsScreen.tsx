import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Play } from "lucide-react";
import type { JointSearchSummary } from "../search-progress/JointSearchProgress";
import { jobSchemas } from "../../../../../domain/index";
import type { JobId } from "../../../../../domain/types";
import styles from "./JointConditionsScreen.module.scss";

interface ProfessionEditor {
  jobId: JobId;
  editor: ReactNode;
}

interface SharedSummaryCardProps {
  commonSlots: readonly string[];
  foodStrategy: string;
  commonFoodLabel: string;
  objective: string;
  selected: boolean;
  onSelect: () => void;
}

function SharedSummaryCard({
  commonSlots,
  foodStrategy,
  commonFoodLabel,
  objective,
  selected,
  onSelect,
}: SharedSummaryCardProps) {
  return (
    <button
      className={styles.summaryCard}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.summaryCardTitle}>共享条件</span>
      <span className={styles.summaryCardLine}>
        共享部位 {commonSlots.length ? commonSlots.join(" / ") : "暂无"}
      </span>
      <span className={styles.summaryCardLine}>
        共 {commonSlots.length} 个部位 · {commonSlots.includes("武器") ? "武器共用" : "武器独立搜索"}
      </span>
      <span className={styles.summaryCardLine}>食物策略 {foodStrategy}</span>
      <span className={styles.summaryCardLine}>共享食物 {commonFoodLabel}</span>
      <span className={styles.summaryCardLine}>优化目标 {objective}</span>
    </button>
  );
}

interface ProfessionSummaryCardProps {
  job: JointSearchSummary["jobs"][number];
  foodStrategy: string;
  selected: boolean;
  onSelect: () => void;
}

function ProfessionSummaryCard({ job, foodStrategy, selected, onSelect }: ProfessionSummaryCardProps) {
  const value = (label: string) => job.details.find((detail) => detail.label === label)?.value ?? "—";
  const lines = [
    `等级 ${value("等级")} · 同步 ${value("同步")}`,
    `装等 ${value("品级")}`,
    `GCD ${value("GCD")}`,
    `食物 ${value("食物")} · ${foodStrategy === "所有职业共用" ? "跟随共享策略" : "独立选择"}`,
    `装备限制 ${value("装备限制")}`,
  ];

  return (
    <button
      className={styles.summaryCard}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.summaryCardTitle}>
        <small>{job.jobId}</small>
        {job.name || jobSchemas[job.jobId].name}
      </span>
      {lines.map((line, index) => (
        <span className={styles.summaryCardLine} key={`${job.jobId}-${index}`}>{line}</span>
      ))}
    </button>
  );
}

export interface JointConditionsScreenProps {
  summary: JointSearchSummary;
  sharedSlotControls: ReactNode;
  foodStrategyControl: ReactNode;
  objectiveControl: ReactNode;
  professionEditors: readonly ProfessionEditor[];
  canStartSearch: boolean;
  feedbackMessage?: string;
  feedbackIsError?: boolean;
  history?: ReactNode;
  dataVersion: string;
  onReset?: () => void;
  onBackToSelection: () => void;
  onStartSearch: () => void;
}

export function JointConditionsScreen({
  summary,
  sharedSlotControls,
  foodStrategyControl,
  objectiveControl,
  professionEditors,
  canStartSearch,
  feedbackMessage,
  feedbackIsError = false,
  history,
  dataVersion,
  onReset,
  onBackToSelection,
  onStartSearch,
}: JointConditionsScreenProps) {
  const [selectedEditor, setSelectedEditor] = useState<"shared" | JobId>("shared");
  useEffect(() => {
    if (selectedEditor !== "shared" && !professionEditors.some((item) => item.jobId === selectedEditor)) {
      setSelectedEditor("shared");
    }
  }, [professionEditors, selectedEditor]);
  const editorIsAvailable = selectedEditor === "shared"
    || professionEditors.some((item) => item.jobId === selectedEditor);
  const activeEditor = editorIsAvailable ? selectedEditor : "shared";
  const selectedJob = summary.jobs.find((job) => job.jobId === activeEditor);
  const selectedProfessionEditor = professionEditors.find((item) => item.jobId === activeEditor);
  const foodValues = summary.jobs.map((job) => job.details.find((detail) => detail.label === "食物")?.value ?? "—");
  const commonFoodLabel = summary.foodStrategy === "所有职业共用"
    ? foodValues.every((value) => value === "自动食物")
      ? "自动选择"
      : new Set(foodValues).size === 1
        ? foodValues[0]
        : "按参与职业条件共同搜索"
    : "各职业单独选择";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>多职业联合搜索 · 第 2 步</p>
            <h1>设置联合条件</h1>
          </div>
          <button className={styles.backButton} type="button" onClick={onBackToSelection}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回职业选择
          </button>
        </header>

        {feedbackMessage && (
          <p className={`${styles.feedback} ${feedbackIsError ? styles.feedbackError : ""}`} role={feedbackIsError ? "alert" : "status"}>
            {feedbackMessage}
          </p>
        )}

        <div className={styles.workArea}>
          <aside className={styles.professionSummary} aria-label="已选职业条件摘要">
            <h2>条件摘要</h2>
            <SharedSummaryCard
              commonSlots={summary.commonSlots}
              foodStrategy={summary.foodStrategy}
              commonFoodLabel={commonFoodLabel}
              objective={summary.objective}
              selected={activeEditor === "shared"}
              onSelect={() => setSelectedEditor("shared")}
            />
            {summary.jobs.map((job) => (
              <ProfessionSummaryCard
                key={job.jobId}
                job={job}
                foodStrategy={summary.foodStrategy}
                selected={activeEditor === job.jobId}
                onSelect={() => setSelectedEditor(job.jobId)}
              />
            ))}
          </aside>

          <section className={styles.editor} aria-label="共享条件和职业专属参数">
            {activeEditor === "shared" ? (
              <section className={styles.sharedPanel} aria-labelledby="joint-shared-heading">
                <div className={styles.sectionTitle}>
                  <div>
                    <h2 id="joint-shared-heading">共享条件设置</h2>
                  </div>
                </div>
                <h3 className={styles.fieldHeading}>公共共享部位</h3>
                <div className={styles.slotControls}>{sharedSlotControls}</div>
                <div className={styles.sharedOptions}>
                  {foodStrategyControl}
                  {objectiveControl}
                </div>
                <div className={styles.sharedFoodRow}>
                  <span>共享食物</span>
                  <strong className={styles.sharedFoodValue}>{commonFoodLabel}</strong>
                </div>
                <div className={styles.sharedNote}>
                  <strong>装备限制</strong>
                  <span>来源范围、强制装备和排除装备在各职业条件中设置；共享部位需同时满足参与职业的条件。</span>
                </div>
              </section>
            ) : (
              <section className={styles.professionEditors} aria-label="职业专属参数">
                <div className={styles.sectionTitle}>
                  <div>
                    <h2>{selectedJob?.name || (activeEditor in jobSchemas ? jobSchemas[activeEditor as JobId].name : "职业专属参数")}</h2>
                    <p>设置该职业的等级、装备范围、速度目标、食物和装备限制。</p>
                  </div>
                  <span>{summary.jobs.length} 个职业</span>
                </div>
                {selectedProfessionEditor?.editor}
              </section>
            )}
          </section>
        </div>
      </main>

      <aside className={styles.rail} aria-label="联合搜索条件摘要">
        <div className={styles.railBody}>
          <header className={styles.railHeading}>
            <p className={styles.eyebrow}>条件摘要</p>
            <h2>联合搜索</h2>
          </header>

          <section className={styles.railSection} aria-label="参与职业">
            <h3>搜索职业</h3>
            <p className={styles.jobNames}>
              {summary.jobs.map((job) => job.name || jobSchemas[job.jobId].name).join(" + ")}
            </p>
          </section>

          <section className={styles.railSection} aria-label="共享条件摘要">
            <h3>共享条件</h3>
            <dl className={styles.railRows}>
              <div><dt>共享部位</dt><dd>{summary.commonSlots.length ? summary.commonSlots.join(" · ") : "不共享"}</dd></div>
              <div><dt>食物策略</dt><dd>{summary.foodStrategy}</dd></div>
              <div><dt>共享食物</dt><dd>{commonFoodLabel}</dd></div>
              <div><dt>目标</dt><dd>{summary.objective}</dd></div>
            </dl>
          </section>

          <div className={styles.railSpacer} aria-hidden="true" />

          <section className={styles.railSection} aria-label="职业配置状态">
            <h3>配置状态</h3>
            <p className={canStartSearch ? styles.readyStatus : styles.invalidStatus}>
              <span aria-hidden="true" />
              {canStartSearch ? "职业组合满足联合搜索要求" : "需要至少两个兼容职业"}
            </p>
          </section>

          <button className={styles.startButton} type="button" onClick={onStartSearch} disabled={!canStartSearch}>
            <Play size={15} fill="currentColor" aria-hidden="true" />
            开始联合搜索
          </button>

          <footer className={styles.railFooter}>
            <span>纯前端计算 · 可离线运行</span>
            <span>数据版本 {dataVersion}</span>
            {(history || onReset) && (
              <details className={styles.historyDisclosure}>
                <summary>更多</summary>
                <div className={styles.historyMenu}>
                  {onReset && (
                    <button className={styles.railResetButton} type="button" onClick={onReset}>
                      重置当前页面配置
                    </button>
                  )}
                  {history}
                </div>
              </details>
            )}
          </footer>
        </div>
      </aside>
    </div>
  );
}
