export type MemoryUsageSnapshot = {
  rssBytes?: number;
  heapUsedBytes?: number;
};

/** 仅返回当前运行时实际提供的内存测量值。 */
export function getMemoryUsageSnapshot(): MemoryUsageSnapshot {
  const runtimeProcess = (
    globalThis as typeof globalThis & {
      process?: { memoryUsage?: () => { rss: number; heapUsed: number } };
    }
  ).process;
  if (typeof runtimeProcess?.memoryUsage === "function") {
    const { rss, heapUsed } = runtimeProcess.memoryUsage();
    return { rssBytes: rss, heapUsedBytes: heapUsed };
  }

  const browserMemory = (
    globalThis.performance as Performance & {
      memory?: { jsHeapSizeLimit?: number; totalJSHeapSize?: number; usedJSHeapSize?: number };
    }
  ).memory;
  if (browserMemory?.usedJSHeapSize !== undefined) {
    return { heapUsedBytes: browserMemory.usedJSHeapSize };
  }

  return {};
}
