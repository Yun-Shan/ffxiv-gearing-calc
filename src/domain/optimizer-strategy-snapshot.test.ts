import { beforeEach, expect, test, vi } from "vitest";
import type { OptimizationConfig, SearchOptions, SearchStrategyMode } from "./index.ts";

const worker = vi.hoisted(() => ({
  optimizeInWorker: vi.fn<(request: unknown, options: SearchOptions) => Promise<unknown>>(),
}));
vi.mock("./worker-client", () => worker);

import { findFeasibleGcds, optimize, optimizeJoint } from "./optimizer.ts";

const config: OptimizationConfig = {
  jobId: "RDM", clanIndex: 0, minItemLevel: 780, maxItemLevel: 795,
  objective: "damage", maximizeTenacity: false, foodId: 0,
};

const entries = [
  { kind: "single", invoke: (options: SearchOptions) => optimize(config, options) },
  { kind: "joint", invoke: (options: SearchOptions) => optimizeJoint({
    jobs: [config, { ...config, jobId: "BLM" }], commonSlots: [], foodStrategy: "independent", objective: "damage",
  }, options) },
  { kind: "gcds", invoke: (options: SearchOptions) => findFeasibleGcds(config, options) },
] as const;

beforeEach(() => worker.optimizeInWorker.mockReset().mockResolvedValue(undefined));

for (const entry of entries) {
  test.each(["mutate map", "replace settings"] as const)(`${entry.kind} snapshots execution settings before dynamic import: %s`, async (mutation) => {
    const strategies: { equalityQuotient: SearchStrategyMode } = { equalityQuotient: "off" };
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    const options: SearchOptions = { strategies, signal, onProgress };
    const pending = entry.invoke(options);
    expect(worker.optimizeInWorker).not.toHaveBeenCalled();
    if (mutation === "mutate map") strategies.equalityQuotient = "on";
    else options.strategies = { equalityQuotient: "on" };
    await pending;
    expect(worker.optimizeInWorker).toHaveBeenCalledOnce();
    const [request, forwarded] = worker.optimizeInWorker.mock.calls[0]!;
    expect(request).toMatchObject({ kind: entry.kind });
    expect(forwarded).not.toBe(options);
    expect(forwarded.strategies).toMatchObject({ equalityQuotient: "off", sharedStateSearch: "auto" });
    expect(Object.isFrozen(forwarded.strategies)).toBe(true);
    expect(forwarded.signal).toBe(signal);
    expect(forwarded.onProgress).toBe(onProgress);
  });
}
