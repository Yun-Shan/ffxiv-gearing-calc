import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("V3 worker 缺少 parentPort");

globalThis.__FFXIV_GENERATED_DATA_BINARY__ = new Uint8Array(workerData.dataBinary);
const { runJointOptimizationLocally } = await import("../../src/domain/optimizer.ts");

try {
  const result = await runJointOptimizationLocally(workerData.config, {
    onProgress: (message) => parentPort.postMessage({ type: "progress", message }),
  });
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  parentPort.postMessage({
    type: "error",
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    },
  });
}

parentPort.close();
