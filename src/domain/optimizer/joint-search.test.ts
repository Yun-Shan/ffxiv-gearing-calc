import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommonGearSlot, JobId, OptimizationConfig } from "../types.ts";

const mocks = vi.hoisted(() => ({
  assembleResult: vi.fn(),
  candidateGearFromInfo: vi.fn(),
  candidateResourceSupportProfileForSearch: vi.fn(),
  createParallelBaselineExecutor: vi.fn(),
  findBestJointLoadoutV3: vi.fn(),
  markSharedAccessoryPairDominancePath: vi.fn(),
  prepareSearch: vi.fn(),
  privateParetoSlots: vi.fn(),
  resourceBudgetCandidateProfileForSearch: vi.fn(),
  resultFood: vi.fn(),
}));

vi.mock("../search/parallel-baseline-executor.ts", () => ({
  createParallelBaselineExecutor: mocks.createParallelBaselineExecutor,
}));
vi.mock("../search/candidate-resource-support-policy.ts", () => ({
  candidateResourceSupportProfileForSearch: mocks.candidateResourceSupportProfileForSearch,
  resourceBudgetCandidateProfileForSearch: mocks.resourceBudgetCandidateProfileForSearch,
}));
vi.mock("../search/shared-accessory-pair-dominance-policy.ts", () => ({
  markSharedAccessoryPairDominancePath: mocks.markSharedAccessoryPairDominancePath,
}));
vi.mock("../search/loadout-finder-v3.ts", () => ({
  findBestJointLoadoutV3: mocks.findBestJointLoadoutV3,
}));
vi.mock("./search-preparation.ts", () => ({
  prepareSearch: mocks.prepareSearch,
  privateParetoSlots: mocks.privateParetoSlots,
}));
vi.mock("./result-assembly.ts", () => ({
  assembleResult: mocks.assembleResult,
  candidateGearFromInfo: mocks.candidateGearFromInfo,
  resultFood: mocks.resultFood,
}));

import { runJointOptimizationLocally } from "./joint-search.ts";

function job(jobId: JobId, overrides: Partial<OptimizationConfig> = {}): OptimizationConfig {
  return {
    clanIndex: 0,
    objective: "damage",
    jobId,
    minItemLevel: 1,
    maxItemLevel: 999,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
    ...overrides,
  };
}

function jointConfig(
  jobs: OptimizationConfig[],
  commonSlots: CommonGearSlot[] = [],
  objective: "damage" | "dps" = "damage",
): Parameters<typeof runJointOptimizationLocally>[0] {
  return {
    jobs: jobs.map((job) => ({ ...job, objective })),
    commonSlots,
    foodStrategy: "independent",
    objective,
    maxSearchMs: 10,
    cacheLimit: 4,
  };
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    commonEquipments: {},
    jobResults: {},
    optima: {},
    value: { numerator: "1", denominator: "1", approximate: 1 },
    proof: {},
    statistics: {},
    ...overrides,
  };
}

const sharedWideScenarios = [
  {
    label: "the narrow MCH/VPR profile",
    jobIds: ["MCH", "VPR"] as const,
    minItemLevel: 730,
    maxItemLevel: 795,
  },
  {
    label: "the four-job physical DPS profile",
    jobIds: ["BRD", "DNC", "MCH", "VPR"] as const,
    minItemLevel: 715,
    maxItemLevel: 795,
  },
  {
    label: "the five-job physical DPS profile",
    jobIds: ["BRD", "DNC", "MCH", "NIN", "VPR"] as const,
    minItemLevel: 715,
    maxItemLevel: 795,
  },
];

