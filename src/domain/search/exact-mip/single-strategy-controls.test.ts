import { expect, test, vi, afterEach } from "vitest";
import type { Stat } from "../../types.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import type { ExactMipOptions } from "./types.ts";
import { SEARCH_STRATEGY_IDS, type SearchStrategies, type SearchStrategyId } from "../strategies.ts";
import { createDamageGcdVectorEvaluator, createIntegerDamageFactorEvaluator, equippedSpeedRangeForGcd } from "../equipped-effects.ts";
import { markCanonicalEvaluatorCandidateUpperBound, shouldEnableCanonicalCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { getAttributeVector } from "./attributes.ts";
import { exactProduct } from "./factor-model.ts";
import { prepareExactMipModel } from "./model-preparation.ts";
import { findBestLoadoutExactMip } from "./single-search.ts";
import * as highs from "../core/highs-solver.ts";
import { prepareSignatureFeasibility } from "./signature-feasibility.ts";

const ids = [-1, 1, 2, 3, 4, 5, 6];
const indexes = new Map<Stat, number>([
  ["MDMG", 0], ["INT", 1], ["CRT", 2], ["DET", 3], ["DHT", 4], ["SPS", 5], ["TEN", 6],
]);
const equipment = (itemId: number, values: number[]): EquipInfo => ({
  itemId, itemLevel: 700, key: `item-${itemId}`, PDMG: 0, MDMG: values[0]!, DLY: 0,
  baseParams: ids.map((baseParamId, index) => ({ baseParamId, value: values[index]! })),
});
function fixture(strategies?: SearchStrategies, objective: "damage" | "dps" = "damage"): ExactMipOptions {
  const foods: FoodInfo[] = [
    { itemId: 9001, itemLevel: 795, key: "crt", baseParams: [{ baseParamId: 2, multiplier: 1.1, maxValue: 100, baseValue: 420 }] },
    { itemId: 9002, itemLevel: 795, key: "det", baseParams: [{ baseParamId: 3, multiplier: 1.1, maxValue: 50, baseValue: 440 }] },
  ];
  return markCanonicalEvaluatorCandidateUpperBound({
    strategies, job: "RDM", jobLevel: 100, clanIndex: 0, objective, attributeIds: ids, statIndexes: indexes,
    slots: [
      [equipment(1, [150, 1000, 400, 300, 200, 0, 0]), equipment(2, [149, 990, 450, 330, 220, 10, 0])],
      [equipment(3, [0, 500, 200, 300, 100, 0, 0]), equipment(4, [0, 510, 240, 270, 130, 10, 0])],
    ],
    foods, speedAttributeId: 5, toughnessAttributeId: 6,
    candidateItemLevelRanges: [{ min: 790, max: 795 }],
    evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, indexes),
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
    maxSearchMs: 10_000,
  });
}

const factorEvaluator = createIntegerDamageFactorEvaluator("RDM", 100, indexes);
function exactValue(options: ExactMipOptions, selection: readonly EquipInfo[], food: FoodInfo | undefined) {
  const factors = factorEvaluator(getAttributeVector(selection, food, ids, undefined, indexes))!;
  return { product: exactProduct(factors), gcd: options.objective === "dps" ? factors.gcdCentiseconds : 1 };
}
function oracle(options: ExactMipOptions) {
  let best = { product: 0n, gcd: 1 };
  for (const first of options.slots[0]!) for (const second of options.slots[1]!) for (const food of options.foods) {
    const value = exactValue(options, [first, second], food);
    if (value.product * BigInt(best.gcd) > best.product * BigInt(value.gcd)) best = value;
  }
  return best;
}

afterEach(() => vi.restoreAllMocks());

const modes: { label: string; strategies?: SearchStrategies }[] = [
  { label: "default" },
  { label: "all off", strategies: Object.fromEntries(SEARCH_STRATEGY_IDS.map((id) => [id, "off"])) },
  { label: "all on", strategies: Object.fromEntries(SEARCH_STRATEGY_IDS.map((id) => [id, "on"])) },
  ...(["factorReachability", "speedFoodProjection", "foodProductBound", "candidateUpperBound", "resourceSupports",
    "conditionalResourceSupports", "resourceBudgetCandidateBounds", "materiaFamilyProjection", "equalityQuotient", "feasibleSeeds"] satisfies SearchStrategyId[])
    .flatMap((id) => (["on", "off"] as const).map((mode) => ({ label: `${id} ${mode}`, strategies: { [id]: mode } }))),
];

test.each(modes)("single $label preserves the exact independently enumerated damage and DPS optimum", async ({ strategies }) => {
  for (const objective of ["damage", "dps"] as const) {
    const options = fixture(strategies, objective);
    const expected = oracle(options);
    const result = (await findBestLoadoutExactMip(options))!;
    expect(result).toBeDefined();
    const actual = exactValue(options, result.selection, result.food);
    expect(actual.product * BigInt(expected.gcd)).toBe(expected.product * BigInt(actual.gcd));
  }
});

