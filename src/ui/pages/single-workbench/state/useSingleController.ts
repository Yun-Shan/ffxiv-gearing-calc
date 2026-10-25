import { useEffect, useRef, useState } from "react";
import {
  cloneForcedGearMap,
  optimize,
  type JobId,
  type GearSlot,
  type MeldedGear,
  type OptimizationResult,
} from "@/domain";
import { optimizationConfigForDomain, type UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";
import { currentDataVersion, makeConfig } from "@/ui/services/app-config";
import {
  replaceSearchHistoryResult,
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
      result: OptimizationResult;
      dataVersion: string;
      historyId?: string;
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
export function useSingleController() {
  const [state, setState] = useState<SingleState>({ phase: "selection" });
  const current = useRef(state);
  current.current = state;
  const active = useRef<AbortController | undefined>(undefined);
  const persistence = useRef<
    | {
        snapshot: OptimizationConfig;
        sidecar: ReturnType<typeof startHistorySidecar>;
      }
    | undefined
  >(undefined);
  const mounted = useRef(true);
  const feedback = useFeedback();
  const messages = useRef(feedback);
  messages.current = feedback;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const controller = active.current;
      active.current = undefined;
      controller?.abort();
    };
  }, []);
  function navigate(next: SingleState) {
    const controller = active.current;
    active.current = undefined;
    controller?.abort();
    current.current = next;
    setState(next);
  }
  function updateDraft(draft: SingleDraft) {
    if (current.current.phase !== "conditions") return;
    const next: SingleState = { phase: "conditions", draft };
    current.current = next;
    setState(next);
  }
  async function load(record: SearchHistoryRecord, result: boolean) {
    if (record.kind !== "single") return false;
    if (
      current.current.phase === "progress" &&
      !(await feedback.confirm({
        title: "载入搜索记录",
        description: "继续将取消当前搜索并载入所选记录。",
      }))
    )
      return false;
    if (result)
      navigate({
        phase: "result",
        snapshot: record.config,
        result: record.result,
        dataVersion: record.dataVersion ?? "未记录",
        historyId: record.id,
      });
    else if (!result)
      navigate({
        phase: "conditions",
        draft: singleDraftFromConfig(record.config),
      });
    else return false;
    return true;
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
    const controller = new AbortController();
    active.current = controller;
    const startedAt = Date.now(),
      dataVersion = currentDataVersion;
    const owns = () => mounted.current && active.current === controller;
    let historyId: string | undefined;
    const finish = startHistorySidecar(
      snapshot,
      dataVersion,
      startedAt,
      (message) => {
        if (mounted.current) messages.current.notify(message, "warning");
      },
      (id) => {
        historyId = id;
        if (!mounted.current) return;
        setState((current) =>
          current.phase === "result" && current.snapshot === snapshot
            ? { ...current, historyId: id }
            : current,
        );
      },
    );

    persistence.current = { snapshot, sidecar: finish };
    const progress: SingleSearchProgressState = {
      phase: "prepare",
      startedAt,
      hasFeasibleCandidate: false,
    };
    current.current = {
      phase: "progress",
      snapshot,
      progress,
      startedAt,
      dataVersion,
    };
    setState(current.current);
    function changeProgress(
      update: (p: SingleSearchProgressState) => SingleSearchProgressState,
    ) {
      if (!owns()) return;
      setState((current) =>
        current.phase === "progress"
          ? { ...current, progress: update(current.progress) }
          : current,
      );
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
          historyId,
        };
        current.current = next;
        setState(next);
        finish(result);
      } else {
        const next: SingleState = {
          phase: "conditions",
          draft: singleDraftFromConfig(snapshot),
        };
        current.current = next;
        setState(next);
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
      current.current = next;
      setState(next);
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
    current.current = next;
    setState(next);
    if (persistence.current?.snapshot === value.snapshot)
      persistence.current.sidecar.replace(result);
    else if (value.historyId)
      void replaceSearchHistoryResult(value.historyId, result).catch((error) =>
        messages.current.notify(
          `搜索记录更新失败：${error instanceof Error ? error.message : String(error)}`,
          "warning",
        ),
      );
  }
  return {
    state,
    updateDraft,
    start,
    replace,
    cancel: () => active.current?.abort(),
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
