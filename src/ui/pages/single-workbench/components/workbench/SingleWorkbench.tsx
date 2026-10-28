import { conditionRows } from "@/ui/features/job-condition/summary";
import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { jobSchemas } from "@/domain";
import { SidePanel } from "@/ui/components/side-panel/SidePanel";
import { JobSelection } from "@/ui/components/job-selection/JobSelection";
import {
  SearchHistory,
  HistoryOverlay,
} from "@/ui/features/search-history/SearchHistory";
import { SingleJobConditionScope } from "@/ui/features/job-condition/scope";
import { JobConditionEditor } from "@/ui/features/job-condition/JobConditionEditor/JobConditionEditor";
import {
  useGcdAnalysisController,
  gcdAnalysisKey,
  gcdAnalysisInputFromConfig,
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
  type SingleState,
} from "../../state/useSingleController";
import {
  GearTable,
  buildResultGearTableRows,
} from "@/ui/components/results/gear-table/GearTable";
import {
  CoreMetricBar,
  buildResultMetricEntry,
} from "@/ui/components/results/core-metric-bar/CoreMetricBar";
import { SingleEquipmentRestrictions } from "../equipment/SingleEquipmentRestrictions";
import styles from "./SingleWorkbench.module.scss";
import type { WorkbenchRouting } from "@/ui/services/workbench-routing";

// Keep aligned with tokens.$single-result-mobile-breakpoint. Floating actions
// render outside the workbench's size containers so they stay viewport-fixed.
const mobileResultQuery = "(width < 1000px)";
function subscribeMobileResult(onChange: () => void) {
  const query = window.matchMedia?.(mobileResultQuery);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}
function mobileResultSnapshot() {
  return window.matchMedia?.(mobileResultQuery).matches ?? false;
}

function summaryRows(draft: SingleDraft) {
  const rows = conditionRows(draft.condition, draft.jobId).filter(
    ({ label }) => label !== "公式等级",
  );
  return [
    ...rows,
    { label: "来源排除", value: `${draft.equipment.excludedSources.length} 项` },
    { label: "装备排除", value: `${draft.equipment.excludedGearIds?.length ?? 0} 项` },
    { label: "强制装备", value: `${Object.keys(draft.equipment.forcedGear).length} 项` },
  ];
}
function Summary({ draft }: { draft: SingleDraft }) {
  return (
    <SidePanel.Rows>
      {summaryRows(draft).map((row) => (
        <SidePanel.Row key={row.label} label={row.label}>
          {row.value}
        </SidePanel.Row>
      ))}
    </SidePanel.Rows>
  );
}
function useSingleWorkbenchValue(routing?: WorkbenchRouting<SingleState>) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const controller = useSingleController(routing, () => setHistoryOpen(false));
  const { state } = controller;
  const smallViewport = useSyncExternalStore(subscribeMobileResult, mobileResultSnapshot);
  const draft =
    state.phase === "conditions"
      ? state.draft
      : state.phase === "selection"
        ? undefined
        : singleDraftFromConfig(state.snapshot);
  const config = state.phase === "conditions" ? compileSingleDraft(state.draft) : undefined;
  const analysis = useGcdAnalysisController({
    input: state.phase === "conditions" && config ? gcdAnalysisInputFromConfig(config) : undefined,
    analyze: analyzeFeasibleGcds,
  });
  const runtime = { gcdAnalysis: analysis };
  const validation = state.phase === "conditions" && draft
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
    historyOpen,
    setHistoryOpen,
    draft,
    runtime,
    validation,
    submitState,
    historyProps,
    title,
    isMobileResult: state.phase === "result" && smallViewport,
  };
}
const Context = createContext<
  ReturnType<typeof useSingleWorkbenchValue> | undefined
>(undefined);
export function SingleWorkbenchProvider({ children, routing }: { children: ReactNode; routing?: WorkbenchRouting<SingleState> }) {
  const value = useSingleWorkbenchValue(routing);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSingleWorkbench() {
  const value = useContext(Context);
  if (!value) throw new Error("SingleWorkbenchProvider is required");
  return value;
}
export function SingleWorkbenchMain() {
  const { controller, state, title, draft, runtime, validation, historyProps, isMobileResult } =
    useSingleWorkbench();
  const resultRows =
    state.phase === "result"
      ? buildResultGearTableRows(state.result, state.snapshot, {
          onReplacementSelect: state.snapshot.sync ? controller.replace : undefined,
        })
      : [];
  return (
    <>
      <header className={`${styles.heading} ${state.phase === "result" ? styles.resultHeading : ""}`}>
        <div className={styles.titleRow}>
          <h1>
            {state.phase === "selection"
              ? title
              : state.phase === "conditions"
                ? `${title} · 条件设置`
                : state.phase === "progress"
                  ? `${title} · 正在搜索`
                  : `${title} · 配装结果`}
          </h1>
        {state.phase === "result" && (
          <span className={styles.durationBadge}>耗时 {(state.result.statistics.elapsedMs / 1000).toFixed(1)} 秒</span>
        )}
        </div>
        {(state.phase === "conditions" || state.phase === "result") && (
          <button onClick={controller.selection}>重新选择职业</button>
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
            mobileResult
            floatingActions={isMobileResult}
            linkShareData={{ mode: "single", config: state.snapshot, results: [state.result], dataVersion: state.dataVersion, elapsedMs: state.result.statistics.elapsedMs }}
            shareData={{
              jobId: state.snapshot.jobId,
              effects: state.result.effects,
              rows: resultRows,
              summaryRows: summaryRows(draft!),
            }}
            entries={[{
              ...buildResultMetricEntry(state.result),
              clanIndex: state.snapshot.clanIndex,
              referenceUrl: isMobileResult
                ? undefined
                : resultReferenceUrl(state.result, state.snapshot),
            }]}
            objective={state.snapshot.objective}
            showTenacity={jobSchemas[state.snapshot.jobId].role === "tank"}
          />
          <GearTable rows={resultRows} jobId={state.snapshot.jobId} mobileResult />
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
    setHistoryOpen,
  } = useSingleWorkbench();
  return (
    <SidePanel mobileResult={state.phase === "result"}>
      <SidePanel.Header
        title={state.phase === "selection" ? "信息公告栏" : title}
        subtitle={state.phase === "selection" ? "自动配装器" : "条件摘要"}
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
          {validation?.issues.length ? "存在无效的条件设置，请检查所有条件约束" : "已就绪，可以开始搜索"}
        </SidePanel.Status>
      )}
      {state.phase === "result" && (
        <SidePanel.Status>数据版本 {state.dataVersion}</SidePanel.Status>
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

          </>
        )}
      </SidePanel.Actions>
      <SidePanel.Footer>
        {state.phase !== "selection" && (
          <button onClick={() => setHistoryOpen(true)}>搜索记录</button>
        )}
      </SidePanel.Footer>
    </SidePanel>
  );
}
export function SingleWorkbenchOverlays() {
  const { historyProps, historyOpen, setHistoryOpen } = useSingleWorkbench();
  return (
    <HistoryOverlay
      {...historyProps}
      open={historyOpen}
      onOpenChange={setHistoryOpen}
    />
  );
}
