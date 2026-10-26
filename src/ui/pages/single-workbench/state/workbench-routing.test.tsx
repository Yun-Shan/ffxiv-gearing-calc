// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ optimize: vi.fn(), optimizeJoint: vi.fn(), save: vi.fn(), replace: vi.fn(), notify: vi.fn(), confirm: vi.fn() }));
vi.mock("@/domain", async original => ({ ...(await original<typeof import("@/domain")>()), optimize: mocks.optimize, optimizeJoint: mocks.optimizeJoint }));
vi.mock("@/ui/components/feedback/FeedbackProvider", () => ({ useFeedback: () => ({ notify: mocks.notify, confirm: mocks.confirm }) }));
vi.mock("@/ui/services/search-history", async original => ({ ...(await original<typeof import("@/ui/services/search-history")>()), saveCompletedSearchHistory: mocks.save, replaceSearchHistoryGearIfCurrent: mocks.replace }));
import { singleDraftFromConfig, singleSessionFromState, singleStateFromResult, singleStateFromSession, useSingleController, type SingleState } from "./useSingleController";
import { jointSessionFromState, jointStateFromResult, jointStateFromSession, useJointWorkbenchController } from "../../joint-workbench/useJointWorkbenchController";
import { createJointWorkbenchDraft, createJointWorkbenchRuntime } from "../../joint-workbench/joint-workbench-state";
import type { JointWorkbenchPhase } from "../../joint-workbench/joint-workbench-types";
import type { WorkbenchRouteControls, WorkbenchRouting } from "@/ui/services/workbench-routing";
import { historyReplacementLink, type SearchHistoryRecord } from "@/ui/services/search-history";
import type { JointWorkbenchResult, SingleWorkbenchResult } from "@/ui/services/workbench-result";
import { gcdAnalysisInputFromConfig, gcdAnalysisKey } from "@/ui/features/job-condition";
import { makeConfig } from "@/ui/services/app-config";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import { workbenchResultFromShare } from "@/ui/services/share-link";
import { createMemoryHistory } from "@tanstack/react-router";
import { WorkbenchRuntime } from "@/ui/app/workbench-runtime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function route<State>(initialState: State) {
  let controls!: WorkbenchRouteControls<State>;
  const routing: WorkbenchRouting<State> = { initialState, publish: vi.fn(), attach(value) { controls = value; return () => {}; } };
  return { routing, get controls() { return controls; } };
}
const singleValue = workbenchResultFromShare(restoreShare(fixtures.find(value => value.label === "nin-sync90")!.binary)) as SingleWorkbenchResult;
const jointValue = workbenchResultFromShare(restoreShare(fixtures.find(value => value.label === "combo-caster-joint")!.binary)) as JointWorkbenchResult;
let root: Root, host: HTMLDivElement;
let single: ReturnType<typeof useSingleController>;
let joint: ReturnType<typeof useJointWorkbenchController>;
function SingleHarness({ routing }: { routing: WorkbenchRouting<SingleState> }) { single = useSingleController(routing); return null; }
function JointHarness({ routing }: { routing: WorkbenchRouting<JointWorkbenchPhase> }) { joint = useJointWorkbenchController(routing); return null; }
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mocks.save.mockImplementation(async input => ({ ...input, id: "saved", status: "completed" }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function flush() { await act(async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); }); }
function completedRecord(mode: "single" | "joint"): SearchHistoryRecord {
  const value = mode === "single" ? singleValue : jointValue;
  return { id: "record", status: "completed", kind: mode, config: value.config, result: value.result, startedAtISO: "2026-10-26T00:00:00.000Z", dataVersion: value.dataVersion } as SearchHistoryRecord;
}
function setup(mode: "single" | "joint") {
  const singleRoute = route<SingleState>({ phase: "conditions", draft: singleDraftFromConfig(makeConfig("NIN")) });
  const draft = createJointWorkbenchDraft(["RDM", "BLM"]);
  const jointRoute = route<JointWorkbenchPhase>({ phase: "conditions", draft, runtime: createJointWorkbenchRuntime(draft.jobs) });
  act(() => root.render(<StrictMode>{mode === "single" ? <SingleHarness routing={singleRoute.routing} /> : <JointHarness routing={jointRoute.routing} />}</StrictMode>));
  if (mode === "joint") {
    for (const job of joint.currentConfig!.jobs) {
      act(() => joint.updateCondition(job.jobId, old => ({ ...old, gcd: { mode: "any" } })));
      act(() => joint.updateGcdRuntime(job.jobId, gcdAnalysisKey(gcdAnalysisInputFromConfig(job)), { status: "ready", key: gcdAnalysisKey(gcdAnalysisInputFromConfig(job)), feasibleTiers: [2.5] }));
    }
    expect(joint.currentValidation?.valid).toBe(true);
  }
  const routing = mode === "single" ? singleRoute.routing : jointRoute.routing;
  vi.mocked(routing.publish).mockClear();
  return {
    get state() { return mode === "single" ? single.state : joint.phase; },
    publish: vi.mocked(routing.publish),
    enterSelection() { act(() => mode === "single" ? singleRoute.controls.enter({ phase: "selection" }, true) : jointRoute.controls.enter({ phase: "selection" }, true)); },
    enterResult() { act(() => mode === "single" ? singleRoute.controls.enter(singleStateFromResult(singleValue)) : jointRoute.controls.enter(jointStateFromResult(jointValue))); },
    leave() { act(() => mode === "single" ? singleRoute.controls.leave() : jointRoute.controls.leave()); },
    start() { act(() => { if (mode === "single") void single.start(() => ({ valid: true })); else joint.startSearch(); }); },
    load() { act(() => { if (mode === "single") void single.loadResult(completedRecord(mode)); else joint.historyProps.onLoadResult(completedRecord(mode)); }); },
    cancel() { act(() => { if (mode === "single") single.cancel(); else joint.cancelSearch(); }); },
    optimize: mode === "single" ? mocks.optimize : mocks.optimizeJoint,
    value: mode === "single" ? singleValue : jointValue,
  };
}

