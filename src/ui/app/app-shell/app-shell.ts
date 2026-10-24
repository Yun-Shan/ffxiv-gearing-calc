export interface AppShellController {
  attach(): void;
  stylesReady(): Promise<boolean>;
  ready(): void;
  fail(error: unknown): void;
}

declare global {
  interface Window {
    __APP_SHELL__?: AppShellController;
  }
}

/** 构建时将此独立函数内联到 HTML；函数内不能引用模块依赖。 */
export function installAppShell(): void {
  let state: "pending" | "ready" | "failed" = "pending";
  let visible = false;
  let failure: unknown;
  const styleWaiters: ((ready: boolean) => void)[] = [];
  document.documentElement.dataset.appStartup = "pending";

  function render() {
    const shell = document.getElementById("app-shell");
    if (!shell) return;
    shell.hidden = !visible;
    if (state !== "failed") return;
    const status = document.getElementById("app-shell-status")!;
    status.setAttribute("role", "alert");
    status.setAttribute("aria-live", "assertive");
    status.setAttribute("aria-busy", "false");
    document.getElementById("app-shell-indicator")!.textContent = "!";
    document.getElementById("app-shell-title")!.textContent = "应用加载失败";
    document.getElementById("app-shell-message")!.textContent =
      "应用资源或游戏数据加载失败，请重新加载。";
    const messages: string[] = [];
    let cause = failure;
    for (let depth = 0; cause !== undefined && depth < 5; depth++) {
      messages.push(cause instanceof Error ? cause.message : String(cause));
      cause = cause instanceof Error ? cause.cause : undefined;
    }
    document.getElementById("app-shell-error")!.textContent =
      messages.join("\n");
    document.getElementById("app-shell-details")!.hidden = false;
    document.getElementById("app-shell-reload")!.hidden = false;
  }

  const showTimer = window.setTimeout(() => {
    if (state !== "pending") return;
    visible = true;
    render();
  }, 300);

  function stylesLoaded() {
    return [
      ...document.querySelectorAll<HTMLLinkElement>("link[data-app-style]"),
    ].every((link) => link.dataset.appStyle === "ready");
  }

  function settleStyles(ready: boolean) {
    for (const resolve of styleWaiters.splice(0)) resolve(ready);
  }

  function cleanup() {
    window.clearTimeout(showTimer);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("vite:preloadError", onPreloadError);
    document.removeEventListener("load", onLoad, true);
  }

  function fail(error: unknown) {
    if (state !== "pending") return;
    state = "failed";
    visible = true;
    failure = error;
    document.documentElement.dataset.appStartup = "failed";
    cleanup();
    settleStyles(false);
    render();
  }

  function onError(event: Event) {
    const target = event.target;
    if (target instanceof HTMLScriptElement && target.src) {
      fail(new Error(`应用脚本加载失败：${target.src}`));
    } else if (
      target instanceof HTMLLinkElement &&
      target.hasAttribute("data-app-style")
    ) {
      fail(new Error(`应用样式加载失败：${target.href}`));
    } else if (event instanceof ErrorEvent) {
      fail(event.error ?? new Error(event.message));
    }
  }

  function onRejection(event: PromiseRejectionEvent) {
    fail(event.reason);
  }

  function onPreloadError(event: Event) {
    fail((event as Event & { payload: unknown }).payload);
  }

  function onLoad(event: Event) {
    const target = event.target;
    if (
      !(target instanceof HTMLLinkElement) ||
      !target.hasAttribute("data-app-style")
    )
      return;
    target.media = "all";
    target.dataset.appStyle = "ready";
    if (stylesLoaded()) settleStyles(true);
  }

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("vite:preloadError", onPreloadError);
  document.addEventListener("load", onLoad, true);

  window.__APP_SHELL__ = {
    attach() {
      document
        .getElementById("app-shell-reload")!
        .addEventListener("click", () => window.location.reload());
      render();
    },
    stylesReady() {
      if (state === "failed") return Promise.resolve(false);
      if (stylesLoaded()) return Promise.resolve(true);
      return new Promise((resolve) => styleWaiters.push(resolve));
    },
    ready() {
      if (state !== "pending" || !stylesLoaded()) return;
      state = "ready";
      cleanup();
      settleStyles(true);
      document.getElementById("root")!.removeAttribute("inert");
      delete document.documentElement.dataset.appStartup;
      document.getElementById("app-shell")!.remove();
      document.getElementById("app-shell-styles")!.remove();
    },
    fail,
  };
}
