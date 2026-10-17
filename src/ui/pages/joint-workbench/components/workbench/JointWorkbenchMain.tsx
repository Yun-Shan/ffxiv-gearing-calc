import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { jobIconUrl } from "@/ui/services/job-icons";
import { useEffect, useRef } from "react";
import { Tabs } from "@base-ui/react/tabs";
import {
  jobSchemas,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
} from "@/domain";
import {
  JobSelection,
  type JointJobSelectionState,
} from "@/ui/components/job-selection/JobSelection";
import { SidePanel } from "@/ui/components/side-panel/SidePanel";
import {
  JointJobConditionScope,
  JobConditionEditor,
  analyzeFeasibleGcds,
  gcdAnalysisInputFromConfig,
  gcdAnalysisKey,
  useGcdAnalysisController,
} from "@/ui/features/job-condition";
import type {
  GcdAnalysisInput,
  GcdAnalysisState,
  JobConditionDraftChange,
  WorkbenchValidation,
} from "@/ui/features/job-condition";
import { isSlotShared } from "@/ui/features/equipment";
import type {
  EquipmentAction,
  JointEquipmentDraft,
} from "@/ui/features/equipment";
import { JointFoodStrategySection } from "../joint-food-strategy-section/JointFoodStrategySection";
import { JointJobEquipmentRestrictions } from "../joint-job-equipment-restrictions/JointJobEquipmentRestrictions";
import { JointSharedEquipmentRestrictions } from "../joint-shared-equipment-restrictions/JointSharedEquipmentRestrictions";
import { SharedSlotsSection } from "../shared-slots-section/SharedSlotsSection";
import { JointProgressPhaseDetail } from "../search-progress/components/joint-progress-phase-detail/JointProgressPhaseDetail";
import type {
  JointSearchPhase,
  JointSearchProgressState,
} from "../../joint-workbench-progress-types";
import {
  CoreMetricBar,
  buildResultMetricEntry,
} from "@/ui/components/results/core-metric-bar/CoreMetricBar";
import {
  GearTable,
  buildResultGearTableRows,
} from "@/ui/components/results/gear-table/GearTable";
import type { SearchHistoryRecord } from "@/ui/services/search-history";
import {
  SearchHistory,
  HistoryOverlay,
} from "@/ui/features/search-history/SearchHistory";
import { commonGearSlotLabels } from "@/ui/services/labels";
import { useJointWorkbench } from "../../useJointWorkbenchController";
import { currentDataVersion, makeConfig } from "@/ui/services/app-config";
import { jobConditionForEffectiveFood } from "../../joint-workbench-state";
import type {
  FoodDraft,
  JointEditorTarget,
  JointWorkbenchDraft,
  JointWorkbenchPhase,
  JointWorkbenchRuntime,
} from "../../joint-workbench-types";
import styles from "./JointWorkbench.module.scss";

