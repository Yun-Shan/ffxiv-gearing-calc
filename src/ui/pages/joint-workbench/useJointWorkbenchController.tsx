import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  jobSchemas,
  optimizeJoint,
  type JobId,
  type JointOptimizationResult,
  type SearchOptions,
} from "@/domain";
import { jointConfigForDomain, type UiJointOptimizationConfig as JointOptimizationConfig, type UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";
import type { JointJobSelectionState } from "@/ui/components/job-selection/JobSelection";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { gcdAnalysisInputFromConfig, gcdAnalysisKey } from "@/ui/features/job-condition";
import type { GcdAnalysisState } from "@/ui/features/job-condition";
import { applyJointEquipmentAction, updateJointSharedSlots } from "@/ui/features/equipment";
import type { EquipmentAction, JointEquipmentDraft } from "@/ui/features/equipment";
import { saveCompletedSearchHistory, type SearchHistoryRecord } from "@/ui/services/search-history";
import { currentDataVersion, makeConfig } from "@/ui/services/app-config";
import type { JointWorkbenchResult } from "@/ui/services/workbench-result";
import { searchMessageText } from "@/ui/services/search-message";
import { compileJointWorkbenchDraft, createJointWorkbenchDraft, createJointWorkbenchRuntime, jointWorkbenchDraftFromConfig } from "./joint-workbench-state";
import type { FoodDraft, JointEditorTarget, JointJobConditionDraftChange, JointWorkbenchDraft, JointWorkbenchPhase, JointWorkbenchRuntime, SearchRangeDraft } from "./joint-workbench-types";
import { deriveJointValidation, freezeJointConfig, gearById, jobSelectionSlots, parseJointProgressStats } from "./joint-workbench-model";
import type { JointSearchPhase, JointSearchProgressJob, JointSearchProgressState } from "./joint-workbench-progress-types";

import type { WorkbenchRouting, WorkbenchTransitionIntent } from "@/ui/services/workbench-routing";
import type { WorkbenchSession } from "@/ui/services/workbench-session";
import { freezeSnapshot } from "@/ui/services/snapshots/freeze-snapshot";

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
  startedAtISO: string;
  uiOwned: boolean;
  settled: boolean;
}
export function jointStateFromResult(value: JointWorkbenchResult): JointWorkbenchPhase {
  return { phase: "result", snapshot: { config: freezeJointConfig(value.config), dataVersion: value.dataVersion }, result: freezeSnapshot(value.result) };
}
export function jointStateFromSession(session: Extract<WorkbenchSession, { mode: "joint" }>): JointWorkbenchPhase {
  return session.phase === "conditions"
    ? { phase: "conditions", draft: structuredClone(session.draft), runtime: createJointWorkbenchRuntime(session.draft.jobs) }
    : jointStateFromResult(session.value);
}
export function jointSessionFromState(state: JointWorkbenchPhase): WorkbenchSession | undefined {
  if (state.phase === "conditions") return { mode: "joint", phase: "conditions", draft: state.draft };
  if (state.phase !== "result") return undefined;
  return { mode: "joint", phase: "result", value: { mode: "joint", config: state.snapshot.config, result: state.result, dataVersion: state.snapshot.dataVersion } };
}
export function useJointWorkbenchController(routing?: WorkbenchRouting<JointWorkbenchPhase>) {
  const { notify, confirm } = useFeedback();
  const [phase, setPhase] = useState<JointWorkbenchPhase>(() => routing?.initialState ?? { phase: "selection" });
  const phaseRef = useRef<JointWorkbenchPhase>(phase);
  const runRef = useRef<ActiveJointRun | undefined>(undefined);
  const runSequence = useRef(0);
  const intent = useRef(0);
  const pendingConfirmation = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const [selectionState, setSelectionState] = useState<JointJobSelectionState>();
  const [selectedJobs, setSelectedJobs] = useState<JobId[]>(() => phase.phase === "conditions" ? [...phase.draft.jobs] : phase.phase === "selection" ? [] : phase.snapshot.config.jobs.map(c => c.jobId));
  const [editorTarget, setEditorTarget] = useState<JointEditorTarget>("shared");
  const [resultTab, setResultTab] = useState("shared");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);

  function transition(next: JointWorkbenchPhase, action: WorkbenchTransitionIntent = "update") {
    phaseRef.current = next;
    setPhase(next);
    routing?.publish(next, action);
  }

  function cancelConfirmation() {
    const controller = pendingConfirmation.current;
    pendingConfirmation.current = undefined;
    controller?.abort();
  }
  function revoke() {
    ++intent.current;
    cancelConfirmation();
    const run = runRef.current;
    if (run) {
      run.uiOwned = false;
      runRef.current = undefined;
      run.controller.abort();
    }
  }
  function navigate(next: JointWorkbenchPhase) {
    revoke();
    transition(next, "push");
  }
  useLayoutEffect(() => routing?.attach({
    enter(next, reset) {
      revoke();
      phaseRef.current = next;
      setPhase(next);
      setHistoryOpen(false);
      setCancelPending(false);
      setEditorTarget("shared");
      setResultTab("shared");
      setSelectedJobs(next.phase === "conditions" ? [...next.draft.jobs] : next.phase === "selection" ? [] : next.snapshot.config.jobs.map(job => job.jobId));
      if (reset || next.phase === "selection") setSelectionState(undefined);
    },
    leave: revoke,
  }), [routing]);

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
    navigate({ phase: "conditions", draft, runtime });
  }

  function updateCondition(jobId: JobId, change: JointJobConditionDraftChange) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return;
    const oldDraft = current.draft.conditions[jobId];
    if (!oldDraft) return;
    ++intent.current;
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
    ++intent.current;
    transition({ ...current, draft: change(current.draft) });
  }

  function updateSharedEquipmentAction(action: EquipmentAction) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return false;
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
      return false;
    }
    updateSharedDraft((draft) => ({
      ...draft,
      shared: { ...draft.shared, equipment: applied.state },
    }));
    return true;
  }

  function updateJobEquipmentAction(jobId: JobId, action: EquipmentAction) {
    const current = phaseRef.current;
    if (current.phase !== "conditions") return false;
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
      return false;
    }
    updateSharedDraft((draft) => ({
      ...draft,
      shared: { ...draft.shared, equipment: applied.state },
    }));
    return true;
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
    return mounted.current && run.uiOwned && runRef.current === run;
  }

  function updateProgress(run: ActiveJointRun, update: (progress: JointSearchProgressState) => JointSearchProgressState) {
    if (!ownsRun(run)) return;
    const current = phaseRef.current;
    if (current.phase !== "progress" || current.snapshot.config !== run.config) return;
    transition({ ...current, progress: update(current.progress) });
  }

  function restoreFreshConditions(run: ActiveJointRun) {
    ++intent.current;
    cancelConfirmation();
    const draft = jointWorkbenchDraftFromConfig(run.config);
    const runtime = createJointWorkbenchRuntime(draft.jobs);
    setSelectedJobs([...draft.jobs]);
    setEditorTarget("shared");
    transition({ phase: "conditions", draft, runtime }, "return");
  }

  function settleRun(
    run: ActiveJointRun,
    outcome: { status: "completed"; result: JointOptimizationResult } | { status: "no-result" } | { status: "cancelled" } | { status: "failed"; error: string },
  ) {
    if (run.settled) return;
    run.settled = true;
    if (!ownsRun(run)) return;
    const snapshot: JointRunSnapshot = {
      ...run.snapshot,
    };
    if (outcome.status === "completed" && !run.controller.signal.aborted) {
      setResultTab("shared");
      const ownership = ++intent.current;
      cancelConfirmation();
      transition({ phase: "result", snapshot, result: outcome.result }, "replace");
      void saveCompletedSearchHistory({
        kind: "joint",
        config: run.config,
        result: outcome.result,
        dataVersion: snapshot.dataVersion,
        startedAtISO: run.startedAtISO,
      }).then((record) => {
        const latest = phaseRef.current;
        if (mounted.current && intent.current === ownership && latest.phase === "result" && latest.snapshot.config === run.config) {
          transition({ ...latest, snapshot: { ...latest.snapshot, historyId: record.id } });
        }
      }).catch((error: unknown) => {
        if (!mounted.current || intent.current !== ownership) return;
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

    revoke();
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
      startedAtISO,
      uiOwned: true,
      settled: false,
    };
    runRef.current = run;
    setCancelPending(false);
    transition({ phase: "progress", snapshot, progress, startedAt }, "push");

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
      searchPromise = optimizeJoint(freezeJointConfig(jointConfigForDomain(config)), {
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
    ++intent.current;
    cancelConfirmation();
    setCancelPending(true);
    run.controller.abort();
  }

  async function navigateFromHistory(record: SearchHistoryRecord, action: "config" | "result") {
    if (record.kind !== "joint") return;
    cancelConfirmation();
    const ownership = ++intent.current;
    const beforeConfirm = phaseRef.current;
    const activeSearch = beforeConfirm.phase === "progress";
    if (activeSearch) {
      const request = new AbortController();
      pendingConfirmation.current = request;
      let accepted: boolean;
      try {
        accepted = await confirm({
          title: "载入历史记录",
          description: "继续后会取消当前联合搜索，并载入所选历史记录。",
          signal: request.signal,
        });
      } finally {
        if (pendingConfirmation.current === request) pendingConfirmation.current = undefined;
      }
      if (!accepted || !mounted.current || intent.current !== ownership) return;
    }

    if (!mounted.current || intent.current !== ownership) return;
    let restoredDraft: JointWorkbenchDraft | undefined;
    if (action === "config") {
      try {
        restoredDraft = jointWorkbenchDraftFromConfig(record.config);
      } catch (error) {
        notify("历史条件无法恢复：" + searchMessageText(error instanceof Error ? error.message : String(error)), "error");
        return;
      }
    }

    setHistoryOpen(false);
    setCancelPending(false);

    if (action === "config") {
      const draft = restoredDraft!;
      const runtime = createJointWorkbenchRuntime(draft.jobs);
      setSelectedJobs([...draft.jobs]);
      setEditorTarget("shared");
      navigate({ phase: "conditions", draft, runtime });
      return;
    }
    setSelectedJobs(record.config.jobs.map((job) => job.jobId));
    setResultTab("shared");
    navigate({
      phase: "result",
      snapshot: {
        config: freezeJointConfig(record.config),
        dataVersion: record.dataVersion ?? "未记录",
        startedAtISO: record.startedAtISO,
        historyId: record.id,
      },
      result: record.result,
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
    navigate({
      phase: "conditions",
      draft,
      runtime: createJointWorkbenchRuntime(draft.jobs),
    });
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revoke(); };
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
      setHistoryOpen(false);
      setSelectionState(undefined);
      setSelectedJobs([]);
      navigate({ phase: "selection" });
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

export function JointWorkbenchProvider({ children, routing }: { children: ReactNode; routing?: WorkbenchRouting<JointWorkbenchPhase> }) {
  const value = useJointWorkbenchController(routing);
  return <JointWorkbenchContext.Provider value={value}>{children}</JointWorkbenchContext.Provider>;
}

export function useJointWorkbench() {
  const value = useContext(JointWorkbenchContext);
  if (!value) throw new Error("JointWorkbenchProvider is required");
  return value;
}
