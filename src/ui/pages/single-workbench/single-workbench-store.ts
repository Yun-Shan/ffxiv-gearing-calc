import { create } from "zustand";
import type { OptimizationConfig, OptimizationResult } from "@/domain";
import type { SingleGcdMode } from "@/ui/services/types";
import type { SearchHistoryRecord } from "@/ui/services/search-history";
import type { SingleWorkbenchView } from "./single-workbench-types";

export type SingleWorkbenchPanelContent =
  | { kind: "selection"; dataVersion: string }
  | { kind: "conditions"; config: OptimizationConfig; gcdMode: SingleGcdMode }
  | { kind: "progress"; config: OptimizationConfig }
  | {
      kind: "result";
      config: OptimizationConfig;
      result?: OptimizationResult;
      startedAtISO?: string;
      dataVersion?: string;
    };

export interface SingleWorkbenchPanelState {
  route: SingleWorkbenchView;
  ariaLabel: string;
  title: string;
  subtitle?: string;
  content: SingleWorkbenchPanelContent;
  status: string;
  statusReady: boolean;
  actionLabel: string;
  actionEnabled: boolean;
  onAction: () => void;
  advancedSettingsEnabled: boolean;
  advancedOpenInitially: boolean;
  historyRefresh: number;
  historyDefaultOpen: boolean;
  historyHideSummary: boolean;
  onLoadConfig: (record: SearchHistoryRecord) => void;
  onLoadResult: (record: SearchHistoryRecord) => void;
}

interface SingleWorkbenchStore {
  // 主内容区路由与右侧面板快照分别保存，避免面板内容依附于主内容子页。
  mainRoute: SingleWorkbenchView;
  panel: SingleWorkbenchPanelState;
  setMainRoute: (route: SingleWorkbenchView) => void;
  setPanel: (panel: SingleWorkbenchPanelState) => void;
  reset: () => void;
}

const initialPanel: SingleWorkbenchPanelState = {
  route: "choose",
  ariaLabel: "公告与应用信息",
  title: "信息公告栏",
  content: { kind: "selection", dataVersion: "" },
  status: "请选择一个职业。",
  statusReady: false,
  actionLabel: "继续设置条件",
  actionEnabled: false,
  onAction: () => {},
  advancedSettingsEnabled: true,
  advancedOpenInitially: true,
  historyRefresh: 0,
  historyDefaultOpen: true,
  historyHideSummary: true,
  onLoadConfig: () => {},
  onLoadResult: () => {},
};

export const useSingleWorkbenchStore = create<SingleWorkbenchStore>((set) => ({
  mainRoute: "choose",
  panel: initialPanel,
  setMainRoute: (mainRoute) => set({ mainRoute }),
  setPanel: (panel) => set({ panel }),
  reset: () => set({ mainRoute: "choose", panel: initialPanel }),
}));
