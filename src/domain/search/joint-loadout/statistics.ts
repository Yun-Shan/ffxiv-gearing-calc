import { getMemoryUsageSnapshot } from "../memory-usage.ts";
import type { JointLoadoutV3Statistics, MutableStatistics } from "./types.ts";

export function statisticsSnapshot(
  mutable: MutableStatistics,
  startedAt: number,
  timeLimitMs: number | undefined,
  cacheLimit: number,
  cacheEntries: number,
): JointLoadoutV3Statistics {
  return {
    ...mutable,
    elapsedMs: performance.now() - startedAt,
    ...(timeLimitMs === undefined ? {} : { timeLimitMs }),
    cacheLimit,
    cacheEntries,
    ...getMemoryUsageSnapshot(),
  };
}
