// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAppShell } from "./app-shell";

const markup = readFileSync(
  resolve("src/ui/app/app-shell/AppShell.html"),
  "utf8",
);

function attach() {
  document.body.innerHTML = `${markup}<div id="root" inert></div>`;
  window.__APP_SHELL__!.attach();
}

function stylesheet(optional = false) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.media = "print";
  if (!optional) link.dataset.appStyle = "pending";
  document.head.append(link);
  return link;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '<style id="app-shell-styles"></style>';
  document.body.innerHTML = "";
  installAppShell();
  attach();
});

afterEach(() => {
  window.__APP_SHELL__?.fail(new Error("test cleanup"));
  delete window.__APP_SHELL__;
  delete document.documentElement.dataset.appStartup;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("HTML 启动外壳", () => {
  it("等待满 300ms 才显示加载页", () => {
    vi.advanceTimersByTime(299);
    expect(document.getElementById("app-shell")!.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(document.getElementById("app-shell")!.hidden).toBe(false);
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
  });

  it("快速启动移除外壳并取消延迟提示，启动后不接管错误", () => {
    vi.advanceTimersByTime(50);
    window.__APP_SHELL__!.ready();
    vi.advanceTimersByTime(500);
    expect(document.getElementById("app-shell")).toBeNull();
    expect(document.getElementById("app-shell-styles")).toBeNull();
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(false);
    window.dispatchEvent(new Event("vite:preloadError"));
    expect(document.documentElement.dataset.appStartup).toBeUndefined();
  });

  it("所有必要样式就绪之前不允许挂载或隐藏外壳", async () => {
    const first = stylesheet();
    const second = stylesheet();
    const canMount = vi.fn();
    const waiting = window.__APP_SHELL__!.stylesReady().then(canMount);
    first.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(first.media).toBe("all");
    expect(canMount).not.toHaveBeenCalled();
    window.__APP_SHELL__!.ready();
    expect(document.getElementById("app-shell")).not.toBeNull();
    second.dispatchEvent(new Event("load"));
    await waiting;
    expect(canMount).toHaveBeenCalledWith(true);
  });

  it("样式下载失败立即提示、拒绝挂载，迟到的成功不能覆盖错误", async () => {
    const link = stylesheet();
    const waiting = window.__APP_SHELL__!.stylesReady();
    link.dispatchEvent(new Event("error"));
    expect(await waiting).toBe(false);
    link.dispatchEvent(new Event("load"));
    window.__APP_SHELL__!.ready();
    vi.advanceTimersByTime(1000);
    expect(document.documentElement.dataset.appStartup).toBe("failed");
    expect(document.getElementById("app-shell")!.hidden).toBe(false);
    expect(document.getElementById("app-shell-title")!.textContent).toBe(
      "应用加载失败",
    );
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
    expect(await window.__APP_SHELL__!.stylesReady()).toBe(false);
  });

  it("入口脚本下载失败时不依赖 React 提示错误", () => {
    const script = document.createElement("script");
    script.src = "/assets/main.js";
    document.head.append(script);
    script.dispatchEvent(new Event("error"));
    expect(document.getElementById("app-shell-error")!.textContent).toContain(
      "应用脚本加载失败",
    );
    expect(document.getElementById("app-shell-reload")!.hidden).toBe(false);
  });

  it("在 HTML 正文解析前发生的错误也会保留并显示安全文本", () => {
    document.body.innerHTML = "";
    window.__APP_SHELL__!.fail(
      new Error("数据载入失败", {
        cause: new Error("<img src=x onerror=alert(1)>"),
      }),
    );
    attach();
    expect(document.getElementById("app-shell")!.hidden).toBe(false);
    expect(document.getElementById("app-shell-error")!.textContent).toContain(
      "<img src=x",
    );
    expect(document.querySelector("#app-shell-error img")).toBeNull();
  });

  it.each(["unhandledrejection", "vite:preloadError"])(
    "处理启动期间的 %s",
    (type) => {
      const error = new Error("数据初始化失败");
      const event = new Event(type);
      Object.defineProperty(
        event,
        type === "unhandledrejection" ? "reason" : "payload",
        { value: error },
      );
      window.dispatchEvent(event);
      expect(document.getElementById("app-shell-error")!.textContent).toBe(
        error.message,
      );
    },
  );

  it("图片和非关键字体样式失败不阻断启动", async () => {
    const image = document.createElement("img");
    document.body.append(image);
    image.dispatchEvent(new Event("error"));
    stylesheet(true).dispatchEvent(new Event("error"));
    expect(await window.__APP_SHELL__!.stylesReady()).toBe(true);
    window.__APP_SHELL__!.ready();
    expect(document.documentElement.dataset.appStartup).toBeUndefined();
  });
});
