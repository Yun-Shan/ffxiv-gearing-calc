// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackProvider, useFeedback } from "./FeedbackProvider";
import { useSingleController, singleDraftFromConfig, type SingleState } from "@/ui/pages/single-workbench/state/useSingleController";
import { useJointWorkbenchController } from "@/ui/pages/joint-workbench/useJointWorkbenchController";
import { createJointWorkbenchDraft, createJointWorkbenchRuntime } from "@/ui/pages/joint-workbench/joint-workbench-state";
import type { JointWorkbenchPhase } from "@/ui/pages/joint-workbench/joint-workbench-types";
import type { WorkbenchRouteControls, WorkbenchRouting } from "@/ui/services/workbench-routing";
import type { SearchHistoryRecord } from "@/ui/services/search-history";
import type { SingleWorkbenchResult, JointWorkbenchResult } from "@/ui/services/workbench-result";
import { gcdAnalysisInputFromConfig, gcdAnalysisKey } from "@/ui/features/job-condition";
import { makeConfig } from "@/ui/services/app-config";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import { workbenchResultFromShare } from "@/ui/services/share-link";

const mocks = vi.hoisted(() => ({ optimize: vi.fn(), optimizeJoint: vi.fn() }));
vi.mock("@/domain", async original => ({ ...(await original<typeof import("@/domain")>()), optimize: mocks.optimize, optimizeJoint: mocks.optimizeJoint }));
let feedback: ReturnType<typeof useFeedback>;
let root: Root, host: HTMLDivElement;
function Probe({ children }: { children?: ReactNode }) { feedback = useFeedback(); return children; }
function render(children?: ReactNode) { act(() => root.render(<FeedbackProvider><Probe>{children}</Probe></FeedbackProvider>)); }
async function flush() { await act(async () => { for (let n = 0; n < 6; n++) await Promise.resolve(); await new Promise(done => setTimeout(done, 0)); }); }
function dialog(title: string) { return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(value => value.textContent?.includes(title)); }
function click(title: string, button: string) {
  const target = [...dialog(title)!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === button)!;
  act(() => target.click());
}
function request(title: string, signal?: AbortSignal) {
  let result!: Promise<boolean>;
  act(() => { result = feedback.confirm({ title, description: `${title}说明`, signal }); });
  return result;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.optimize.mockReset(); mocks.optimizeJoint.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("abortable feedback confirmation", () => {
  it("does not open an already aborted request or replace the current confirmation", async () => {
    render(); const pending = request("当前确认");
    const controller = new AbortController(); controller.abort();
    await expect(request("已失效确认", controller.signal)).resolves.toBe(false);
    expect(dialog("已失效确认")).toBeUndefined(); expect(dialog("当前确认")).toBeDefined();
    click("当前确认", "确认"); await expect(pending).resolves.toBe(true);
  });
  it.each(["确认", "取消"])("removes the signal listener after clicking %s", async button => {
    render(); const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = request("普通确认", controller.signal); expect(dialog("普通确认")).toBeDefined();
    click("普通确认", button); await flush();
    await expect(pending).resolves.toBe(button === "确认"); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(dialog("普通确认")).toBeUndefined();
    act(() => feedback.openAdvancedSettings()); act(() => controller.abort()); await flush();
    expect(dialog("高级设置")).toBeDefined();
  });
  it("settles only the owned request when aborted and preserves unrelated feedback", async () => {
    render(); act(() => feedback.openProblemFeedback());
    const controller = new AbortController(); const pending = request("载入确认", controller.signal);
    act(() => controller.abort()); await flush(); await expect(pending).resolves.toBe(false);
    expect(dialog("载入确认")).toBeUndefined(); expect(dialog("支持与反馈")).toBeDefined();
  });
  it("replacing a confirmation removes its listener and a late abort cannot close the replacement", async () => {
    render(); const first = new AbortController(), second = new AbortController();
    const remove = vi.spyOn(first.signal, "removeEventListener");
    const oldRequest = request("第一项", first.signal), newRequest = request("第二项", second.signal);
    await expect(oldRequest).resolves.toBe(false); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    act(() => first.abort()); await flush(); expect(dialog("第二项")).toBeDefined();
    click("第二项", "确认"); await expect(newRequest).resolves.toBe(true);
  });
  it("unmount resolves false and releases the signal listener", async () => {
    render(); const controller = new AbortController(); const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = request("退出确认", controller.signal);
    act(() => root.render(null)); await expect(pending).resolves.toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

function route<State>(initialState: State) {
  let controls!: WorkbenchRouteControls<State>;
  const routing: WorkbenchRouting<State> = { initialState, publish: vi.fn(), attach(value) { controls = value; return () => {}; } };
  return { routing, get controls() { return controls; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const singleValue = workbenchResultFromShare(restoreShare(fixtures.find(value => value.label === "nin-sync90")!.binary)) as SingleWorkbenchResult;
const jointValue = workbenchResultFromShare(restoreShare(fixtures.find(value => value.label === "combo-caster-joint")!.binary)) as JointWorkbenchResult;
let single: ReturnType<typeof useSingleController>, joint: ReturnType<typeof useJointWorkbenchController>;
function SingleProbe({ routing }: { routing: WorkbenchRouting<SingleState> }) { single = useSingleController(routing); return null; }
function JointProbe({ routing }: { routing: WorkbenchRouting<JointWorkbenchPhase> }) { joint = useJointWorkbenchController(routing); return null; }
function setup(mode: "single" | "joint") {
  const conditions: SingleState = { phase: "conditions", draft: singleDraftFromConfig(makeConfig("NIN")) };
  const draft = createJointWorkbenchDraft(["RDM", "BLM"]);
  const jointConditions: JointWorkbenchPhase = { phase: "conditions", draft, runtime: createJointWorkbenchRuntime(draft.jobs) };
  const singleRoute = route<SingleState>(conditions), jointRoute = route<JointWorkbenchPhase>(jointConditions);
  render(mode === "single" ? <SingleProbe routing={singleRoute.routing} /> : <JointProbe routing={jointRoute.routing} />);
  if (mode === "joint") for (const job of joint.currentConfig!.jobs) {
    act(() => joint.updateCondition(job.jobId, value => ({ ...value, gcd: { mode: "any" } })));
    const key = gcdAnalysisKey(gcdAnalysisInputFromConfig(job));
    act(() => joint.updateGcdRuntime(job.jobId, key, { status: "ready", key, feasibleTiers: [2.5] }));
  }
  const value = mode === "single" ? singleValue : jointValue;
  const record = { id: "saved", status: "completed", kind: mode, config: value.config, result: value.result, startedAtISO: "2026-10-26T00:00:00.000Z", dataVersion: value.dataVersion } as SearchHistoryRecord;
  const search = deferred<unknown>(); (mode === "single" ? mocks.optimize : mocks.optimizeJoint).mockReturnValue(search.promise);
  act(() => { if (mode === "single") void single.start(() => ({ valid: true })); else joint.startSearch(); });
  expect(mode === "single" ? single.state.phase : joint.phase.phase).toBe("progress");
  act(() => { if (mode === "single") void single.loadResult(record); else joint.historyProps.onLoadResult(record); });
  const title = mode === "single" ? "载入搜索记录" : "载入历史记录";
  expect(dialog(title)).toBeDefined();
  const publish = vi.mocked(mode === "single" ? singleRoute.routing.publish : jointRoute.routing.publish);
  return {
    title, publish,
    get state() { return mode === "single" ? single.state : joint.phase; },
    navigate(action: "enter" | "reset" | "leave" | "unmount") {
      act(() => {
        if (action === "unmount") root.render(<FeedbackProvider><Probe /></FeedbackProvider>);
        else if (mode === "single") {
          if (action === "leave") singleRoute.controls.leave();
          else singleRoute.controls.enter(action === "reset" ? { phase: "selection" } : conditions, action === "reset");
        } else if (action === "leave") jointRoute.controls.leave();
        else jointRoute.controls.enter(action === "reset" ? { phase: "selection" } : jointConditions, action === "reset");
      });
    },
    settleSearch() { search.resolve(value.result); },
  };
}
describe.each(["single", "joint"] as const)("%s real history confirmation", mode => {
  it("leaves a newer unrelated confirmation open when its workflow is revoked", async () => {
    const ui = setup(mode), other = request("无关确认");
    ui.navigate("enter"); await flush();
    expect(dialog(ui.title)).toBeUndefined(); expect(dialog("无关确认")).toBeDefined();
    click("无关确认", "取消"); await expect(other).resolves.toBe(false);
    ui.settleSearch(); await flush();
  });
  it.each(["enter", "reset", "leave", "unmount"] as const)("closes the owned dialog on route %s and ignores the late search", async action => {
    const ui = setup(mode); ui.navigate(action); const state = ui.state; ui.publish.mockClear();
    await flush(); expect(dialog(ui.title)).toBeUndefined();
    ui.settleSearch(); await flush(); expect(ui.state).toBe(state); expect(ui.publish).not.toHaveBeenCalled();
  });
});
