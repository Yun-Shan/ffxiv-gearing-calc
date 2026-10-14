import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { findFeasibleGcds, type JobId, type OptimizationConfig } from "@/domain";
import type { SingleGcdFeasibility } from "@/ui/components/job-config/types.ts";
import { searchMessageText } from "@/ui/services/search-message.ts";
import type { SingleGcdMode } from "@/ui/services/types.ts";
import type { SingleWorkbenchView } from "../single-workbench-types.ts";

export function useSingleWorkbenchGcd({
  selectedJob,
  config,
  setConfig,
  view,
  running,
  singleGcdMode,
}: {
  selectedJob: JobId | null;
  config: OptimizationConfig;
  setConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  view: SingleWorkbenchView;
  running: boolean;
  singleGcdMode: SingleGcdMode;
}) {
  const [customGcdCoverage, setCustomGcdCoverage] = useState<{ key: string; tiers: number[] }>();
  const [customGcdError, setCustomGcdError] = useState<string>();
  const [singleGcdFeasibility, setSingleGcdFeasibility] = useState<SingleGcdFeasibility>();

  const customSpeedHasBounds = config.speedMin !== undefined || config.speedMax !== undefined;
  const customSpeedActive = singleGcdMode === "speed" || customSpeedHasBounds;
  const gcdSelectionActive = singleGcdMode === "tiers" || config.gcdChoices !== undefined;
  // 目标和档位选择会由可行性结果推导；将它们从查询键中排除，避免结果反过来触发重复查询。
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
  const selectedGcds = config.gcdChoices ?? [];
  const selectedGcdsAreFeasible = currentTierFeasibility?.status === "ready" &&
    selectedGcds.length > 0 && selectedGcds.every((gcd) => currentTierFeasibility.tiers.includes(gcd));
  const selectedGcdsIncludeUnavailable = currentTierFeasibility?.status === "ready" &&
    selectedGcds.some((gcd) => !currentTierFeasibility.tiers.includes(gcd));
  const derivedObjective = customSpeedActive
    ? !customSpeedHasBounds
      ? "dps"
      : currentGcdCoverage === undefined
        ? undefined
        : currentGcdCoverage.length === 1 ? "damage" : "dps"
    : singleGcdMode === "tiers"
      ? (config.gcdChoices?.length ?? 0) === 1 ? "damage" : "dps"
      : "dps";
  const displayObjective = derivedObjective ?? config.objective!;
  const canStartSearch =
    selectedJob !== null &&
    (singleGcdMode === "tiers"
      ? selectedGcdsAreFeasible
      : customSpeedActive
        ? !customSpeedHasBounds || (currentGcdCoverage !== undefined && currentGcdCoverage.length > 0)
        : true) &&
    !running;
  const singleGcdActionMessage = singleGcdMode === "tiers"
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

  useEffect(() => {
    if (view !== "workbench" || !selectedJob || !customSpeedActive || !customSpeedHasBounds || gcdSelectionActive) {
      setCustomGcdCoverage(undefined);
      setCustomGcdError(undefined);
      return;
    }
    const controller = new AbortController();
    // 输入停止后再查询，并在依赖变化或离开页面时取消旧请求，防止过期结果覆盖当前状态。
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
    if (view !== "workbench" || !selectedJob || !derivedObjective) return;
    setConfig((current) => current.objective === derivedObjective
      ? current
      : { ...current, objective: derivedObjective });
  }, [view, selectedJob, derivedObjective]);

  return {
    singleGcdMode,
    setSingleGcdFeasibility,
    customGcdError,
    displayObjective,
    canStartSearch,
    singleGcdActionMessage,
  };
}