describe.each(["single", "joint"] as const)("%s route-owned transitions", mode => {
  it("publishes progress as push, callbacks as update, success as replace and edit as push", async () => {
    const ui = setup(mode), search = deferred<unknown>();
    ui.optimize.mockReturnValue(search.promise);
    ui.start();
    expect(ui.state.phase).toBe("progress");
    expect(ui.publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "progress" }), "push");
    act(() => ui.optimize.mock.calls[0]![1].onProgress("搜索进度"));
    expect(ui.publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "progress" }), "update");
    search.resolve(ui.value.result); await flush();
    expect(ui.publish.mock.calls.some(([state, intent]) => state.phase === "result" && intent === "replace")).toBe(true);
    await act(async () => { if (mode === "single") await single.edit(); else await joint.adjustConditions(); });
    expect(ui.publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "conditions" }), "push");
  });
  it("returns a cancelled search to conditions without adding a new phase entry", async () => {
    const ui = setup(mode), search = deferred<undefined>(); ui.optimize.mockReturnValue(search.promise);
    ui.start(); ui.cancel(); search.resolve(undefined); await flush();
    expect(ui.publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "conditions" }), "return");
  });
  it("route entry aborts and revokes a run without publishing or accepting its late progress/result", async () => {
    const ui = setup(mode), search = deferred<unknown>(); ui.optimize.mockReturnValue(search.promise);
    ui.start(); const options = ui.optimize.mock.calls[0]![1];
    ui.enterResult(); const entered = ui.state; ui.publish.mockClear();
    expect(options.signal.aborted).toBe(true);
    act(() => options.onProgress("late progress")); search.resolve(ui.value.result); await flush();
    expect(ui.state).toBe(entered); expect(ui.publish).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(ui.optimize).toHaveBeenCalledOnce();
  });
  it.each(["reset", "entry", "leave"])("rejects a history confirmation resolved after %s", async action => {
    const ui = setup(mode), search = deferred<unknown>(), confirmation = deferred<boolean>();
    ui.optimize.mockReturnValue(search.promise); mocks.confirm.mockReturnValue(confirmation.promise);
    ui.start(); ui.load(); expect(mocks.confirm).toHaveBeenCalledOnce();
    if (action === "reset") ui.enterSelection(); else if (action === "entry") ui.enterResult(); else ui.leave();
    const entered = ui.state; ui.publish.mockClear();
    confirmation.resolve(true); search.resolve(ui.value.result); await flush();
    expect(ui.state).toBe(entered); expect(ui.publish).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    if (mode === "joint" && action === "reset") { expect(joint.historyOpen).toBe(false); expect(joint.selectionState).toBeUndefined(); expect(joint.editorTarget).toBe("shared"); }
  });
  it("does not attach a completed history save after leaving its result", async () => {
    const ui = setup(mode), storage = deferred<SearchHistoryRecord>(); mocks.save.mockReturnValue(storage.promise); ui.optimize.mockResolvedValue(ui.value.result);
    ui.start(); await flush(); expect(ui.state.phase).toBe("result");
    if (mode === "single") expect(single.state.phase === "result" && single.state.historyLink).toBeUndefined();
    ui.enterSelection(); ui.publish.mockClear(); storage.resolve(completedRecord(mode)); await flush();
    expect(ui.state.phase).toBe("selection"); expect(ui.publish).not.toHaveBeenCalled();
  });
});

