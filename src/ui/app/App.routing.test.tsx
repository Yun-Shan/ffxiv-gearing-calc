// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import { workbenchResultFromShare } from "@/ui/services/share-link";
import {
  readWorkbenchSession,
  writeWorkbenchSession,
} from "@/ui/services/workbench-session";
import { makeConfig } from "@/ui/services/app-config";
import { singleDraftFromConfig } from "@/ui/pages/single-workbench/state/useSingleController";
import {
  createJointWorkbenchDraft,
  jointWorkbenchDraftFromConfig,
} from "@/ui/pages/joint-workbench/joint-workbench-state";
import { App, createAppRouter } from "./App";

const mocks = vi.hoisted(() => ({
  optimize: vi.fn(),
  optimizeJoint: vi.fn(),
  gcd: vi.fn(),
}));
vi.mock("@/domain", async (original) => ({
  ...(await original<typeof import("@/domain")>()),
  optimize: mocks.optimize,
  optimizeJoint: mocks.optimizeJoint,
  findFeasibleGcds: mocks.gcd,
}));

let router: ReturnType<typeof createAppRouter> | undefined;
let root: Root;
let host: HTMLDivElement;
let baseElement: HTMLBaseElement | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mocks.optimize.mockReset();
  mocks.optimizeJoint.mockReset();
  mocks.gcd.mockReset().mockResolvedValue([2.5, 2.48]);
  window.sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  router?.history.destroy();
  router = undefined;
  host.remove();
  baseElement?.remove();
  baseElement = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function mount(path: string, restore = false) {
  router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    restore,
  });
  await act(async () => {
    await router!.load();
    root.render(<App router={router!} />);
  });
}
async function navigate(path: string) {
  await act(async () => {
    await router!.navigate({ to: path as "/" });
  });
}
async function click(name: string) {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === name,
  );
  expect(button, `button ${name}`).toBeDefined();
  await act(async () => {
    button!.click();
  });
}
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((done) => window.setTimeout(done, ms));
  });
}
const title = () => host.querySelector("h1")?.textContent;
const path = () => router!.state.location.pathname;
function singleConditions() {
  const draft = singleDraftFromConfig(makeConfig("PLD"));
  draft.condition.gcd = { mode: "any" };
  return { mode: "single", phase: "conditions", draft } as const;
}
function noOptimization() {
  expect(mocks.optimize).not.toHaveBeenCalled();
  expect(mocks.optimizeJoint).not.toHaveBeenCalled();
}
function minimumItemLevelInput() {
  const label = [...host.querySelectorAll("label")].find(
    (item) => item.textContent === "最低装备品级",
  );
  const input = label?.control;
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}
async function enterMinimumItemLevel(value: string, commit: boolean) {
  const input = minimumItemLevelInput();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (commit) input.blur();
  });
}

