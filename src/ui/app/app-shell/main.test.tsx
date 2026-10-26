// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAppShell } from "./app-shell";

const { renderApp, preload, routerLoad, createAppRouter, router } = vi.hoisted(
  () => {
    const routerLoad = vi.fn();
    const router = { load: routerLoad };
    return {
      renderApp: vi.fn(),
      preload: vi.fn(),
      routerLoad,
      createAppRouter: vi.fn(() => router),
      router,
    };
  },
);
vi.mock("../App", () => ({ App: () => renderApp(), createAppRouter }));
vi.mock("../../services/resource-preload", () => ({
  scheduleResourcePreload: preload,
}));
const markup = readFileSync(
  resolve("src/ui/app/app-shell/AppShell.html"),
  "utf8",
);

beforeEach(() => {
  vi.resetModules();
  renderApp.mockReset();
  preload.mockReset();
  routerLoad.mockReset().mockResolvedValue(undefined);
  createAppRouter.mockReset().mockReturnValue(router);
  document.head.innerHTML = '<style id="app-shell-styles"></style>';
  document.body.innerHTML = `${markup}<div id="root" inert></div>`;
  installAppShell();
  window.__APP_SHELL__!.attach();
});

afterEach(() => {
  window.__APP_SHELL__?.fail(new Error("test cleanup"));
  delete window.__APP_SHELL__;
  delete document.documentElement.dataset.appStartup;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("真实入口的首次提交", () => {
  it("只有主界面提交成功才移除外壳", async () => {
    const { createElement } = await import("react");
    renderApp.mockImplementation(() => createElement("h1", null, "测试主页面"));
    await import("../../../main");
    expect(createAppRouter).toHaveBeenCalledOnce();
    expect(routerLoad).toHaveBeenCalledOnce();
    expect(document.getElementById("root")!.textContent).toBe("测试主页面");
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(false);
    expect(document.getElementById("app-shell")).toBeNull();
    expect(preload).toHaveBeenCalledOnce();
  });

  it("初始路由仍在加载时保留外壳，加载完成后才挂载、ready 和预取", async () => {
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    let resolveLoad!: () => void;
    routerLoad.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
          markLoadStarted();
        }),
    );
    const ready = vi.spyOn(window.__APP_SHELL__!, "ready");
    const entryLoad = import("../../../main");
    await loadStarted;

    expect(document.documentElement.dataset.appStartup).toBe("pending");
    expect(document.getElementById("app-shell")).not.toBeNull();
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
    expect(renderApp).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();

    resolveLoad();
    await entryLoad;

    expect(renderApp).toHaveBeenCalled();
    expect(ready).toHaveBeenCalledOnce();
    expect(preload).toHaveBeenCalledOnce();
    expect(ready.mock.invocationCallOrder[0]).toBeGreaterThan(
      routerLoad.mock.invocationCallOrder[0],
    );
    expect(preload.mock.invocationCallOrder[0]).toBeGreaterThan(
      ready.mock.invocationCallOrder[0],
    );
  });

  it("初始路由加载拒绝时显示外壳错误且不挂载主界面", async () => {
    const error = new Error("initial route load failed");
    routerLoad.mockRejectedValueOnce(error);
    const fail = vi.spyOn(window.__APP_SHELL__!, "fail");

    await expect(import("../../../main")).rejects.toBe(error);

    expect(fail).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith(error);
    expect(renderApp).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.appStartup).toBe("failed");
    expect(document.getElementById("app-shell")!.hidden).toBe(false);
    expect(document.getElementById("app-shell-error")!.textContent).toContain(
      error.message,
    );
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
  });

  it.each(["render", "ref", "layout", "effect"])(
    "%s 阶段的挂载异常不会被启动成功覆盖",
    async (phase) => {
      const { createElement, useLayoutEffect, useEffect } =
        await import("react");
      const error = new Error(`${phase} mount failed`);
      vi.spyOn(console, "error").mockImplementation(() => {});
      renderApp.mockImplementation(() => {
        useLayoutEffect(() => {
          if (phase === "layout") throw error;
        }, []);
        useEffect(() => {
          if (phase === "effect") throw error;
        }, []);
        if (phase === "render") throw error;
        return createElement("div", {
          ref: (node: HTMLDivElement | null) => {
            if (node && phase === "ref") throw error;
          },
        });
      });
      await import("../../../main");
      expect(document.documentElement.dataset.appStartup).toBe("failed");
      expect(document.getElementById("app-shell")!.hidden).toBe(false);
      expect(document.getElementById("app-shell-error")!.textContent).toContain(
        error.message,
      );
      expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
      expect(document.getElementById("root")!.childElementCount).toBe(0);
      expect(preload).not.toHaveBeenCalled();
    },
  );

  it("入口晚于资源错误完成加载时不再挂载主页面", async () => {
    window.__APP_SHELL__!.fail(new Error("style download failed"));
    await import("../../../main");
    expect(renderApp).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.appStartup).toBe("failed");
  });
});
