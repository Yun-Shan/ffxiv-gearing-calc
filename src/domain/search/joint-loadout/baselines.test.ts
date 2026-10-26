import { expect, test, vi } from "vitest";
import { solveBaselines } from "./baselines.ts";
import type { JobContext, JointLoadoutV3Options } from "./types.ts";
import { contextFor, optionsFor, statistics } from "./fixtures.helper.test.ts";

function baselineFor(
  context: JobContext,
  overrides: Partial<JointLoadoutV3Options> = {},
  remainingTimeLimit = () => undefined as number | undefined,
) {
  const mutable = statistics();
  return {
    mutable,
    solve: () =>
      solveBaselines({
        options: { ...optionsFor([context]), ...overrides },
        contexts: [context],
        preserveCommonSlotIndexes: new Map([[context, new Set<number>()]]),
        objective: "damage",
        mutable,
        assertWithinBudget: () => {},
        remainingTimeLimit,
        remainingWorkerTimeLimit: () => 1000,
        timeLimitMs: 1000,
        cancellationRequested: () => false,
        baselineConcurrency: 2,
      }),
  };
}

test.each([undefined, [undefined]])(
  "baseline infeasibility propagates without a completed optimum: %j",
  async (results) => {
    const context = contextFor();
    const baseline = baselineFor(context, {
      baselineExecutor: async () => results,
    });
    expect(await baseline.solve()).toBe(false);
    expect(baseline.mutable.innerSolves).toBe(1);
  },
);

test("baseline worker must return one result per job", async () => {
  const context = contextFor();
  await expect(
    baselineFor(context, { baselineExecutor: async () => [] }).solve(),
  ).rejects.toThrow(/职业数量不匹配/);
});

test("baseline worker receives a finite shared deadline and prefixed progress callbacks", async () => {
  const context = contextFor();
  const progress = vi.fn();
  const solverProgress = vi.fn();
  const solverCallback = vi.fn();
  context.job.options.onSolverProgress = solverProgress;
  const executor: NonNullable<
    JointLoadoutV3Options["baselineExecutor"]
  > = async (tasks, lifecycle) => {
    expect(tasks[0]!.maxSearchMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(lifecycle.maxConcurrency).toBe(1);
    expect(lifecycle.remainingMs()).toBe(1000);
    expect(lifecycle.isCancelled()).toBe(false);
    tasks[0]!.onProgress?.("solver");
    tasks[0]!.onSolverProgress?.({ model: "baseline" } as Parameters<
      NonNullable<(typeof tasks)[0]["onSolverProgress"]>
    >[0]);
    tasks[0]!.onSolverCallback?.({ model: "baseline" } as Parameters<
      NonNullable<(typeof tasks)[0]["onSolverCallback"]>
    >[0]);
    return [context.optimum];
  };
  expect(
    await baselineFor(context, {
      baselineExecutor: executor,
      onProgress: progress,
      onSolverCallback: solverCallback,
    }).solve(),
  ).toBe(true);
  expect(progress).toHaveBeenCalledWith("SAM: solver");
  expect(solverProgress).toHaveBeenCalledWith({ model: "SAM:baseline" });
  expect(solverCallback).toHaveBeenCalledWith({ model: "SAM:baseline" });
});

test.each(["before", "after"])(
  "baseline timeout %s candidate pruning never runs the executor",
  async (stage) => {
    const context = contextFor();
    let reads = 0;
    const executor = vi.fn(async () => [context.optimum]);
    const baseline = baselineFor(context, { baselineExecutor: executor }, () =>
      stage === "before" || reads++ > 0 ? 0 : 100,
    );
    await expect(baseline.solve()).rejects.toThrow(/未完成最优性证明/);
    expect(executor).not.toHaveBeenCalled();
  },
);

test("a baseline with invalid GCD is rejected before ratio normalization", async () => {
  const context = contextFor();
  const factors = context.factorEvaluator([100, 3000, 400, 300, 200, 100, 0])!;
  context.factorEvaluator = () => ({ ...factors, gcdCentiseconds: 0 });
  await expect(
    baselineFor(context, {
      baselineExecutor: async () => [context.optimum],
    }).solve(),
  ).rejects.toThrow(/伤害基线无效/);
});
