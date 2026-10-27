import { describe, expect, test, vi } from "vitest";
import { runJointOptimizationLocally } from "./optimizer/joint-search.ts";
import type { JobId } from "./types.ts";
import { gameData } from "./data.ts";
import { filterStatsForJob } from "./job-stats.ts";
import { prepareSearch, privateParetoSlots } from "./optimizer/search-preparation.ts";
import { createIntegerDamageFactorEvaluator } from "./search/equipped-effects.ts";
import { applyFood } from "./search/joint-loadout/attributes.ts";

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

    test("four tanks 780-785 retain the exact witnessed objective and original solo denominators", async () => {
      const jobIds = ["PLD", "WAR", "DRK", "GNB"] as const;
      const excludedGearIds = Array.from(gameData.gears)
        .filter((gear) => gear.customParameters !== undefined || gear.resistanceWeaponAdjust !== undefined)
        .map((gear) => gear.id);
      const jobs = jobIds.map((jobId) => ({
        jobId, clanIndex: 0, objective: "damage" as const,
        minItemLevel: 780, maxItemLevel: 785, gcdChoices: [2.5],
        maximizeTenacity: false, excludedSources: [], excludedGearIds, forcedGear: {}, foodId: 0,
      }));
      // These constants are assertions after a fresh formal search. No known
      // loadout, objective cutoff or baseline is supplied as a search input.
      const result = await runJointOptimizationLocally({
        jobs, commonSlots: ["head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2"],
        foodStrategy: "shared", objective: "damage",
      });
      expect(result).toBeDefined();
      expect(result!.proof.complete).toBe(true);
      expect(BigInt(result!.value.numerator) * 2324486470n)
        .toBeGreaterThanOrEqual(9297538159n * BigInt(result!.value.denominator));
      const originalSoloProducts = {
        PLD: 2992685628662940600000n,
        WAR: 3035236075316414611200n,
        DRK: 3035236075316414611200n,
        GNB: 2994115414448845440000n,
      };
      for (const config of jobs) {
        const solo = result!.optima[config.jobId]!;
        const prepared = prepareSearch(config, {}, false, true, privateParetoSlots(config), true);
        const raw = new Array<number>(prepared.options.attributeIds.length).fill(0);
        for (const gear of solo.gear) for (const [stat, value] of Object.entries(filterStatsForJob(gear.finalStats, gameData.jobSchemas[config.jobId]))) {
          const index = prepared.options.statIndexes.get(stat as keyof typeof gear.finalStats);
          if (index !== undefined) raw[index] += value ?? 0;
        }
        const food = prepared.options.foods.find((candidate) => candidate.itemId === solo.food.id);
        expect(food).toBeDefined();
        const attributes = applyFood(raw, food, new Map(prepared.options.attributeIds.map((id, index) => [id, index])));
        const factors = createIntegerDamageFactorEvaluator(config.jobId, solo.calculationLevel, prepared.options.statIndexes, 0)(attributes)!;
        const product = [factors.weaponDamage, factors.mainStat, factors.determination, factors.tenacity, factors.critical, factors.directHit]
          .reduce((value, factor) => value * BigInt(factor), 1n);
        expect(product).toBe(originalSoloProducts[config.jobId]);
      }
    }, 900_000);
  },
);
