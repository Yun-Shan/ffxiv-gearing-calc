import { useEffect, useState } from "react";
import { jobSchemas, type JobId, type OptimizationConfig } from "@/domain";
import { defaultJobLevel, displayedDataVersion, makeConfig } from "@/ui/services/app-config";
import styles from "./SingleWorkbenchPage.module.scss";
import { SingleWorkbenchMainRoute } from "./components/main-route/SingleWorkbenchMainRoute";
import { SingleWorkbenchSidebar } from "./components/sidebar/single-workbench-sidebar/SingleWorkbenchSidebar";
import { useSingleWorkbenchGcd } from "./hooks/useSingleWorkbenchGcd.ts";
import { useSingleWorkbenchSearch } from "./hooks/useSingleWorkbenchSearch.ts";
import { useSingleWorkbenchPanelState } from "./hooks/useSingleWorkbenchPanelState.ts";
import { useSingleWorkbenchStore } from "./single-workbench-store";

export function SingleWorkbenchPage() {
  const [selectedJob, setSelectedJob] = useState<JobId | null>(null);
  const [config, setConfig] = useState<OptimizationConfig>(() => makeConfig("PLD"));
  const [singleGcdMode, setSingleGcdMode] = useState<"any" | "tiers" | "speed">("any");
  const view = useSingleWorkbenchStore((state) => state.mainRoute);
  const setView = useSingleWorkbenchStore((state) => state.setMainRoute);
  const resetStore = useSingleWorkbenchStore((state) => state.reset);
  const search = useSingleWorkbenchSearch({
    selectedJob,
    setSelectedJob,
    config,
    setConfig,
    setView,
    setSingleGcdMode,
  });
  const gcd = useSingleWorkbenchGcd({
    selectedJob,
    config,
    setConfig,
    view,
    running: search.running,
    singleGcdMode,
  });

  useEffect(() => () => resetStore(), [resetStore]);

  function chooseJob(jobId: JobId) {
    if (selectedJob === jobId) {
      setView("workbench");
      search.clearOutcomeMessages();
      return;
    }
    if (search.running) search.cancelSearch();
    setSelectedJob(jobId);
    setConfig({ ...makeConfig(jobId), objective: "dps" });
    setSingleGcdMode("any");
    search.resetResultForNewConfig();
    setView("workbench");
    search.clearOutcomeMessages();
  }

  function editConfig() {
    setConfig((current) => ({
      ...current,
      jobLevel: jobSchemas[current.jobId].maxJobLevel ?? defaultJobLevel,
    }));
    setView("workbench");
    search.clearOutcomeMessages();
  }

  useSingleWorkbenchPanelState({
    view,
    selectedJob,
    config,
    singleGcdMode,
    displayObjective: gcd.displayObjective,
    canStartSearch: gcd.canStartSearch,
    statusMessage: view === "workbench" ? gcd.singleGcdActionMessage : search.statusMessage ?? "",
    searchRunning: search.running,
    activeSearchConfig: search.activeSearchConfig,
    result: search.result,
    resultConfig: search.resultConfig,
    resultStartedAt: search.resultStartedAt,
    resultDataVersion: search.resultDataVersion,
    dataVersion: displayedDataVersion,
    historyRefresh: search.historyRefresh,
    onChooseJob: () => { if (selectedJob) setView("workbench"); },
    onStartSearch: () => { void search.runSearch(gcd.canStartSearch, gcd.displayObjective); },
    onCancelSearch: search.cancelSearch,
    onEditConfig: editConfig,
    onLoadConfig: search.loadHistoryConfig,
    onLoadResult: search.loadHistoryResult,
  });

  return (
    <main
      className={styles.layout}
      data-result-view={view === "result" || undefined}
      data-progress-view={view === "progress" || undefined}
    >
      <SingleWorkbenchMainRoute
        selectedJob={selectedJob}
        config={config}
        setConfig={setConfig}
        singleGcdMode={singleGcdMode}
        onSingleGcdModeChange={setSingleGcdMode}
        onSingleGcdFeasibilityChange={gcd.setSingleGcdFeasibility}
        gcd={gcd}
        search={search}
        onChooseJob={chooseJob}
      />
      <SingleWorkbenchSidebar />
    </main>
  );
}
