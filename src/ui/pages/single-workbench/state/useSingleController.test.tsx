// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  optimize: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/domain", async (original) => ({
  ...(await original<typeof import("@/domain")>()),
  optimize: mocks.optimize,
}));
vi.mock("@/ui/services/search-history", () => ({
  createSearchHistory: mocks.start,
  finishSearchHistory: mocks.finish,
  replaceSearchHistoryResult: mocks.replace,
}));
vi.mock("@/ui/components/feedback/FeedbackProvider", () => ({
  useFeedback: () => ({ notify: mocks.notify, confirm: mocks.confirm }),
}));
import { useSingleController } from "./useSingleController";
import { makeConfig } from "@/ui/services/app-config";
import { gears, type OptimizationResult, type MeldedGear } from "@/domain";
import { type OptimizationResultWithEquivalentGear } from "@/ui/components/results/gear-table/GearTable";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
let root: Root,
  host: HTMLDivElement,
  controller: ReturnType<typeof useSingleController>;
function Harness() {
  controller = useSingleController();
  return null;
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
  mocks.finish.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue({ id: "a" });
  mocks.confirm.mockResolvedValue(true);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
describe("Single run ownership and nonblocking history", () => {
  it("starts and settles without waiting for history; binds a late id only to its own result", async () => {
    const storage = deferred<{ id: string }>(),
      search = deferred<OptimizationResult | undefined>();
    mocks.start.mockReturnValue(storage.promise);
    mocks.optimize.mockReturnValue(search.promise);
    act(() => controller.choose("PLD"));
    let run!: Promise<void>;
    act(() => {
      run = controller.start(() => ({ valid: true }));
    });
    expect(mocks.optimize).toHaveBeenCalledOnce();
    expect(controller.state.phase).toBe("progress");
    const result = { score: 1 } as OptimizationResult;
    await act(async () => {
      search.resolve(result);
      await run;
    });
    expect(controller.state.phase).toBe("result");
    expect(mocks.finish).not.toHaveBeenCalled();
    await act(async () => {
      storage.resolve({ id: "late" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      controller.state.phase === "result" && controller.state.historyId,
    ).toBe("late");
    expect(mocks.finish).toHaveBeenCalledWith(
      "late",
      expect.objectContaining({
        status: "completed",
        finishedAtISO: expect.any(String),
      }),
    );
  });
  it("storage failure never suppresses a valid search result", async () => {
    mocks.start.mockRejectedValue(new Error("storage unavailable"));
    mocks.optimize.mockResolvedValue({ score: 2 });
    act(() => controller.choose("PLD"));
    await act(async () => {
      await controller.start(() => ({ valid: true }));
    });
    expect(controller.state.phase).toBe("result");
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.stringContaining("storage unavailable"),
      "warning",
    );
  });
  it("cancel waits for actual settle and restores a fresh draft", async () => {
    const search = deferred<OptimizationResult | undefined>();
    mocks.optimize.mockReturnValue(search.promise);
    act(() => controller.choose("PLD"));
    let run!: Promise<void>;
    act(() => {
      run = controller.start(() => ({ valid: true }));
    });
    act(() => controller.cancel());
    expect(controller.state.phase).toBe("progress");
    await act(async () => {
      search.reject(new DOMException("cancel", "AbortError"));
      await run;
    });
    expect(controller.state.phase).toBe("conditions");
  });
  it("navigation detaches old callbacks/finally from a newer selection", async () => {
    const search = deferred<OptimizationResult | undefined>();
    mocks.optimize.mockReturnValue(search.promise);
    act(() => controller.choose("PLD"));
    let run!: Promise<void>;
    act(() => {
      run = controller.start(() => ({ valid: true }));
    });
    act(() => controller.choose("WAR"));
    await act(async () => {
      search.resolve({ score: 2 } as OptimizationResult);
      await run;
    });
    expect(
      controller.state.phase === "conditions" && controller.state.draft.jobId,
    ).toBe("WAR");
  });
  it("old-version completed snapshots load without recomputation", async () => {
    const result = { score: 3 } as OptimizationResult;
    await act(async () => {
      await controller.loadResult({
        id: "old",
        kind: "single",
        status: "completed",
        config: makeConfig("PLD"),
        result,
        dataVersion: "old",
        startedAtISO: "2026-01-01T00:00:00.000Z",
        finishedAtISO: "2026-01-01T00:00:02.000Z",
      });
    });
    expect(
      controller.state.phase === "result" && controller.state.durationMs,
    ).toBe(2000);
    expect(mocks.optimize).not.toHaveBeenCalled();
  });
  it("rechecks latest validation before starting", async () => {
    act(() => controller.choose("PLD"));
    await act(async () => {
      await controller.start(() => ({ valid: false }));
    });
    expect(mocks.optimize).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe("conditions");
  });
  it("keeps the last replacement when history start returns after result interactions", async () => {
    const storage = deferred<{ id: string }>();
    mocks.start.mockReturnValue(storage.promise);
    const base = gears.find(
      (x) => x.slot === "weapon" && x.jobs.includes("PLD"),
    )!;
    const a: MeldedGear & { replacementGroupKey: string } = {
      ...base,
      name: "test selected",
      melds: [],
      finalStats: base.stats,
      replacementGroupKey: "weapon-group",
    };
    const b: MeldedGear = { ...a, id: a.id + 1, name: "test replacement B" };
    const c: MeldedGear = { ...a, id: a.id + 2, name: "test replacement C" };
    const result = {
      score: 1,
      gear: [a],
      equivalentGear: { "weapon-group": [a, b, c] },
    } as unknown as OptimizationResultWithEquivalentGear;
    mocks.optimize.mockResolvedValue(result);
    act(() => controller.choose("PLD"));
    act(() => {
      if (controller.state.phase === "conditions")
        controller.updateDraft({
          ...controller.state.draft,
          condition: {
            ...controller.state.draft.condition,
            range: {
              ...controller.state.draft.condition.range,
              sync: { mode: "enabled", itemLevel: 735 },
            },
          },
        });
    });
    await act(async () => {
      await controller.start(() => ({ valid: true }));
    });
    act(() => controller.replace("weapon", b));
    act(() => controller.replace("weapon", c));
    await act(async () => {
      storage.resolve({ id: "late-replacement" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(
      controller.state.phase === "result" &&
        controller.state.result.gear[0]?.name,
    ).toBe("test replacement C");
    expect(mocks.finish).toHaveBeenCalledWith(
      "late-replacement",
      expect.objectContaining({
        result: expect.objectContaining({ gear: [c] }),
      }),
    );
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "late-replacement",
      expect.objectContaining({ gear: [c] }),
    );
  });
});
