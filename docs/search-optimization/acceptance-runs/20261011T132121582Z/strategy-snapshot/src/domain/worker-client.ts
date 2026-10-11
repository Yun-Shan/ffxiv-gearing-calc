import { findFeasibleGcdsLocally, runJointOptimizationLocally, runOptimizationLocally } from "./optimizer";
import type { JointOptimizationConfig, JointOptimizationResult, OptimizationConfig, OptimizationResult, SearchCandidateCounts, SearchOptions } from "./types";
import type { HighsCallbackTrace, LinearMipProgress } from "./search/linear-mip.ts";

export type SearchRequest =
  | { kind: "single"; config: OptimizationConfig; traceSolverCallbacks?: boolean; includeCandidateCounts?: boolean; includeSolverProgress?: boolean }
  | { kind: "joint"; config: JointOptimizationConfig; traceSolverCallbacks?: boolean; includeCandidateCounts?: boolean; includeSolverProgress?: boolean }
  | { kind: "gcds"; config: OptimizationConfig; traceSolverCallbacks?: boolean; includeCandidateCounts?: boolean; includeSolverProgress?: boolean };
export type SearchValue = OptimizationResult | JointOptimizationResult | number[] | undefined;
export type SearchResponse =
  | { kind: "progress"; message: string }
  | { kind: "candidateCounts"; counts: SearchCandidateCounts }
  | { kind: "solverProgress"; progress: LinearMipProgress }
  | { kind: "solverCallback"; trace: HighsCallbackTrace }
  | { kind: "result"; value: SearchValue }
  | { kind: "error"; message: string; name: string };

export function optimizeInWorker(request: { kind: "single"; config: OptimizationConfig }, options?: SearchOptions): Promise<OptimizationResult | undefined>;
export function optimizeInWorker(request: { kind: "joint"; config: JointOptimizationConfig }, options?: SearchOptions): Promise<JointOptimizationResult | undefined>;
export function optimizeInWorker(request: { kind: "gcds"; config: OptimizationConfig }, options?: SearchOptions): Promise<number[]>;
export async function optimizeInWorker(request: SearchRequest, options: SearchOptions = {}): Promise<SearchValue> {
  if (options.signal?.aborted) throw cancellationError();
  if (typeof Worker === "undefined") {
    if (request.kind === "single") return runOptimizationLocally(request.config, options);
    if (request.kind === "joint") return runJointOptimizationLocally(request.config, options);
    return findFeasibleGcdsLocally(request.config, options);
  }
  const worker = new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
  const budget = Math.min(request.config.maxSearchMs ?? (request.kind === "joint" ? 235_000 : 115_000), request.kind === "joint" ? 235_000 : 115_000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: SearchValue) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish(cancellationError());
    // Worker termination interrupts synchronous WASM solving too.
    const timer = setTimeout(() => finish(new Error("搜索超过总时限，未返回未完成结果")), budget + 5_000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    worker.addEventListener("message", (event: MessageEvent<SearchResponse>) => {
      const response = event.data;
      if (response.kind === "progress") options.onProgress?.(response.message);
      else if (response.kind === "candidateCounts") options.onCandidateCounts?.(response.counts);
      else if (response.kind === "solverProgress") options.onSolverProgress?.(response.progress);
      else if (response.kind === "solverCallback") options.onSolverCallback?.(response.trace);
      else if (response.kind === "error") {
        const error = new Error(response.message);
        error.name = response.name;
        finish(error);
      } else finish(undefined, response.value);
    });
    worker.addEventListener("error", (event) => finish(new Error(event.message || "搜索工作线程失败")));
    worker.addEventListener("messageerror", () => finish(new Error("搜索结果传输失败")));
    const workerRequest = {
      ...request,
      ...(options.onSolverCallback === undefined ? {} : { traceSolverCallbacks: true }),
      ...(options.onCandidateCounts === undefined ? {} : { includeCandidateCounts: true }),
      ...(options.onSolverProgress === undefined ? {} : { includeSolverProgress: true }),
    };
    try { worker.postMessage(workerRequest); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    if (options.signal?.aborted) cancel();
  });
}

function cancellationError(): Error {
  const error = new Error("搜索已取消");
  error.name = "AbortError";
  return error;
}
