import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import type { BaselineWorkerMessage, BaselineWorkerRequest } from "./parallel-baseline-executor.ts";

const workerPort = parentPort;
if (!workerPort) throw new Error("基线工作线程缺少 parentPort");

(globalThis as typeof globalThis & { __FFXIV_GENERATED_DATA_BINARY__?: Uint8Array })
  .__FFXIV_GENERATED_DATA_BINARY__ = new Uint8Array(
    await readFile(new URL("../../data/generated-data.bin", import.meta.url)),
  );
const { solveSerializedBaseline } = await import("./parallel-baseline-solver.ts");

workerPort.on("message", async (request: BaselineWorkerRequest) => {
  const { options, callbacks: requestedCallbacks } = request;
  try {
    const result = await solveSerializedBaseline(options, {
      ...(requestedCallbacks.progress ? {
        onProgress: (message) => workerPort.postMessage({ type: "progress", message }),
      } : {}),
      ...(requestedCallbacks.solverProgress ? {
        onSolverProgress: (progress) => workerPort.postMessage({ type: "solverProgress", progress }),
      } : {}),
      ...(requestedCallbacks.solverCallback ? {
        onSolverCallback: (trace) => workerPort.postMessage({ type: "solverCallback", trace }),
      } : {}),
    });
    workerPort.postMessage({ type: "result", result } satisfies BaselineWorkerMessage);
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    workerPort.postMessage({
      type: "error",
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack === undefined ? {} : { stack: error.stack }),
      },
    } satisfies BaselineWorkerMessage);
  }
});
workerPort.postMessage({ type: "ready" });
