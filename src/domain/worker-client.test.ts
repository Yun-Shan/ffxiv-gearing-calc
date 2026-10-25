import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizeInWorker, type SearchRequest } from "./worker-client";
import type { JointOptimizationConfig, OptimizationConfig } from "./types";
import { createBrowserBaselineWorker } from "./search/parallel-baseline-browser-adapter.ts";
import type { ComputeWorkerRequest } from "./compute-worker-protocol.ts";
import type { BaselineWorkerRequest } from "./search/parallel-baseline-executor.ts";

class ControlledWorker extends EventTarget {
  static instances: ControlledWorker[] = [];
  request?: SearchRequest;
  requests: ComputeWorkerRequest[] = [];
  terminate = vi.fn();

  constructor(readonly url: string, readonly options: WorkerOptions) {
    super();
    ControlledWorker.instances.push(this);
    setTimeout(() => this.emit("message", { kind: "ready" }), 0);
  }

  postMessage(request: ComputeWorkerRequest): void {
    this.requests.push(request);
    if (request.kind !== "baseline") this.request = request;
  }

  respond(): void {
    this.emit("message", { kind: "result", value: undefined });
  }

  emit(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }
}

const singleConfig: OptimizationConfig = {
  clanIndex: 0,
  objective: "damage",
  jobId: "SAM",
  minItemLevel: 1,
  maxItemLevel: 1,
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  foodId: 0,
  maxSearchMs: 1,
};

afterEach(() => {
  ControlledWorker.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("frontend worker search timing", () => {
  it("uses the same script in independent search and baseline instances, waiting for readiness", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", ControlledWorker);
    const search = optimizeInWorker({ kind: "gcds", config: singleConfig });
    const baseline = createBrowserBaselineWorker();
    const request = { options: {}, callbacks: { progress: true, solverProgress: false, solverCallback: false } } as BaselineWorkerRequest;
    baseline.postMessage(request);
    const [searchWorker, baselineWorker] = ControlledWorker.instances;
    expect(searchWorker).not.toBe(baselineWorker);
    expect(searchWorker!.url).toBe(baselineWorker!.url);
    expect(searchWorker!.options).toEqual({ type: "module" });
    expect(searchWorker!.requests).toEqual([]);
    expect(baselineWorker!.requests).toEqual([]);
    const onMessage = vi.fn();
    const detach = baseline.onMessage(onMessage);
    await vi.advanceTimersByTimeAsync(0);
    expect(searchWorker!.requests).toHaveLength(1);
    expect(baselineWorker!.requests).toEqual([{ kind: "baseline", ...request }]);
    expect(onMessage).not.toHaveBeenCalled();
    baselineWorker!.emit("message", { kind: "baseline", message: { type: "progress", message: "working" } });
    expect(onMessage).toHaveBeenCalledWith({ type: "progress", message: "working" });
    baselineWorker!.emit("message", { kind: "baseline", message: { type: "result", result: undefined } });
    baseline.postMessage(request);
    expect(baselineWorker!.requests).toHaveLength(2);
    detach();
    searchWorker!.respond();
    await search;
    expect(searchWorker!.terminate).toHaveBeenCalledOnce();
    expect(baselineWorker!.terminate).not.toHaveBeenCalled();
    baseline.terminate();
    expect(baselineWorker!.terminate).toHaveBeenCalledOnce();
  });

  it.each([false, true])("cancels a worker before/after readiness (%s) without sending late requests", async (ready) => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", ControlledWorker);
    const controller = new AbortController();
    const search = optimizeInWorker({ kind: "single", config: singleConfig }, { signal: controller.signal });
    const rejected = expect(search).rejects.toMatchObject({ name: "AbortError" });
    if (ready) await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(0);
    const worker = ControlledWorker.instances[0]!;
    expect(worker.requests).toHaveLength(ready ? 1 : 0);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects search failures and terminates the affected instance", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", ControlledWorker);
    const search = optimizeInWorker({ kind: "single", config: singleConfig });
    const rejected = expect(search).rejects.toMatchObject({ name: "TypeError", message: "module failed" });
    await vi.advanceTimersByTimeAsync(0);
    const worker = ControlledWorker.instances[0]!;
    worker.emit("message", { kind: "error", name: "TypeError", message: "module failed" });
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("ignores saved time limits and does not terminate searches on a timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", ControlledWorker);

    const requests: (
      | { kind: "single"; config: OptimizationConfig }
      | { kind: "joint"; config: JointOptimizationConfig }
      | { kind: "gcds"; config: OptimizationConfig }
    )[] = [
      { kind: "single", config: singleConfig },
      { kind: "gcds", config: singleConfig },
      {
        kind: "joint",
        config: {
          objective: "damage",
          jobs: [{ ...singleConfig, maxSearchMs: 1 }],
          commonSlots: [],
          foodStrategy: "shared",
          maxSearchMs: 1,
        },
      },
    ];

    for (const request of requests) {
      let settled = false;
      const search = request.kind === "single"
        ? optimizeInWorker({ kind: "single", config: request.config })
        : request.kind === "joint"
          ? optimizeInWorker({ kind: "joint", config: request.config })
          : optimizeInWorker({ kind: "gcds", config: request.config });
      const pending = search.finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      const worker = ControlledWorker.instances.at(-1)!;
      expect(worker.request).toBeDefined();
      if (worker.request?.kind === "single" || worker.request?.kind === "gcds") {
        expect(worker.request.config.maxSearchMs).toBeUndefined();
      } else if (worker.request?.kind === "joint") {
        expect(worker.request.config.maxSearchMs).toBeUndefined();
        expect(worker.request.config.jobs[0]?.maxSearchMs).toBeUndefined();
      }

      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(false);
      worker.respond();
      await pending;
      expect(settled).toBe(true);
    }
  });
});
