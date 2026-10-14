import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { jobSchemas, type JobId, type OptimizationConfig, type OptimizationResult } from "@/domain";
import type { SingleGcdMode } from "@/ui/services/types.ts";
import type { SearchHistoryRecord } from "@/ui/services/search-history.ts";
import type { SingleWorkbenchPanelState } from "../single-workbench-store.ts";
import { useSingleWorkbenchStore } from "../single-workbench-store.ts";
import type { SingleWorkbenchView } from "../single-workbench-types.ts";

export function useSingleWorkbenchPanelState({
  view,
  selectedJob,
  config,
  singleGcdMode,
  displayObjective,
  canStartSearch,
  statusMessage,
  searchRunning,
  activeSearchConfig,
  result,
  resultConfig,
  resultStartedAt,
  resultDataVersion,
  dataVersion,
  historyRefresh,
  onChooseJob,
  onStartSearch,
  onCancelSearch,
  onEditConfig,
  onLoadConfig,
  onLoadResult,
}: {
  view: SingleWorkbenchView;
  selectedJob: JobId | null;
  config: OptimizationConfig;
  singleGcdMode: SingleGcdMode;
  displayObjective: OptimizationConfig["objective"];
  canStartSearch: boolean;
  statusMessage: string;
  searchRunning: boolean;
  activeSearchConfig?: OptimizationConfig;
  result?: OptimizationResult;
  resultConfig?: OptimizationConfig;
  resultStartedAt?: string;
  resultDataVersion?: string;
  dataVersion: string;
  historyRefresh: number;
  onChooseJob: () => void;
  onStartSearch: () => void;
  onCancelSearch: () => void;
  onEditConfig: () => void;
  onLoadConfig: (record: SearchHistoryRecord) => void;
  onLoadResult: (record: SearchHistoryRecord) => void;
}) {
  const setPanel = useSingleWorkbenchStore((state) => state.setPanel);
  // 面板快照保留稳定的回调引用，再通过 ref 调用最新处理函数，避免捕获过期闭包。
  const callbacks = useRef({
    onChooseJob,
    onStartSearch,
    onCancelSearch,
    onEditConfig,
    onLoadConfig,
    onLoadResult,
  });
  callbacks.current = {
    onChooseJob,
    onStartSearch,
    onCancelSearch,
    onEditConfig,
    onLoadConfig,
    onLoadResult,
  };
  const onChooseJobStable = useCallback(() => callbacks.current.onChooseJob(), []);
  const onStartSearchStable = useCallback(() => callbacks.current.onStartSearch(), []);
  const onCancelSearchStable = useCallback(() => callbacks.current.onCancelSearch(), []);
  const onEditConfigStable = useCallback(() => callbacks.current.onEditConfig(), []);
  const onLoadConfigStable = useCallback((record: SearchHistoryRecord) => callbacks.current.onLoadConfig(record), []);
  const onLoadResultStable = useCallback((record: SearchHistoryRecord) => callbacks.current.onLoadResult(record), []);
  const panel = useMemo<SingleWorkbenchPanelState>(() => {
    const job = selectedJob ? jobSchemas[selectedJob] : undefined;
    const resultConfigValue = resultConfig ?? config;
    const displayedConfig = view === "workbench"
      ? { ...config, objective: displayObjective }
      : config;
    const historyProps = {
      historyRefresh,
      historyDefaultOpen: view === "choose",
      historyHideSummary: view === "choose",
      advancedSettingsEnabled: view !== "result",
      advancedOpenInitially: view === "choose",
      onLoadConfig: onLoadConfigStable,
      onLoadResult: onLoadResultStable,
    };

    switch (view) {
      case "choose":
        return {
          route: view,
          ariaLabel: "公告与应用信息",
          title: "信息公告栏",
          subtitle: "单职业配装工作台",
          content: { kind: "selection", dataVersion },
          status: job ? `已选择 ${job.name}，可以继续设置条件。` : "请选择一个职业。",
          statusReady: Boolean(job),
          actionLabel: "继续设置条件",
          actionEnabled: Boolean(job),
          onAction: onChooseJobStable,
          ...historyProps,
        };
      case "workbench":
        return {
          route: view,
          ariaLabel: "当前搜索条件摘要",
          title: "当前搜索条件",
          subtitle: job?.name,
          content: { kind: "conditions", config: displayedConfig, gcdMode: singleGcdMode },
          status: statusMessage,
          statusReady: canStartSearch,
          actionLabel: "开始搜索",
          actionEnabled: canStartSearch,
          onAction: onStartSearchStable,
          ...historyProps,
        };
      case "progress":
        return {
          route: view,
          ariaLabel: "搜索条件摘要",
          title: "搜索进度",
          subtitle: job?.name,
          content: { kind: "progress", config: activeSearchConfig ?? config },
          status: searchRunning ? "搜索正在运行，可以随时取消。" : statusMessage,
          statusReady: searchRunning,
          actionLabel: "取消搜索",
          actionEnabled: searchRunning,
          onAction: onCancelSearchStable,
          ...historyProps,
        };
      case "result":
        return {
          route: view,
          ariaLabel: "配装条件摘要",
          title: "配装结果",
          subtitle: jobSchemas[resultConfigValue.jobId].name,
          content: {
            kind: "result",
            config: resultConfigValue,
            result,
            startedAtISO: resultStartedAt,
            dataVersion: resultDataVersion,
          },
          status: "已生成最优配装结果。",
          statusReady: true,
          actionLabel: "编辑当前条件",
          actionEnabled: true,
          onAction: onEditConfigStable,
          ...historyProps,
        };
    }
  }, [
    view,
    selectedJob,
    config,
    singleGcdMode,
    displayObjective,
    canStartSearch,
    statusMessage,
    searchRunning,
    activeSearchConfig,
    result,
    resultConfig,
    resultStartedAt,
    resultDataVersion,
    dataVersion,
    historyRefresh,
    onChooseJobStable,
    onStartSearchStable,
    onCancelSearchStable,
    onEditConfigStable,
    onLoadConfigStable,
    onLoadResultStable,
  ]);

  useLayoutEffect(() => {
    // 在浏览器绘制前同步面板快照，避免主内容已切换而侧栏仍显示上一状态。
    setPanel(panel);
  }, [panel, setPanel]);
}
