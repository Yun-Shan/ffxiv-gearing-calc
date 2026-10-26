// @vitest-environment jsdom
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import { makeConfig, currentDataVersion } from "@/ui/services/app-config";
import { workbenchResultFromShare } from "@/ui/services/share-link";
import {
  readWorkbenchSession,
  writeWorkbenchSession,
} from "@/ui/services/workbench-session";
import {
  singleDraftFromConfig,
  singleStateFromResult,
  type SingleState,
} from "@/ui/pages/single-workbench/state/useSingleController";
import { WorkbenchRuntime } from "./workbench-runtime";
import {
  jointStateFromResult,
  jointStateFromSession,
} from "@/ui/pages/joint-workbench/useJointWorkbenchController";
import { jointWorkbenchDraftFromConfig } from "@/ui/pages/joint-workbench/joint-workbench-state";
import type { JointWorkbenchPhase } from "@/ui/pages/joint-workbench/joint-workbench-types";
import type { WorkbenchResult } from "@/ui/services/workbench-result";

let history: ReturnType<typeof createMemoryHistory>;
beforeEach(() => {
  window.sessionStorage.clear();
  history = createMemoryHistory();
});
afterEach(() => {
  history.destroy();
});
const conditions = (
  jobId: "PLD" | "SAM" = "PLD",
): Extract<SingleState, { phase: "conditions" }> => ({
  phase: "conditions",
  draft: singleDraftFromConfig(makeConfig(jobId)),
});
const location = (pathname: string) => ({ pathname, search: {} });
function fixtureResult(mode: "single" | "joint"): WorkbenchResult {
  const fixture = fixtures.find(
    (item) => item.label === (mode === "single" ? "brd-open" : "caster-shared"),
  )!;
  const value = workbenchResultFromShare(restoreShare(fixture.binary));
  if (value.mode !== mode) throw new Error(`${mode} fixture expected`);
  return value;
}
function setup() {
  const runtime = new WorkbenchRuntime(false);
  const navigate = vi.fn(async () => undefined);
  let current = {
    ...location("/single/conditions"),
    state: { __TSR_index: 2 },
  };
  runtime.connect({ history, navigate, location: () => current });
  return {
    runtime,
    navigate,
    setIndex: (index: number) => {
      current = { ...current, state: { __TSR_index: index } };
    },
  };
}

