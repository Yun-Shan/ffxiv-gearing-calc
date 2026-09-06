// Worker 进程入口：调用同一份领域代码跑优化器，避免主线程被长时间搜索阻塞。
import { optimize } from "./optimizer";
import type { OptimizationConfig, OptimizationResult } from "./types";

export interface WorkerRequest {
  id: number;
  config: OptimizationConfig;
}

export interface WorkerResponse {
  id: number;
  result: OptimizationResult | undefined;
  durationMs: number;
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  if (!data || typeof data.id !== "number") return;
  const started = performance.now();
  let result: OptimizationResult | undefined;
  try {
    result = optimize(data.config);
  } catch (error) {
    result = undefined;
    console.error("worker-optimize-error", error);
  }
  const response: WorkerResponse = {
    id: data.id,
    result,
    durationMs: performance.now() - started,
  };
  (self as unknown as Worker).postMessage(response);
});
