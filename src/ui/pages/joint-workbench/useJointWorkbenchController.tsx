import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  jobSchemas,
  optimizeJoint,
  type JobId,
  type JointOptimizationConfig,
  type JointOptimizationResult,
  type OptimizationConfig,
  type SearchOptions,
} from "@/domain";
import type { JointJobSelectionState } from "@/ui/components/job-selection/JobSelection";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { gcdAnalysisInputFromConfig, gcdAnalysisKey } from "@/ui/features/job-condition";
import type { GcdAnalysisState } from "@/ui/features/job-condition";
import { applyJointEquipmentAction, updateJointSharedSlots } from "@/ui/features/equipment";
import type { EquipmentAction, JointEquipmentDraft } from "@/ui/features/equipment";
import { saveCompletedSearchHistory, type SearchHistoryRecord } from "@/ui/services/search-history";
import { currentDataVersion, makeConfig } from "@/ui/services/app-config";
import { searchMessageText } from "@/ui/services/search-message";
import { compileJointWorkbenchDraft, createJointWorkbenchDraft, createJointWorkbenchRuntime, jointWorkbenchDraftFromConfig } from "./joint-workbench-state";
import type { FoodDraft, JointEditorTarget, JointJobConditionDraftChange, JointWorkbenchDraft, JointWorkbenchPhase, JointWorkbenchRuntime, SearchRangeDraft } from "./joint-workbench-types";
import { deriveJointValidation, freezeJointConfig, gearById, jobSelectionSlots, parseJointProgressStats } from "./joint-workbench-model";
import type { JointSearchPhase, JointSearchProgressJob, JointSearchProgressState } from "./joint-workbench-progress-types";