describe("workbench transition ownership", () => {
  it.each(["single", "joint"] as const)(
    "rebuilds missing %s conditions from the restored result snapshot",
    (mode) => {
      const value = fixtureResult(mode);
      const original = new WorkbenchRuntime(false);
      const originalPort = original.port(mode);
      const resultState =
        value.mode === "single"
          ? singleStateFromResult(value)
          : jointStateFromResult(value);
      originalPort.publish(resultState, "replace");
      expect(readWorkbenchSession().session?.phase).toBe("result");

      const runtime = new WorkbenchRuntime(true);
      const port = runtime.port(mode);
      expect(runtime.prepare(location(`/${mode}/result`))).toBeUndefined();
      const retainedResult = port.initialState;
      expect(retainedResult.phase).toBe("result");
      expect(runtime.prepare(location(`/${mode}/conditions`))).toBeUndefined();

      if (value.mode === "single") {
        const result = retainedResult as Extract<
          SingleState,
          { phase: "result" }
        >;
        const originalSnapshot = structuredClone(result.snapshot);
        const conditions = port.initialState as Extract<
          SingleState,
          { phase: "conditions" }
        >;
        expect(conditions.draft).toEqual(singleDraftFromConfig(value.config));
        conditions.draft.condition.range.minItemLevel += 1;
        expect(result.snapshot).toEqual(originalSnapshot);
      } else {
        const result = retainedResult as Extract<
          JointWorkbenchPhase,
          { phase: "result" }
        >;
        const originalSnapshot = structuredClone(result.snapshot);
        const conditions = port.initialState as Extract<
          JointWorkbenchPhase,
          { phase: "conditions" }
        >;
        expect(conditions.draft).toEqual(
          jointWorkbenchDraftFromConfig(value.config),
        );
        expect(Object.keys(conditions.runtime)).toHaveLength(
          value.config.jobs.length,
        );
        expect(
          Object.values(conditions.runtime).every(
            (entry) => entry.gcdAnalysis.status === "idle",
          ),
        ).toBe(true);
        const runtimes = Object.values(conditions.runtime);
        expect(new Set(runtimes).size).toBe(runtimes.length);
        conditions.draft.shared.range.minItemLevel += 1;
        expect(result.snapshot).toEqual(originalSnapshot);
      }
      expect(readWorkbenchSession().session?.phase).toBe("conditions");
    },
  );

  it.each(["single", "joint"] as const)(
    "keeps an existing %s conditions Draft ahead of a retained result snapshot",
    (mode) => {
      const value = fixtureResult(mode);
      const { runtime } = setup();
      const port = runtime.port(mode);
      const resultA =
        value.mode === "single"
          ? singleStateFromResult(value)
          : jointStateFromResult(value);
      port.publish(resultA, "replace");

      if (value.mode === "single") {
        const configB = structuredClone(value.config);
        configB.minItemLevel -= 1;
        const draftB = {
          phase: "conditions" as const,
          draft: singleDraftFromConfig(configB),
        };
        port.publish(draftB, "push");
        port.publish(resultA, "replace");
        expect(
          runtime.prepare(location(`/${mode}/conditions`)),
        ).toBeUndefined();
        expect(port.initialState).toBe(draftB);
        expect(
          (port.initialState as Extract<SingleState, { phase: "conditions" }>)
            .draft,
        ).toEqual(draftB.draft);
      } else {
        const configB = structuredClone(value.config);
        for (const config of configB.jobs) config.minItemLevel -= 1;
        const draftB = jointStateFromSession({
          mode: "joint",
          phase: "conditions",
          draft: jointWorkbenchDraftFromConfig(configB),
        }) as Extract<JointWorkbenchPhase, { phase: "conditions" }>;
        const jobId = draftB.draft.jobs[0]!;
        draftB.runtime[jobId]!.gcdAnalysis = {
          status: "ready",
          key: "draft-b",
          feasibleTiers: [2.5],
        };
        port.publish(draftB, "push");
        port.publish(resultA, "replace");
        expect(
          runtime.prepare(location(`/${mode}/conditions`)),
        ).toBeUndefined();
        expect(port.initialState).toBe(draftB);
        expect(
          (
            port.initialState as Extract<
              JointWorkbenchPhase,
              { phase: "conditions" }
            >
          ).runtime[jobId]?.gcdAnalysis,
        ).toEqual({ status: "ready", key: "draft-b", feasibleTiers: [2.5] });
      }

      expect(readWorkbenchSession().session?.phase).toBe("conditions");
    },
  );

  it.each(["single", "joint"] as const)(
    "re-decodes masked share A in the same %s owner and retains edited conditions B",
    (mode) => {
      const { runtime } = setup();
      const fixture = fixtures.find(
        (item) =>
          item.label === (mode === "single" ? "brd-open" : "caster-shared"),
      )!;
      const valueA = workbenchResultFromShare(restoreShare(fixture.binary));
      const token = fixture.binary;
      runtime.prepare({ pathname: "/", search: { s: token } });
      runtime.acceptShare(valueA, token, { s: token });
      const port = runtime.port(mode);
      const enter = vi.fn();
      const leave = vi.fn();
      port.attach({ enter, leave });
      const valueB = structuredClone(valueA);
      if (valueB.mode === "single") valueB.config.minItemLevel -= 1;
      else for (const config of valueB.config.jobs) config.minItemLevel -= 1;
      const conditionsB =
        valueB.mode === "single"
          ? {
              phase: "conditions" as const,
              draft: singleDraftFromConfig(valueB.config),
            }
          : jointStateFromSession({
              mode: "joint",
              phase: "conditions",
              draft: jointWorkbenchDraftFromConfig(valueB.config),
            });
      port.publish(conditionsB, "push");
      valueB.result.statistics.elapsedMs = 1250;
      const resultB =
        valueB.mode === "single"
          ? singleStateFromResult(valueB)
          : jointStateFromResult(valueB);
      port.publish(resultB, "replace");
      runtime.prepare(location(`/${mode}/conditions`));
      expect(port.initialState).toBe(conditionsB);
      enter.mockClear();

      expect(
        runtime.prepare({
          pathname: `/${mode}/result`,
          search: {},
          maskedLocation: { pathname: "/", search: { s: token } },
        }),
      ).toBeUndefined();
      expect(runtime.pendingShare(mode)).toEqual({
        mode,
        token,
        search: { s: token },
      });
      expect(runtime.port(mode)).toBe(port);
      expect(leave).toHaveBeenCalledOnce();
      expect(enter).not.toHaveBeenCalled();
      runtime.acceptShare(valueA, token, { s: token });
      expect(port.initialState).toMatchObject({
        phase: "result",
        result: {
          statistics: { elapsedMs: valueA.result.statistics.elapsedMs },
        },
      });
      expect(runtime.pendingShare(mode)).toBeUndefined();
      runtime.prepare(location(`/${mode}/conditions`));
      expect(port.initialState).toBe(conditionsB);
    },
  );
  it("keeps current Draft B and result A across phase entries without history-entry snapshots", () => {
    const { runtime } = setup();
    runtime.prepare(location("/single"));
    const port = runtime.port("single");
    const view = workbenchResultFromShare(
      restoreShare(fixtures.find((f) => f.label === "brd-open")!.binary),
    );
    if (view.mode !== "single") throw new Error("single fixture expected");
    const resultA = singleStateFromResult(view);
    port.publish(resultA, "replace");
    const draftB = conditions("SAM");
    port.publish(draftB, "push");
    expect(runtime.prepare(location("/single/result"))).toBeUndefined();
    expect(port.initialState).toBe(resultA);
    runtime.prepare(location("/single/conditions"));
    expect(port.initialState).toBe(draftB);
    expect(readWorkbenchSession().session).toEqual({
      mode: "single",
      phase: "conditions",
      draft: draftB.draft,
    });
  });
  it("invalidates old results when a new job is chosen after selection", () => {
    const { runtime } = setup();
    const port = runtime.port("single");
    const value = workbenchResultFromShare(
      restoreShare(fixtures.find((f) => f.label === "brd-open")!.binary),
    );
    if (value.mode !== "single") throw new Error("single fixture expected");
    port.publish(singleStateFromResult(value), "replace");
    port.publish({ phase: "selection" }, "push");
    port.publish(conditions("SAM"), "push");
    expect(runtime.prepare(location("/single/result"))).toEqual({
      to: "/single",
      search: {},
    });
    expect(port.initialState).toMatchObject({
      phase: "conditions",
      draft: { jobId: "SAM" },
    });
  });
  it("revokes controller ownership on exit and ignores late publications from that workbench", () => {
    const { runtime, navigate } = setup();
    const old = runtime.port("single");
    const leave = vi.fn();
    old.attach({ enter: vi.fn(), leave });
    old.publish(conditions(), "push");
    runtime.prepare(location("/faq"));
    expect(leave).toHaveBeenCalledTimes(1);
    navigate.mockClear();
    old.publish(conditions("SAM"), "push");
    expect(navigate).not.toHaveBeenCalled();
    expect(readWorkbenchSession()).toEqual({});
    expect(runtime.port("single").initialState).toEqual({ phase: "selection" });
  });
  it("resets even a currently active selection entry and drops saved phases", () => {
    const { runtime } = setup();
    const port = runtime.port("single");
    const enter = vi.fn();
    port.attach({ enter, leave: vi.fn() });
    port.publish(conditions(), "push");
    runtime.reset("single");
    expect(enter).toHaveBeenLastCalledWith({ phase: "selection" }, true);
    expect(readWorkbenchSession()).toEqual({});
    expect(runtime.prepare(location("/single/conditions"))).toEqual({
      to: "/single",
      search: {},
    });
  });
  it("reuses the conditions history entry when cancelling the directly subsequent progress", () => {
    const { runtime, navigate, setIndex } = setup();
    const port = runtime.port("single");
    port.publish(conditions(), "push");
    const state: SingleState = {
      phase: "progress",
      snapshot: makeConfig("PLD"),
      progress: { phase: "prepare", startedAt: 1, hasFeasibleCandidate: false },
      startedAt: 1,
      dataVersion: currentDataVersion,
    };
    port.publish(state, "push");
    const back = vi.spyOn(history, "back");
    setIndex(3);
    navigate.mockClear();
    port.publish(conditions(), "return");
    expect(back).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(runtime.prepare(location("/single/progress"))).toEqual({
      to: "/single/conditions",
      search: {},
    });
  });
  it("never serializes an active progress state over committed conditions", () => {
    const { runtime } = setup();
    const port = runtime.port("single");
    const draft = conditions();
    port.publish(draft, "push");
    port.publish(
      {
        phase: "progress",
        snapshot: makeConfig("PLD"),
        progress: {
          phase: "prepare",
          startedAt: 1,
          hasFeasibleCandidate: false,
        },
        startedAt: 1,
        dataVersion: currentDataVersion,
      },
      "push",
    );
    expect(readWorkbenchSession().session).toEqual({
      mode: "single",
      phase: "conditions",
      draft: draft.draft,
    });
  });
  it("drops active progress when stale masked share recovery starts and ignores decoding after Forward leaves it", () => {
    const { runtime, navigate } = setup();
    const token = fixtures.find((f) => f.label === "brd-open")!.binary;
    const valueA = workbenchResultFromShare(restoreShare(token));
    if (valueA.mode !== "single") throw new Error("single fixture expected");
    const port = runtime.port("single");
    const draft = {
      phase: "conditions" as const,
      draft: singleDraftFromConfig(valueA.config),
    };
    port.publish(draft, "push");
    port.publish(
      {
        phase: "progress",
        snapshot: valueA.config,
        progress: {
          phase: "prepare",
          startedAt: 1,
          hasFeasibleCandidate: false,
        },
        startedAt: 1,
        dataVersion: currentDataVersion,
      },
      "push",
    );
    const enter = vi.fn();
    port.attach({ enter, leave: vi.fn() });
    navigate.mockClear();

    expect(
      runtime.prepare({
        pathname: "/single/result",
        search: {},
        maskedLocation: { pathname: "/", search: { s: token } },
      }),
    ).toBeUndefined();
    expect(port.initialState).toBe(draft);
    expect(enter).toHaveBeenCalledWith(draft, false);
    expect(runtime.pendingShare("single")).toMatchObject({ token });

    expect(runtime.prepare(location("/single/progress"))).toEqual({
      to: "/single/conditions",
      search: {},
    });
    runtime.prepare(location("/single/conditions"));
    expect(runtime.pendingShare("single")).toBeUndefined();
    runtime.acceptShare(valueA, token, { s: token });
    expect(port.initialState).toBe(draft);
    expect(navigate).not.toHaveBeenCalled();
    expect(readWorkbenchSession().session).toEqual({
      mode: "single",
      phase: "conditions",
      draft: draft.draft,
    });
  });
  it("consumes refresh eligibility once rather than using saved data for later route entries", () => {
    writeWorkbenchSession({
      mode: "single",
      phase: "conditions",
      draft: conditions().draft,
    });
    const runtime = new WorkbenchRuntime(true);
    runtime.prepare(location("/faq"));
    expect(runtime.prepare(location("/single/conditions"))).toEqual({
      to: "/single",
      search: {},
    });
    expect(readWorkbenchSession()).toEqual({});
  });
  it("ignores share completion after a token change or ordinary navigation", () => {
    const { runtime, navigate } = setup();
    const value = workbenchResultFromShare(
      restoreShare(fixtures.find((f) => f.label === "brd-open")!.binary),
    );
    runtime.prepare({ pathname: "/", search: { s: "first" } });
    runtime.prepare({ pathname: "/", search: { s: "second" } });
    runtime.acceptShare(value, "first", { s: "first" });
    expect(navigate).not.toHaveBeenCalled();
    runtime.prepare(location("/about"));
    runtime.acceptShare(value, "second", { s: "second" });
    expect(navigate).not.toHaveBeenCalled();
    expect(readWorkbenchSession()).toEqual({});
  });
});
