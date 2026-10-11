import { solveSerializedBaseline } from "./parallel-baseline-solver.ts";
import type { BaselineWorkerMessage, BaselineWorkerRequest } from "./parallel-baseline-executor.ts";

const workerScope = self as unknown as {
  postMessage(message: BaselineWorkerMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<BaselineWorkerRequest>) => void): void;
};

workerScope.addEventListener("message", async (event) => {
  const { options, callbacks: requestedCallbacks } = event.data;
  try {
    const result = await solveSerializedBaseline(options, {
      ...(requestedCallbacks.progress ? {
        onProgress: (message) => workerScope.postMessage({ type: "progress", message }),
      } : {}),
      ...(requestedCallbacks.solverProgress ? {
        onSolverProgress: (progress) => workerScope.postMessage({ type: "solverProgress", progress }),
      } : {}),
      ...(requestedCallbacks.solverCallback ? {
        onSolverCallback: (trace) => workerScope.postMessage({ type: "solverCallback", trace }),
      } : {}),
    });
    workerScope.postMessage({ type: "result", result });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    workerScope.postMessage({
      type: "error",
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack === undefined ? {} : { stack: error.stack }),
      },
    });
  }
});
