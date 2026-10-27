// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ResultShareData } from "@/ui/components/results/result-share-layout/types";

const modules = vi.hoisted(() => ({ screenshot: vi.fn(), layout: vi.fn() }));

let idle: (() => void) | undefined;
const requestIdleCallback = vi.fn((callback: () => void) => {
  idle = callback;
  return 1;
});
const toBlob = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
const write = vi.fn(async (items: { image: Promise<Blob> }[]) => {
  await items[0]!.image;
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  idle = undefined;
  modules.screenshot.mockReset().mockResolvedValue({ snapdom: { toBlob } });
  modules.layout.mockReset().mockResolvedValue({
    ResultShareLayout: () =>
      createElement("div", { "data-result-share-layout": "" }),
  });
  vi.doMock("@zumer/snapdom", () => modules.screenshot());
  vi.doMock("@/ui/components/results/result-share-layout/ResultShareLayout", () =>
    modules.layout(),
  );
  vi.stubGlobal("requestIdleCallback", requestIdleCallback);
  vi.stubGlobal(
    "navigator",
    new Proxy(navigator, {
      get: (target, property) =>
        property === "clipboard"
          ? { write }
          : Reflect.get(target, property, target),
    }),
  );
  vi.stubGlobal(
    "ClipboardItem",
    class {
      image: Promise<Blob>;
      constructor(data: Record<string, Promise<Blob>>) {
        this.image = data["image/png"]!;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("waits for idle and reuses initialization while pending and after completion", async () => {
  let finish!: (module: { snapdom: { toBlob: typeof toBlob } }) => void;
  modules.screenshot.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const service = await import("./share-result");
  service.scheduleResultImageInitialization();
  service.scheduleResultImageInitialization();
  expect(requestIdleCallback).toHaveBeenCalledOnce();
  expect(modules.screenshot).not.toHaveBeenCalled();
  expect(modules.layout).not.toHaveBeenCalled();
  idle!();
  await vi.waitFor(() => expect(modules.screenshot).toHaveBeenCalledOnce());
  service.scheduleResultImageInitialization();
  expect(requestIdleCallback).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-result-share-layout]")).toBeNull();
  expect(write).not.toHaveBeenCalled();
  expect(toBlob).not.toHaveBeenCalled();

  const copying = service.copyResultImage({} as ResultShareData);
  expect(write).toHaveBeenCalledOnce();
  finish({ snapdom: { toBlob } });
  await copying;
  service.scheduleResultImageInitialization();
  expect(requestIdleCallback).toHaveBeenCalledOnce();
  expect(modules.screenshot).toHaveBeenCalledOnce();
  expect(modules.layout).toHaveBeenCalledOnce();
  expect(toBlob).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-result-share-layout]")).toBeNull();
});

it("reuses a manual copy started before the idle task runs", async () => {
  const service = await import("./share-result");
  service.scheduleResultImageInitialization();
  await service.copyResultImage({} as ResultShareData);
  idle!();
  await vi.dynamicImportSettled();
  expect(modules.screenshot).toHaveBeenCalledOnce();
  expect(modules.layout).toHaveBeenCalledOnce();
  expect(toBlob).toHaveBeenCalledOnce();
});

it("uses a delayed fallback when requestIdleCallback is unavailable", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  const service = await import("./share-result");
  service.scheduleResultImageInitialization();
  service.scheduleResultImageInitialization();
  await vi.advanceTimersByTimeAsync(999);
  expect(modules.screenshot).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  vi.useRealTimers();
  await vi.dynamicImportSettled();
  expect(modules.screenshot).toHaveBeenCalledOnce();
  expect(modules.layout).toHaveBeenCalledOnce();
  expect(toBlob).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it("handles speculative failure and allows another attempt on a later entry", async () => {
  modules.screenshot.mockRejectedValueOnce(new TypeError("network failed"));
  const service = await import("./share-result");
  service.scheduleResultImageInitialization();
  idle!();
  await vi.dynamicImportSettled();
  expect(modules.screenshot).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();

  // Release Vitest's failed mock evaluation; retain the original service instance
  // to verify that its failed initialization promise was cleared.
  vi.resetModules();
  vi.doMock("@zumer/snapdom", () => modules.screenshot());
  service.scheduleResultImageInitialization();
  expect(requestIdleCallback).toHaveBeenCalledTimes(2);
  idle!();
  await vi.dynamicImportSettled();
  expect(modules.screenshot).toHaveBeenCalledTimes(2);
  await service.copyResultImage({} as ResultShareData);
  expect(toBlob).toHaveBeenCalledOnce();
});