it("rebinds ordinary result history when pending share recovery is interrupted", async () => {
  const runtime = new WorkbenchRuntime(false);
  const history = createMemoryHistory();
  runtime.connect({
    history,
    navigate: async () => undefined,
    location: () => ({ pathname: "/single/result", search: {} }),
  });
  try {
    runtime.prepare({ pathname: "/", search: { s: "share-a" } });
    runtime.acceptShare(singleValue, "share-a", { s: "share-a" });
    const historyLink = historyReplacementLink(completedRecord("single"));
    const port = runtime.port("single");
    const ordinaryResult = { ...singleStateFromResult(singleValue), historyLink };
    port.publish(ordinaryResult, "replace");
    act(() => root.render(<SingleHarness routing={port} />));

    act(() => {
      runtime.prepare({
        pathname: "/single/result",
        search: {},
        maskedLocation: { pathname: "/", search: { s: "share-a" } },
      });
    });
    expect(runtime.pendingShare("single")).toBeDefined();
    act(() => {
      runtime.prepare({ pathname: "/single/result", search: {} });
    });
    expect(runtime.pendingShare("single")).toBeUndefined();
    expect(single.state).toBe(ordinaryResult);
    const gear = singleValue.result.gear.find(value => value.slot === "head")!;
    const replacement = singleValue.result.equivalentGear![gear.replacementGroupKey!]!
      .find(value => value.id !== gear.id)!;
    mocks.replace.mockResolvedValue(historyLink);

    act(() => single.replace("head", replacement));
    await flush();

    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      historyLink,
      expect.arrayContaining([expect.objectContaining({ id: replacement.id, slot: "head" })]),
    );
    const resumed = single.state;
    act(() => runtime.acceptShare(singleValue, "share-a", { s: "share-a" }));
    expect(single.state).toBe(resumed);
    expect(mocks.optimize).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  } finally {
    history.destroy();
  }
});

