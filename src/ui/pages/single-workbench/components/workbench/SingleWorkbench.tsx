import { conditionRows } from "@/ui/features/job-condition/summary";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { jobSchemas } from "@/domain";
import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import { SidePanel } from "@/ui/components/side-panel/SidePanel";
import { JobSelection } from "@/ui/components/job-selection/JobSelection";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import {
  SearchHistory,
  HistoryOverlay,
} from "@/ui/features/search-history/SearchHistory";
import { SingleJobConditionScope } from "@/ui/features/job-condition/scope";
import { JobConditionEditor } from "@/ui/features/job-condition/JobConditionEditor/JobConditionEditor";
import {
  useGcdAnalysisController,
  gcdAnalysisKey,
} from "@/ui/features/job-condition/gcd-analysis";
import { analyzeFeasibleGcds } from "@/ui/features/job-condition/analyze-feasible-gcds";
import { deriveWorkbenchValidation } from "@/ui/features/job-condition/validation";
import { resultReferenceUrl } from "@/ui/services/reference-gearset-share";

import { SingleSearchProgress } from "../search-progress/SingleSearchProgress";
import {
  useSingleController,
  compileSingleDraft,
  singleDraftFromConfig,
  type SingleDraft,
} from "../../state/useSingleController";
import { ResultGearTable } from "@/ui/components/results/gear-table/GearTable";
import {
  CoreMetricBar,
  buildResultMetricEntry,
} from "@/ui/components/results/core-metric-bar/CoreMetricBar";
import { SingleEquipmentRestrictions } from "../equipment/SingleEquipmentRestrictions";
import styles from "./SingleWorkbench.module.scss";

function Summary({ draft }: { draft: SingleDraft }) {
  const rows = conditionRows(draft.condition, draft.jobId).filter((row) =>
    [
      "种族",
      "装备品级",
      "同步品级",
      "GCD",
      "食物",
      ...(jobSchemas[draft.jobId].role === "tank"
        ? ["最低坚韧", "最低减伤", "坚韧目标"]
        : []),
    ].includes(row.label),
  );
  return (
    <SidePanel.Rows>
      {rows.map((row) => (
        <SidePanel.Row key={row.label} label={row.label}>
          {row.value}
        </SidePanel.Row>
      ))}
      <SidePanel.Row label="来源排除">
        {draft.equipment.excludedSources.length} 项
      </SidePanel.Row>
      <SidePanel.Row label="装备排除">
        {draft.equipment.excludedGearIds?.length ?? 0} 项
      </SidePanel.Row>
      <SidePanel.Row label="强制装备">
        {Object.keys(draft.equipment.forcedGear).length} 项
      </SidePanel.Row>
    </SidePanel.Rows>
  );
}
function useSingleWorkbenchValue() {
  const controller = useSingleController();
  const { state } = controller;
  const feedback = useFeedback();
  const [historyOpen, setHistoryOpen] = useState(false);
  const draft =
    state.phase === "conditions"
      ? state.draft
      : state.phase === "selection"
        ? undefined
        : singleDraftFromConfig(state.snapshot);
  const config = draft ? compileSingleDraft(draft) : undefined;
  const analysis = useGcdAnalysisController({
    input: state.phase === "conditions" ? config : undefined,
    analyze: analyzeFeasibleGcds,
  });
  const runtime = { gcdAnalysis: analysis };
  const validation = draft
    ? deriveWorkbenchValidation({
        jobs: [
          {
            jobId: draft.jobId,
            draft: draft.condition,
            runtime,
            expectedGcdKey: config ? gcdAnalysisKey(config) : undefined,
          },
        ],
      })
    : undefined;
  const submitState = useRef({
    valid: !!validation?.valid,
    feasibleGcds:
      analysis.status === "ready" ? analysis.feasibleTiers : undefined,
  });
  submitState.current = {
    valid: !!validation?.valid,
    feasibleGcds:
      analysis.status === "ready" ? analysis.feasibleTiers : undefined,
  };
  const historyProps = {
    kind: "single" as const,
    onLoadConfig: (record: Parameters<typeof controller.loadConfig>[0]) => {
      void controller.loadConfig(record).then((loaded) => {
        if (loaded) setHistoryOpen(false);
      });
    },
    onLoadResult: (record: Parameters<typeof controller.loadResult>[0]) => {
      void controller.loadResult(record).then((loaded) => {
        if (loaded) setHistoryOpen(false);
      });
    },
  };
  const title =
    state.phase === "selection" ? "选择职业" : jobSchemas[draft!.jobId].name;
  return {
    controller,
    state,
    feedback,
    historyOpen,
    setHistoryOpen,
    draft,
    runtime,
    validation,
    submitState,
    historyProps,
    title,
  };
}
const Context = createContext<
  ReturnType<typeof useSingleWorkbenchValue> | undefined
