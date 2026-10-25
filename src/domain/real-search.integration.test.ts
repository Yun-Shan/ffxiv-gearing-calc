import { describe, expect, test, vi } from "vitest";
import { runJointOptimizationLocally } from "./optimizer/joint-search.ts";
import type { JobId } from "./types.ts";

// Run the same production solver in-process so coverage includes solo baselines.
// Worker transport is checked separately by the worker tests and formal suite.
vi.mock("./search/parallel-baseline-executor.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./search/parallel-baseline-executor.ts")
  >()),
  createParallelBaselineExecutor: async () => undefined,
}));

const scenarios: {
  jobs: JobId[];
  minimum: number;
  numerator: string;
  denominator: string;
}[] = [
  {
    jobs: ["VPR", "MCH"],
    minimum: 730,
    numerator: "8673",
    denominator: "4337",
  },
  {
    jobs: ["BRD", "DNC", "MCH", "VPR"],
    minimum: 715,
    numerator: "18973495",
    denominator: "4744003",
  },
  {
    jobs: ["BRD", "DNC", "MCH", "NIN", "VPR"],
    minimum: 715,
    numerator: "21682",
    denominator: "4337",
  },
];

// Frozen exact objectives from 58ce7fc and its committed game data. These cover
// the real two/four/five-job strengthening paths, beyond small exhaustive models.
// Opt in through test:domain:coverage; ordinary unit runs remain short.
describe.skipIf(process.env.FFXIV_DOMAIN_REAL_CASES !== "1")(
  "real shared-search equivalence",
  () => {
    for (const scenario of scenarios) {
      test(`${scenario.jobs.join("+")} keeps the exact optimum and complete proof`, async () => {
        const profiles: string[] = [];
        const result = await runJointOptimizationLocally(
          {
            jobs: scenario.jobs.map((jobId) => ({
              clanIndex: 0,
              jobId,
              minItemLevel: scenario.minimum,
              maxItemLevel: 795,
              sync: { kind: "itemLevel", value: 735 },
              objective: "dps",
              maximizeTenacity: false,
              excludedSources: [],
              forcedGear: {},
              foodId: 0,
            })),
            commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"],
            foodStrategy: "shared",
            objective: "dps",
          },
          {
            onSolverProgress: (event) => {
              if (event.message?.startsWith("PROFILE "))
                profiles.push(event.message);
            },
          },
        );
        expect(result).toBeDefined();
        expect(result!.proof.complete).toBe(true);
        expect(
          BigInt(result!.value.numerator) * BigInt(scenario.denominator),
        ).toBe(BigInt(scenario.numerator) * BigInt(result!.value.denominator));
        expect(Object.keys(result!.jobResults).sort()).toEqual(
          [...scenario.jobs].sort(),
        );
        for (const job of scenario.jobs) {
          const chosen = result!.jobResults[job]!;
          const solo = result!.optima[job]!;
          expect(chosen.score).toBeLessThanOrEqual(solo.score);
          expect(chosen.gear.length).toBe(solo.gear.length);
          expect(chosen.food.id).toBe(result!.commonFood!.id);
        }
        expect(
          profiles.some((profile) => profile.includes("joint-model-ready")),
        ).toBe(true);
      }, 600_000);
    }
  },
);
