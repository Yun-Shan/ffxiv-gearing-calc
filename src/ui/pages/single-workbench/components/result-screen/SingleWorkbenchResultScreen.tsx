import type { OptimizationConfig, OptimizationResult } from "@/domain";
import { ResultPanel } from "../result-panel/single-result-panel/SingleResultPanel";

export function SingleWorkbenchResultScreen({
  result,
  config,
}: {
  result: OptimizationResult;
  config: OptimizationConfig;
}) {
  return <ResultPanel
    result={result}
    config={config}
    compact
  />;
}
