// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  optimize: vi.fn(),
  start: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/domain", async (original) => ({
  ...(await original<typeof import("@/domain")>()),
  optimize: mocks.optimize,
}));
vi.mock("@/ui/services/search-history", () => ({
  saveCompletedSearchHistory: mocks.start,
  replaceSearchHistoryResult: mocks.replace,
}));
vi.mock("@/ui/components/feedback/FeedbackProvider", () => ({
  useFeedback: () => ({ notify: mocks.notify, confirm: mocks.confirm }),
}));
import {
  singleDraftFromConfig,
  useSingleController,
} from "./useSingleController";
import { makeConfig } from "@/ui/services/app-config";
import { gears, gameData, type OptimizationResult, type MeldedGear } from "@/domain";
import { type OptimizationResultWithEquivalentGear } from "@/ui/components/results/gear-table/GearTable";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import { workbenchResultFromShare } from "@/ui/services/share-link";
import type { SingleWorkbenchResult } from "@/ui/services/workbench-result";
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
function Harness({ initialResult }: { initialResult?: SingleWorkbenchResult }) {
  controller = useSingleController(initialResult);
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
  mocks.start.mockResolvedValue({ id: "a" });
  mocks.confirm.mockResolvedValue(true);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
describe("Single run ownership and nonblocking history", () => {
  it("accepts a display result and replaces its gear without creating or updating history", async () => {
    const fixture = fixtures.find(item => item.label === "nin-sync90")!;
    const initialResult = workbenchResultFromShare(restoreShare(fixture.binary));
    if (initialResult.mode !== "single") throw new Error("Expected single result");
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<Harness initialResult={initialResult} />));
    expect(controller.state.phase).toBe("result");
    expect(controller.state.phase === "result" && Object.isFrozen(controller.state.snapshot)).toBe(true);
    expect(controller.state.phase === "result" && controller.state.snapshot).not.toBe(initialResult.config);
    const selected = initialResult.result.gear.find(gear => gear.slot === "head")!;
    const replacement = initialResult.result.equivalentGear![selected.replacementGroupKey!]!.find(gear => gear.id !== selected.id)!;
    act(() => controller.replace("head", replacement));
    expect(controller.state.phase === "result" && controller.state.result.gear.find(gear => gear.slot === "head")?.id).toBe(replacement.id);
    expect(initialResult.result.gear.find(gear => gear.slot === "head")?.id).toBe(selected.id);
    expect(mocks.optimize).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => controller.edit());
    expect(controller.state.phase === "conditions" && controller.state.draft.condition.range.sync).toEqual(initialResult.config.sync);
  });
  it("retains the selected duty in the snapshot and saved conditions while projecting the domain input", async () => {
    const duty = gameData.sync.groups.flatMap(({ options }) => options).find(({ target }) => target.kind === "itemLevel")!;
    mocks.optimize.mockResolvedValue({ score: 1 });
    act(() => controller.choose("PLD"));
    act(() => controller.updateDraft(singleDraftFromConfig({ ...makeConfig("PLD"), sync: duty.target, syncDuty: duty.name })));
    await act(async () => { await controller.start(() => ({ valid: true })); });
    const input = mocks.optimize.mock.calls[0]![0];
    expect(Object.isFrozen(input)).toBe(true);
    expect(input.sync).toEqual(duty.target);
    expect(input).not.toHaveProperty("syncDuty");
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ syncDuty: duty.name, sync: duty.target }) }));
    expect(controller.state.phase === "result" && controller.state.snapshot.syncDuty).toBe(duty.name);
    await act(async () => { await controller.edit(); });
    expect(controller.state.phase === "conditions" && controller.state.draft.condition.range.syncDuty).toBe(duty.name);
  });

  it("restores structured force values into an editable detached draft", () => {
    const forcedValue = {
      id: gears.find((gear) => gear.slot === "head")!.id,
      melds: [{ stat: "DHT" as const, value: 54, grade: 12 }, null],
    };
    const config = {
      ...makeConfig("SAM"),
      forcedGear: { head: forcedValue },
    };
    const draft = singleDraftFromConfig(config);

    expect(draft.equipment.forcedGear!.head).toEqual(forcedValue);
    expect(draft.equipment.forcedGear!.head).not.toBe(forcedValue);
    if (
      draft.equipment.forcedGear!.head !== undefined &&
      typeof draft.equipment.forcedGear!.head !== "number" &&
      "melds" in draft.equipment.forcedGear!.head
    )
      expect(draft.equipment.forcedGear!.head.melds).not.toBe(forcedValue.melds);
  });

  it("starts and settles without waiting for history; retains the result after a late save", async () => {
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
    expect(mocks.start).not.toHaveBeenCalled();
    const result = { score: 1 } as OptimizationResult;
    await act(async () => {
      search.resolve(result);
      await run;
    });
    expect(controller.state.phase).toBe("result");
    expect(mocks.start).toHaveBeenCalledOnce();
    await act(async () => {
      storage.resolve({ id: "late" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      controller.state.phase === "result" && controller.state.result,
    ).toBe(result);
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ result, startedAtISO: expect.any(String) }),
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
    expect(mocks.start).toHaveBeenCalledOnce();
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
    expect(mocks.start).not.toHaveBeenCalled();
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
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["no-result", "failed"])(
    "does not save %s searches",
    async (outcome) => {
      if (outcome === "failed")
        mocks.optimize.mockRejectedValue(new Error("search failed"));
      else mocks.optimize.mockResolvedValue(undefined);
      act(() => controller.choose("PLD"));
      await act(async () => {
        await controller.start(() => ({ valid: true }));
      });
      expect(controller.state.phase).toBe("conditions");
      expect(mocks.start).not.toHaveBeenCalled();
    },
  );
  it("old-version completed snapshots load without recomputation", async () => {
    const result = { score: 3, statistics: { elapsedMs: 2345 } } as OptimizationResult;
    await act(async () => {
      await controller.loadResult({
        id: "old",
        kind: "single",
        status: "completed",
        config: makeConfig("PLD"),
        result,
        dataVersion: "old",
        startedAtISO: "2026-01-01T00:00:00.000Z",
      });
    });
    expect(
      controller.state.phase === "result" && controller.state.result.statistics.elapsedMs,
    ).toBe(2345);
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
              sync: { kind: "itemLevel", value: 735 },
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
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "late-replacement",
      expect.objectContaining({ gear: [c] }),
    );
  });
});
