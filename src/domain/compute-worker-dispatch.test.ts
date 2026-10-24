import { afterEach, expect, it, vi } from "vitest";
import type {
  ComputeWorkerRequest,
  ComputeWorkerResponse,
} from "./compute-worker-protocol.ts";
import type { BaselineWorkerRequest } from "./search/parallel-baseline-executor.ts";
import type { OptimizationConfig } from "./types.ts";

const handlers = vi.hoisted(() => ({
  single: vi.fn(),
  joint: vi.fn(),
  gcds: vi.fn(),
  baseline: vi.fn(),
}));
vi.mock("./optimizer/single-search.ts", () => ({
  runOptimizationLocally: handlers.single,
}));
vi.mock("./optimizer/joint-search.ts", () => ({
  runJointOptimizationLocally: handlers.joint,
}));
vi.mock("./optimizer/gcd-search.ts", () => ({
  findFeasibleGcdsLocally: handlers.gcds,
}));
vi.mock("./search/parallel-baseline-solver.ts", () => ({
  solveSerializedBaseline: handlers.baseline,
}));

async function start() {
  const responses: ComputeWorkerResponse[] = [];
  let listener: (event: MessageEvent<ComputeWorkerRequest>) => Promise<void>;
  vi.stubGlobal("self", {
    postMessage: (response: ComputeWorkerResponse) => responses.push(response),
    addEventListener: (_type: string, callback: typeof listener) => {
      listener = callback;
    },
  });
  await import("./compute.worker.ts");
  expect(responses).toEqual([{ kind: "ready" }]);
  return {
    responses,
    send: (request: ComputeWorkerRequest) =>
      listener({ data: request } as MessageEvent<ComputeWorkerRequest>),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.resetAllMocks();
});

it.each(["single", "joint", "gcds"] as const)(
  "dispatches %s and forwards requested progress",
  async (kind) => {
    const result = kind === "gcds" ? [2.5] : { score: 123 };
    handlers[kind].mockImplementation((_config, options) => {
      options.onProgress("calculating");
      options.onCandidateCounts({ foods: 1 });
      options.onSolverProgress({ model: "search" });
      options.onSolverCallback({ model: "trace" });
      return result;
    });
    const worker = await start();
    const request = {
      kind,
      config: { jobId: "RDM" },
      includeCandidateCounts: true,
      includeSolverProgress: true,
      traceSolverCallbacks: true,
    } as ComputeWorkerRequest;
    await worker.send(request);
    expect(worker.responses).toEqual([
      { kind: "ready" },
      { kind: "progress", message: "calculating" },
      { kind: "candidateCounts", counts: { foods: 1 } },
      { kind: "solverProgress", progress: { model: "search" } },
      { kind: "solverCallback", trace: { model: "trace" } },
      { kind: "result", value: result },
    ]);
    expect(handlers[kind]).toHaveBeenCalledOnce();
    for (const other of Object.keys(handlers).filter((key) => key !== kind)) {
      expect(handlers[other as keyof typeof handlers]).not.toHaveBeenCalled();
    }
  },
);

it("handles sequential baseline tasks with isolated progress/results and preserved error details", async () => {
  const failure = new TypeError("baseline failed");
  handlers.baseline
    .mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onProgress("baseline progress");
      callbacks.onSolverProgress({ model: "baseline" });
      callbacks.onSolverCallback({ model: "baseline trace" });
      return { selectionIndexes: [0], foodIndex: 0 };
    })
    .mockRejectedValueOnce(failure);
  const worker = await start();
  const request = {
    kind: "baseline",
    options: {},
    callbacks: { progress: true, solverProgress: true, solverCallback: true },
  } as { kind: "baseline" } & BaselineWorkerRequest;
  await worker.send(request);
  await worker.send(request);
  expect(worker.responses.slice(1)).toEqual([
    {
      kind: "baseline",
      message: { type: "progress", message: "baseline progress" },
    },
    {
      kind: "baseline",
      message: { type: "solverProgress", progress: { model: "baseline" } },
    },
    {
      kind: "baseline",
      message: { type: "solverCallback", trace: { model: "baseline trace" } },
    },
    {
      kind: "baseline",
      message: {
        type: "result",
        result: { selectionIndexes: [0], foodIndex: 0 },
      },
    },
    {
      kind: "baseline",
      message: {
        type: "error",
        error: {
          name: failure.name,
          message: failure.message,
          stack: failure.stack,
        },
      },
    },
  ]);
});

it("returns a search error without enabling unrequested diagnostic callbacks", async () => {
  handlers.single.mockImplementation((_config, options) => {
    expect(options.onCandidateCounts).toBeUndefined();
    expect(options.onSolverProgress).toBeUndefined();
    expect(options.onSolverCallback).toBeUndefined();
    throw new RangeError("invalid input");
  });
  const worker = await start();
  await worker.send({ kind: "single", config: {} as OptimizationConfig });
  expect(worker.responses.at(-1)).toEqual({
    kind: "error",
    name: "RangeError",
    message: "invalid input",
  });
});