test("on bypasses the candidate count route but never evaluator or highest-tenacity applicability", async () => {
  const automatic = fixture();
  const forced = fixture({ candidateUpperBound: "on" });
  expect(shouldEnableCanonicalCandidateUpperBound(automatic, true)).toBe(false);
  expect(shouldEnableCanonicalCandidateUpperBound(forced, true)).toBe(true);
  expect(shouldEnableCanonicalCandidateUpperBound(forced, false)).toBe(false);
  expect(shouldEnableCanonicalCandidateUpperBound({ ...forced, constraints: { maxToughnessMode: true } }, true)).toBe(false);
  expect(shouldEnableCanonicalCandidateUpperBound({ ...forced, equipmentAttributeExtractor: () => [] }, true)).toBe(false);
  expect((await findBestLoadoutExactMip(forced))!.statistics.candidateUpperBound).toBeDefined();
  expect((await findBestLoadoutExactMip(fixture({ candidateUpperBound: "off" })))!.statistics.candidateUpperBound).toBeUndefined();
});

test("factor and resource switches remove only optional model pruning and support rows", async () => {
  const enabled = (await prepareExactMipModel(fixture({ factorReachability: "on", resourceSupports: "on", conditionalResourceSupports: "on" })))!;
  const disabled = (await prepareExactMipModel(fixture({ factorReachability: "off", resourceSupports: "off", conditionalResourceSupports: "off" })))!;
  expect(enabled.reachableFactorClassesRemoved).toBeGreaterThan(0);
  expect(disabled.reachableFactorClassesRemoved).toBe(0);
  expect(enabled.groups.reduce((sum, group) => sum + group.classes.length, 0)).toBeLessThan(disabled.groups.reduce((sum, group) => sum + group.classes.length, 0));
  expect(enabled.model.rows.some(({ name }) => name.startsWith("factor_resource_"))).toBe(true);
  expect(disabled.model.rows.some(({ name }) => name.startsWith("factor_resource_"))).toBe(false);
  expect(disabled.conditionalResourceSupport?.skipReason).toBe("disabled-by-policy");
  expect(disabled.model.rows.some(({ name }) => name === "slot_0")).toBe(true);
  const signature = enabled.groups.map((group) => ({ name: group.name, ...group.classes.at(-1)! }));
  const enabledFilter = prepareSignatureFeasibility(fixture({ resourceSupports: "on" }), enabled);
  const disabledFilter = prepareSignatureFeasibility(fixture({ resourceSupports: "off" }), enabled);
  expect(enabledFilter.isPossiblyFeasibleFactorTuple(signature)).toBe(false);
  expect(disabledFilter.isPossiblyFeasibleFactorTuple(signature)).toBe(true);
});

test("T11 off cannot be silently re-enabled by T34 on with a speed constraint", async () => {
  const options = fixture({ speedFoodProjection: "off", foodProductBound: "on" });
  options.constraints = { speedMax: 20 };
  expect((await prepareExactMipModel(options))!.model.speedFoodProjection).toBeUndefined();
  const result = (await findBestLoadoutExactMip(options))!;
  expect(result.statistics.foodProductBound?.skipReason).toBe("speed-projection-unavailable");
  expect(result.damage).toBeGreaterThan(0);
  const enabled = fixture({ speedFoodProjection: "on" });
  enabled.constraints = { speedMax: 20 };
  expect((await prepareExactMipModel(enabled))!.model.speedFoodProjection).toBeDefined();
});

test("resource budget on is independent of candidate pruning and hint publication", async () => {
  const solve = vi.spyOn(highs, "solveIntegerModel");
  const result = (await findBestLoadoutExactMip(fixture({ candidateUpperBound: "off", resourceBudgetCandidateBounds: "on", feasibleSeeds: "off" })))!;
  expect(result.statistics.candidateUpperBound).toBeUndefined();
  expect(result.statistics.resourceBudgetCandidateBound).toBeDefined();
  expect(solve).toHaveBeenCalled();
  for (const [request] of solve.mock.calls) {
    expect(request.solutionHint).toBeUndefined();
    expect(request.strategies).toMatchObject({ feasibleSeeds: "off", resourceBudgetCandidateBounds: "on" });
  }
});

test("all off still rejects cancelled searches and computes the full-domain highest tenacity", async () => {
  const strategies = Object.fromEntries(SEARCH_STRATEGY_IDS.map((id) => [id, "off"])) as SearchStrategies;
  const cancelled = fixture(strategies);
  cancelled.isCancelled = () => true;
  await expect(findBestLoadoutExactMip(cancelled)).rejects.toThrow();
  const options = fixture(strategies);
  options.constraints = { maxToughnessMode: true };
  const result = (await findBestLoadoutExactMip(options))!;
  expect(result.maximumToughness).toBe(0);
  expect(result.statistics.solverRuns).toBeGreaterThan(1);
});
