import { findFeasibleGcdsLocally } from "./optimizer/gcd-search.ts";
import { runJointOptimizationLocally } from "./optimizer/joint-search.ts";
import { runOptimizationLocally } from "./optimizer/single-search.ts";
import { solveSerializedBaseline } from "./search/parallel-baseline-solver.ts";
import type {
  ComputeWorkerRequest,
  ComputeWorkerResponse,
  SearchRequest,
  SearchValue,
} from "./compute-worker-protocol.ts";
import type {
  BaselineWorkerMessage,
  BaselineWorkerRequest,
} from "./search/parallel-baseline-executor.ts";
import type { SearchOptions } from "./types.ts";

const workerScope = self as unknown as {
  postMessage(response: ComputeWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ComputeWorkerRequest>) => void,
  ): void;
};

async function search(request: SearchRequest): Promise<void> {
  const options: SearchOptions = {
    onProgress: (message) =>
      workerScope.postMessage({ kind: "progress", message }),
    ...(request.includeCandidateCounts
      ? {
          onCandidateCounts: (counts) =>
            workerScope.postMessage({ kind: "candidateCounts", counts }),
        }
      : {}),
    ...(request.includeSolverProgress
      ? {
          onSolverProgress: (progress) =>
            workerScope.postMessage({ kind: "solverProgress", progress }),
        }
      : {}),
    ...(request.traceSolverCallbacks
      ? {
          onSolverCallback: (trace) =>
            workerScope.postMessage({ kind: "solverCallback", trace }),
        }
      : {}),
  };
  try {
    let value: SearchValue;
    if (request.kind === "single")
      value = await runOptimizationLocally(request.config, options);
    else if (request.kind === "joint")
      value = await runJointOptimizationLocally(request.config, options);
    else value = findFeasibleGcdsLocally(request.config, options);
    workerScope.postMessage({ kind: "result", value });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    workerScope.postMessage({
      kind: "error",
      message: error.message,
      name: error.name,
    });
  }
}

async function baseline({
  options,
  callbacks,
}: BaselineWorkerRequest): Promise<void> {
  const post = (message: BaselineWorkerMessage) =>
    workerScope.postMessage({ kind: "baseline", message });
  try {
    const result = await solveSerializedBaseline(options, {
      ...(callbacks.progress
        ? { onProgress: (message) => post({ type: "progress", message }) }
        : {}),
      ...(callbacks.solverProgress
        ? {
            onSolverProgress: (progress) =>
              post({ type: "solverProgress", progress }),
          }
        : {}),
      ...(callbacks.solverCallback
        ? {
            onSolverCallback: (trace) =>
              post({ type: "solverCallback", trace }),
          }
        : {}),
    });
    post({ type: "result", result });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    post({
      type: "error",
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack === undefined ? {} : { stack: error.stack }),
      },
    });
  }
}

workerScope.addEventListener("message", (event) =>
  event.data.kind === "baseline" ? baseline(event.data) : search(event.data),
);
// Static domain imports finish strict data validation before accepting any task.
workerScope.postMessage({ kind: "ready" });
