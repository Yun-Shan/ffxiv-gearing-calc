import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cloneForcedGearMap,
  optimize,
  type JobId,
  type GearSlot,
  type MeldedGear,
} from "@/domain";
import { optimizationConfigForDomain, type UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";
import { currentDataVersion, makeConfig } from "@/ui/services/app-config";
import {
  historyReplacementLink,
  replaceSearchHistoryGearIfCurrent,
  type HistoryReplacementLink,
  type SearchHistoryRecord,
} from "@/ui/services/search-history";
import {
  equivalentGearKey,
  replaceEquivalentGear,
} from "@/ui/components/results/gear-table/GearTable";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { freezeSnapshot } from "@/ui/services/snapshots/freeze-snapshot";
import { gearSlotLabels } from "@/ui/services/labels";
import { startHistorySidecar } from "./history-sidecar";
import type { SingleSearchProgressState } from "../components/search-progress/SingleSearchProgress";
import { compileJobCondition } from "@/ui/features/job-condition/compiler";
import { jobConditionDraftFromConfig } from "@/ui/features/job-condition/draft";
import type { SingleEquipmentDraft } from "@/ui/features/equipment/types";
import type { JobConditionDraft } from "@/ui/features/job-condition/types";
import type { WorkbenchRouting, WorkbenchTransitionIntent } from "@/ui/services/workbench-routing";
import type { WorkbenchSession } from "@/ui/services/workbench-session";
import type { ResultView, SingleWorkbenchResult } from "@/ui/services/workbench-result";

export interface SingleDraft {
  jobId: JobId;
  condition: JobConditionDraft;
  equipment: SingleEquipmentDraft;
}
export type SingleState =
  | { phase: "selection" }
  | { phase: "conditions"; draft: SingleDraft }
  | {
      phase: "progress";
      snapshot: OptimizationConfig;
      progress: SingleSearchProgressState;
      startedAt: number;
      dataVersion: string;
    }
  | {
      phase: "result";
      snapshot: OptimizationConfig;
      result: ResultView;
      dataVersion: string;
      historyLink?: HistoryReplacementLink;
    };
export function singleDraftFromConfig(config: OptimizationConfig): SingleDraft {
  return {
    jobId: config.jobId,
    condition: jobConditionDraftFromConfig(config),
    equipment: {
      excludedSources: [...(config.excludedSources ?? [])],
      excludedGearIds: [...(config.excludedGearIds ?? [])],
      forcedGear: cloneForcedGearMap(config.forcedGear),
    },
  };
}
export function compileSingleDraft(
  draft: SingleDraft,
  feasibleGcds?: readonly number[],
): OptimizationConfig {
  return {
    ...makeConfig(draft.jobId),
    ...compileJobCondition(draft.condition, {
      jobId: draft.jobId,
      feasibleGcds,
    }).config,
    ...draft.equipment,
  };
}
export function singleStateFromResult(value: SingleWorkbenchResult): Extract<SingleState, { phase: "result" }> {
  return { phase: "result", snapshot: freezeSnapshot(value.config), result: freezeSnapshot(value.result), dataVersion: value.dataVersion };
}
export function singleStateFromSession(session: Extract<WorkbenchSession, { mode: "single" }>): SingleState {
  return session.phase === "conditions"
    ? { phase: "conditions", draft: structuredClone(session.draft) }
    : { ...singleStateFromResult(session.value), historyLink: session.historyLink };
}
export function singleSessionFromState(state: SingleState): WorkbenchSession | undefined {
  if (state.phase === "conditions") return { mode: "single", phase: "conditions", draft: state.draft };
  if (state.phase !== "result") return undefined;
  return { mode: "single", phase: "result", value: { mode: "single", config: state.snapshot, result: state.result, dataVersion: state.dataVersion }, historyLink: state.historyLink };
}
interface HistorySource {
  link?: HistoryReplacementLink;
  writes: Promise<unknown>;
}
export function useSingleController(routing?: WorkbenchRouting<SingleState>, onRouteEntry?: () => void) {
  const [state, setState] = useState<SingleState>(() => routing?.initialState ?? { phase: "selection" });
  const current = useRef(state);
  const active = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const intent = useRef(0);
  const pendingConfirmation = useRef<AbortController | undefined>(undefined);
  const source = useRef<HistorySource | undefined>(undefined);
  const feedback = useFeedback();
  const messages = useRef(feedback);
  messages.current = feedback;
  const routeEntry = useRef(onRouteEntry);
  routeEntry.current = onRouteEntry;
  function cancelConfirmation() {
    const controller = pendingConfirmation.current;
    pendingConfirmation.current = undefined;
    controller?.abort();
  }
  function revoke() {
    ++intent.current;
    cancelConfirmation();
    source.current = undefined;
    const controller = active.current;
    active.current = undefined;
    controller?.abort();
  }
  function commit(next: SingleState, action: WorkbenchTransitionIntent = "update") {
    current.current = next;
    setState(next);
    routing?.publish(next, action);
  }
  function bindHistory(next: SingleState) {
    source.current = next.phase === "result" && next.historyLink
      ? { link: next.historyLink, writes: Promise.resolve() }
      : undefined;
  }
  useLayoutEffect(() => {
    bindHistory(current.current);
    return routing?.attach({
      enter(next) {
        revoke();
        bindHistory(next);
        current.current = next;
        setState(next);
        routeEntry.current?.();
      },
      leave: revoke,
    });
  }, [routing]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revoke();
    };
  }, []);
  function navigate(next: SingleState) {
    revoke();
    bindHistory(next);
    commit(next, "push");
  }
  function updateDraft(draft: SingleDraft) {
    if (current.current.phase !== "conditions") return;
    ++intent.current;
    commit({ phase: "conditions", draft });
  }
  async function load(record: SearchHistoryRecord, result: boolean) {
    if (record.kind !== "single") return false;
    cancelConfirmation();
    const ownership = ++intent.current;
    if (current.current.phase === "progress") {
      const request = new AbortController();
      pendingConfirmation.current = request;
      let accepted: boolean;
      try {
        accepted = await feedback.confirm({ title: "载入搜索记录", description: "继续将取消当前搜索并载入所选记录。", signal: request.signal });
      } finally {
        if (pendingConfirmation.current === request) pendingConfirmation.current = undefined;
      }
      if (!accepted || !mounted.current || ownership !== intent.current) return false;
    }
    if (!mounted.current || ownership !== intent.current) return false;
    if (result) navigate({ phase: "result", snapshot: freezeSnapshot(record.config), result: record.result, dataVersion: record.dataVersion ?? "未记录", historyLink: historyReplacementLink(record) });
    else navigate({ phase: "conditions", draft: singleDraftFromConfig(record.config) });
    return true;
  }
  function persistGear(owner: HistorySource, gear: ResultView["gear"]) {
    owner.writes = owner.writes.then(async () => {
      if (!mounted.current || source.current !== owner || !owner.link) return;
      const link = await replaceSearchHistoryGearIfCurrent(owner.link, gear);
      if (!mounted.current || source.current !== owner) return;
      owner.link = link;
      const latest = current.current;
      if (latest.phase === "result") commit({ ...latest, historyLink: link });
    }).catch(error => {
      if (mounted.current && source.current === owner) {
        owner.link = undefined;
        const latest = current.current;
        if (latest.phase === "result") commit({ ...latest, historyLink: undefined });
        messages.current.notify(`搜索记录更新失败：${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    });
  }
  async function start(
    readValidation: () => { valid: boolean; feasibleGcds?: readonly number[] },
  ) {
    const value = current.current;
    const latest = readValidation();
    if (value.phase !== "conditions" || !latest.valid) return;
    const snapshot = freezeSnapshot(
      compileSingleDraft(value.draft, latest.feasibleGcds),
    );
    revoke();
    const controller = new AbortController();
    active.current = controller;
    const startedAt = Date.now(),
      dataVersion = currentDataVersion;
    const owns = () => mounted.current && active.current === controller;
    let historyOwner: HistorySource | undefined;
    const finish = startHistorySidecar(
      snapshot,
      dataVersion,
      startedAt,
      (message) => {
        if (mounted.current && historyOwner && source.current === historyOwner) messages.current.notify(message, "warning");
      },
    );

    const progress: SingleSearchProgressState = {
      phase: "prepare",
      startedAt,
      hasFeasibleCandidate: false,
    };
    commit({
      phase: "progress",
      snapshot,
      progress,
      startedAt,
      dataVersion,
    }, "push");
    function changeProgress(
      update: (p: SingleSearchProgressState) => SingleSearchProgressState,
    ) {
      if (!owns()) return;
      const latest = current.current;
      if (latest.phase === "progress") commit({ ...latest, progress: update(latest.progress) });
    }
    try {
      const result = await optimize(freezeSnapshot(optimizationConfigForDomain(snapshot)), {
        signal: controller.signal,
        onProgress: (message) =>
          changeProgress((p) => ({
            ...p,
            phase:
              message.includes("核验") || message.includes("复核")
                ? "verify"
                : "solve",
          })),
        onCandidateCounts: (counts) =>
          changeProgress((p) => ({
            ...p,
            phase: "solve",
            slotCandidateCounts: counts.slots.map((x) => ({
              label:
                gearSlotLabels[x.slot as keyof typeof gearSlotLabels] ??
                (x.slot === "rings" ? "戒指组合" : x.slot),
              count: x.count,
            })),
            foodCandidateCount: counts.foodCount,
          })),
        onSolverProgress: (event) =>
          changeProgress((p) => ({
            ...p,
            phase: "solve",
            hasFeasibleCandidate:
              p.hasFeasibleCandidate || event.kind === "incumbent",
            currentModel: {
              model: event.model,
              status: event.status,
              completed: event.completed,
              primalBound: event.objectiveValue,
              dualBound: event.bestBound,
              gap: event.gap,
              variables: event.variableCount,
              constraints: event.rowCount,
              nodes:
                event.nodes && /^\d+$/.test(event.nodes)
                  ? Number(event.nodes)
                  : undefined,
              lpIterations:
                event.totalLpIterations && /^\d+$/.test(event.totalLpIterations)
                  ? Number(event.totalLpIterations)
                  : undefined,
            },
          })),
      });
      if (!owns()) return;
      if (result && !controller.signal.aborted) {
        const next: SingleState = {
          phase: "result",
          snapshot,
          result,
          dataVersion,
        };
        const owner: HistorySource = { writes: Promise.resolve() };
        source.current = owner;
        historyOwner = owner;
        ++intent.current;
        cancelConfirmation();
        commit(next, "replace");
        void finish(result).then(record => {
          if (!record || !mounted.current || source.current !== owner) return;
          owner.link = historyReplacementLink(record);
          const latest = current.current;
          if (latest.phase !== "result") return;
          commit({ ...latest, historyLink: owner.link });
          if (latest.result.gear !== result.gear) persistGear(owner, latest.result.gear);
        });
      } else {
        const next: SingleState = {
          phase: "conditions",
          draft: singleDraftFromConfig(snapshot),
        };
        ++intent.current;
        cancelConfirmation();
        commit(next, "return");
        feedback.notify(
          controller.signal.aborted
            ? "搜索已取消。"
            : "当前条件下没有可行配装，请调整条件。",
          controller.signal.aborted ? "info" : "warning",
        );
      }
    } catch (error) {
      if (!owns()) return;
      const next: SingleState = {
        phase: "conditions",
        draft: singleDraftFromConfig(snapshot),
      };
      ++intent.current;
      cancelConfirmation();
      commit(next, "return");
      feedback.notify(
        controller.signal.aborted
          ? "搜索已取消。"
          : error instanceof Error
            ? error.message
            : String(error),
        controller.signal.aborted ? "info" : "error",
      );
    } finally {
      if (active.current === controller) active.current = undefined;
    }
  }
  function replace(slot: GearSlot, replacement: MeldedGear) {
    const value = current.current;
    if (value.phase !== "result" || value.snapshot.sync === undefined) return;
    const result = replaceEquivalentGear(
      value.result,
      slot,
      equivalentGearKey(replacement),
    );
    const next: SingleState = { ...value, result };
    ++intent.current;
    commit(next);
    if (source.current?.link) persistGear(source.current, result.gear);
  }
  return {
    state,
    updateDraft,
    start,
    replace,
    cancel: () => { ++intent.current; cancelConfirmation(); active.current?.abort(); },
    choose: (jobId: JobId) => {
      const draft = singleDraftFromConfig(makeConfig(jobId));
      draft.condition.gcd = { mode: "tiers", tiers: [] };
      navigate({ phase: "conditions", draft });
    },
    selection: () => navigate({ phase: "selection" }),
    edit: async () => {
      const s = current.current;
      if (s.phase !== "result") return;
      navigate({
        phase: "conditions",
        draft: singleDraftFromConfig(s.snapshot),
      });
    },
    loadConfig: (r: SearchHistoryRecord) => load(r, false),
    loadResult: (r: SearchHistoryRecord) => load(r, true),
  };
}
