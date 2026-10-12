import { useEffect, useMemo, useRef, useState } from "react";
import {
  findFeasibleGcds,
  jobSchemas,
  optimize,
  type GearSlot,
  type JobId,
  type OptimizationConfig,
  type OptimizationResult,
  type SearchCandidateCounts,
} from "../../../domain/index";
import type { LinearMipProgress } from "../../../domain/search/linear-mip";
import { AppHeader } from "../../components/app-header/AppHeader";
import { JobPicker } from "./components/job-selection/wizard-navigation/WizardNavigation";
import { SingleWorkbenchLayout, SingleWorkbenchFlow } from "./components/layout/single-workbench-layout/SingleWorkbenchLayout";
import styles from "./SingleWorkbenchPage.module.css";
import { SingleWorkbenchMain } from "./components/main/single-workbench-main/SingleWorkbenchMain";
import { SingleWorkbenchSidebar } from "./components/sidebar/single-workbench-sidebar/SingleWorkbenchSidebar";
import { SingleConditionSummary } from "./components/summary/single-condition-summary/SingleConditionSummary";
import { JobSelectionSidebar } from "./components/job-selection/job-selection-sidebar/JobSelectionSidebar";
import { SearchHistory } from "../../components/search-history/SearchHistory";
import { SingleSearchProgress } from "./components/search-progress/SingleSearchProgress";
import type {
  SingleSearchCurrentModelMetrics,
  SingleSearchProgressState,
  SingleSearchSlotCandidateCount,
} from "./components/search-progress/SingleSearchProgress";
import { JobConfigFields } from "../../components/job-config/job-config-fields/JobConfigFields";
import { ResultPanel, StatusPanel } from "./components/result-panel/single-result-panel/SingleResultPanel";
import {
  displayedDataVersion,
  defaultJobLevel,
  makeConfig,
  normalizeSingleWorkbenchConfig,
  singleGcdModeForConfig,
} from "../../services/app-config";
import type { SingleGcdFeasibility } from "../../components/job-config/types";
import type { SingleGcdMode } from "../../services/types";
import { searchMessageText, searchProgressText } from "../../services/search-message";
import { gearSlotLabels } from "../../services/labels";
import { createSearchHistory, finishSearchHistory } from "../../services/search-history";
import type { SearchHistoryRecord } from "../../services/search-history";

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

