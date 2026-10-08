import { findFeasibleGcdsLocally, runJointOptimizationLocally, runOptimizationLocally } from "./optimizer";
import type { SearchRequest, SearchResponse, SearchValue } from "./worker-client";
import type { HighsCallbackTrace, LinearMipProgress } from "./search/linear-mip.ts";
import type { SearchCandidateCounts } from "./types.ts";

const workerScope = self as unknown as { postMessage(response: SearchResponse): void; addEventListener(type: "message", listener: (event: MessageEvent<SearchRequest>) => void): void };
workerScope.addEventListener("message", async (event) => {
  const request = event.data;
  const options = {
    onProgress: (message: string) => workerScope.postMessage({ kind: "progress", message }),
    ...(request.includeCandidateCounts ? {
      onCandidateCounts: (counts: SearchCandidateCounts) => workerScope.postMessage({ kind: "candidateCounts", counts }),
    } : {}),
    ...(request.includeSolverProgress ? {
      onSolverProgress: (progress: LinearMipProgress) => workerScope.postMessage({ kind: "solverProgress", progress }),
    } : {}),
    ...(request.traceSolverCallbacks ? {
      onSolverCallback: (trace: HighsCallbackTrace) => workerScope.postMessage({ kind: "solverCallback", trace }),
    } : {}),
  };
  try {
    let value: SearchValue;
    if (request.kind === "single") value = await runOptimizationLocally(request.config, options);
    else if (request.kind === "joint") value = await runJointOptimizationLocally(request.config, options);
    else value = findFeasibleGcdsLocally(request.config, options);
    workerScope.postMessage({ kind: "result", value });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    workerScope.postMessage({ kind: "error", message: error.message, name: error.name });
  }
});

workerScope.postMessage({ kind: "ready" });
