import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("单职业搜索 worker 缺少 parentPort");

try {
  if (!(workerData.dataBinary instanceof Uint8Array)) {
    throw new Error("单职业搜索 worker 缺少 generated-data.bin 字节");
  }
  globalThis.__FFXIV_GENERATED_DATA_BINARY__ = workerData.dataBinary;
  const { runOptimizationLocally } = await import("../../../src/domain/optimizer.ts");
  const solverStatuses = [];
  const result = await runOptimizationLocally(workerData.config, {
    onProgress: (message) => {
      const match = /^HiGHS (\S+) 状态=([^；]+)/.exec(message);
      if (match) solverStatuses.push({ phase: match[1], status: match[2] });
      parentPort.postMessage({ type: "progress", message });
    },
    onCandidateCounts: (counts) => parentPort.postMessage({ type: "candidateCounts", counts }),
    ...(process.env.FFXIV_PROFILE_TIMING === "1" ? {
      onSolverProgress: (progress) => {
        if (progress.kind === "log") parentPort.postMessage({ type: "solverProgress", progress });
      },
    } : {}),
  });
  parentPort.postMessage({ type: "result", result, solverStatuses });
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
