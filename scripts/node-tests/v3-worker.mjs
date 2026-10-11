import { parentPort, workerData } from "node:worker_threads";
import { runJointOptimizationLocally } from "../../src/domain/optimizer.ts";

if (!parentPort) throw new Error("V3 worker 缺少 parentPort");

try {
  const profileTimingEnabled = process.env.FFXIV_PROFILE_TIMING === "1";
  const options = {
    onProgress: (message) => parentPort.postMessage({ type: "progress", message }),
    ...(profileTimingEnabled ? {
      onSolverProgress: (progress) => {
        if (progress.kind === "log") parentPort.postMessage({ type: "solverProgress", progress });
      },
    } : {}),
  };
  const result = await runJointOptimizationLocally(workerData.config, options);
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
