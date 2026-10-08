import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizeInWorker, type SearchRequest } from "./worker-client";
import type { JointOptimizationConfig, OptimizationConfig } from "./types";

class ControlledWorker extends EventTarget {
  static instances: ControlledWorker[] = [];
  request?: SearchRequest;

  constructor() {
    super();
    ControlledWorker.instances.push(this);
    setTimeout(() => this.emit("message", { kind: "ready" }), 0);
  }

  postMessage(request: SearchRequest): void {
    this.request = request;
  }

  terminate(): void {}

  respond(): void {
    this.emit("message", { kind: "result", value: undefined });
  }

  private emit(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }
}

const singleConfig: OptimizationConfig = {
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