describe("workbench route integration", () => {
  it.each(["/", "/single"])(
    "keeps the selection alias %s unchanged",
    async (url) => {
      await mount(url);
      expect(path()).toBe(url);
      expect(title()).toBe("选择职业");
      noOptimization();
    },
  );
  it("ignores the legacy hash route", async () => {
    await mount("/#/joint");
    expect(path()).toBe("/");
    expect(title()).toBe("选择职业");
    noOptimization();
  });
  it.each([
    "/single/conditions",
    "/single/progress",
    "/single/result",
    "/joint/conditions",
    "/joint/progress",
    "/joint/result",
  ])(
    "replaces an unavailable %s with the corresponding selection",
    async (url) => {
      await mount(url);
      const mode = url.startsWith("/joint") ? "joint" : "single";
      expect(path()).toBe(`/${mode}`);
      expect(title()).toBe(
        mode === "single" ? "选择职业" : "选择参与联合搜索的职业",
      );
      expect(router!.history.length).toBe(1);
      noOptimization();
    },
  );
  it("replaces unknown paths with root without appending redirect history", async () => {
    await mount("/single/unrecognized");
    expect(path()).toBe("/");
    expect(title()).toBe("选择职业");
    expect(router!.history.length).toBe(1);
  });
  it("can choose a new job after an unknown path redirects within the matching Single parent", async () => {
    await mount("/single");
    await click("武士");
    expect(path()).toBe("/single/conditions");
    await navigate("/single/unrecognized");
    expect(path()).toBe("/");
    expect(title()).toBe("选择职业");
    expect(readWorkbenchSession()).toEqual({});
    await click("骑士");
    expect(path()).toBe("/single/conditions");
    expect(title()).toContain("骑士");
    expect(readWorkbenchSession().session).toMatchObject({
      mode: "single",
      phase: "conditions",
      draft: { jobId: "PLD" },
    });
    noOptimization();
  });
  it("keeps the same conditions view mounted on same-phase navigation and retains the committed Draft", async () => {
    await mount("/");
    await click("武士");
    expect(path()).toBe("/single/conditions");
    const section = host.querySelector("main section");
    expect(section).not.toBeNull();
    const before = readWorkbenchSession().session;
    expect(before).toMatchObject({
      mode: "single",
      phase: "conditions",
      draft: { jobId: "SAM" },
    });
    await navigate("/single/conditions");
    expect(host.querySelector("main section")).toBe(section);
    expect(readWorkbenchSession().session).toEqual(before);
    expect(title()).toContain("武士");
    noOptimization();
  });
  it.each(["/faq", "/joint", "/about"])(
    "clears old conditions on exit to %s",
    async (destination) => {
      await mount("/single");
      await click("武士");
      expect(readWorkbenchSession().session).toMatchObject({
        phase: "conditions",
      });
      await navigate(destination);
      expect(readWorkbenchSession()).toEqual({});
      await navigate("/single/conditions");
      expect(path()).toBe("/single");
      expect(title()).toBe("选择职业");
      noOptimization();
    },
  );
  it("treats a main navigation click as an explicit reset even within Single", async () => {
    await mount("/single");
    await click("武士");
    const nav = host.querySelector<HTMLAnchorElement>(
      'nav[aria-label="主导航"] a',
    );
    await act(async () => {
      nav!.click();
    });
    expect(path()).toBe("/single");
    expect(title()).toBe("选择职业");
    expect(readWorkbenchSession()).toEqual({});
    await navigate("/single/conditions");
    expect(path()).toBe("/single");
    noOptimization();
  });
  it("restores committed incomplete conditions only for an eligible refresh", async () => {
    const saved = singleConditions();
    saved.draft.condition.gcd = { mode: "tiers", tiers: [] };
    expect(writeWorkbenchSession(saved)).toBeUndefined();
    await mount("/single/conditions", true);
    expect(path()).toBe("/single/conditions");
    expect(title()).toContain("骑士");
    expect(readWorkbenchSession().session).toEqual(saved);
    noOptimization();
  });
  it.each(["single", "joint"] as const)(
    "restores %s conditions when the deployment base has the same name",
    async (mode) => {
      baseElement = document.createElement("base");
      baseElement.setAttribute("href", `/${mode}/`);
      document.head.append(baseElement);
      const saved = mode === "single"
        ? singleConditions()
        : {
            mode: "joint" as const,
            phase: "conditions" as const,
            draft: createJointWorkbenchDraft(["RDM", "BLM"]),
          };
      expect(writeWorkbenchSession(saved)).toBeUndefined();

      await mount(`/${mode}/${mode}/conditions`, true);

      expect(path()).toBe(`/${mode}/conditions`);
      expect(router!.history.location.pathname).toBe(`/${mode}/${mode}/conditions`);
      expect(host.querySelector("header img")?.getAttribute("src")).toBe(
        `/${mode}/icons/logo-128.png`,
      );
      expect(
        window.sessionStorage.getItem(
          `ffxiv-gearing-calc:workbench-session:/${mode}/`,
        ),
      ).not.toBeNull();
      expect(title()).toContain(mode === "single" ? "骑士" : "设置联合条件");
      expect(readWorkbenchSession().session).toEqual(saved);
      const activeSingle = host.querySelector(
        'nav[aria-label="主导航"] a[aria-current="page"]',
      );
      expect(activeSingle?.textContent).toBe(mode === "single" ? "单职业搜索" : undefined);
      noOptimization();
    },
  );
  it.each([
    ["/配装/", "/%E9%85%8D%E8%A3%85/"],
    ["/app/../tools/", "/tools/"],
  ])(
    "restores conditions after URL.pathname normalizes deployment base %s",
    async (literal, pathname) => {
      baseElement = document.createElement("base");
      baseElement.setAttribute("href", literal);
      document.head.append(baseElement);
      const saved = singleConditions();
      expect(writeWorkbenchSession(saved)).toBeUndefined();

      await mount(`${pathname}single/conditions`, true);

      expect(path()).toBe("/single/conditions");
      expect(router!.history.location.pathname).toBe(`${pathname}single/conditions`);
      expect(title()).toContain("骑士");
      expect(readWorkbenchSession().session).toEqual(saved);
      expect(
        window.sessionStorage.getItem(
          `ffxiv-gearing-calc:workbench-session:${pathname}`,
        ),
      ).not.toBeNull();
      noOptimization();
    },
  );
  it("does not restore a copied session record on ordinary deep entry", async () => {
    expect(writeWorkbenchSession(singleConditions())).toBeUndefined();
    await mount("/single/conditions");
    expect(path()).toBe("/single");
    expect(title()).toBe("选择职业");
    expect(readWorkbenchSession()).toEqual({});
  });
  it("restores Joint committed conditions without running an optimizer", async () => {
    const saved = {
      mode: "joint",
      phase: "conditions",
      draft: createJointWorkbenchDraft(["RDM", "BLM"]),
    } as const;
    expect(writeWorkbenchSession(saved)).toBeUndefined();
    await mount("/joint/conditions", true);
    expect(path()).toBe("/joint/conditions");
    expect(title()).toBe("设置联合条件");
    expect(readWorkbenchSession().session).toEqual(saved);
    noOptimization();
  });
  it.each([false, true])(
    "refresh respects the numeric commit boundary (blur=%s)",
    async (commit) => {
      const saved = singleConditions();
      const initial = saved.draft.condition.range.minItemLevel;
      const edited = initial + 1;
      writeWorkbenchSession(saved);
      await mount("/single/conditions", true);
      await enterMinimumItemLevel(String(edited), commit);
      expect(minimumItemLevelInput().value).toBe(String(edited));
      expect(readWorkbenchSession().session).toMatchObject({
        phase: "conditions",
        draft: {
          condition: { range: { minItemLevel: commit ? edited : initial } },
        },
      });
      act(() => root.unmount());
      router!.history.destroy();
      root = createRoot(host);
      await mount("/single/conditions", true);
      expect(minimumItemLevelInput().value).toBe(
        String(commit ? edited : initial),
      );
      noOptimization();
    },
  );
  it("immediately warns about a failed session write without navigation and keeps conditions editable", async () => {
    const saved = singleConditions();
    writeWorkbenchSession(saved);
    await mount("/single/conditions", true);
    const savedKey = window.sessionStorage.key(0)!;
    expect(window.sessionStorage.getItem(savedKey)).not.toBeNull();
    const beforePath = path();
    const historyLength = router!.history.length;
    const quota = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Test quota exceeded", "QuotaExceededError");
      });
    const edited = saved.draft.condition.range.minItemLevel + 1;

    await enterMinimumItemLevel(String(edited), true);

    expect(quota).toHaveBeenCalled();
    expect(path()).toBe(beforePath);
    expect(router!.history.length).toBe(historyLength);
    expect(document.body.textContent).toContain(
      "无法使用工作台刷新恢复，刷新后将返回职业选择。",
    );
    expect(window.sessionStorage.getItem(savedKey)).toBeNull();
    expect(readWorkbenchSession()).toEqual({});
    expect(minimumItemLevelInput().value).toBe(String(edited));
    await enterMinimumItemLevel(String(edited + 1), true);
    expect(minimumItemLevelInput().value).toBe(String(edited + 1));
    expect(path()).toBe(beforePath);
    noOptimization();
  });
  it("Back and Forward retain result A and the subsequently committed Draft B content", async () => {
    const fixture = fixtures.find((item) => item.label === "brd-open")!;
    const value = workbenchResultFromShare(restoreShare(fixture.binary));
    if (value.mode !== "single") throw new Error("single fixture expected");
    writeWorkbenchSession({ mode: "single", phase: "result", value });
    await mount("/single/result", true);
    const originalResult = readWorkbenchSession().session;
    expect(originalResult).toMatchObject({ mode: "single", phase: "result" });
    await click("调整条件");
    const edited = value.config.minItemLevel + 1;
    await enterMinimumItemLevel(String(edited), true);
    expect(readWorkbenchSession().session).toMatchObject({
      phase: "conditions",
      draft: { condition: { range: { minItemLevel: edited } } },
    });
    await act(async () => {
      router!.history.back();
    });
    await settle();
    expect(path()).toBe("/single/result");
    expect(title()).toBe("吟游诗人 · 配装结果");
    expect(readWorkbenchSession().session).toEqual(originalResult);
    await act(async () => {
      router!.history.forward();
    });
    await settle();
    expect(path()).toBe("/single/conditions");
    expect(minimumItemLevelInput().value).toBe(String(edited));
    noOptimization();
  });
  it.each(["single", "joint"] as const)(
    "restores %s presentation results from real validated fixtures",
    async (mode) => {
      const fixture = fixtures.find(
        (item) =>
          item.label === (mode === "single" ? "brd-open" : "caster-shared"),
      )!;
      const value = workbenchResultFromShare(restoreShare(fixture.binary));
      expect(value.mode).toBe(mode);
      if (value.mode === "single")
        writeWorkbenchSession({ mode: "single", phase: "result", value });
      else writeWorkbenchSession({ mode: "joint", phase: "result", value });
      await mount(`/${mode}/result`, true);
      expect(path()).toBe(`/${mode}/result`);
      expect(title()).toBe(
        mode === "single" ? "吟游诗人 · 配装结果" : "联合配装结果",
      );
      expect(host.querySelector("table")).not.toBeNull();
      noOptimization();
    },
  );
  it.each(["single", "joint"] as const)(
    "rebuilds missing %s conditions on Back after a result refresh and preserves the result on Forward",
    async (mode) => {
      const fixture = fixtures.find(
        (item) =>
          item.label === (mode === "single" ? "brd-open" : "caster-shared"),
      )!;
      const value = workbenchResultFromShare(restoreShare(fixture.binary));
      if (value.mode === "single")
        writeWorkbenchSession({ mode: "single", phase: "result", value });
      else writeWorkbenchSession({ mode: "joint", phase: "result", value });
      router = createAppRouter({
        history: createMemoryHistory({
          initialEntries: [`/${mode}/conditions`, `/${mode}/result`],
          initialIndex: 1,
        }),
        restore: true,
      });
      await act(async () => {
        await router!.load();
        root.render(<App router={router!} />);
      });
      expect(path()).toBe(`/${mode}/result`);
      const savedResult = readWorkbenchSession().session;
      const expectedDraft =
        value.mode === "single"
          ? singleDraftFromConfig(value.config)
          : jointWorkbenchDraftFromConfig(value.config);
      const initialMinimum =
        value.mode === "single"
          ? value.config.minItemLevel
          : value.config.jobs[0].minItemLevel;

      act(() => router!.history.back());
      await settle();

      expect(path()).toBe(`/${mode}/conditions`);
      expect(minimumItemLevelInput().value).toBe(String(initialMinimum));
      expect(readWorkbenchSession().session).toEqual({
        mode,
        phase: "conditions",
        draft: expectedDraft,
      });
      await enterMinimumItemLevel(String(initialMinimum + 1), true);

      act(() => router!.history.forward());
      await settle();

      expect(path()).toBe(`/${mode}/result`);
      expect(host.querySelector("table")).not.toBeNull();
      expect(readWorkbenchSession().session).toEqual(savedResult);
      noOptimization();
    },
  );
  it("refreshes progress to conditions, without starting a Worker", async () => {
    writeWorkbenchSession(singleConditions());
    await mount("/single/progress", true);
    expect(path()).toBe("/single/conditions");
    expect(title()).toContain("骑士");
    expect(router!.history.length).toBe(1);
    noOptimization();
  });
  it("cancels progress on Back, ignores its late result and never reruns on Forward", async () => {
    const fixture = fixtures.find((item) => item.label === "brd-open")!;
    const value = workbenchResultFromShare(restoreShare(fixture.binary));
    let complete!: (result: unknown) => void;
    mocks.optimize.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    writeWorkbenchSession(singleConditions());
    await mount("/single/conditions", true);
    await settle(230);
    await click("开始搜索");
    await settle();
    expect(mocks.optimize).toHaveBeenCalledTimes(1);
    const signal = mocks.optimize.mock.calls[0][1].signal as AbortSignal;
    expect(path()).toBe("/single/progress");
    await act(async () => {
      router!.history.back();
    });
    await settle();
    expect(signal.aborted).toBe(true);
    expect(path()).toBe("/single/conditions");
    expect(title()).toContain("骑士");
    await act(async () => {
      complete(value.result);
    });
    expect(path()).toBe("/single/conditions");
    await act(async () => {
      router!.history.forward();
    });
    await settle();
    expect(path()).toBe("/single/conditions");
    expect(mocks.optimize).toHaveBeenCalledTimes(1);
    expect(title()).toContain("骑士");
  });
});