describe("joint search result validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createParallelBaselineExecutor.mockResolvedValue({ dispose: vi.fn() });
    mocks.candidateResourceSupportProfileForSearch.mockReturnValue(undefined);
    mocks.resourceBudgetCandidateProfileForSearch.mockReturnValue(undefined);
    mocks.markSharedAccessoryPairDominancePath.mockImplementation((options) => options);
    mocks.candidateGearFromInfo.mockImplementation((equipment, slot) => ({
      equipment,
      slot,
    }));
    mocks.findBestJointLoadoutV3.mockResolvedValue(
      result({ commonEquipments: { ring: {}, ring2: {} } }),
    );
    mocks.prepareSearch.mockImplementation((config: OptimizationConfig) => ({
      foods: [{}],
      options: { slots: [[]] },
      slots: [{ name: "weapon", candidates: [{}] }],
      jobId: config.jobId,
    }));
    mocks.privateParetoSlots.mockReturnValue([]);
  });

  it.each([
    { kind: "jobLevel", value: 90 },
    { kind: "itemLevel", value: 680 },
  ] as const)("passes the %o sync target into both shared candidate profiles", async (sync) => {
    const config = jointConfig([
      job("MCH", { sync }),
      job("VPR", { sync }),
    ]);

    await runJointOptimizationLocally(config);

    const expectedJobs = [
      {
        jobId: "MCH",
        minItemLevel: 1,
        maxItemLevel: 999,
        sync,
      },
      {
        jobId: "VPR",
        minItemLevel: 1,
        maxItemLevel: 999,
        sync,
      },
    ];
    expect(mocks.resourceBudgetCandidateProfileForSearch.mock.calls[0]?.[0].jobs)
      .toEqual(expectedJobs);
    expect(mocks.candidateResourceSupportProfileForSearch.mock.calls[0]?.[0].jobs)
      .toEqual(expectedJobs);
  });

  it("marks the exact shared-accessory-pair DPS path when all eligibility conditions hold", async () => {
    const config = jointConfig(
      [job("MCH"), job("VPR")],
      ["ring", "ring2", "bracelet", "earrings", "necklace"],
      "dps",
    );
    config.foodStrategy = "shared";
    const options = {
      onProgress: vi.fn(),
      onSolverProgress: vi.fn(),
      onSolverCallback: vi.fn(),
    };

    const optimized = await runJointOptimizationLocally(config, options);

    expect(optimized?.value.approximate).toBe(1);
    expect([...(optimized?.commonGear.ring ?? []), ...(optimized?.commonGear.ring2 ?? [])]).toEqual([
      { equipment: {}, slot: "ring" },
      { equipment: {}, slot: "ring2" },
    ]);
    expect(mocks.markSharedAccessoryPairDominancePath).toHaveBeenCalledOnce();
    const solverOptions = mocks.findBestJointLoadoutV3.mock.calls[0]?.[0];
    expect(solverOptions).toMatchObject({
      commonSlots: ["ring", "ring2", "bracelet", "earrings", "necklace"],
      foodStrategy: "shared",
      objective: "dps",
    });
    expect(solverOptions).toHaveProperty("baselineExecutor");
    expect(solverOptions).toHaveProperty("onSolverProgress", options.onSolverProgress);
    expect(solverOptions).toHaveProperty("onSolverCallback", options.onSolverCallback);
  });

  it("reassembles valid shared gear, job results, optima and shared food", async () => {
    mocks.assembleResult.mockImplementation((exactResult, config) => ({
      jobId: config.jobId,
      exactResult,
    }));
    mocks.resultFood.mockReturnValue({ id: 49240 });
    mocks.findBestJointLoadoutV3.mockResolvedValueOnce(
      result({
        commonEquipments: {
          rings: { ringEquips: [{ id: 1 }, { id: 2 }] },
          head: { id: 3 },
        },
        jobResults: { RDM: { score: "result" }, BLM: { score: "result" } },
        optima: { RDM: { score: "optimum" }, BLM: { score: "optimum" } },
      }),
    );
    const config = jointConfig(
      [
        job("RDM", { forcedGear: { ring: 100 } }),
        job("BLM", { forcedGear: { ring: 100 } }),
      ],
      ["ring", "ring2", "head"],
    );
    config.foodStrategy = "shared";

    const optimized = await runJointOptimizationLocally(config);

    expect(optimized?.commonGear).toEqual({
      ring: [{ equipment: { id: 1 }, slot: "ring" }],
      ring2: [{ equipment: { id: 2 }, slot: "ring2" }],
      head: [{ equipment: { id: 3 }, slot: "head" }],
    });
    expect(optimized?.commonFood).toEqual({ id: 49240 });
    expect(optimized?.jobResults.RDM).toMatchObject({
      jobId: "RDM",
      exactResult: { score: "result" },
    });
    expect(optimized?.optima.BLM).toMatchObject({
      jobId: "BLM",
      exactResult: { score: "optimum" },
    });
  });

  it("publishes one domain duration including preparation, solving, disposal and all result reconstruction", async () => {
    let now = 100;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const solverStatistics = { elapsedMs: 40 };
    mocks.prepareSearch.mockImplementation((config: OptimizationConfig) => {
      now += 10;
      return { foods: [{}], options: { slots: [[]] }, slots: [{ name: "weapon", candidates: [{}] }], jobId: config.jobId };
    });
    mocks.createParallelBaselineExecutor.mockResolvedValueOnce({ dispose: async () => { now += 80; } });
    mocks.findBestJointLoadoutV3.mockImplementationOnce(async () => {
      now += 40;
      return result({
        jobResults: { RDM: {}, BLM: {} },
        optima: { RDM: {}, BLM: {} },
        statistics: solverStatistics,
      });
    });
    mocks.assembleResult.mockImplementation(() => {
      now += 10;
      return { statistics: { elapsedMs: 1 } };
    });
    try {
      const completed = await runJointOptimizationLocally(jointConfig([job("RDM"), job("BLM")]));
      expect(completed?.statistics.elapsedMs).toBe(180);
      for (const result of [...Object.values(completed!.jobResults), ...Object.values(completed!.optima)]) {
        expect(result.statistics.elapsedMs).toBe(180);
      }
      expect(solverStatistics.elapsedMs).toBe(40);
    } finally {
      clock.mockRestore();
    }
  });

  it("reports cancellation through the solver callback and rejects a cancelled result", async () => {
    const controller = new AbortController();
    mocks.findBestJointLoadoutV3.mockImplementationOnce(async (options) => {
      expect(options.isCancelled()).toBe(false);
      controller.abort();
      expect(options.isCancelled()).toBe(true);
      return result();
    });

    await expect(
      runJointOptimizationLocally(
        jointConfig([job("RDM"), job("BLM")]),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each(sharedWideScenarios)("keeps the weaker pair relaxation disabled for $label", async ({
    jobIds,
    minItemLevel,
    maxItemLevel,
  }) => {
    const config = jointConfig(
      jobIds.map((jobId) => job(jobId, {
        minItemLevel,
        maxItemLevel,
        sync: { kind: "itemLevel", value: 735 },
      })),
      ["ring", "ring2", "bracelet", "earrings", "necklace"],
      "dps",
    );
    config.foodStrategy = "shared";

    await runJointOptimizationLocally(config);

    expect(mocks.findBestJointLoadoutV3.mock.calls[0]?.[0].ratioUpperPairPolicy)
      .toBe("disabled");
    expect(mocks.markSharedAccessoryPairDominancePath).toHaveBeenCalledOnce();
  });

  it("fails closed when the solver returns an unknown job", async () => {
    mocks.findBestJointLoadoutV3.mockResolvedValueOnce(
      result({ jobResults: { AST: {} } }),
    );

    await expect(
      runJointOptimizationLocally(jointConfig([job("RDM"), job("BLM")])),
    ).rejects.toThrow("联合搜索返回了未知职业：AST");
  });

  it("rejects a malformed shared ring-pair result", async () => {
    mocks.findBestJointLoadoutV3.mockResolvedValueOnce(
      result({ commonEquipments: { rings: {} } }),
    );

    await expect(
      runJointOptimizationLocally(
        jointConfig([job("RDM"), job("BLM")], ["ring", "ring2"]),
      ),
    ).rejects.toThrow("联合结果缺少共享戒指对");
  });

  it("rejects an incomplete factorized shared ring pair", async () => {
    mocks.findBestJointLoadoutV3.mockResolvedValueOnce(
      result({ commonEquipments: {} }),
    );

    await expect(
      runJointOptimizationLocally(
        jointConfig([job("RDM"), job("BLM")], ["ring", "ring2"]),
      ),
    ).rejects.toThrow("联合结果缺少共享戒指对");
  });
});