import {
  objectiveLabel,
  resultSummaryRows,
  sharedGearRows,
} from "../../joint-workbench-model";
function SharedResultContent({
  config,
  result,
}: {
  config: JointOptimizationConfig;
  result: JointOptimizationResult;
}) {
  const summaries = resultSummaryRows(config, result);
  const rows = sharedGearRows(result);
  return (
    <div className={styles.sharedResult}>
      <section aria-label="联合结果概览" className={styles.overview}>
        <header>
          <h2>联合结果概览</h2>
          <p>
            目标：{objectiveLabel(config.objective)} · 归一化联合值{" "}
            {result.value.approximate.toFixed(8)}
          </p>
        </header>
        <div className={styles.overviewTableWrap}>
          <table className={styles.overviewTable}>
            <thead>
              <tr>
                <th scope="col">职业</th>
                <th scope="col">单职业基线</th>
                <th scope="col">联合目标</th>
                <th scope="col">基线保留</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((row) => (
                <tr key={row.jobId}>
                  <th scope="row">{jobSchemas[row.jobId].name}</th>
                  <td>{row.baseline?.score.toFixed(7) ?? "—"}</td>
                  <td>{row.joint?.score.toFixed(7) ?? "—"}</td>
                  <td>{row.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.commonFood && (
          <p className={styles.sharedFood}>
            共享食物：{result.commonFood.name}
          </p>
        )}
      </section>
      <section aria-label="共享装备" className={styles.sharedGear}>
        <h2>共享装备</h2>
        {rows.length ? (
          <GearTable rows={rows} />
        ) : (
          <p>本次结果没有共享装备部位。</p>
        )}
      </section>
    </div>
  );
}

function jobMetricEntries(
  jobId: JobId,
  result: JointOptimizationResult,
): ReturnType<typeof buildResultMetricEntry>[] {
  const joint = result.jobResults[jobId];
  return joint
    ? [buildResultMetricEntry(joint, "joint-" + jobId, "联合配装")]
    : [];
}

function JointGcdRuntime({
  runtimeState,
  jobId,
  input,
  onAnalysis,
}: {
  jobId: JobId;
  input: GcdAnalysisInput;
  runtimeState: GcdAnalysisState;
  onAnalysis(jobId: JobId, key: string, state: GcdAnalysisState): void;
}) {
  const state = useGcdAnalysisController({
    input,
    analyze: analyzeFeasibleGcds,
  });
  const key = gcdAnalysisKey(input);
  const callbackRef = useRef(onAnalysis);
  callbackRef.current = onAnalysis;
  // A new editor runtime may reuse the same analysis key and mounted observer.
  useEffect(() => {
    callbackRef.current(jobId, key, state);
  }, [jobId, key, state, runtimeState]);
  return null;
}

export function SideRows({
  rows,
}: {
  rows: readonly { label: string; value: string }[];
}) {
  return (
    <SidePanel.Rows>
      {rows.map((row) => (
        <SidePanel.Row key={row.label} label={row.label}>
          {row.value}
        </SidePanel.Row>
      ))}
    </SidePanel.Rows>
  );
}

export function SideFooter({ onHistory }: { onHistory(): void }) {
  const { openAdvancedSettings } = useFeedback();
  return (
    <SidePanel.Footer>
      <button type="button" onClick={onHistory}>
        搜索记录
      </button>
      <button type="button" onClick={openAdvancedSettings}>
        高级设置
      </button>
    </SidePanel.Footer>
  );
}

export function HistoryDialog({
  open,
  onOpenChange,
  onLoadConfig,
  onLoadResult,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onLoadConfig(record: SearchHistoryRecord): void;
  onLoadResult(record: SearchHistoryRecord): void;
}) {
  return (
    <HistoryOverlay
      open={open}
      onOpenChange={onOpenChange}
      kind="joint"
      onLoadConfig={onLoadConfig}
      onLoadResult={onLoadResult}
    />
  );
}

function JobTab({
  commonSlots,
  jobId,
  config,
  result,
}: {
  commonSlots: JointOptimizationConfig["commonSlots"];
  jobId: JobId;
  config: OptimizationConfig;
  result: JointOptimizationResult;
}) {
  const jobResult = result.jobResults[jobId];
  if (!jobResult) return <p>结果没有包含该职业的配装明细。</p>;
  const rows = buildResultGearTableRows(jobResult, config).map((row) => {
    if (
      row.item.kind !== "gear" ||
      !isSlotShared(row.item.slot, commonSlots)
    )
      return row;
    return { ...row, marker: "共享" };
  });
  return (
    <div className={styles.jobResult}>
      <CoreMetricBar
        objective={config.objective}
        entries={jobMetricEntries(jobId, result)}
        showTenacity={jobSchemas[jobId].role === "tank"}
      />
      <GearTable rows={rows} />
    </div>
  );
}

export function SelectionMain({
  selectedJobs,
  selectionState,
  onSelectionChange,
  onContinue,
  historyProps,
}: {
  selectedJobs: readonly JobId[];
  selectionState?: JointJobSelectionState;
  onSelectionChange(state: JointJobSelectionState): void;
  onContinue(): void;
  historyProps: {
    onLoadConfig(record: SearchHistoryRecord): void;
    onLoadResult(record: SearchHistoryRecord): void;
  };
}) {
  const valid = selectionState?.valid ?? false;
  const reason =
    selectionState?.invalidReason === "mixed-gear-groups"
      ? "所选职业来自不同装备分组，请调整选择。"
      : "请选择同一装备分组内的至少两个职业。";
  return (
    <section
      className={styles.selectionMain}
      aria-labelledby="joint-selection-title"
    >
      <header className={styles.pageHeading}>
        <p>实验室 · 多职业联合搜索</p>
        <h1 id="joint-selection-title">选择参与联合搜索的职业</h1>
        <span>同一搜索中的职业必须属于相同装备分组。</span>
      </header>
      <JobSelection
        mode="joint"
        initialJobs={selectedJobs}
        onSelectionChange={onSelectionChange}
      />
      <div className={styles.selectionHistory}>
        <SearchHistory kind="joint" {...historyProps} />
      </div>
      <footer className={styles.selectionFooter}>
        <p role={valid ? "status" : "alert"}>
          {valid
            ? "已选择 " + selectedJobs.length + " 个职业，可以继续设置条件。"
            : reason}
        </p>
        <button type="button" disabled={!valid} onClick={onContinue}>
          前往条件设置
        </button>
      </footer>
    </section>
  );
}

export function ConditionsMain({
  draft,
  runtime,
  validation,
  target,
  setTarget,
  compiledConfig,
  onConditionChange,
  onSharedFoodStrategy,
  onSharedFood,
  onSharedEquipmentChange,
  onJobEquipmentChange,
  onSharedSlotsChange,
  onRuntimeAnalysis,
}: {
  draft: JointWorkbenchDraft;
  runtime: JointWorkbenchRuntime;
  validation: WorkbenchValidation;
  target: JointEditorTarget;
  setTarget(target: JointEditorTarget): void;
  compiledConfig: JointOptimizationConfig;
  onConditionChange(jobId: JobId, change: JobConditionDraftChange): void;
  onSharedFoodStrategy(strategy: "shared" | "independent"): void;
  onSharedFood(food: FoodDraft): void;
  onSharedEquipmentChange(action: EquipmentAction): void;
  onJobEquipmentChange(jobId: JobId, action: EquipmentAction): void;
  onSharedSlotsChange(next: JointEquipmentDraft): void;
  onRuntimeAnalysis(jobId: JobId, key: string, state: GcdAnalysisState): void;
}) {
  const jobConfigMap = Object.fromEntries(
    compiledConfig.jobs.map((job) => [job.jobId, job]),
  ) as Record<JobId, OptimizationConfig>;
  return (
    <section
      className={styles.conditionsMain}
      aria-labelledby="joint-conditions-title"
    >
      <header className={styles.pageHeading}>
        <p>实验室 · 多职业联合搜索</p>
        <h1 id="joint-conditions-title">设置联合条件</h1>
        <span>条件快照会冻结；公式等级按职业上限与同步品级确定。</span>
      </header>
      <Tabs.Root
        className={styles.conditionsTabs}
        value={target}
        onValueChange={(value) => setTarget(value as JointEditorTarget)}
      >
        <Tabs.List className={styles.editorTargets} aria-label="条件编辑范围">
          <Tabs.Tab value="shared">共享设置</Tabs.Tab>
          {draft.jobs.map((jobId) => (
            <Tabs.Tab key={jobId} value={jobId}>
              <img
                src={jobIconUrl(jobId)}
                alt=""
                aria-hidden="true"
              />
              {jobSchemas[jobId].name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="shared" className={styles.conditionsBody}>
          <div className={styles.sharedEditor}>
            <div className={styles.sharedBasics}>
              <SharedSlotsSection
                jobs={draft.jobs}
                equipment={draft.shared.equipment}
                onChange={onSharedSlotsChange}
              />
              <JointFoodStrategySection
                strategy={draft.shared.foodStrategy}
                food={draft.shared.food}
                onStrategyChange={onSharedFoodStrategy}
                onFoodChange={onSharedFood}
              />
            </div>
            <JointSharedEquipmentRestrictions
              jobs={draft.jobs}
              configs={jobConfigMap}
              equipment={draft.shared.equipment}
              onAction={onSharedEquipmentChange}
            />
          </div>
        </Tabs.Panel>
        {draft.jobs.map((activeJob) => (
          <Tabs.Panel
            key={activeJob}
            value={activeJob}
            className={styles.conditionsBody}
          >
            <div className={styles.jobEditor}>
              <JointJobConditionScope
                jobId={activeJob}
                draft={jobConditionForEffectiveFood(draft, activeJob)}
                onChange={(change) => onConditionChange(activeJob, change)}
                runtime={
                  runtime[activeJob] ?? { gcdAnalysis: { status: "idle" } }
                }
                validation={validation.jobs[activeJob]}
                foodDisabled={draft.shared.foodStrategy === "shared"}
              >
                <JobConditionEditor />
              </JointJobConditionScope>
              <JointJobEquipmentRestrictions
                jobId={activeJob}
                config={jobConfigMap[activeJob] ?? makeConfig(activeJob)}
                equipment={draft.shared.equipment}
                onAction={(action) => onJobEquipmentChange(activeJob, action)}
              />
            </div>
          </Tabs.Panel>
        ))}
      </Tabs.Root>
      <div className={styles.runtimeObservers} aria-hidden="true">
        {draft.jobs.map((jobId) => {
          const config = jobConfigMap[jobId] ?? makeConfig(jobId);
          return (
            <JointGcdRuntime
              key={jobId}
              jobId={jobId}
              runtimeState={runtime[jobId]!.gcdAnalysis}
              input={gcdAnalysisInputFromConfig(config)}
              onAnalysis={onRuntimeAnalysis}
            />
          );
        })}
      </div>
    </section>
  );
}

export function ProgressMain({
  progress,
}: {
  progress: JointSearchProgressState;
}) {
  const stageIndex =
    progress.phase === "prepare" ? 0 : progress.phase === "verify" ? 2 : 1;
  const stages: { phase: JointSearchPhase; label: string }[] = [
    { phase: "prepare", label: "准备候选与搜索模型" },
    { phase: "baseline", label: "求解单职业基线与联合方案" },
    { phase: "verify", label: "核验候选与最优性" },
  ];
  return (
    <section
      className={styles.progressMain}
      aria-labelledby="joint-progress-title"
    >
      <header className={styles.pageHeading}>
        <p>实验室 · 多职业联合搜索</p>
        <h1 id="joint-progress-title">搜索进度</h1>
      </header>
      <ol className={styles.stageTrack} aria-label="搜索阶段">
        {stages.map((stage, index) => (
          <li
            key={stage.phase}
            aria-current={stageIndex === index ? "step" : undefined}
            data-state={
              index === stageIndex
                ? "current"
                : index < stageIndex
                  ? "complete"
                  : "upcoming"
            }
          >
            <span>{index < stageIndex ? "✓" : index + 1}</span>
            {stage.label}
          </li>
        ))}
      </ol>
      <JointProgressPhaseDetail progress={progress} />
    </section>
  );
}

export function ResultMain({
  config,
  result,
  durationMs,
  dataVersion,
  selectedTab,
  setSelectedTab,
}: {
  config: JointOptimizationConfig;
  result: JointOptimizationResult;
  durationMs: number;
  dataVersion: string;
  selectedTab: string;
  setSelectedTab(value: string): void;
}) {
  const tabList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = tabList.current;
    const selected = list?.querySelector<HTMLElement>(
      '[data-value="' + selectedTab + '"]',
    );
    if (!list || !selected) return;
    const selectedStart =
      selected.getBoundingClientRect().left -
      list.getBoundingClientRect().left +
      list.scrollLeft;
    const selectedEnd = selectedStart + selected.offsetWidth;
    const visibleStart = list.scrollLeft;
    const visibleEnd = visibleStart + list.clientWidth;
    if (selectedStart < visibleStart) list.scrollTo({ left: selectedStart });
    else if (selectedEnd > visibleEnd)
      list.scrollTo({ left: selectedEnd - list.clientWidth });
  }, [selectedTab]);
  return (
    <section className={styles.resultMain} aria-labelledby="joint-result-title">
      <header className={styles.resultHeading}>
        <div>
          <p>实验室 · 多职业联合搜索</p>
          <h1 id="joint-result-title">联合配装结果</h1>
        </div>
        <div className={styles.resultMetadata}>
          <span>搜索耗时 {(Math.max(0, durationMs) / 1000).toFixed(1)} 秒</span>
          <span>数据版本 {dataVersion}</span>
        </div>
      </header>
      {dataVersion !== currentDataVersion && (
        <p className={styles.versionNotice}>
          此结果来自旧数据版本，显示的是当时保存的结果，不会按当前数据重新计算。
        </p>
      )}
      <Tabs.Root
        value={selectedTab}
        onValueChange={(value) => setSelectedTab(String(value))}
        className={styles.resultTabs}
      >
        <Tabs.List
          ref={tabList}
          className={styles.resultTabList}
          aria-label="联合结果职业"
        >
          <Tabs.Tab
            className={styles.resultTab}
            value="shared"
            data-value="shared"
          >
            共享装备
          </Tabs.Tab>
          {config.jobs.map(({ jobId }) => (
            <Tabs.Tab
              className={styles.resultTab}
              value={jobId}
              data-value={jobId}
              key={jobId}
            >
              <img
                src={jobIconUrl(jobId)}
                alt=""
                aria-hidden="true"
              />
              {jobSchemas[jobId].name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel className={styles.resultPanel} value="shared">
          <SharedResultContent config={config} result={result} />
        </Tabs.Panel>
        {config.jobs.map(({ jobId }) => (
          <Tabs.Panel className={styles.resultPanel} value={jobId} key={jobId}>
            <JobTab
              commonSlots={config.commonSlots}
              jobId={jobId}
              config={
                config.jobs.find((job) => job.jobId === jobId) ??
                makeConfig(jobId)
              }
              result={result}
            />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </section>
  );
}

export function JointWorkbenchMain() {
  const controller = useJointWorkbench();
  const { phase } = controller;
  if (phase.phase === "selection") {
    return (
      <SelectionMain
        selectedJobs={
          controller.selectionState?.jobs ?? controller.selectedJobs
        }
        selectionState={controller.selectionState}
        onSelectionChange={controller.onSelectionChange}
        onContinue={controller.continueSelection}
        historyProps={controller.historyProps}
      />
    );
  }
  if (
    phase.phase === "conditions" &&
    controller.currentConfig &&
    controller.currentValidation
  ) {
    return (
      <ConditionsMain
        draft={phase.draft}
        runtime={phase.runtime}
        validation={controller.currentValidation}
        target={controller.editorTarget}
        setTarget={controller.setEditorTarget}
        compiledConfig={controller.currentConfig}
        onConditionChange={controller.updateCondition}
        onSharedFoodStrategy={controller.updateSharedFoodStrategy}
        onSharedFood={controller.updateSharedFood}
        onSharedEquipmentChange={controller.updateSharedEquipmentAction}
        onJobEquipmentChange={controller.updateJobEquipmentAction}
        onSharedSlotsChange={controller.updateSharedSlots}
        onRuntimeAnalysis={controller.updateGcdRuntime}
      />
    );
  }
  if (phase.phase === "progress")
    return <ProgressMain progress={phase.progress} />;
  if (phase.phase === "result") {
    return (
      <ResultMain
        config={phase.snapshot.config}
        result={phase.result}
        durationMs={phase.durationMs}
        dataVersion={phase.snapshot.dataVersion}
        selectedTab={controller.resultTab}
        setSelectedTab={controller.setResultTab}
      />
    );
  }
  return null;
}
