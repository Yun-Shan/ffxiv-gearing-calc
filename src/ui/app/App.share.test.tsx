// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreDocument, restoreShare } from "@/share/restore";
import type { ShareDocument, ShareView } from "@/share/types";
import type { ShareWorkerRequest } from "@/share/worker-protocol";
import { App } from "./App";

const tasks = vi.hoisted(() => ({
  requests: [] as {
    input: ShareWorkerRequest;
    signal: AbortSignal;
    resolve(view: ShareView): void;
    reject(error: Error): void;
  }[],
  optimize: vi.fn(),
  optimizeJoint: vi.fn(),
  saveHistory: vi.fn(),
  replaceHistory: vi.fn(),
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
}));
vi.mock("@/ui/services/search-history", async (original) => ({
  ...(await original<typeof import("@/ui/services/search-history")>()),
  saveCompletedSearchHistory: tasks.saveHistory,
  replaceSearchHistoryResult: tasks.replaceHistory,
}));
const joint = fixtures.find((f) => f.label === "caster-shared")!;
const single = fixtures.find((f) => f.label === "brd-open")!;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  tasks.requests = [];
  tasks.optimize.mockClear();
  tasks.optimizeJoint.mockClear();
  tasks.saveHistory.mockClear();
  tasks.replaceHistory.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", `/?s=${joint.binary}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const nav = (label: string) =>
  [...host.querySelectorAll('nav[aria-label="主导航"] a')].find(
    (a) => a.textContent === label,
  )!;
const resolve = async (index: number, token: string) =>
  act(async () => tasks.requests[index].resolve(restoreShare(token)));
function navigate(url: string) {
  act(() => {
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
function noSearchOrHistory() {
  expect(tasks.optimize).not.toHaveBeenCalled();
  expect(tasks.optimizeJoint).not.toHaveBeenCalled();
  expect(tasks.saveHistory).not.toHaveBeenCalled();
  expect(tasks.replaceHistory).not.toHaveBeenCalled();
}

describe("share input at the application entry", () => {
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
      act(() => root.render(<App />));
      expect(host.textContent).toContain("正在恢复分享结果");
      await resolve(0, fixture.binary);
      expect(window.location.pathname).toBe(path);
      expect(window.location.search).toBe("");
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
      noSearchOrHistory();
    },
  );
  it("keeps unknown conditions at entry until explicitly ignored", async () => {
    const document = structuredClone(single.document) as ShareDocument;
    document.configs[0].excludedSources = [
      "known-source",
      { unknownSourceId: 9999 },
    ];
    act(() => root.render(<App />));
    await act(async () => tasks.requests[0].resolve(restoreDocument(document)));
    expect(host.textContent).toContain("未知来源（9999）");
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
    expect(window.location.pathname).toBe("/single");
    expect(window.location.search).toBe("");
    expect(host.querySelector("h1")?.textContent).toBe("吟游诗人 · 配装结果");
    noSearchOrHistory();
    expect(document.configs[0].excludedSources).toHaveLength(2);
  });
  it("shows invalid synchronization at entry without mounting a result workbench", async () => {
    act(() => root.render(<App />));
    await act(async () =>
      tasks.requests[0].reject(new Error("无效的分享链接：未知同步副本 999")),
    );
    expect(host.querySelector("h1")?.textContent).toBe("无效的分享链接");
    expect(host.textContent).toContain("未知同步副本 999");
    expect(host.querySelector("table")).toBeNull();
    noSearchOrHistory();
    act(() => button("返回搜索").click());
    expect(window.location.search).toBe("");
    expect(host.querySelector("h1")?.textContent).toBe("选择职业");
  });
  it("discards a prior token even when its cancelled worker completes late", async () => {
    act(() => root.render(<App />));
    navigate(`/?s=${single.binary}`);
    expect(tasks.requests[0].signal.aborted).toBe(true);
    await resolve(0, joint.binary);
    expect(host.textContent).toContain("正在恢复分享结果");
    expect(window.location.search).toContain(single.binary);
    await resolve(1, single.binary);
    expect(window.location.pathname).toBe("/single");
    expect(host.querySelector("h1")?.textContent).toBe("吟游诗人 · 配装结果");
    noSearchOrHistory();
  });
  it("does not overwrite ordinary navigation when a worker returns late", async () => {
    act(() => root.render(<App />));
    navigate("/about");
    expect(tasks.requests[0].signal.aborted).toBe(true);
    await resolve(0, joint.binary);
    expect(window.location.pathname).toBe("/about");
    expect(host.querySelector("h1")?.textContent).toBe("关于自动配装器");
    noSearchOrHistory();
  });
  it("handles StrictMode cleanup and does not reimport after leaving the workbench", async () => {
    act(() =>
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    );
    expect(tasks.requests).toHaveLength(2);
    expect(tasks.requests[0].signal.aborted).toBe(true);
    await resolve(0, joint.binary);
    expect(window.location.search).toContain("s=");
    await resolve(1, joint.binary);
    expect(window.location.pathname).toBe("/joint");
    navigate("/about");
    navigate("/joint");
    expect(host.querySelector("h1")?.textContent).not.toBe("联合配装结果");
    expect(tasks.requests).toHaveLength(2);
    noSearchOrHistory();
  });
});
