import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OptimizationConfig } from "../types.ts";

const mocks = vi.hoisted(() => ({
  findBestLoadoutExactMip: vi.fn(),
  prepareSearch: vi.fn(),
  privateParetoSlots: vi.fn(),
}));

vi.mock("../search/loadout-finder-exact-mip.ts", () => ({
  findBestLoadoutExactMip: mocks.findBestLoadoutExactMip,
}));
vi.mock("./search-preparation.ts", () => ({
  prepareSearch: mocks.prepareSearch,
  privateParetoSlots: mocks.privateParetoSlots,
}));

import { runOptimizationLocally } from "./single-search.ts";

type Prepared = {
  options: Record<string, unknown>;
  slots: { candidates: unknown[] }[];
  foods: unknown[];
  searchedCandidates: number;
};

const brdProfile: OptimizationConfig = {
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

function config(
  profile: OptimizationConfig,
  overrides: Partial<OptimizationConfig> = {},
): OptimizationConfig {
  return { ...profile, ...overrides };
}

async function run(profile: OptimizationConfig): Promise<void> {
  await runOptimizationLocally(profile);
}

beforeEach(() => {
  prepared = {
    options: {
      candidateResourceSupportProfile: "full",
      mainStatResourceSupport: false,
    },
    slots: [{ candidates: [{}] }],
    foods: [{}],
    searchedCandidates: 1,
  };
  mocks.prepareSearch.mockReturnValue(prepared);
  mocks.privateParetoSlots.mockReturnValue(new Set());
  mocks.findBestLoadoutExactMip.mockResolvedValue(undefined);
});

describe("single-search measured resource profiles", () => {
  it.each([
    ["BRD DPS profile", brdProfile, true],
    ["BLM item-level profile", blmProfile, false],
  ] as const)(
    "enables the compact profile only for the exact %s",
    async (_label, profile, mainStat) => {
      await run(profile);

      expect(prepared.options.candidateResourceSupportProfile).toBe("compact");
      expect(prepared.options.mainStatResourceSupport).toBe(mainStat);
    },
  );

  const sharedNearMisses: [string, Partial<OptimizationConfig>][] = [
    ["a GCD target", { gcdTarget: 2.5 }],
    ["a GCD choice", { gcdChoices: [2.5] }],
    ["a minimum speed", { speedMin: 400 }],
    ["a maximum speed", { speedMax: 600 }],
    ["a minimum tenacity", { minTenacity: 400 }],
    ["a mitigation threshold", { toughnessMinPercent: 10 }],
    ["maximum tenacity", { maximizeTenacity: true }],
    ["an excluded source", { excludedSources: ["test"] }],
    ["an excluded gear ID", { excludedGearIds: [1] }],
    ["forced gear", { forcedGear: { weapon: 1 } }],
    ["selected food", { foodId: 1 }],
  ];

  it.each(sharedNearMisses)(
    "keeps the %s configuration on the full profile",
    async (_label, overrides) => {
      await run(config(brdProfile, overrides));
      expect(prepared.options.candidateResourceSupportProfile).toBe("full");
      expect(prepared.options.mainStatResourceSupport).toBe(false);

      prepared.options.candidateResourceSupportProfile = "full";
      prepared.options.mainStatResourceSupport = false;
      await run(config(blmProfile, overrides));
      expect(prepared.options.candidateResourceSupportProfile).toBe("full");
      expect(prepared.options.mainStatResourceSupport).toBe(false);
    },
  );

  it.each([
    ["another job", { jobId: "MCH" }],
    ["a lower minimum item level", { minItemLevel: 769 }],
    ["a higher maximum item level", { maxItemLevel: 796 }],
    ["an active sync target", { sync: { kind: "jobLevel", value: 90 } }],
    ["the damage objective", { objective: "damage" }],
  ] as const)(
    "does not use the BRD profile for %s",
    async (_label, overrides) => {
      await run(config(brdProfile, overrides));
      expect(prepared.options.candidateResourceSupportProfile).toBe("full");
      expect(prepared.options.mainStatResourceSupport).toBe(false);
    },
  );

  it.each([
    ["another job", { jobId: "MCH" }],
    ["a lower minimum item level", { minItemLevel: 729 }],
    ["a higher maximum item level", { maxItemLevel: 796 }],
    ["no sync target", { sync: undefined }],
    ["a job-level target", { sync: { kind: "jobLevel", value: 80 } }],
    ["another item-level target", { sync: { kind: "itemLevel", value: 736 } }],
    ["the DPS objective", { objective: "dps" }],
  ] as const)(
    "does not use the BLM profile for %s",
    async (_label, overrides) => {
      await run(config(blmProfile, overrides));
      expect(prepared.options.candidateResourceSupportProfile).toBe("full");
      expect(prepared.options.mainStatResourceSupport).toBe(false);
    },
  );

  it("returns before solving when prepared gear or food candidates are empty", async () => {
    prepared.slots = [{ candidates: [] }];

    await expect(runOptimizationLocally(brdProfile)).resolves.toBeUndefined();

    expect(mocks.findBestLoadoutExactMip).not.toHaveBeenCalled();
  });
});
