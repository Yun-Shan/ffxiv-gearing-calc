import { describe, expect, test, vi } from "vitest";
import { createRestrictedSearch } from "./restricted-search.ts";
import type { JobContext, JointLoadoutV3Options } from "./types.ts";
import {
  choice,
  contextFor,
  equip,
  optionsFor,
  resultFor,
  statistics,
} from "./fixtures.helper.test.ts";

function searchFor(
  contexts: readonly JobContext[],
  overrides: Partial<JointLoadoutV3Options> = {},
  config: {
    cacheLimit?: number;
    cancelled?: () => boolean;
    ceiling?: () => boolean;
    remaining?: () => number | undefined;
  } = {},
) {
  const mutable = statistics();
  const updateBest = vi.fn();
  const search = createRestrictedSearch({
    options: { ...optionsFor(contexts), ...overrides },
    contexts,
    commonSlotProjections: new Map(),
    objective: "damage",
    mutable,
    cacheLimit: config.cacheLimit ?? 2,
    assertWithinBudget: () => {},
    remainingTimeLimit: config.remaining ?? (() => undefined),
    remainingWorkerTimeLimit: () => 1000,
    timeLimitMs: 1000,
    cancellationRequested: config.cancelled ?? (() => false),
    baselineConcurrency: 2,
    exactScore: () => ({ numerator: 1n, denominator: 1n }),
    updateBest,
    isAtProvenCeiling: config.ceiling ?? (() => false),
  });
  return { ...search, mutable, updateBest };
}

