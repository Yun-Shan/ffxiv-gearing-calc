import type {
  JointOptimizationResult,
  JobId,
  OptimizationResult,
} from "@/domain";
import type {
  UiJointOptimizationConfig,
  UiOptimizationConfig,
} from "./search-config";

/** Result presentation does not require solver counters, certificates or baseline loadouts. */
export type ResultView = Omit<
  OptimizationResult,
  "searchedCandidates" | "maximumTenacity"
>;
export type JointResultView = Pick<
  JointOptimizationResult,
  "commonGear" | "commonFood" | "objective"
> & {
  jobResults: Partial<Record<JobId, ResultView>>;
  optima: Partial<Record<JobId, Pick<OptimizationResult, "score">>>;
  value: Pick<JointOptimizationResult["value"], "approximate">;
  statistics: { elapsedMs: number };
};

export interface SingleWorkbenchResult {
  mode: "single";
  config: UiOptimizationConfig;
  result: ResultView;
  dataVersion: string;
}
export interface JointWorkbenchResult {
  mode: "joint";
  config: UiJointOptimizationConfig;
  result: JointResultView;
  dataVersion: string;
}
export type WorkbenchResult = SingleWorkbenchResult | JointWorkbenchResult;
