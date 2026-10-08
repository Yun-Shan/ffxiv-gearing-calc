import { findFeasibleGcdsLocally, runJointOptimizationLocally, runOptimizationLocally } from "./optimizer";
import GcdOptimizerWorker from "./gcd-optimizer.worker.ts?worker";
import OptimizerWorker from "./optimizer.worker.ts?worker";
import type { JointOptimizationConfig, JointOptimizationResult, OptimizationConfig, OptimizationResult, SearchCandidateCounts, SearchOptions } from "./types";
import type { HighsCallbackTrace, LinearMipProgress } from "./search/linear-mip.ts";

export type SearchRequest =
  | { kind: "single"; config: OptimizationConfig; traceSolverCallbacks?: boolean; includeCandidateCounts?: boolean; includeSolverProgress?: boolean }
  | { kind: "joint"; config: JointOptimizationConfig; traceSolverCallbacks?: boolean; includeCandidateCounts?: boolean; includeSolverProgress?: boolean }
  | { kind: "gcds"; config: OptimizationConfig; traceSolverCallbacks?: boolean; includeCandidateCounts?: boolean; includeSolverProgress?: boolean };
export type SearchValue = OptimizationResult | JointOptimizationResult | number[] | undefined;
export type SearchResponse =
  | { kind: "ready" }
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
  const frontendRequest = withoutFrontendSearchLimit(request);
  if (typeof Worker === "undefined") {
    if (frontendRequest.kind === "single") return runOptimizationLocally(frontendRequest.config, options);
    if (frontendRequest.kind === "joint") return runJointOptimizationLocally(frontendRequest.config, options);
    return findFeasibleGcdsLocally(frontendRequest.config, options);
  }
  const worker = frontendRequest.kind === "gcds"
    ? new GcdOptimizerWorker()
    : new OptimizerWorker();
  return new Promise((resolve, reject) => {
    let settled = false;
    let requestSent = false;
    const finish = (error?: Error, value?: SearchValue) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish(cancellationError());
    options.signal?.addEventListener("abort", cancel, { once: true });
    const workerRequest = {
      ...frontendRequest,
      ...(options.onSolverCallback === undefined ? {} : { traceSolverCallbacks: true }),
      ...(options.onCandidateCounts === undefined ? {} : { includeCandidateCounts: true }),
      ...(options.onSolverProgress === undefined ? {} : { includeSolverProgress: true }),
    };
    const sendRequest = () => {
      if (settled || requestSent) return;
      requestSent = true;
      try { worker.postMessage(workerRequest); } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    worker.addEventListener("message", (event: MessageEvent<SearchResponse>) => {
      const response = event.data;
      if (response.kind === "ready") sendRequest();
      else if (response.kind === "progress") options.onProgress?.(response.message);
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
    if (options.signal?.aborted) cancel();
  });
}

function withoutFrontendSearchLimit(request: SearchRequest): SearchRequest {
  if (request.kind === "joint") {
    return {
      ...request,
      config: {
        ...request.config,
        maxSearchMs: undefined,
        jobs: request.config.jobs.map((job) => ({ ...job, maxSearchMs: undefined })),
      },
    };
  }
  return { ...request, config: { ...request.config, maxSearchMs: undefined } };
}

function cancellationError(): Error {
  const error = new Error("搜索已取消");
  error.name = "AbortError";
  return error;
}
