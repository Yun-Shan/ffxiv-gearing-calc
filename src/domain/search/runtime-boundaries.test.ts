import { afterEach, expect, test, vi } from "vitest";
import { throwIfCancelled } from "./cancellation";
import { getMemoryUsageSnapshot } from "./memory-usage";

afterEach(() => vi.unstubAllGlobals());

test("cancellation throws an identifiable abort error and leaves completed work alone", () => {
  expect(() => throwIfCancelled()).not.toThrow();
  expect(() => throwIfCancelled(() => false)).not.toThrow();
  try { throwIfCancelled(() => true); throw new Error("missing abort"); }
  catch (error) { expect(error).toMatchObject({ name: "AbortError", message: "搜索已取消" }); }
});

test("runtime memory measurements never invent browser process RSS", () => {
  vi.stubGlobal("process", { memoryUsage: () => ({ rss: 100, heapUsed: 50 }) });
  expect(getMemoryUsageSnapshot()).toEqual({ rssBytes: 100, heapUsedBytes: 50 });
  vi.stubGlobal("process", undefined);
  vi.stubGlobal("performance", { memory: { usedJSHeapSize: 40 } });
  expect(getMemoryUsageSnapshot()).toEqual({ heapUsedBytes: 40 });
  vi.stubGlobal("performance", {});
  expect(getMemoryUsageSnapshot()).toEqual({});
});
