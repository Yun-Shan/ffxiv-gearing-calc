import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  optimize,
  jobSchemas,
  type GearSlot,
  type JobId,
  type OptimizationConfig,
  type OptimizationResult,
  type SearchCandidateCounts,
} from "@/domain";
import type { LinearMipProgress } from "@/domain/search/linear-mip.ts";
import type {
  SingleSearchCurrentModelMetrics,
  SingleSearchProgressState,
  SingleSearchSlotCandidateCount,
} from "../components/search-progress/SingleSearchProgress.tsx";
import {
  displayedDataVersion,
  singleGcdModeForConfig,
} from "@/ui/services/app-config.ts";
import { searchMessageText } from "@/ui/services/search-message.ts";
import { gearSlotLabels } from "@/ui/services/labels.ts";
import { createSearchHistory, finishSearchHistory } from "@/ui/services/search-history.ts";
import type { SearchHistoryRecord } from "@/ui/services/search-history.ts";
import type { SingleGcdMode } from "@/ui/services/types.ts";
import type { SingleWorkbenchView } from "../single-workbench-types.ts";

const slotLabels = gearSlotLabels;

function safeProgressCount(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function candidateSlotLabel(slot: string): string {
  if (slot === "rings") return "戒指组合";
  if (slot === "weapon") return "主手";
  return slotLabels[slot as GearSlot] ?? slot;
}

export function useSingleWorkbenchSearch({
  selectedJob,
  setSelectedJob,
  config,
  setConfig,
  setView,
  setSingleGcdMode,
}: {
  selectedJob: JobId | null;
  setSelectedJob: Dispatch<SetStateAction<JobId | null>>;
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  setView: (view: SingleWorkbenchView) => void;
  setSingleGcdMode: Dispatch<SetStateAction<SingleGcdMode>>;
}) {
  const [result, setResult] = useState<OptimizationResult>();
  const [resultConfig, setResultConfig] = useState<OptimizationConfig>();
  const [resultStartedAt, setResultStartedAt] = useState<string>();
  const [resultDataVersion, setResultDataVersion] = useState<string>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [resultKey, setResultKey] = useState<string>();
  const [hasAttempted, setHasAttempted] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyError, setHistoryError] = useState<string>();
  const [searchProgress, setSearchProgress] = useState<SingleSearchProgressState>({
    phase: "prepare",
    startedAt: Date.now(),
    hasFeasibleCandidate: false,
  });
  const [activeSearchConfig, setActiveSearchConfig] = useState<OptimizationConfig>();
  const abortController = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    abortController.current?.abort();
  }, []);

  function cancelSearch() {
    abortController.current?.abort();
  }

  function abortSearchForNavigation() {
    const controller = abortController.current;
    // 先解除当前请求的所有权，旧请求的回调与 finally 就不会再改写新页面状态。
    abortController.current = undefined;
    controller?.abort();
    setRunning(false);
  }

  function clearOutcomeMessages() {
    setError(undefined);
    setStatusMessage(undefined);
  }

  function resetResultForNewConfig() {
    setResult(undefined);
    setResultConfig(undefined);
    setResultStartedAt(undefined);
    setResultDataVersion(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
  }

  function loadHistoryConfig(record: SearchHistoryRecord) {
    if (record.kind !== "single") return;
    abortSearchForNavigation();
    setSelectedJob(record.config.jobId);
    const loadedConfig = record.config;
    setConfig(loadedConfig);
    setSingleGcdMode(singleGcdModeForConfig(loadedConfig));
    resetResultForNewConfig();
    setView("workbench");
    clearOutcomeMessages();
  }

  function loadHistoryResult(record: SearchHistoryRecord) {
    if (record.kind !== "single" || !record.result || record.dataVersion !== displayedDataVersion) return;
    abortSearchForNavigation();
    setSelectedJob(record.config.jobId);
    const loadedConfig = record.config;
    setConfig(loadedConfig);
    setSingleGcdMode(singleGcdModeForConfig(loadedConfig));
    setResult(record.result);
    setResultConfig(record.config);
    setResultStartedAt(record.startedAtISO);
    setResultDataVersion(record.dataVersion);
    setResultKey(JSON.stringify(loadedConfig));
    setHasAttempted(true);
    setView("result");
    setStatusMessage("已载入该次搜索结果。");
    setError(undefined);
  }

  async function saveHistoryOutcome(id: string, outcome: Parameters<typeof finishSearchHistory>[1]) {
    try { await finishSearchHistory(id, outcome); }
    catch (caught) { setHistoryError("搜索记录保存失败：" + searchMessageText(caught instanceof Error ? caught.message : String(caught))); }
    setHistoryRefresh((value) => value + 1);
  }

  async function runSearch(canStartSearch: boolean, displayObjective: OptimizationConfig["objective"]) {
    if (!selectedJob || !canStartSearch) return;
    const searchConfig = { ...config, jobId: selectedJob, objective: displayObjective };
    const searchKey = JSON.stringify(searchConfig);
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    const startedAt = Date.now();
    setActiveSearchConfig(searchConfig);
    setSearchProgress({
      phase: "prepare",
      startedAt,
      hasFeasibleCandidate: false,
    });
    setRunning(true);
    setView("progress");
    setError(undefined);
    setStatusMessage(undefined);
    setHasAttempted(true);
    setResult(undefined);
    setResultConfig(undefined);
    setResultStartedAt(undefined);
    setResultDataVersion(undefined);
    setResultKey(undefined);
    setHistoryError(undefined);
    let historyId: string | undefined;
    let historyStartedAt = new Date(startedAt).toISOString();

    try {
      // 先写入运行中记录，再启动耗时计算，刷新页面后仍能看到本次搜索记录。
      const record = await createSearchHistory({
        kind: "single",
        config: searchConfig,
        dataVersion: displayedDataVersion,
      });
      historyId = record.id;
      historyStartedAt = record.startedAtISO;
      setSearchProgress((current) => ({ ...current, startedAt: Date.parse(record.startedAtISO) }));
      setHistoryRefresh((value) => value + 1);
      if (controller.signal.aborted) throw new Error("搜索已取消。");

      // 每个回调都核对请求身份，丢弃已取消或被新搜索取代的旧请求事件。
      const searchResult = await optimize(searchConfig, {
        signal: controller.signal,
        onProgress: (message) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          const verificationStarted =
            message.includes("还原并复核") ||
            message.includes("精确候选已核验") ||
            message.includes("签名带");
          setSearchProgress((current) => ({
            ...current,
            phase: verificationStarted ? "verify" : current.phase === "prepare" ? "solve" : current.phase,
            hasFeasibleCandidate: current.hasFeasibleCandidate || message.includes("精确候选已核验"),
          }));
        },
        onCandidateCounts: (counts: SearchCandidateCounts) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          const order = new Map(["weapon", "offhand", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "rings"].map((slot, index) => [slot, index]));
          const slotCandidateCounts: SingleSearchSlotCandidateCount[] = counts.slots
            .map(({ slot, count }) => ({ label: candidateSlotLabel(slot), slot, count }))
            .sort((left, right) => (order.get(left.slot) ?? 99) - (order.get(right.slot) ?? 99))
            .map(({ label, count }) => ({ label, count }));
          setSearchProgress((current) => ({
            ...current,
            phase: "solve",
            slotCandidateCounts,
            foodCandidateCount: counts.foodCount,
          }));
        },
        onSolverProgress: (event: LinearMipProgress) => {
          if (controller.signal.aborted || abortController.current !== controller) return;
          const secondRoundModel = event.model === "exact_damage_band_feasibility";
          const foundObjectiveCandidate =
            event.kind === "incumbent" && event.model.startsWith("exact_damage_");
          const model: SingleSearchCurrentModelMetrics = {
            model: event.model,
            status: event.status,
            completed: event.completed,
            primalBound: event.objectiveValue,
            dualBound: event.bestBound,
            gap: event.gap,
            nodes: safeProgressCount(event.nodes),
            lpIterations: safeProgressCount(event.totalLpIterations),
            variables: event.variableCount,
            constraints: event.rowCount,
          };
          setSearchProgress((current) => {
            return {
              ...current,
              phase: secondRoundModel ? "verify" : current.phase === "prepare" ? "solve" : current.phase,
              hasFeasibleCandidate: current.hasFeasibleCandidate || foundObjectiveCandidate,
              currentModel: model,
            };
          });
        },
      });

      await saveHistoryOutcome(
        historyId,
        searchResult ? { status: "completed", result: searchResult } : { status: "no-result" },
      );
      if (controller.signal.aborted || abortController.current !== controller) return;
      setResult(searchResult);
      if (searchResult) {
        setResultKey(searchKey);
        setResultConfig(searchConfig);
        setResultStartedAt(historyStartedAt);
        setResultDataVersion(displayedDataVersion);
        setView("result");
        setStatusMessage(undefined);
      } else {
        setView("workbench");
        setStatusMessage("当前条件下没有可行配装，请调整条件后重新搜索。");
      }
    } catch (caught) {
      if (historyId) {
        await saveHistoryOutcome(
          historyId,
          controller.signal.aborted
            ? { status: "cancelled" }
            : { status: "failed", error: searchMessageText(caught instanceof Error ? caught.message : String(caught)) },
        );
      }
      if (abortController.current !== controller) return;
      setView("workbench");
      if (controller.signal.aborted || caught instanceof Error && caught.name === "AbortError") {
        setStatusMessage("搜索已取消。本次搜索已立即停止，可以调整条件后重新开始。");
      } else {
        setError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
      }
    } finally {
      if (abortController.current === controller) {
        abortController.current = undefined;
        setRunning(false);
      }
    }
  }

  return {
    result,
    resultConfig,
    resultStartedAt,
    resultDataVersion,
    resultKey,
    running,
    error,
    statusMessage,
    hasAttempted,
    historyRefresh,
    historyError,
    searchProgress,
    activeSearchConfig,
    cancelSearch,
    abortSearchForNavigation,
    clearOutcomeMessages,
    resetResultForNewConfig,
    loadHistoryConfig,
    loadHistoryResult,
    runSearch,
  };
}
