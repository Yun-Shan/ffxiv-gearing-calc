import { memo, useLayoutEffect, useState } from "react";
import { ArrowRight, Pencil, Play, X } from "lucide-react";
import { SinglePageSidePanel } from "@/ui/components/side-panel/SinglePageSidePanel";
import { SearchHistory } from "@/ui/components/search-history/SearchHistory";
import { displayedDataVersion } from "@/ui/services/app-config";
import { SingleConditionSummary } from "../../summary/single-condition-summary/SingleConditionSummary";
import { JobSelectionSidebar } from "../../job-selection/job-selection-sidebar/JobSelectionSidebar";
import { useSingleWorkbenchStore } from "../../../single-workbench-store";
import styles from "./SingleWorkbenchSidebar.module.scss";

export const SingleWorkbenchSidebar = memo(function SingleWorkbenchSidebar() {
  const panel = useSingleWorkbenchStore((state) => state.panel);
  const [advancedOpen, setAdvancedOpen] = useState(panel.advancedOpenInitially);

  useLayoutEffect(() => {
    setAdvancedOpen(panel.advancedOpenInitially);
  }, [panel.route, panel.advancedOpenInitially]);

  const info = (() => {
    switch (panel.content.kind) {
      case "selection":
        return <JobSelectionSidebar dataVersion={panel.content.dataVersion} />;
      case "conditions":
        return <SingleConditionSummary
          config={panel.content.config}
          view="workbench"
          gcdMode={panel.content.gcdMode}
        />;
      case "progress":
        return <SingleConditionSummary config={panel.content.config} view="progress" />;
      case "result":
        return <SingleConditionSummary
          config={panel.content.config}
          view="result"
          result={panel.content.result}
          startedAtISO={panel.content.startedAtISO}
          dataVersion={panel.content.dataVersion}
        />;
    }
  })();
  const ActionIcon = panel.route === "choose"
    ? ArrowRight
    : panel.route === "workbench"
      ? Play
      : panel.route === "progress"
        ? X
        : Pencil;

  return (
    <SinglePageSidePanel
      className={`${styles.sidebar}${panel.route === "result" ? ` ${styles.resultSidebar}` : ""}`}
      ariaLabel={panel.ariaLabel}
    >
      <header className={styles.panelHeader}>
        <div>
          <h2>{panel.title}</h2>
          {panel.subtitle && <p>{panel.subtitle}</p>}
        </div>
      </header>
      <div className={styles.summary}>{info}</div>
      <div className={styles.actionbar}>
        <span className={panel.statusReady ? styles.ready : styles.pending} role="status">{panel.status}</span>
        <button
          type="button"
          className={styles.runButton}
          disabled={!panel.actionEnabled}
          onClick={panel.onAction}
        >
          <ActionIcon size={16} fill={panel.route === "workbench" ? "currentColor" : "none"} />
          {panel.actionLabel}
        </button>
      </div>
      <footer className={styles.footer}>
        <span>纯前端计算 · 可离线运行</span>
        <button
          type="button"
          className={styles.advancedToggle}
          disabled={!panel.advancedSettingsEnabled}
          aria-expanded={advancedOpen && panel.advancedSettingsEnabled}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          高级设置
        </button>
      </footer>
      {advancedOpen && panel.advancedSettingsEnabled && <div className={styles.history}>
        <SearchHistory
          kind="single"
          currentDataVersion={displayedDataVersion}
          refreshKey={panel.historyRefresh}
          defaultOpen={panel.historyDefaultOpen}
          hideSummary={panel.historyHideSummary}
          onLoadConfig={panel.onLoadConfig}
          onLoadResult={panel.onLoadResult}
        />
      </div>}
    </SinglePageSidePanel>
  );
});