describe("restricted solve lifecycle", () => {
  test("serial refinement solves the restricted candidate domain and reuses the proven result", async () => {
    const alternate = equip(2, [100, 2900, 300, 200, 100, 50, 0]);
    const context = contextFor([[equip(1), alternate]]);
    const search = searchFor([context]);
    const fixed = new Map([["body", choice([context], alternate)]]);
    const results = await search.refineSeedJobs(
      undefined,
      fixed,
      undefined,
      [0],
      [context.optimum],
    );
    expect(results[0]!.selection).toEqual([alternate]);
    expect(results[0]!.damage).toBe(resultFor(context, [alternate]).damage);
    expect(search.mutable).toMatchObject({
      innerSolves: 1,
      cacheMisses: 1,
      parentResultReuses: 0,
    });
    expect(
      await search.refineSeedJobs(undefined, fixed, undefined, [0]),
    ).toEqual(results);
    expect(search.mutable.cacheHits).toBe(1);
  });

  test("worker requests honor food changes, compact profiles, callbacks and partial assignment scoring", async () => {
    const first = contextFor();
    const second = contextFor(undefined, undefined, "DRG");
    const selectedFood = {
      itemId: 5,
      itemLevel: 795,
      key: "food",
      physicalKey: "food",
      baseParams: [],
    };
    const progress = vi.fn();
    const solverProgress = vi.fn();
    const solverCallback = vi.fn();
    first.job.options.onSolverProgress = solverProgress;
    first.job.options.onSolverCallback = solverCallback;
    const executor: NonNullable<
      JointLoadoutV3Options["baselineExecutor"]
    > = async (tasks) => {
      expect(tasks[0]!.candidateResourceSupportProfile).toBe("compact");
      expect(tasks[0]!.foods).toEqual([selectedFood]);
      tasks[0]!.onProgress?.("progress");
      tasks[0]!.onSolverProgress?.({ model: "inner" } as Parameters<
        NonNullable<(typeof tasks)[0]["onSolverProgress"]>
      >[0]);
      tasks[0]!.onSolverCallback?.({ model: "inner" } as Parameters<
        NonNullable<(typeof tasks)[0]["onSolverCallback"]>
      >[0]);
      return [resultFor(first, first.optimum.selection, selectedFood)];
    };
    const search = searchFor([first, second], {
      baselineExecutor: executor,
      onProgress: progress,
    });
    const results = await search.refineSeedJobs(
      [undefined, second.optimum],
      new Map(),
      { key: "food", foods: new Map([[first.job.id, selectedFood]]) },
      [0],
      [first.optimum],
    );
    expect(results[0]!.food).toBe(selectedFood);
    expect(results[1]).toBe(second.optimum);
    expect(progress).toHaveBeenCalledWith("SAM: progress");
    expect(solverProgress).toHaveBeenCalledWith({ model: "SAM:inner" });
    expect(solverCallback).toHaveBeenCalledWith({ model: "SAM:inner" });
    expect(search.updateBest).not.toHaveBeenCalled();
  });

  test("reuses a feasible parent only for the same physical food and full equipment identity", async () => {
    const context = contextFor();
    const search = searchFor([context]);
    const fixed = new Map([
      ["body", choice([context], context.optimum.selection[0]!)],
    ]);
    const results = await search.refineSeedJobs(
      undefined,
      fixed,
      undefined,
      [0],
      [context.optimum],
    );
    expect(results).toEqual([context.optimum]);
    expect(search.mutable.parentResultReuses).toBe(1);
    expect(search.mutable.innerSolves).toBe(0);
    expect(
      await search.refineSeedJobs(undefined, fixed, undefined, [0]),
    ).toEqual(results);
    expect(search.mutable.cacheHits).toBe(1);
  });

  test("bounded cache evicts the least recently used entry and zero disables storage", async () => {
    const context = contextFor();
    const search = searchFor([context], {}, { cacheLimit: 2 });
    const request = (key: string) =>
      search.refineSeedJobs(
        undefined,
        new Map(),
        { key, foods: new Map() },
        [0],
      );
    await request("A");
    await request("B");
    await request("A");
    await request("C");
    expect([...search.cache.keys()].map((key) => key.split("|")[1])).toEqual([
      "A",
      "C",
    ]);
    expect(search.mutable.cacheEntries).toBe(2);
    expect(search.mutable.cacheHits).toBe(1);
    const disabled = searchFor([context], {}, { cacheLimit: 0 });
    await disabled.refineSeedJobs(undefined, new Map(), undefined, [0]);
    expect(disabled.cache.size).toBe(0);
    expect(disabled.mutable.cacheEntries).toBe(0);
  });

  test("an infeasible worker result is cached, while a no-callback executor still completes accounting", async () => {
    const alternate = equip(2, [100, 2900]);
    const context = contextFor([[equip(1), alternate]]);
    const executor = vi.fn(async () => [undefined]);
    const search = searchFor([context], { baselineExecutor: executor });
    const fixed = new Map([["body", choice([context], alternate)]]);
    expect(
      await search.refineSeedJobs(undefined, fixed, undefined, [0]),
    ).toEqual([undefined]);
    expect(
      await search.refineSeedJobs(undefined, fixed, undefined, [0]),
    ).toEqual([undefined]);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(search.mutable).toMatchObject({
      innerSolves: 1,
      cacheMisses: 1,
      cacheHits: 1,
      cacheEntries: 1,
    });
    expect(search.updateBest).not.toHaveBeenCalled();
  });

  test.each(["unknown", "duplicate", "incomplete", "undefined"])(
    "rejects a broken worker executor: %s",
    async (kind) => {
      const alternate = equip(2, [100, 2900]);
      const context = contextFor([[equip(1), alternate]]);
      const result = resultFor(context, [alternate]);
      const executor: NonNullable<
        JointLoadoutV3Options["baselineExecutor"]
      > = async (_tasks, lifecycle) => {
        if (kind === "unknown") lifecycle.onTaskComplete?.(99, result);
        if (kind === "duplicate") {
          lifecycle.onTaskComplete?.(0, result);
          lifecycle.onTaskComplete?.(0, result);
        }
        if (kind === "undefined") return undefined;
        return [];
      };
      const search = searchFor([context], { baselineExecutor: executor });
      const fixed = new Map([["body", choice([context], alternate)]]);
      await expect(
        search.refineSeedJobs(undefined, fixed, undefined, [0]),
      ).rejects.toThrow(
        kind === "unknown"
          ? /未知任务索引/
          : kind === "duplicate"
            ? /重复完成/
            : /完整结果集/,
      );
    },
  );

  test("worker completion scores only complete assignments and observes cancellation at the ceiling", async () => {
    const alternate = equip(2, [100, 2900]);
    const context = contextFor([[equip(1), alternate]]);
    const result = resultFor(context, [alternate]);
    let ceiling = false;
    const executor: NonNullable<
      JointLoadoutV3Options["baselineExecutor"]
    > = async (tasks, lifecycle) => {
      expect(tasks[0]!.slots[0]).toEqual([alternate]);
      ceiling = true;
      lifecycle.onTaskComplete?.(0, result);
      return [result];
    };
    const search = searchFor(
      [context],
      { baselineExecutor: executor },
      { ceiling: () => ceiling, cancelled: () => ceiling },
    );
    await expect(
      search.refineSeedJobs(
        undefined,
        new Map([["body", choice([context], alternate)]]),
        undefined,
        [0],
      ),
    ).rejects.toThrow(/取消/);
    expect(search.mutable.innerSolves).toBe(1);
    expect(search.updateBest).toHaveBeenCalledTimes(1);
  });

  test("expired budget fails before starting a worker or returning an approximate recommendation", async () => {
    const alternate = equip(2, [100, 2900]);
    const context = contextFor([[equip(1), alternate]]);
    const executor = vi.fn(async () => []);
    const search = searchFor(
      [context],
      { baselineExecutor: executor },
      { remaining: () => 0 },
    );
    await expect(
      search.refineSeedJobs(
        undefined,
        new Map([["body", choice([context], alternate)]]),
        undefined,
        [0],
      ),
    ).rejects.toThrow(/未完成最优性证明/);
    expect(executor).not.toHaveBeenCalled();
    expect(search.cache.size).toBe(0);
  });
});