it("round trips incomplete committed Drafts, keeps hidden choices and rebuilds Joint runtime", () => {
  const draft = singleDraftFromConfig(makeConfig("PLD")); draft.condition.gcd = { mode: "tiers", tiers: [] }; draft.condition.tank = { strategy: "tenacity" };
  const state: SingleState = { phase: "conditions", draft };
  const stored = singleSessionFromState(state)!;
  const restored = singleStateFromSession(stored as Extract<typeof stored, { mode: "single" }>);
  expect(restored).toEqual(state); expect(restored).not.toBe(state);
  const jointDraft = createJointWorkbenchDraft(["RDM", "BLM"]);
  const session = jointSessionFromState({ phase: "conditions", draft: jointDraft, runtime: { ...createJointWorkbenchRuntime(jointDraft.jobs), RDM: { gcdAnalysis: { status: "loading", key: "old" } } } });
  expect(session).not.toHaveProperty("runtime");
  const jointRestored = jointStateFromSession(session as Extract<NonNullable<typeof session>, { mode: "joint" }>);
  expect(jointRestored.phase === "conditions" && jointRestored.runtime.RDM?.gcdAnalysis).toEqual({ status: "idle" });
  expect(jointRestored.phase === "conditions" && jointRestored.draft).toEqual(jointDraft);
});
it("serializes result linkage and freezes restored presentation snapshots without solver metadata", () => {
  const record = completedRecord("single"), historyLink = historyReplacementLink(record);
  const state = { ...singleStateFromResult(singleValue), historyLink };
  const session = singleSessionFromState(state)!;
  const restored = singleStateFromSession(session as Extract<typeof session, { mode: "single" }>);
  expect(restored.phase === "result" && restored.historyLink).toEqual(historyLink);
  expect(restored.phase === "result" && Object.isFrozen(restored.result)).toBe(true);
  expect(restored.phase === "result" && Object.isFrozen(restored.snapshot)).toBe(true);
  const jointState = jointStateFromResult(jointValue);
  const jointSession = jointSessionFromState(jointState)!;
  expect(jointStateFromSession(jointSession as Extract<typeof jointSession, { mode: "joint" }>)).toEqual(jointState);
});
it("restored history linkage advances after each CAS and detaches after an overwrite", async () => {
  const historyLink = historyReplacementLink(completedRecord("single"));
  const routing = route<SingleState>({ ...singleStateFromResult(singleValue), historyLink });
  act(() => root.render(<SingleHarness routing={routing.routing} />));
  const gear = singleValue.result.gear.find(value => value.slot === "head")!;
  const replacement = singleValue.result.equivalentGear![gear.replacementGroupKey!]!.find(value => value.id !== gear.id)!;
  const nextLink = { ...historyLink, resultSignature: "after replacement" };
  mocks.replace.mockResolvedValueOnce(nextLink).mockResolvedValueOnce(undefined);
  act(() => single.replace("head", replacement)); await flush();
  expect(mocks.replace).toHaveBeenLastCalledWith(historyLink, expect.any(Array));
  expect(single.state.phase === "result" && single.state.historyLink).toEqual(nextLink);
  act(() => single.replace("head", gear)); await flush();
  expect(mocks.replace).toHaveBeenLastCalledWith(nextLink, expect.any(Array));
  expect(single.state.phase === "result" && single.state.historyLink).toBeUndefined();
  act(() => single.replace("head", replacement)); await flush(); expect(mocks.replace).toHaveBeenCalledTimes(2);
});

it("serializes rapid gear writes against each newly confirmed history fingerprint", async () => {
  const historyLink = historyReplacementLink(completedRecord("single"));
  const routing = route<SingleState>({ ...singleStateFromResult(singleValue), historyLink });
  act(() => root.render(<SingleHarness routing={routing.routing} />));
  const gear = singleValue.result.gear.find(value => value.slot === "head")!;
  const replacement = singleValue.result.equivalentGear![gear.replacementGroupKey!]!.find(value => value.id !== gear.id)!;
  const pending = deferred<typeof historyLink | undefined>();
  const nextLink = { ...historyLink, resultSignature: "first write" };
  mocks.replace.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(historyLink);
  act(() => single.replace("head", replacement)); await flush();
  act(() => single.replace("head", gear)); await flush();
  expect(mocks.replace).toHaveBeenCalledTimes(1);
  pending.resolve(nextLink); await flush();
  expect(mocks.replace).toHaveBeenLastCalledWith(nextLink, expect.arrayContaining([expect.objectContaining({ id: gear.id, slot: "head" })]));
  expect(single.state.phase === "result" && single.state.result.gear.find(value => value.slot === "head")?.id).toBe(gear.id);
});
it("an in-flight history replacement cannot attach its fingerprint after route reset", async () => {
  const historyLink = historyReplacementLink(completedRecord("single"));
  const routing = route<SingleState>({ ...singleStateFromResult(singleValue), historyLink });
  act(() => root.render(<SingleHarness routing={routing.routing} />));
  const gear = singleValue.result.gear.find(value => value.slot === "head")!;
  const replacement = singleValue.result.equivalentGear![gear.replacementGroupKey!]!.find(value => value.id !== gear.id)!;
  const pending = deferred<typeof historyLink | undefined>(); mocks.replace.mockReturnValue(pending.promise);
  act(() => single.replace("head", replacement)); await flush();
  act(() => routing.controls.enter({ phase: "selection" }, true)); vi.mocked(routing.routing.publish).mockClear();
  pending.resolve({ ...historyLink, resultSignature: "late" }); await flush();
  expect(single.state.phase).toBe("selection"); expect(routing.routing.publish).not.toHaveBeenCalled();
});
