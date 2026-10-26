import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  BaselineWorkerHandle,
  BaselineWorkerMessage,
  BaselineWorkerRequest,
  SerializedBaselineResult,
} from "./parallel-baseline-executor.ts";
import { contextFor, equip } from "./joint-loadout/fixtures.helper.test.ts";

const adapters = vi.hoisted(() => ({ node: vi.fn(), browser: vi.fn() }));
vi.mock("../node/parallel-baseline-node-adapter.ts", () => ({
  createNodeBaselineWorker: adapters.node,
}));
vi.mock("./parallel-baseline-browser-adapter.ts", () => ({
  createBrowserBaselineWorker: adapters.browser,
}));
import { createParallelBaselineExecutor } from "./parallel-baseline-executor.ts";

function workerFor(
  respond: (
    emit: (message: BaselineWorkerMessage) => void,
    request: BaselineWorkerRequest,
  ) => void,
  terminate = vi.fn(),
): BaselineWorkerHandle {
  const listeners = new Set<(message: BaselineWorkerMessage) => void>();
  return {
    postMessage: (request) =>
      respond(
        (message) => [...listeners].forEach((listener) => listener(message)),
        request,
      ),
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onError: () => () => {},
    terminate,
  };
}

const control = { remainingMs: () => 1000, isCancelled: () => false };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("parallel executor transport boundaries", () => {
  test("an empty batch allocates no worker, and a disposed executor cannot launch work", async () => {
    const executor = (await createParallelBaselineExecutor())!;
    expect(await executor([], control)).toEqual([]);
    expect(adapters.node).not.toHaveBeenCalled();
    await executor.dispose!();
    await executor.dispose!();
    await expect(executor([contextFor().job.options], control)).rejects.toThrow(
      /已关闭/,
    );
  });

  test.each(["cancelled", "expired"])(
    "an initially %s batch never allocates workers",
    async (kind) => {
      const executor = (await createParallelBaselineExecutor())!;
      await expect(
        executor([contextFor().job.options], {
          remainingMs: () => (kind === "expired" ? 0 : 1000),
          isCancelled: () => kind === "cancelled",
        }),
      ).rejects.toThrow(kind === "cancelled" ? /已取消/ : /未完成最优性证明/);
      expect(adapters.node).not.toHaveBeenCalled();
    },
  );

  test.each(["create", "post", "callback", "progress"])(
    "%s failures reject with normalized errors and terminate workers",
    async (stage) => {
      const terminate = vi.fn();
      adapters.node.mockImplementation(() => {
        if (stage === "create") throw "worker factory failure";
        return workerFor((emit) => {
          if (stage === "post") throw "postMessage failure";
          if (stage === "progress")
            emit({ type: "progress", message: "hello" });
          else emit({ type: "result", result: undefined });
        }, terminate);
      });
      const context = contextFor();
      context.job.options.onProgress = () => {
        throw "progress callback failure";
      };
      const executor = (await createParallelBaselineExecutor())!;
      await expect(
        executor([context.job.options], {
          ...control,
          onTaskComplete: () => {
            throw "completion callback failure";
          },
        }),
      ).rejects.toThrow(/failure/);
      expect(terminate).toHaveBeenCalledTimes(stage === "create" ? 0 : 1);
    },
  );

  test("worker diagnostics retain error names and stacks even if termination rejects", async () => {
    const terminate = vi.fn(async () => {
      throw new Error("termination failed");
    });
    adapters.node.mockImplementation(() =>
      workerFor(
        (emit) =>
          emit({
            type: "error",
            error: {
              name: "SolverError",
              message: "incomplete proof",
              stack: "remote solver stack",
            },
          }),
        terminate,
      ),
    );
    const executor = (await createParallelBaselineExecutor())!;
    await expect(
      executor([contextFor().job.options], control),
    ).rejects.toMatchObject({
      name: "SolverError",
      message: "incomplete proof",
      stack: "remote solver stack",
    });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  test.each([
    { selectionIndexes: [], foodIndex: undefined, expected: /数量不匹配/ },
    { selectionIndexes: [-1], foodIndex: undefined, expected: /无效装备索引/ },
    { selectionIndexes: [0.5], foodIndex: undefined, expected: /无效装备索引/ },
    { selectionIndexes: [9], foodIndex: undefined, expected: /无效装备索引/ },
    { selectionIndexes: [0], foodIndex: -1, expected: /无效食物索引/ },
    { selectionIndexes: [0], foodIndex: 0.5, expected: /无效食物索引/ },
    { selectionIndexes: [0], foodIndex: 9, expected: /无效食物索引/ },
  ])(
    "rejects malformed result indices: %j",
    async ({ selectionIndexes, foodIndex, expected }) => {
      const context = contextFor();
      const result: SerializedBaselineResult = {
        ...context.optimum,
        selectionIndexes,
        foodIndex,
      };
      adapters.node.mockImplementation(() =>
        workerFor((emit) => emit({ type: "result", result })),
      );
      const executor = (await createParallelBaselineExecutor())!;
      await expect(executor([context.job.options], control)).rejects.toThrow(
        expected,
      );
    },
  );

  test("transport preserves optional solver policies, unknown ring metadata and callback routing", async () => {
    const context = contextFor([
      [
        equip(1, undefined, {
          ringSlotIndex: "bad" as never,
          isUnique: "bad" as never,
        }),
      ],
    ]);
    const progress = vi.fn();
    const solverProgress = vi.fn();
    const solverCallback = vi.fn();
    context.job.options = {
      ...context.job.options,
      constraints: { speedMin: 0 },
      toughnessAttributeId: 7,
      candidateResourceSupportProfile: "compact",
      resourceBudgetCandidateProfile: "default",
      objective: "dps",
      onProgress: progress,
      onSolverProgress: solverProgress,
      onSolverCallback: solverCallback,
    };
    adapters.node.mockImplementation(() =>
      workerFor((emit, request) => {
        expect(request.options).toMatchObject({
          constraints: { speedMin: 0 },
          toughnessAttributeId: 7,
          objective: "dps",
          candidateResourceSupportProfile: "compact",
          resourceBudgetCandidateProfile: "default",
        });
        expect([...request.options.slots.ringSlotKinds]).toEqual([2]);
        expect([...request.options.slots.uniqueKinds]).toEqual([3]);
        expect(request.callbacks).toEqual({
          progress: true,
          solverProgress: true,
          solverCallback: true,
        });
        emit({ type: "progress", message: "started" });
        emit({
          type: "solverProgress",
          progress: { model: "baseline" } as never,
        });
        emit({ type: "solverCallback", trace: { model: "baseline" } as never });
        emit({
          type: "result",
          result: {
            ...context.optimum,
            selectionIndexes: [0],
            foodIndex: undefined,
          },
        });
      }),
    );
    const executor = (await createParallelBaselineExecutor())!;
    const results = await executor([context.job.options], {
      ...control,
      maxConcurrency: Number.NaN,
    });
    expect(results![0]!.selection[0]).toBe(context.job.options.slots[0]![0]);
    expect(progress).toHaveBeenCalledWith("started");
    expect(solverProgress).toHaveBeenCalledWith({ model: "baseline" });
    expect(solverCallback).toHaveBeenCalledWith({ model: "baseline" });
    await executor.dispose!();
  });

  test("browser runtime uses the browser adapter, and an unavailable runtime returns no executor", async () => {
    adapters.browser.mockImplementation(() =>
      workerFor((emit) => emit({ type: "result", result: undefined })),
    );
    vi.stubGlobal("process", { versions: {} });
    vi.stubGlobal("Worker", class {});
    const pending = createParallelBaselineExecutor();
    vi.unstubAllGlobals();
    const executor = (await pending)!;
    expect(await executor([contextFor().job.options], control)).toEqual([
      undefined,
    ]);
    expect(adapters.browser).toHaveBeenCalledTimes(1);
    await executor.dispose!();
    vi.stubGlobal("process", { versions: {} });
    vi.stubGlobal("Worker", undefined);
    const unavailable = createParallelBaselineExecutor();
    vi.unstubAllGlobals();
    expect(await unavailable).toBeUndefined();
  });
});
