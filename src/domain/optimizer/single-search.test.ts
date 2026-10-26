import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OptimizationConfig } from "../types.ts";

const mocks = vi.hoisted(() => ({
  findBestLoadoutExactMip: vi.fn(),
  prepareSearch: vi.fn(),
  privateParetoSlots: vi.fn(),
  assembleResult: vi.fn(),
  attachEquivalentGear: vi.fn(),
}));

vi.mock("../search/loadout-finder-exact-mip.ts", () => ({
  findBestLoadoutExactMip: mocks.findBestLoadoutExactMip,
}));
vi.mock("./search-preparation.ts", () => ({
  prepareSearch: mocks.prepareSearch,
  privateParetoSlots: mocks.privateParetoSlots,
}));
vi.mock("./result-assembly.ts", () => ({ assembleResult: mocks.assembleResult }));
vi.mock("./equivalent-gear.ts", () => ({ attachEquivalentGear: mocks.attachEquivalentGear }));

import { runOptimizationLocally } from "./single-search.ts";

type Prepared = {
  options: Record<string, unknown>;
  slots: { candidates: unknown[] }[];
  foods: unknown[];
  searchedCandidates: number;
};

const brdProfile: OptimizationConfig = {
  clanIndex: 0,
  jobId: "BRD",
  minItemLevel: 770,
  maxItemLevel: 795,
  objective: "dps",
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  foodId: 0,
};

const blmProfile: OptimizationConfig = {
  clanIndex: 0,
  jobId: "BLM",
  minItemLevel: 730,
  maxItemLevel: 795,
  sync: { kind: "itemLevel", value: 735 },
  objective: "damage",
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  foodId: 0,
};

let prepared: Prepared;

beforeEach(() => {
  prepared = {
    options: { candidateResourceSupportProfile: "balanced" },
    slots: [{ candidates: [{}] }],
    foods: [{}],
    searchedCandidates: 1,
  };
  mocks.prepareSearch.mockReturnValue(prepared);
  mocks.privateParetoSlots.mockReturnValue(new Set());
  mocks.findBestLoadoutExactMip.mockResolvedValue(undefined);
});

describe("single-search coordination", () => {
  it("measures candidate preparation, solving, reconstruction and equivalent gear from the domain entry", async () => {
    let now = 100;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const solverStatistics = { elapsedMs: 40, solverRuns: 2 };
    mocks.prepareSearch.mockImplementationOnce(() => { now += 20; return prepared; });
    mocks.findBestLoadoutExactMip.mockImplementationOnce(async () => {
      now += 40;
      return { statistics: solverStatistics };
    });
    mocks.assembleResult.mockImplementationOnce(() => {
      now += 10;
      return { statistics: { ...solverStatistics } };
    });
    mocks.attachEquivalentGear.mockImplementationOnce((result) => { now += 30; return result; });
    try {
      const completed = await runOptimizationLocally(brdProfile);
      expect(completed?.statistics).toEqual({ elapsedMs: 100, solverRuns: 2 });
      expect(solverStatistics.elapsedMs).toBe(40);
    } finally {
      clock.mockRestore();
    }
  });
  it.each([brdProfile, blmProfile])("uses prepared solver options for $jobId", async (profile) => {
    const originalOptions = structuredClone(prepared.options);
    await runOptimizationLocally(profile);

    expect(mocks.findBestLoadoutExactMip).toHaveBeenCalledWith(prepared.options);
    expect(prepared.options).toEqual(originalOptions);
  });

  it("returns before solving when prepared gear or food candidates are empty", async () => {
    prepared.slots = [{ candidates: [] }];

    await expect(runOptimizationLocally(brdProfile)).resolves.toBeUndefined();

    expect(mocks.findBestLoadoutExactMip).not.toHaveBeenCalled();
  });
});
