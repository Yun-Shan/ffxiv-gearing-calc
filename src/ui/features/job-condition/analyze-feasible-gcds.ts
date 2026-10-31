import { findFeasibleGcds } from "@/domain";
import type { AnalyzeFeasibleGcds, GcdAnalysisInput } from "./types";
import { getSearchStrategySettings } from "@/ui/services/search-strategy-settings";

/** Adapter to the current domain API; it does not reproduce GCD or combat formulas. */
export const analyzeFeasibleGcds: AnalyzeFeasibleGcds = (
  input: GcdAnalysisInput,
  signal: AbortSignal,
) =>
  findFeasibleGcds(
    {
      ...input,
      gcdChoices: undefined,
      speedMin: input.speedMin,
      speedMax: input.speedMax,
      objective: "damage",
    },
    { signal, strategies: getSearchStrategySettings() },
  );
