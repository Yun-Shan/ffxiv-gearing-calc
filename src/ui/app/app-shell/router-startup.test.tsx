// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAppShell } from "./app-shell";

const { preload, roots } = vi.hoisted(() => ({
  preload: vi.fn(),
  roots: [] as import("react-dom/client").Root[],
}));
vi.mock("../../services/resource-preload", () => ({
  scheduleResourcePreload: preload,
}));
vi.mock("react-dom/client", async (original) => {
  const client = await original<typeof import("react-dom/client")>();
  return {
    ...client,
    createRoot(...args: Parameters<typeof client.createRoot>) {
      const root = client.createRoot(...args);
      roots.push(root);
      return root;
    },
  };
});
const markup = readFileSync(
  resolve("src/ui/app/app-shell/AppShell.html"),
  "utf8",
);
let cleanupRouter: (() => void) | undefined;
let restoreRoute: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  preload.mockReset();
  document.head.innerHTML = '<style id="app-shell-styles"></style>';
  document.body.innerHTML = `${markup}<div id="root" inert></div>`;
  window.sessionStorage.clear();
  installAppShell();
  window.__APP_SHELL__!.attach();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  cleanupRouter?.();
  cleanupRouter = undefined;
  restoreRoute?.();
  restoreRoute = undefined;
  window.__APP_SHELL__?.fail(new Error("test cleanup"));
  delete window.__APP_SHELL__;
  delete document.documentElement.dataset.appStartup;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function realRouterEntry() {
  // All React/router modules come from the same post-reset module graph. Only
  // the factory seam is replaced; App, RouterProvider and createRoot stay real.
  const app = await import("../App");
  const { createMemoryHistory } = await import("@tanstack/react-router");
  const router = app.createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/about"] }),
    restore: false,
  });
  cleanupRouter = () => router.history.destroy();
  vi.spyOn(app, "createAppRouter").mockReturnValue(router);
  const route = router.routesByPath["/about"];
  const original = { ...route.options };
  restoreRoute = () => {
    route.options = original;
  };
  return { router, route };
}

function expectStartupFailure(error: Error) {
  expect(window.__APP_SHELL__!.fail).toHaveBeenCalledWith(error);
  expect(document.documentElement.dataset.appStartup).toBe("failed");
  expect(document.getElementById("app-shell")!.hidden).toBe(false);
  expect(document.getElementById("app-shell-title")!.textContent).toBe(
    "应用加载失败",
  );
  expect(document.getElementById("app-shell-error")!.textContent).toContain(
    error.message,
  );
  expect(document.getElementById("app-shell-reload")!.hidden).toBe(false);
  expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
  expect(document.getElementById("root")!.childElementCount).toBe(0);
  expect(preload).not.toHaveBeenCalled();
}

describe("real router initial commit and startup shell", () => {
  it.each(["component render", "beforeLoad"] as const)(
    "retains the failed reload shell when the initial route fails in %s",
    async (phase) => {
      const { route } = await realRouterEntry();
      const error = new Error(`real initial route ${phase} failed`);
      const fail = vi.spyOn(window.__APP_SHELL__!, "fail");
      if (phase === "component render")
        route.options.component = () => {
          throw error;
        };
      else
        route.options.beforeLoad = () => {
          throw error;
        };

      await import("../../../main");

      expect(fail).toHaveBeenCalled();
      expectStartupFailure(error);
    },
  );

  it("keeps the pending shell until a real initial loader and route commit finish", async () => {
    const { route } = await realRouterEntry();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((done) => {
      started = done;
    });
    route.options.beforeLoad = () =>
      new Promise<void>((done) => {
        release = done;
        started();
      });
    const ready = vi.spyOn(window.__APP_SHELL__!, "ready");
    const entry = import("../../../main");
    await waiting;
    expect(document.documentElement.dataset.appStartup).toBe("pending");
    expect(document.getElementById("app-shell")).not.toBeNull();
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
    expect(document.getElementById("root")!.childElementCount).toBe(0);
    expect(ready).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();

    release();
    await entry;

    expect(document.querySelector("#root h1")?.textContent).toBe(
      "关于自动配装器",
    );
    expect(document.getElementById("app-shell")).toBeNull();
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(false);
    expect(ready).toHaveBeenCalledOnce();
    expect(preload).toHaveBeenCalledOnce();
  });
});
