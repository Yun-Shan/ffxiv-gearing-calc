import { useEffect, useMemo, useState } from "react";
import type { OptimizationConfig } from "@/domain";
import type {
  AnalyzeFeasibleGcds,
  GcdAnalysisInput,
  GcdAnalysisState,
} from "./types";

export function gcdAnalysisInputFromConfig(
  config: OptimizationConfig,
): GcdAnalysisInput {
  return {
    jobId: config.jobId,
    minItemLevel: config.minItemLevel,
    maxItemLevel: config.maxItemLevel,
    speedMin: config.speedMin,
    speedMax: config.speedMax,
    syncLevel: config.syncLevel,
    minTenacity: config.minTenacity,
    toughnessMin: config.toughnessMin,
    toughnessMinPercent: config.toughnessMinPercent,
    maximizeTenacity: config.maximizeTenacity,
    excludedSources: [...config.excludedSources],
    excludedGearIds: config.excludedGearIds
      ? [...config.excludedGearIds]
      : undefined,
    forcedGear: { ...config.forcedGear },
    foodId: config.foodId,
  };
}

export function gcdAnalysisKey(input: GcdAnalysisInput): string {
  return JSON.stringify({
    jobId: input.jobId,
    minItemLevel: input.minItemLevel,
    maxItemLevel: input.maxItemLevel,
    speedMin: input.speedMin,
    speedMax: input.speedMax,
    syncLevel: input.syncLevel,
    minTenacity: input.minTenacity,
    toughnessMin: input.toughnessMin,
    toughnessMinPercent: input.toughnessMinPercent,
    maximizeTenacity: input.maximizeTenacity,
    excludedSources: [...input.excludedSources].sort(),
    excludedGearIds: [...(input.excludedGearIds ?? [])].sort((a, b) => a - b),
    forcedGear: Object.fromEntries(
      Object.entries(input.forcedGear).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    foodId: input.foodId,
  });
}

export function useGcdAnalysisController({
  input,
  analyze,
  debounceMs = 180,
}: {
  input: GcdAnalysisInput | undefined;
  analyze: AnalyzeFeasibleGcds;
  debounceMs?: number;
}): GcdAnalysisState {
  const key = input ? gcdAnalysisKey(input) : undefined;
  const stableInput = useMemo(() => input, [key]);
  const [state, setState] = useState<GcdAnalysisState>({ status: "idle" });

  useEffect(() => {
    if (!stableInput || !key) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading", key });
    const timer = window.setTimeout(() => {
      analyze(stableInput, controller.signal)
        .then((tiers) => {
          if (controller.signal.aborted) return;
          setState({ status: "ready", key, feasibleTiers: [...tiers] });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: "error",
            key,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [analyze, debounceMs, key, stableInput]);

  if (!key) return { status: "idle" };
  return state.status !== "idle" && state.key !== key
    ? { status: "loading", key }
    : state;
}