>(undefined);
export function SingleWorkbenchProvider({ children }: { children: ReactNode }) {
  const value = useSingleWorkbenchValue();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
function useWorkbench() {
  const value = useContext(Context);
  if (!value) throw new Error("SingleWorkbenchProvider is required");
  return value;
}
export function SingleWorkbenchMain() {
  const { controller, state, title, runtime, validation, historyProps } =
    useWorkbench();
  return (
    <>
      <header className={styles.heading}>
        <div>
          <h1>
            {state.phase === "selection"
              ? title
              : state.phase === "conditions"
                ? `${title} · 条件设置`
                : state.phase === "progress"
                  ? `${title} · 正在搜索`
                  : `${title} · 配装结果`}
          </h1>
        </div>
        {state.phase === "conditions" && (
          <button onClick={controller.selection}>重新选择职业</button>
        )}
        {state.phase === "result" && (
          <span>
            总用时 {(state.durationMs / 1000).toFixed(1)} 秒 · 数据{" "}
            {state.dataVersion}
          </span>
        )}
      </header>
      {state.phase === "selection" && (
        <>
          <JobSelection mode="single" onSelect={controller.choose} />
          <SearchHistory {...historyProps} />
        </>
      )}
      {state.phase === "conditions" && (
        <div className={styles.conditions}>
          <SingleJobConditionScope
            jobId={state.draft.jobId}
            draft={state.draft.condition}
            onChange={(change) =>
              controller.updateDraft({
                ...state.draft,
                condition:
                  typeof change === "function"
                    ? change(state.draft.condition)
                    : change,
              })
            }
            runtime={runtime}
            validation={validation?.jobs[state.draft.jobId]}
          >
            <JobConditionEditor />
          </SingleJobConditionScope>
          <SingleEquipmentRestrictions
            draft={state.draft}
            onChange={controller.updateDraft}
          />
        </div>
      )}
      {state.phase === "progress" && (
        <SingleSearchProgress jobName={title} progress={state.progress} />
      )}
      {state.phase === "result" && (
        <>
          <CoreMetricBar
            entries={[buildResultMetricEntry(state.result)]}
            objective={state.snapshot.objective ?? "dps"}
            showTenacity={jobSchemas[state.snapshot.jobId].role === "tank"}
          />
          <ResultGearTable
            result={state.result}
            config={state.snapshot}
            onReplacementSelect={
              state.snapshot.syncLevel !== undefined
                ? controller.replace
                : undefined
            }
          />
        </>
      )}
    </>
  );
}
export function SingleWorkbenchAside() {
  const {
    controller,
    state,
    title,
    draft,
    validation,
    submitState,
    feedback,
    setHistoryOpen,
  } = useWorkbench();
  return (
    <SidePanel>
      <SidePanel.Header
        title={state.phase === "selection" ? "信息公告栏" : title}
        subtitle={state.phase === "selection" ? "配装工坊" : "条件摘要"}
      />
      <SidePanel.Content>
        {draft ? (
          <Summary draft={draft} />
        ) : (
          <p className={styles.note}>
            选择职业后配置装备、食物与战斗条件。计算在本地浏览器完成。
          </p>
        )}
      </SidePanel.Content>
      {state.phase === "conditions" && (
        <SidePanel.Status status={validation?.status}>
          {validation?.valid
            ? "已就绪，搜索结果将满足条件"
            : (validation?.issues[0]?.message ?? "正在分析可行档位…")}
        </SidePanel.Status>
      )}
      <SidePanel.Actions>
        {state.phase === "conditions" && (
          <button
            disabled={!validation?.valid}
            onClick={() => void controller.start(() => submitState.current)}
          >
            开始搜索
          </button>
        )}
        {state.phase === "progress" && (
          <button onClick={controller.cancel}>取消搜索</button>
        )}
        {state.phase === "result" && (
          <>
            <button onClick={() => void controller.edit()}>调整条件</button>
            {resultReferenceUrl(state.result, state.snapshot) && (
              <a
                className={styles.share}
                href={resultReferenceUrl(state.result, state.snapshot)}
                target="_blank"
                rel="noreferrer"
              >
                在配装器打开
              </a>
            )}
          </>
        )}
      </SidePanel.Actions>
      <SidePanel.Footer>
        {state.phase !== "selection" && (
          <button onClick={() => setHistoryOpen(true)}>搜索记录</button>
        )}
        <button onClick={feedback.openAdvancedSettings}>
          高级设置
        </button>
      </SidePanel.Footer>
    </SidePanel>
  );
}
export function SingleWorkbenchOverlays() {
  const { historyProps, historyOpen, setHistoryOpen } = useWorkbench();
  return (
    <HistoryOverlay
      {...historyProps}
      open={historyOpen}
      onOpenChange={setHistoryOpen}
    />
  );
}
