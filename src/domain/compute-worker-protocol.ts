import type {
  JointOptimizationConfig,
  JointOptimizationResult,
  OptimizationConfig,
  OptimizationResult,
  SearchCandidateCounts,
} from "./types.ts";
import type {
  HighsCallbackTrace,
  LinearMipProgress,
} from "./search/linear-mip.ts";
import type {
  BaselineWorkerMessage,
  BaselineWorkerRequest,
} from "./search/parallel-baseline-executor.ts";

export type SearchRequest =
  | {
      kind: "single";
      config: OptimizationConfig;
      traceSolverCallbacks?: boolean;
      includeCandidateCounts?: boolean;
      includeSolverProgress?: boolean;
    }
  | {
      kind: "joint";
      config: JointOptimizationConfig;
      traceSolverCallbacks?: boolean;
      includeCandidateCounts?: boolean;
      includeSolverProgress?: boolean;
    }
  | {
      kind: "gcds";
      config: OptimizationConfig;
      traceSolverCallbacks?: boolean;
      includeCandidateCounts?: boolean;
      includeSolverProgress?: boolean;
    };
export type SearchValue =
  OptimizationResult | JointOptimizationResult | number[] | undefined;
export type SearchResponse =
  | { kind: "ready" }
  | { kind: "progress"; message: string }
  | { kind: "candidateCounts"; counts: SearchCandidateCounts }
  | { kind: "solverProgress"; progress: LinearMipProgress }
  | { kind: "solverCallback"; trace: HighsCallbackTrace }
  | { kind: "result"; value: SearchValue }
  | { kind: "error"; message: string; name: string };

export type ComputeWorkerRequest =
  SearchRequest | ({ kind: "baseline" } & BaselineWorkerRequest);
export type ComputeWorkerResponse =
  SearchResponse | { kind: "baseline"; message: BaselineWorkerMessage };