const roleNames = {
  tank: "防护职业",
  healer: "治疗职业",
  str: "力量职业",
  dex: "灵巧职业",
  int: "智力职业",
} as const;
export function SingleWorkbenchPage({ onReset }: { onReset: () => void }) {
  const [selectedJob, setSelectedJob] = useState<JobId | null>(null);
  const [config, setConfig] = useState<OptimizationConfig>(() => makeConfig("PLD"));
  const [singleGcdMode, setSingleGcdMode] = useState<SingleGcdMode>("any");
  const [view, setView] = useState<"choose" | "workbench" | "progress" | "result">("choose");
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
  const [customGcdCoverage, setCustomGcdCoverage] = useState<{ key: string; tiers: number[] }>();
  const [customGcdError, setCustomGcdError] = useState<string>();
  const [singleGcdFeasibility, setSingleGcdFeasibility] = useState<SingleGcdFeasibility>();
  const abortController = useRef<AbortController | undefined>(undefined);

  const currentKey = selectedJob ? JSON.stringify(config) : "";
  const stale = result !== undefined && resultKey !== currentKey;
  const job = selectedJob ? jobSchemas[selectedJob] : undefined;
  const customSpeedHasBounds = config.speedMin !== undefined || config.speedMax !== undefined;
  const customSpeedActive = singleGcdMode === "speed" || customSpeedHasBounds;
  const gcdSelectionActive = singleGcdMode === "tiers" || config.gcdTarget !== undefined || config.gcdChoices !== undefined;
  const hasLegacyGcdSpeedConflict = customSpeedActive && gcdSelectionActive;
  const customGcdQueryKey = JSON.stringify({
    ...config,
    objective: undefined,
    gcdTarget: undefined,
    gcdChoices: undefined,
  });
  const customGcdQueryConfig = useMemo<OptimizationConfig>(
    () => ({ ...config, objective: "damage", gcdTarget: undefined, gcdChoices: undefined }),
    [customGcdQueryKey],
  );
  const currentGcdCoverage =
    customGcdCoverage?.key === customGcdQueryKey ? customGcdCoverage.tiers : undefined;
  const currentTierFeasibility =
    singleGcdFeasibility?.key === customGcdQueryKey ? singleGcdFeasibility : undefined;
  const selectedGcds = config.gcdChoices ?? (config.gcdTarget === undefined ? [] : [config.gcdTarget]);
  const selectedGcdsAreFeasible = currentTierFeasibility?.status === "ready" &&
    selectedGcds.length > 0 && selectedGcds.every((gcd) => currentTierFeasibility.tiers.includes(gcd));
  const selectedGcdsIncludeUnavailable = currentTierFeasibility?.status === "ready" &&
    selectedGcds.some((gcd) => !currentTierFeasibility.tiers.includes(gcd));
  const derivedObjective = hasLegacyGcdSpeedConflict
    ? undefined
    : customSpeedActive
      ? !customSpeedHasBounds
        ? "dps"
        : currentGcdCoverage === undefined
          ? undefined
          : currentGcdCoverage.length === 1 ? "damage" : "dps"
      : singleGcdMode === "tiers"
        ? (config.gcdChoices?.length ?? 0) === 1 ? "damage" : "dps"
        : config.gcdTarget !== undefined || (config.gcdChoices?.length ?? 0) === 1
        ? "damage"
        : "dps";
  const displayObjective = derivedObjective ?? config.objective ?? "damage";
  const canStartSearch =
    selectedJob !== null &&
    !hasLegacyGcdSpeedConflict &&
    (singleGcdMode === "tiers"
      ? selectedGcdsAreFeasible
      : customSpeedActive
        ? !customSpeedHasBounds || (currentGcdCoverage !== undefined && currentGcdCoverage.length > 0)
        : true) &&
    !running;
  const singleGcdActionMessage = hasLegacyGcdSpeedConflict
    ? "请先选择 GCD 条件或自定义速度范围。"
    : singleGcdMode === "tiers"
      ? !currentTierFeasibility || currentTierFeasibility.status === "loading"
        ? "正在查询当前条件下的可行 GCD 档位…"
        : currentTierFeasibility.status === "error"
          ? "可行 GCD 档位查询失败，请重新查询。"
          : selectedGcds.length === 0
            ? "请选择至少一个可行 GCD 档位。"
            : selectedGcdsIncludeUnavailable
              ? "请移除当前条件下不可行的已选 GCD 档位。"
              : "已就绪 · 搜索结果将严格满足以上条件"
      : customSpeedActive && customSpeedHasBounds && currentGcdCoverage === undefined
        ? "正在计算速度范围覆盖的 GCD 档位…"
        : customSpeedActive && customSpeedHasBounds && currentGcdCoverage?.length === 0
          ? "当前速度范围没有可行 GCD 档位。"
          : "已就绪 · 搜索结果将严格满足以上条件";

  useEffect(() => () => {
    abortController.current?.abort();
  }, []);

  useEffect(() => {
    if (view !== "workbench" || !selectedJob || !customSpeedActive || !customSpeedHasBounds || gcdSelectionActive) {
      setCustomGcdCoverage(undefined);
      setCustomGcdError(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCustomGcdError(undefined);
      findFeasibleGcds(customGcdQueryConfig, { signal: controller.signal })
        .then((tiers) => {
          if (controller.signal.aborted) return;
          setCustomGcdCoverage({ key: customGcdQueryKey, tiers });
          const objective = tiers.length === 1 ? "damage" : "dps";
          setConfig((current) => current.objective === objective ? current : { ...current, objective });
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) {
            setCustomGcdError(searchMessageText(caught instanceof Error ? caught.message : String(caught)));
          }
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [view, selectedJob, customSpeedActive, customSpeedHasBounds, gcdSelectionActive, customGcdQueryKey, customGcdQueryConfig]);

  useEffect(() => {
    if (view !== "workbench" || !selectedJob || hasLegacyGcdSpeedConflict || !derivedObjective) return;
    setConfig((current) => current.objective === derivedObjective
      ? current
      : { ...current, objective: derivedObjective });
  }, [view, selectedJob, hasLegacyGcdSpeedConflict, derivedObjective]);

  function cancelSearch() {
    abortController.current?.abort();
  }

  function abortSearchForNavigation() {
    const controller = abortController.current;
    abortController.current = undefined;
    controller?.abort();
    setRunning(false);
  }

  function clearOutcomeMessages() {
    setError(undefined);
    setStatusMessage(undefined);
  }

  function chooseJob(jobId: JobId) {
    if (selectedJob === jobId) {
      setView("workbench");
      clearOutcomeMessages();
      return;
    }
    if (running) cancelSearch();
    setSelectedJob(jobId);
    setConfig({ ...makeConfig(jobId), objective: "dps" });
    setSingleGcdMode("any");
    setResult(undefined);
    setResultConfig(undefined);
    setResultStartedAt(undefined);
    setResultDataVersion(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
    setView("workbench");
    clearOutcomeMessages();
  }

  function loadHistoryConfig(record: SearchHistoryRecord) {
    if (record.kind !== "single") return;
    abortSearchForNavigation();
    setSelectedJob(record.config.jobId);
    const loadedConfig = normalizeSingleWorkbenchConfig({
      ...record.config,
      jobLevel: jobSchemas[record.config.jobId].maxJobLevel ?? defaultJobLevel,
    });
    if (
      singleGcdModeForConfig(loadedConfig) === "speed" &&
      loadedConfig.speedMin === undefined &&
      loadedConfig.speedMax === undefined
    ) {
      loadedConfig.objective = "dps";
    }
    setConfig(loadedConfig);
    setSingleGcdMode(singleGcdModeForConfig(loadedConfig));
    setResult(undefined);
    setResultConfig(undefined);
    setResultStartedAt(undefined);
    setResultDataVersion(undefined);
    setResultKey(undefined);
    setHasAttempted(false);
    setView("workbench");
    clearOutcomeMessages();
  }

  function loadHistoryResult(record: SearchHistoryRecord) {
    if (record.kind !== "single" || !record.result || record.dataVersion !== displayedDataVersion) return;
    abortSearchForNavigation();
    setSelectedJob(record.config.jobId);
    const loadedConfig = normalizeSingleWorkbenchConfig(record.config);
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

  async function runSearch() {
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

  const objectiveLabel = displayObjective === "dps" ? "每秒每威力伤害期望" : "每威力伤害期望";

  function keepGcdAndClearSpeed() {
    setConfig((current) => {
      const normalized = normalizeSingleWorkbenchConfig(current);
      const objective = normalized.gcdTarget !== undefined || normalized.gcdChoices?.length === 1 ? "damage" : "dps";
      return { ...normalized, speedMin: undefined, speedMax: undefined, objective };
    });
    const normalized = normalizeSingleWorkbenchConfig(config);
    setSingleGcdMode(normalized.gcdTarget !== undefined || normalized.gcdChoices !== undefined ? "tiers" : "any");
    setCustomGcdCoverage(undefined);
    clearOutcomeMessages();
  }

  function keepSpeedAndClearGcd() {
    setConfig((current) => ({ ...current, gcdTarget: undefined, gcdChoices: undefined }));
    setSingleGcdMode("speed");
    setCustomGcdCoverage(undefined);
    clearOutcomeMessages();
  }

  const searchHistory = (
    <SearchHistory
      kind="single"
      currentDataVersion={displayedDataVersion}
      refreshKey={historyRefresh}
      defaultOpen={view === "choose"}
      hideSummary={view === "choose"}
      onLoadConfig={loadHistoryConfig}
      onLoadResult={loadHistoryResult}
    />
  );

  return (
    <>
    <AppHeader
      page="single"
    />
    <SingleWorkbenchFlow resultView={view === "result"}>
      {view === "choose" && <div className={styles.selectionLayout}>
        <section className={styles.jobSelection} aria-labelledby="single-selection-title">
          <header className={styles.selectionHeading}>
            <p className={styles.sectionKicker}>单职业配装 · 配装流程</p>
            <h1 id="single-selection-title">选择职业</h1>
          </header>
          <JobPicker value={selectedJob} onChange={chooseJob} />
          {searchHistory}
        </section>
        <JobSelectionSidebar dataVersion={displayedDataVersion} onReset={onReset} />
      </div>}

      {view === "workbench" && selectedJob && job && <SingleWorkbenchLayout
        main={<SingleWorkbenchMain
          roleLabel={job.role === "tank" ? "坦克" : roleNames[job.role]}
          jobName={job.name}
          onChangeJob={() => setView("choose")}
          notices={<>
            {hasLegacyGcdSpeedConflict && <section className={styles.configWarning} role="alert">
              <strong>这组历史条件同时设置了 GCD 档位和自定义速度范围。</strong>
              <p>新工作台要求两者互斥，请选择保留其中一项后再搜索。</p>
              <div>
                <button type="button" onClick={keepGcdAndClearSpeed}>保留 GCD 档位</button>
                <button type="button" onClick={keepSpeedAndClearGcd}>保留自定义速度</button>
              </div>
            </section>}
            {customGcdError && <p className={styles.gcdError} role="alert">{customGcdError}</p>}
            {historyError && <p role="alert">{historyError}</p>}
          </>}
          status={!result && <StatusPanel
            running={false}
            progress=""
            error={error}
            message={statusMessage}
            onCancel={cancelSearch}
          />}
          fields={<JobConfigFields
            config={config}
            setConfig={setConfig}
            showFood
            step="all"
            singleWorkbench
            singleGcdMode={singleGcdMode}
            onSingleGcdModeChange={setSingleGcdMode}
            onSingleGcdFeasibilityChange={setSingleGcdFeasibility}
            singleObjectiveLabel={objectiveLabel}
            onEdited={clearOutcomeMessages}
          />}
          outcome={hasAttempted && (error || statusMessage) && !result && <ResultPanel
            config={config}
            attempted={hasAttempted}
            failed={error !== undefined}
            statusMessage={statusMessage}
          />}
        />}
        sidebar={<SingleWorkbenchSidebar
          summary={<SingleConditionSummary
            config={{ ...config, objective: displayObjective }}
            view="workbench"
            gcdMode={singleGcdMode}
          />}
          status={singleGcdActionMessage}
          canStartSearch={canStartSearch}
          onStartSearch={runSearch}
          onReset={onReset}
          history={searchHistory}
        />}
      />}

      {view === "progress" && activeSearchConfig && selectedJob && <SingleSearchProgress
        jobName={jobSchemas[selectedJob].name}
        progress={searchProgress}
        rightSummary={<SingleConditionSummary config={activeSearchConfig} view="progress" />}
        onCancel={cancelSearch}
        onReset={onReset}
        history={searchHistory}
      />}

      {view === "result" && result && !stale && <ResultPanel
        result={result}
        config={resultConfig ?? config}
        compact
        searchStartedAt={resultStartedAt}
        resultDataVersion={resultDataVersion}
        onEditConfig={() => {
          setConfig((current) => ({
            ...current,
            jobLevel: jobSchemas[current.jobId].maxJobLevel ?? defaultJobLevel,
          }));
          setView("workbench");
          clearOutcomeMessages();
        }}
      />}
    </SingleWorkbenchFlow>
    </>
  );
}