type JointRunSnapshot = {
  config: JointOptimizationConfig;
  dataVersion: string;
  startedAtISO: string;
  historyId?: string;
};
interface ActiveJointRun {
  identity: number;
  controller: AbortController;
  config: JointOptimizationConfig;
  snapshot: JointRunSnapshot;
  startedAt: number;
  startedAtISO: string;
  uiOwned: boolean;
  settled: boolean;
}
export function useJointWorkbenchController() {
  const { notify, confirm } = useFeedback();
  const [phase, setPhase] = useState<JointWorkbenchPhase>({ phase: "selection" });
  const phaseRef = useRef<JointWorkbenchPhase>(phase);
  const runRef = useRef<ActiveJointRun | undefined>(undefined);
  const runSequence = useRef(0);
  const [selectionState, setSelectionState] = useState<JointJobSelectionState>();
  const [selectedJobs, setSelectedJobs] = useState<JobId[]>([]);
  const [editorTarget, setEditorTarget] = useState<JointEditorTarget>("shared");
  const [resultTab, setResultTab] = useState("shared");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);

  function transition(next: JointWorkbenchPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  const currentConfig = phase.phase === "conditions"
    ? compileJointWorkbenchDraft(phase.draft, phase.runtime)
    : undefined;
  const currentValidation = phase.phase === "conditions"
    ? deriveJointValidation(phase.draft, phase.runtime)
    : undefined;

  function openConditions(jobs: readonly JobId[]) {
    const draft = createJointWorkbenchDraft(jobs);
    const runtime = createJointWorkbenchRuntime(jobs);
    setSelectedJobs([...jobs]);
    setEditorTarget("shared");
    transition({ phase: "conditions", draft, runtime });
  }

  function updateCondition(jobId: JobId, change: JointJobConditionDraftChange) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    const oldDraft = current.draft.conditions[jobId];
    if (!oldDraft) return;
    const nextCondition = typeof change === "function" ? change(oldDraft) : change;
    transition({
      ...current,
      draft: {
        ...current.draft,
        conditions: { ...current.draft.conditions, [jobId]: nextCondition },
      },
    });
  }

  function updateSharedDraft(change: (draft: JointWorkbenchDraft) => JointWorkbenchDraft) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    transition({ ...current, draft: change(current.draft) });
  }

  function updateSharedEquipmentAction(action: EquipmentAction) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    const applied = applyJointEquipmentAction(
      current.draft.shared.equipment,
      { kind: "joint-shared" },
      action,
      {
        lookup: (gearId) => gearById.get(gearId),
        jobSlots: jobSelectionSlots(current.draft.jobs),
      },
    );
    if (!applied.accepted) {
      notify(applied.reason === "unique-ring" ? "不能同时强制装备两枚相同的唯一戒指。" : applied.reason === "job-restriction" ? "该装备被职业专属限制排除，无法设为共享强制装备。" : "当前共享部位不允许此装备操作。", "warning");
      return;
    }
    updateSharedDraft((draft) => ({
      ...draft,
      shared: { ...draft.shared, equipment: applied.state },
    }));
  }

  function updateJobEquipmentAction(jobId: JobId, action: EquipmentAction) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    const applied = applyJointEquipmentAction(
      current.draft.shared.equipment,
      { kind: "joint-job", jobId },
      action,
      {
        lookup: (gearId) => gearById.get(gearId),
        jobSlots: jobSelectionSlots(current.draft.jobs),
      },
    );
    if (!applied.accepted) {
      const message = applied.reason === "unique-ring"
        ? "不能同时强制装备两枚相同的唯一戒指。"
        : applied.reason === "shared-restriction"
        ? "该装备与共享限制冲突，未应用职业专属设置。"
        : "该装备类型目前没有可用的私有部位，未应用设置。";
      notify(message, "warning");
      return;
    }
    updateSharedDraft((draft) => ({
      ...draft,
      shared: { ...draft.shared, equipment: applied.state },
    }));
  }

  function updateSharedSlots(next: JointEquipmentDraft) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    const equipment = updateJointSharedSlots(
      current.draft.shared.equipment,
      next.commonSlots,
      {
        jobSlots: jobSelectionSlots(current.draft.jobs),
        lookup: (gearId) => gearById.get(gearId),
      },
    );
    updateSharedDraft((draft) => ({
      ...draft,
      shared: { ...draft.shared, equipment },
    }));
  }

  function updateGcdRuntime(jobId: JobId, expectedKey: string, state: GcdAnalysisState) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    const currentCompiled = compileJointWorkbenchDraft(current.draft, current.runtime);
    const jobConfig = currentCompiled.jobs.find((job) => job.jobId === jobId);
    if (!jobConfig || gcdAnalysisKey(gcdAnalysisInputFromConfig(jobConfig)) !== expectedKey) return;
    const oldState = current.runtime[jobId]?.gcdAnalysis;
    if (JSON.stringify(oldState) === JSON.stringify(state)) return;
    transition({
      ...current,
      runtime: {
        ...current.runtime,
        [jobId]: { gcdAnalysis: state },
      },
    });
  }

  function ownsRun(run: ActiveJointRun): boolean {
    return run.uiOwned && runRef.current === run;
  }

  function updateProgress(run: ActiveJointRun, update: (progress: JointSearchProgressState) => JointSearchProgressState) {
    if (!ownsRun(run)) return;
    const current = phaseRef.current;
    if (current.phase !== "progress" || current.snapshot.config !== run.config) return;
    transition({ ...current, progress: update(current.progress) });
  }

  function restoreFreshConditions(run: ActiveJointRun) {
    const draft = jointWorkbenchDraftFromConfig(run.config);
    const runtime = createJointWorkbenchRuntime(draft.jobs);
    setSelectedJobs([...draft.jobs]);
    setEditorTarget("shared");
    transition({ phase: "conditions", draft, runtime });
  }

  function settleRun(
    run: ActiveJointRun,
    outcome: { status: "completed"; result: JointOptimizationResult } | { status: "no-result" } | { status: "cancelled" } | { status: "failed"; error: string },
  ) {
    if (run.settled) return;
    run.settled = true;
    const finishedAt = Date.now();
    const finishedAtISO = new Date(finishedAt).toISOString();
    const durationMs = Math.max(0, finishedAt - run.startedAt);
    if (!ownsRun(run)) return;
    const snapshot: JointRunSnapshot = {
      ...run.snapshot,
    };
    if (outcome.status === "completed" && !run.controller.signal.aborted) {
      setResultTab("shared");
      transition({ phase: "result", snapshot, result: outcome.result, durationMs });
      void saveCompletedSearchHistory({
        kind: "joint",
        config: run.config,
        result: outcome.result,
        dataVersion: snapshot.dataVersion,
        startedAtISO: run.startedAtISO,
        finishedAtISO,
      }).then((record) => {
        const latest = phaseRef.current;
        if (latest.phase === "result" && latest.snapshot.config === run.config) {
          transition({ ...latest, snapshot: { ...latest.snapshot, historyId: record.id } });
        }
      }).catch((error: unknown) => {
        notify("联合搜索已完成，但本地记录保存失败：" + searchMessageText(error instanceof Error ? error.message : String(error)), "warning");
      });
    } else {
      restoreFreshConditions(run);
      if (outcome.status === "cancelled" || run.controller.signal.aborted) notify("联合搜索已取消。", "info");
      else if (outcome.status === "no-result") notify("当前约束下没有满足条件的联合配装，请调整条件后重试。", "warning");
      else if (outcome.status === "failed") notify(searchMessageText(outcome.error), "error");
    }
    run.uiOwned = false;
    if (runRef.current === run) runRef.current = undefined;
    setCancelPending(false);
  }

  function startSearch() {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    const latestValidation = deriveJointValidation(current.draft, current.runtime);
    if (!latestValidation.valid) {
      const firstIssue = latestValidation.issues[0];
      notify(
        latestValidation.status === "pending"
          ? "正在验证条件，请稍后再开始搜索。"
          : firstIssue?.message ?? "请修正条件后再开始搜索。",
        latestValidation.status === "pending" ? "info" : "warning",
      );
      return;
    }

    const config = freezeJointConfig(compileJointWorkbenchDraft(current.draft, current.runtime));
    const startedAt = Date.now();
    const startedAtISO = new Date(startedAt).toISOString();
    const controller = new AbortController();
    const snapshot: JointRunSnapshot = {
      config,
      dataVersion: currentDataVersion,
      startedAtISO,
    };
    const progress: JointSearchProgressState = {
      phase: "prepare",
      startedAt,
      jobs: config.jobs.map((job): JointSearchProgressJob => ({
        jobId: job.jobId,
        name: jobSchemas[job.jobId].name + " · " + job.jobId,
        prepared: false,
      })),
      jointStats: {},
    };
    const run: ActiveJointRun = {
      identity: ++runSequence.current,
      controller,
      config,
      snapshot,
      startedAt,
      startedAtISO,
      uiOwned: true,
      settled: false,
    };
    runRef.current = run;
    setCancelPending(false);
    transition({ phase: "progress", snapshot, progress, startedAt });

    const onProgress = (message: string) => {
      if (!ownsRun(run) || controller.signal.aborted) return;
      updateProgress(run, (currentProgress) => {
        const stats = parseJointProgressStats(message);
        const verify = message.includes("还原并复核");
        const baseline = message.includes("单职业最优伤害基线");
        const joint = message.includes("共享候选组合估分") || message.includes("V3 搜索进度") || message.includes("V3 incumbent 更新");
        const phaseName: JointSearchPhase = verify ? "verify" : joint ? "joint" : baseline ? "baseline" : currentProgress.phase;
        return {
          ...currentProgress,
          phase: phaseName,
          verifyMessage: verify ? searchMessageText(message) : currentProgress.verifyMessage,
          jointStats: { ...currentProgress.jointStats, ...stats },
        };
      });
    };
    const onCandidateCounts = ({ jobId }: { jobId: JobId }) => {
      if (!ownsRun(run) || controller.signal.aborted) return;
      updateProgress(run, (currentProgress) => ({
        ...currentProgress,
        jobs: currentProgress.jobs.map((job) => job.jobId === jobId ? { ...job, prepared: true } : job),
      }));
    };
    const onSolverProgress = (event: Parameters<NonNullable<SearchOptions["onSolverProgress"]>>[0]) => {
      if (!ownsRun(run) || controller.signal.aborted) return;
      updateProgress(run, (currentProgress) => {
        if (event.model.startsWith("joint:")) {
          const jointSolver = currentProgress.jointSolver?.model === event.model
            ? { ...currentProgress.jointSolver, ...event }
            : event;
          return { ...currentProgress, phase: "joint", jointSolver };
        }
        if (currentProgress.phase === "joint" || currentProgress.phase === "verify") return currentProgress;
        const job = currentProgress.jobs.find((entry) => event.model.startsWith(entry.jobId + ":"));
        if (!job) return currentProgress;
        const solver = job.solver?.model === event.model ? { ...job.solver, ...event } : event;
        return {
          ...currentProgress,
          phase: "baseline",
          jobs: currentProgress.jobs.map((entry) => entry.jobId === job.jobId ? { ...entry, solver } : entry),
        };
      });
    };

    let searchPromise: Promise<JointOptimizationResult | undefined>;
    try {
      searchPromise = optimizeJoint(config, {
        signal: controller.signal,
        onProgress,
        onCandidateCounts,
        onSolverProgress,
      });
    } catch (error) {
      searchPromise = Promise.reject(error);
    }

    void searchPromise.then((result) => {
      if (controller.signal.aborted) settleRun(run, { status: "cancelled" });
      else if (result) settleRun(run, { status: "completed", result });
      else settleRun(run, { status: "no-result" });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) settleRun(run, { status: "cancelled" });
      else settleRun(run, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    });
  }

  function cancelSearch() {
    const run = runRef.current;
    if (!run || !ownsRun(run)) return;
    setCancelPending(true);
    run.controller.abort();
  }

  function historyResultDuration(record: SearchHistoryRecord): number {
    const started = Date.parse(record.startedAtISO);
    const finished = Date.parse(record.finishedAtISO);
    return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : 0;
  }

  async function navigateFromHistory(record: SearchHistoryRecord, action: "config" | "result") {
    if (record.kind !== "joint") return;
    const beforeConfirm = phaseRef.current;
    const activeSearch = beforeConfirm.phase === "progress";
    if (activeSearch) {
      const accepted = await confirm({
        title: "载入历史记录",
        description: "继续后会取消当前联合搜索，并载入所选历史记录。",
      });
      if (!accepted) return;
    }

    let restoredDraft: JointWorkbenchDraft | undefined;
    if (action === "config") {
      try {
        restoredDraft = jointWorkbenchDraftFromConfig(record.config);
      } catch (error) {
        notify("历史条件无法恢复：" + searchMessageText(error instanceof Error ? error.message : String(error)), "error");
        return;
      }
    }

    const current = phaseRef.current;
    if (current.phase === "progress") {
      const activeRun = runRef.current;
      if (activeRun) {
        activeRun.uiOwned = false;
        runRef.current = undefined;
        activeRun.controller.abort();
      }
    }
    setHistoryOpen(false);
    setCancelPending(false);

    if (action === "config") {
      const draft = restoredDraft!;
      const runtime = createJointWorkbenchRuntime(draft.jobs);
      setSelectedJobs([...draft.jobs]);
      setEditorTarget("shared");
      transition({ phase: "conditions", draft, runtime });
      return;
    }
    setSelectedJobs(record.config.jobs.map((job) => job.jobId));
    setResultTab("shared");
    transition({
      phase: "result",
      snapshot: {
        config: freezeJointConfig(record.config),
        dataVersion: record.dataVersion ?? "未记录",
        startedAtISO: record.startedAtISO,
        historyId: record.id,
      },
      result: record.result,
      durationMs: historyResultDuration(record),
    });
  }

  async function adjustConditions() {
    const initial = phaseRef.current;
    if (initial.phase !== "result") return;
    const current = phaseRef.current;
    if (current.phase !== "result" || current.snapshot.config !== initial.snapshot.config || current.result !== initial.result) return;
    let draft: JointWorkbenchDraft;
    try {
      draft = jointWorkbenchDraftFromConfig(current.snapshot.config);
    } catch (error) {
      notify("历史条件无法恢复：" + searchMessageText(error instanceof Error ? error.message : String(error)), "error");
      return;
    }
    setSelectedJobs([...draft.jobs]);
    setEditorTarget("shared");
    transition({
      phase: "conditions",
      draft,
      runtime: createJointWorkbenchRuntime(draft.jobs),
    });
  }

  useEffect(() => () => {
    const run = runRef.current;
    if (run) {
      run.uiOwned = false;
      runRef.current = undefined;
      run.controller.abort();
    }
  }, []);

  const historyProps = {
    onLoadConfig: (record: SearchHistoryRecord) => { void navigateFromHistory(record, "config"); },
    onLoadResult: (record: SearchHistoryRecord) => { void navigateFromHistory(record, "result"); },
  };

  return {
    phase,
    selectionState,
    selectedJobs,
    editorTarget,
    setEditorTarget,
    resultTab,
    setResultTab,
    historyOpen,
    setHistoryOpen,
    cancelPending,
    currentConfig,
    currentValidation,
    historyProps,
    onSelectionChange(next: JointJobSelectionState) {
      setSelectionState(next);
      setSelectedJobs([...next.jobs]);
    },
    continueSelection() {
      if (selectionState?.valid) openConditions(selectionState.jobs);
    },
    returnToSelection() {
      transition({ phase: "selection" });
    },
    updateCondition,
    updateSharedRange(range: SearchRangeDraft) {
      updateSharedDraft((draft) => ({
        ...draft,
        shared: { ...draft.shared, range },
      }));
    },
    updateSharedFoodStrategy(foodStrategy: "shared" | "independent") {
      updateSharedDraft((draft) => ({
        ...draft,
        shared: { ...draft.shared, foodStrategy },
      }));
    },
    updateSharedFood(food: FoodDraft) {
      updateSharedDraft((draft) => ({
        ...draft,
        shared: { ...draft.shared, food },
      }));
    },
    updateSharedEquipmentAction,
    updateJobEquipmentAction,
    updateSharedSlots,
    updateGcdRuntime,
    startSearch,
    cancelSearch,
    adjustConditions,
  };
}
export type JointWorkbenchController = ReturnType<typeof useJointWorkbenchController>;
const JointWorkbenchContext = createContext<JointWorkbenchController | undefined>(undefined);

export function JointWorkbenchProvider({ children }: { children: ReactNode }) {
  const value = useJointWorkbenchController();
  return <JointWorkbenchContext.Provider value={value}>{children}</JointWorkbenchContext.Provider>;
}

export function useJointWorkbench() {
  const value = useContext(JointWorkbenchContext);
  if (!value) throw new Error("JointWorkbenchProvider is required");
  return value;
}
