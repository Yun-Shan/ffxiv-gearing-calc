// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreDocument, restoreShare } from "@/share/restore";
import type { ShareDocument, ShareView } from "@/share/types";
import type { ShareWorkerRequest } from "@/share/worker-protocol";
import { createBrowserHistory } from "@tanstack/react-router";
import { readWorkbenchSession, writeWorkbenchSession } from "@/ui/services/workbench-session";
import { workbenchResultFromShare } from "@/ui/services/share-link";
import { App, createAppRouter } from "./App";

const tasks = vi.hoisted(() => ({
  requests: [] as {
    input: ShareWorkerRequest;
    signal: AbortSignal;
    resolve(view: ShareView): void;
    reject(error: Error): void;
  }[],
  optimize: vi.fn(),
  optimizeJoint: vi.fn(),
  gcd: vi.fn(),
  saveHistory: vi.fn(),
  replaceHistory: vi.fn(),
  initializeImages: vi.fn(),
}));
vi.mock("@/ui/services/share-result", async (original) => ({
  ...(await original<typeof import("@/ui/services/share-result")>()),
  scheduleResultImageInitialization: tasks.initializeImages,
}));
vi.mock("@/ui/services/share-link", async (original) => ({
  ...(await original<typeof import("@/ui/services/share-link")>()),
  runShareTask: vi.fn(
    (input: ShareWorkerRequest, signal: AbortSignal) =>
      new Promise<ShareView>((resolve, reject) =>
        tasks.requests.push({ input, signal, resolve, reject }),
      ),
  ),
}));
vi.mock("@/domain", async (original) => ({
  ...(await original<typeof import("@/domain")>()),
  optimize: tasks.optimize,
  optimizeJoint: tasks.optimizeJoint,
  findFeasibleGcds: tasks.gcd,
}));
vi.mock("@/ui/services/search-history", async (original) => ({
  ...(await original<typeof import("@/ui/services/search-history")>()),
  saveCompletedSearchHistory: tasks.saveHistory,
  replaceSearchHistoryGearIfCurrent: tasks.replaceHistory,
}));
const joint = fixtures.find((f) => f.label === "caster-shared")!;
const single = fixtures.find((f) => f.label === "brd-open")!;
const synced = fixtures.find((f) => f.label === "nin-sync90")!;
let root: Root, host: HTMLDivElement;
let router: ReturnType<typeof createAppRouter> | undefined;
beforeEach(() => {
  window.sessionStorage.clear();
  tasks.requests = [];
  tasks.optimize.mockReset();
  tasks.optimizeJoint.mockReset();
  tasks.saveHistory.mockReset();
  tasks.replaceHistory.mockReset();
  tasks.gcd.mockReset().mockResolvedValue([2.5, 2.48]);
  tasks.initializeImages.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState(null, "", `/?s=${joint.binary}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  router?.history.destroy();
  router = undefined;
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const nav = (label: string) =>
  [...host.querySelectorAll('nav[aria-label="主导航"] a')].find(
    (a) => a.textContent === label,
  )!;
async function replaceGear(currentName: string, nextName: string) {
  const row = [...host.querySelectorAll("tr")].find((item) =>
    item.textContent?.includes(currentName),
  )!;
  const trigger = [...row.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith("可替换"),
  )!;
  await act(async () => trigger.click());
  const popup = [...document.body.querySelectorAll("[aria-label]")].find(
    (item) => item.getAttribute("aria-label") === `${currentName}的可替换装备`,
  )!;
  const option = [...popup.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(nextName),
  )!;
  await act(async () => option.click());
  expect(row.textContent).toContain(nextName);
}
async function waitForNavigation(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((done) => window.setTimeout(done, 0));
    });
    expect(router!.state.status).toBe("idle");
    assertion();
  }, { timeout: 3000 });
}
async function resolve(index: number, token: string) {
  const request = tasks.requests[index];
  const wasAborted = request.signal.aborted;
  const view = restoreShare(token);
  await act(async () => request.resolve(view));
  if (!wasAborted)
    await waitForNavigation(() =>
      expect(router!.state.location.pathname).toBe(`/${view.document.mode}/result`),
    );
}
async function traverse(direction: "back" | "forward", assertion: () => void) {
  act(() => router!.history[direction]());
  await waitForNavigation(assertion);
}
async function mount(strict = false, restore = false) {
  router = createAppRouter({ history: createBrowserHistory(), restore });
  await act(async () => {
    await router!.load();
    root.render(
      strict ? (
        <StrictMode>
          <App router={router!} />
        </StrictMode>
      ) : (
        <App router={router!} />
      ),
    );
  });
}
async function navigate(url: string) {
  const target = new URL(url, window.location.origin);
  await act(async () => {
    await router!.navigate({
      to: target.pathname as "/",
      search: Object.fromEntries(target.searchParams),
    });
  });
}
function expectSharedResult(mode: "single" | "joint", token: string) {
  expect(window.location.pathname).toBe("/");
  expect(new URLSearchParams(window.location.search).get("s")).toBe(token);
  expect(router!.state.location.pathname).toBe(`/${mode}/result`);
}
function noSearchOrHistory() {
  expect(tasks.optimize).not.toHaveBeenCalled();
  expect(tasks.optimizeJoint).not.toHaveBeenCalled();
  expect(tasks.saveHistory).not.toHaveBeenCalled();
  expect(tasks.replaceHistory).not.toHaveBeenCalled();
}

describe("share input at the application entry", () => {
  it.each(["ordinary", "share"])("keeps mobile joint %s results on shared equipment and switches complete job views without routing", async (source) => {
    let small = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      get matches() { return query === "(width < 1000px)" && small; },
      addEventListener(_event: string, listener: () => void) {
        if (query === "(width < 1000px)") listeners.add(listener);
      },
      removeEventListener(_event: string, listener: () => void) {
        listeners.delete(listener);
      },
    }));
    const view = restoreShare(joint.binary);
    const value = workbenchResultFromShare(view);
    if (value.mode !== "joint") throw new Error("Expected joint result");
    if (source === "ordinary") {
      window.history.replaceState(null, "", "/joint/result");
      writeWorkbenchSession({ mode: "joint", phase: "result", value });
      await mount(false, true);
    } else {
      await mount();
      await resolve(0, joint.binary);
    }
    const select = (tab: string) => host.querySelector<HTMLButtonElement>(
      `[role="tab"][data-value="${tab}"]`,
    )!;
    const floating = () => document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="分享配装结果"]',
    );
    expect(select("shared").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('section[aria-label="共享装备"]')).not.toBeNull();
    expect(floating()?.textContent).toBe("");
    expect(host.textContent).not.toContain("当前屏幕过小，可能无法正常使用");
    const url = window.location.href;
    const depth = window.history.length;
    const load = vi.spyOn(router!, "load");
    for (const [index, config] of view.document.configs.entries()) {
      await act(async () => select(config.jobId).click());
      expect(select(config.jobId).getAttribute("aria-selected")).toBe("true");
      const metrics = host.querySelector('section[aria-label="核心指标"]')!;
      expect(metrics.textContent).toContain(view.results[index].effects.damage.toFixed(7));
      expect(metrics.textContent).not.toContain("在配装器打开");
      expect(host.querySelector("table")?.textContent).toContain(view.results[index].food.name);
      expect(host.querySelector("aside")?.textContent).toContain("实际生效条件");
      expect(host.querySelector("aside")?.textContent).not.toContain("公式等级");
      expect(floating()?.textContent).toBe("");
      expect(window.location.href).toBe(url);
      expect(window.history.length).toBe(depth);
    }
    const lastJob = view.document.configs.at(-1)!.jobId;
    await act(async () => {
      small = false;
      for (const listener of listeners) listener();
    });
    expect(floating()).toBeNull();
    expect(select(lastJob).getAttribute("aria-selected")).toBe("true");
    expect(button("分享配装结果")).toBeDefined();
    await act(async () => {
      small = true;
      for (const listener of listeners) listener();
    });
    expect(floating()?.textContent).toBe("");
    expect(select(lastJob).getAttribute("aria-selected")).toBe("true");
    await act(async () => select("shared").click());
    expect(host.querySelector('section[aria-label="联合结果概览"]')).not.toBeNull();
    expect(host.querySelector("aside")?.textContent).toContain("共享条件");
    expect(floating()?.textContent).toBe("");
    expect(load).not.toHaveBeenCalled();
    expect(tasks.requests).toHaveLength(source === "share" ? 1 : 0);
    noSearchOrHistory();
  });
  it.each([
    {
      fixture: single,
      path: "/single",
      title: "吟游诗人 · 配装结果",
      navigation: "单职业搜索",
    },
    {
      fixture: joint,
      path: "/joint",
      title: "联合配装结果",
      navigation: "实验室",
    },
  ])(
    "enters the ordinary $path workbench with its normal actions",
    async ({ fixture, path, title, navigation }) => {
      window.history.replaceState(null, "", `/?s=${fixture.binary}`);
      const depth = window.history.length;
      await mount();
      expect(host.textContent).toContain("正在恢复分享结果");
      expect(tasks.initializeImages).not.toHaveBeenCalled();
      await resolve(0, fixture.binary);
      await vi.waitFor(() => expect(tasks.initializeImages).toHaveBeenCalled());
      expectSharedResult(
        path === "/single" ? "single" : "joint",
        fixture.binary,
      );
      expect(window.history.length).toBe(depth);
      expect(nav(navigation).getAttribute("aria-current")).toBe(
        path === "/single" ? "page" : null,
      );
      expect(host.querySelector("h1")?.textContent).toBe(title);
      expect(button("调整条件")).toBeDefined();
      expect(button("搜索记录")).toBeDefined();
      expect(button("重新选择职业")).toBeDefined();
      expect(host.textContent).not.toContain("原耗时");
      expect(host.textContent).not.toContain("原数据版本");
      expect(host.textContent).not.toContain("以此条件重算");
      noSearchOrHistory();
      await act(async () => button("调整条件").click());
      expect(host.textContent).toContain("开始搜索");
      expect(window.location.pathname).toBe(`${path}/conditions`);
      expect(window.location.search).toBe("");
      noSearchOrHistory();
    },
  );
  it("keeps unknown conditions at entry until explicitly ignored", async () => {
    const document = structuredClone(single.document) as ShareDocument;
    document.configs[0].excludedSources = [
      "known-source",
      { unknownSourceId: 9999 },
    ];
    await mount();
    await act(async () => tasks.requests[0].resolve(restoreDocument(document)));
    expect(host.textContent).toContain("未知来源（9999）");
    expect(tasks.initializeImages).not.toHaveBeenCalled();
    expect(window.location.search).toContain("s=");
    expect(host.querySelector("table")).toBeNull();
    expect(button("调整条件")).toBeUndefined();
    noSearchOrHistory();
    act(() => button("忽略未知来源并继续").click());
    expect(tasks.requests.length).toBe(2);
    const next = tasks.requests[1].input;
    if (!("document" in next))
      throw new Error("Expected resolved document request");
    expect(next.document.configs[0].excludedSources).toEqual(["known-source"]);
    expect(next.document.rows).toEqual(document.rows);
    await act(async () =>
      tasks.requests[1].resolve(restoreDocument(next.document)),
    );
    expectSharedResult("single", joint.binary);
    expect(host.querySelector("h1")?.textContent).toBe("吟游诗人 · 配装结果");
    noSearchOrHistory();
    expect(document.configs[0].excludedSources).toHaveLength(2);
  });
  it("shows invalid synchronization at entry without mounting a result workbench", async () => {
    await mount();
    await act(async () =>
      tasks.requests[0].reject(new Error("无效的分享链接：未知同步副本 999")),
    );
    expect(host.querySelector("h1")?.textContent).toBe("分享链接恢复失败");
    expect(tasks.initializeImages).not.toHaveBeenCalled();
    expect(host.querySelector("main[data-share-error] pre")?.textContent).toContain(
      "未知同步副本 999",
    );
    expect(host.querySelector("main[data-share-error]")).not.toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(button("重新加载")).toBeUndefined();
    expect(button("返回搜索")).toBeUndefined();
    expect(host.querySelector("table")).toBeNull();
    noSearchOrHistory();
    await act(async () => button("返回首页").click());
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(host.querySelector("h1")?.textContent).toBe("选择职业");
  });
  it("discards a prior token even when its cancelled worker completes late", async () => {
    await mount();
    await navigate(`/?s=${single.binary}`);
    expect(tasks.requests[0].signal.aborted).toBe(true);
    await resolve(0, joint.binary);
    expect(host.textContent).toContain("正在恢复分享结果");
    expect(window.location.search).toContain(single.binary);
    await resolve(1, single.binary);
    expectSharedResult("single", single.binary);
    expect(host.querySelector("h1")?.textContent).toBe("吟游诗人 · 配装结果");
    noSearchOrHistory();
  });
  it("does not overwrite ordinary navigation when a worker returns late", async () => {
    await mount();
    await navigate("/about");
    expect(tasks.requests[0].signal.aborted).toBe(true);
    await resolve(0, joint.binary);
    expect(window.location.pathname).toBe("/about");
    expect(host.querySelector("h1")?.textContent).toBe("关于自动配装器");
    noSearchOrHistory();
  });
  it("handles StrictMode cleanup and does not reimport after leaving the workbench", async () => {
    await mount(true);
    expect(tasks.requests).toHaveLength(2);
    expect(tasks.requests[0].signal.aborted).toBe(true);
    await resolve(0, joint.binary);
    expect(window.location.search).toContain("s=");
    await resolve(1, joint.binary);
    expectSharedResult("joint", joint.binary);
    await navigate("/about");
    await navigate("/joint");
    expect(host.querySelector("h1")?.textContent).not.toBe("联合配装结果");
    expect(tasks.requests).toHaveLength(2);
    noSearchOrHistory();
  });
  it("preserves all visible query values while masking the internal result route", async () => {
    const query = `?s=${single.binary}&campaign=001&tag=first&tag=second&empty=`;
    window.history.replaceState(null, "", `/${query}`);
    await mount();
    await resolve(0, single.binary);
    expectSharedResult("single", single.binary);
    expect(window.location.search).toBe(query);
    expect(new URLSearchParams(window.location.search).getAll("tag")).toEqual([
      "first",
      "second",
    ]);
    noSearchOrHistory();
  });
  it("updates the share token on repeated gear replacements without routing or adding history", async () => {
    window.history.replaceState(
      null,
      "",
      `/?s=${synced.binary}&s=ignored&campaign=001&tag=first&tag=second&empty=`,
    );
    await mount();
    await resolve(0, synced.binary);
    const view = restoreShare(synced.binary);
    const gear = view.results[0].gear.find((item) => item.slot === "head")!;
    const replacement = view.results[0].equivalentGear![
      gear.replacementGroupKey!
    ]!.find((item) => item.id !== gear.id)!;
    const depth = window.history.length;
    const location = router!.state.location;
    const load = vi.spyOn(router!, "load");
    const navigateSpy = vi.spyOn(router!, "navigate");
    const prepare = vi.spyOn(router!.options.context.workflow, "prepare");
    let token = synced.binary;
    for (const [current, next] of [
      [gear, replacement],
      [replacement, gear],
    ]) {
      await replaceGear(current.name, next.name);
      const query = new URLSearchParams(window.location.search);
      const nextToken = query.get("s")!;
      expect(nextToken).not.toBe(token);
      expect(query.getAll("s")).toEqual([nextToken]);
      expect(
        restoreShare(nextToken).results[0].gear.find(
          (item) => item.slot === "head",
        )?.id,
      ).toBe(next.id);
      expect(query.get("campaign")).toBe("001");
      expect(query.getAll("tag")).toEqual(["first", "second"]);
      expect(query.get("empty")).toBe("");
      expectSharedResult("single", nextToken);
      expect(router!.history.location.search).toBe(window.location.search);
      expect(router!.state.location).toBe(location);
      expect(window.history.length).toBe(depth);
      expect(load).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(tasks.requests).toHaveLength(1);
      noSearchOrHistory();
      token = nextToken;
    }
    await act(async () => button("调整条件").click());
    expect(window.location.search).toBe("");
    await traverse("back", () => expectSharedResult("single", token));
    expect(tasks.requests).toHaveLength(1);
    expect(host.textContent).toContain(gear.name);
    noSearchOrHistory();
  });
  it("restores replacement gear from the updated token on refresh and browser history return", async () => {
    window.history.replaceState(null, "", `/?s=${synced.binary}`);
    await mount();
    await resolve(0, synced.binary);
    const view = restoreShare(synced.binary);
    const gear = view.results[0].gear.find((item) => item.slot === "head")!;
    const replacement = view.results[0].equivalentGear![
      gear.replacementGroupKey!
    ]!.find((item) => item.id !== gear.id)!;
    await replaceGear(gear.name, replacement.name);
    const token = new URLSearchParams(window.location.search).get("s")!;
    await navigate("/about");
    await traverse("back", () => expect(tasks.requests).toHaveLength(2));
    expect(tasks.requests[1].input).toEqual({ token });
    await resolve(1, token);
    expectSharedResult("single", token);
    expect(host.textContent).toContain(replacement.name);

    act(() => root.unmount());
    router!.history.destroy();
    root = createRoot(host);
    await mount(false, true);
    expect(tasks.requests).toHaveLength(3);
    expect(tasks.requests[2].input).toEqual({ token });
    await resolve(2, token);
    expectSharedResult("single", token);
    expect(host.textContent).toContain(replacement.name);
    noSearchOrHistory();
  });
  it("decodes the visible token again on refresh ahead of the saved workbench result", async () => {
    await mount();
    await resolve(0, joint.binary);
    expectSharedResult("joint", joint.binary);
    expect(window.sessionStorage.length).toBeGreaterThan(0);
    act(() => root.unmount());
    router!.history.destroy();
    // A fresh document retains the address bar and sessionStorage, without the
    // prior router's in-memory controller or internal mask state.
    window.history.replaceState(null, "", `/?s=${single.binary}`);
    root = createRoot(host);
    await mount(false, true);
    expect(tasks.requests).toHaveLength(2);
    expect(tasks.requests[1].input).toMatchObject({ token: single.binary });
    expect(host.textContent).toContain("正在恢复分享结果");
    await resolve(1, single.binary);
    expectSharedResult("single", single.binary);
    expect(host.querySelector("h1")?.textContent).toBe("吟游诗人 · 配装结果");
    noSearchOrHistory();
  });
  it("returns through browser history to the original token rather than a later result", async () => {
    await mount();
    await resolve(0, joint.binary);
    await navigate("/about");
    await navigate(`/?s=${single.binary}`);
    await resolve(1, single.binary);
    expectSharedResult("single", single.binary);
    await traverse("back", () =>
      expect(host.querySelector("h1")?.textContent).toBe("关于自动配装器"),
    );
    await traverse("back", () => expect(tasks.requests).toHaveLength(3));
    expect(tasks.requests[2].input).toMatchObject({ token: joint.binary });
    await resolve(2, joint.binary);
    expectSharedResult("joint", joint.binary);
    expect(host.querySelector("h1")?.textContent).toBe("联合配装结果");
    noSearchOrHistory();
  });
  it("keeps edited Draft B after re-decoding share A behind a later ordinary search B", async () => {
    window.history.replaceState(null, "", `/?s=${single.binary}`);
    await mount();
    await resolve(0, single.binary);
    const shareA = readWorkbenchSession().session;
    expect(shareA).toMatchObject({ mode: "single", phase: "result" });
    if (shareA?.mode !== "single" || shareA.phase !== "result")
      throw new Error("Expected validated single share A");
    const resultB = {
      ...structuredClone(shareA.value.result),
      searchedCandidates: 1,
      statistics: { elapsedMs: 1250 },
    };
    // The original real loadout remains legal when lowering only the minimum
    // item level. Different timings make A and the ordinary result B visible.
    tasks.optimize.mockResolvedValue(resultB);
    tasks.saveHistory.mockImplementation(async (input) => ({
      ...structuredClone(input),
      id: "ordinary-search-b",
      status: "completed",
    }));
    await act(async () => button("调整条件").click());
    const minimum = () => {
      const label = [...host.querySelectorAll("label")].find(
        (item) => item.textContent === "最低装备品级",
      );
      return label!.control as HTMLInputElement;
    };
    const edited = shareA.value.config.minItemLevel - 1;
    await act(async () => {
      const input = minimum();
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, String(edited));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      await new Promise((done) => window.setTimeout(done, 230));
    });
    expect(readWorkbenchSession().session).toMatchObject({
      phase: "conditions",
      draft: { condition: { range: { minItemLevel: edited } } },
    });
    expect(button("开始搜索").disabled).toBe(false);
    await act(async () => button("开始搜索").click());
    expect(tasks.optimize).toHaveBeenCalledTimes(1);
    expect(tasks.optimize.mock.calls[0][0].minItemLevel).toBe(edited);
    expect(tasks.saveHistory).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/single/result");
    expect(window.location.search).toBe("");
    expect(host.textContent).toContain("耗时 1.3 秒");
    await traverse("back", () =>
      expect(router!.state.location.pathname).toBe("/single/conditions"),
    );
    expect(minimum().value).toBe(String(edited));
    await traverse("back", () => expect(tasks.requests).toHaveLength(2));
    expect(tasks.requests[1].input).toEqual({ token: single.binary });
    expect(host.textContent).toContain("正在恢复分享结果");
    await resolve(1, single.binary);
    expectSharedResult("single", single.binary);
    expect(host.querySelector("h1")?.textContent).toBe("吟游诗人 · 配装结果");
    expect(host.textContent).toContain("耗时 14.3 秒");
    expect(host.textContent).not.toContain("耗时 1.3 秒");
    expect(readWorkbenchSession().session).toEqual(shareA);
    await traverse("forward", () =>
      expect(router!.state.location.pathname).toBe("/single/conditions"),
    );
    expect(minimum().value).toBe(String(edited));
    expect(readWorkbenchSession().session).toMatchObject({
      phase: "conditions",
      draft: { condition: { range: { minItemLevel: edited } } },
    });
    expect(tasks.optimize).toHaveBeenCalledTimes(1);
    expect(tasks.saveHistory).toHaveBeenCalledTimes(1);
    expect(tasks.requests).toHaveLength(2);
  });
});
