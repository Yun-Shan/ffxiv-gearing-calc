// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scheduleResourcePreload } from "./resource-preload";

let idle: (() => void) | undefined;
const requestIdleCallback = vi.fn((callback: () => void) => {
  idle = callback;
  return 1;
});
const readBody = vi.fn(async () => new ArrayBuffer(0));
const fetchResource = vi.fn(async (_url: string, _options?: RequestInit) => ({
  ok: true,
  arrayBuffer: readBody,
}));

function manifest(resources: unknown) {
  const node = document.createElement("script");
  node.id = "app-preload-resources";
  node.type = "application/json";
  node.textContent = JSON.stringify(resources);
  document.head.append(node);
}

beforeEach(() => {
  idle = undefined;
  vi.stubGlobal("requestIdleCallback", requestIdleCallback);
  vi.stubGlobal("fetch", fetchResource);
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([]);
});
afterEach(() => {
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("waits for idle, deduplicates URLs and consumes resources without starting a worker", async () => {
  const Worker = vi.fn();
  vi.stubGlobal("Worker", Worker);
  const resources = [
    "/worker.js",
    "/highs.js",
    "/highs.wasm",
    "./snapdom.js",
    "./share-layout.css",
    "/data.bin",
  ];
  manifest([...resources, "/worker.js"]);
  scheduleResourcePreload();
  scheduleResourcePreload();
  expect(requestIdleCallback).toHaveBeenCalledOnce();
  expect(fetchResource).not.toHaveBeenCalled();
  idle!();
  await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(resources.length));
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual(
    resources.map((url) => new URL(url, document.baseURI).href),
  );
  expect(fetchResource).toHaveBeenCalledWith(expect.any(String), {
    cache: "force-cache",
    credentials: "same-origin",
    priority: "low",
  });
  expect(Worker).not.toHaveBeenCalled();
});

it("skips already loaded modules and continues after speculative network failures", async () => {
  vi.mocked(performance.getEntriesByName).mockImplementation((url) =>
    url.endsWith("shared.js") ? [{} as PerformanceEntry] : [],
  );
  fetchResource.mockRejectedValueOnce(new TypeError("network failed"));
  manifest(["/shared.js", "/worker.js", "/highs.wasm"]);
  scheduleResourcePreload();
  idle!();
  await vi.waitFor(() => expect(readBody).toHaveBeenCalledOnce());
  expect(fetchResource).toHaveBeenCalledTimes(2);
});

it("falls back to a delayed background task when idle callbacks are unavailable", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  manifest(["/worker.js"]);
  scheduleResourcePreload();
  await vi.advanceTimersByTimeAsync(999);
  expect(fetchResource).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(readBody).toHaveBeenCalledOnce();
});

it("ignores absent or invalid manifests", () => {
  scheduleResourcePreload();
  manifest({ invalid: true });
  scheduleResourcePreload();
  expect(requestIdleCallback).not.toHaveBeenCalled();
  expect(fetchResource).not.toHaveBeenCalled();
});
