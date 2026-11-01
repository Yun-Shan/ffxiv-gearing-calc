import { afterEach, expect, test, vi } from "vitest";
import type { Stat } from "../../types.ts";
import type { EquipInfo } from "../types.ts";
import type { ExactMipOptions } from "./types.ts";
import { createDamageGcdVectorEvaluator, createIntegerDamageFactorEvaluator } from "../equipped-effects.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { getAttributeVector } from "./attributes.ts";
import { exactProduct } from "./factor-model.ts";
import { findBestLoadoutExactMip } from "./single-search.ts";
import * as coverModule from "./strict-improvement-cover.ts";
import * as signatureBand from "../signature-band.ts";
import * as highs from "../core/highs-solver.ts";

const ids = [-1, 1, 2, 3, 4, 5];
const indexes = new Map<Stat, number>([
  ["MDMG", 0], ["INT", 1], ["CRT", 2], ["DET", 3], ["DHT", 4], ["SPS", 5],
]);
function fixture(): ExactMipOptions {
  const equipment = (itemId: number, speed: number): EquipInfo => ({
    itemId, itemLevel: 700, key: `cover-item-${itemId}`, PDMG: 0, MDMG: 150, DLY: 0,
    baseParams: [150, 1500, 600, 600, 300, speed].map((value, index) => ({ baseParamId: ids[index]!, value })),
  });
  return markCanonicalEvaluatorCandidateUpperBound({
    job: "RDM", jobLevel: 100, clanIndex: 0, objective: "damage", attributeIds: ids,
    statIndexes: indexes, slots: [[equipment(1, 0), equipment(2, 100)]], foods: [],
    speedAttributeId: 5, maxSearchMs: 10_000,
    strategies: { resourceSupports: "off", candidateUpperBound: "off", resourceBudgetCandidateBounds: "off" },
    evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, indexes),
  } satisfies ExactMipOptions);
}
function product(options: ExactMipOptions, selection: readonly EquipInfo[]) {
  return exactProduct(createIntegerDamageFactorEvaluator("RDM", 100, indexes)(
    getAttributeVector(selection, undefined, ids, undefined, indexes),
  )!);
}
afterEach(() => vi.restoreAllMocks());

test("real generated classes, original rows and native feasible solutions continue through an empty cover", async () => {
  // Exercise the native band even when the existing optional BigInt shortcut
  // could finish earlier. Production still calls that original check first.
  const band = vi.spyOn(signatureBand, "hasStrictlyBetterFactorCombination").mockReturnValue(true);
  const cover = vi.spyOn(coverModule, "prepareStrictImprovementCover");
  const solve = vi.spyOn(highs, "solveIntegerModel");
  const options = fixture();
  const result = (await findBestLoadoutExactMip(options))!;
  expect(result).toBeDefined();
  expect(product(options, result.selection)).toBe(product(options, options.slots[0]!.slice(0, 1)));
  expect(band).toHaveBeenCalled();
  expect(cover).toHaveBeenCalled();
  expect(cover.mock.results.every((entry) => entry.type === "return" && entry.value.status === "covered" && entry.value.targetCount === 0)).toBe(true);
  const bands = solve.mock.calls.map(([request]) => request).filter((request) => request.name === "exact_damage_band_feasibility");
  expect(bands.length).toBeGreaterThanOrEqual(2);
  expect(bands.every((request) => request.rows.every((row) => !row.name.startsWith("strict_improvement_cover_")))).toBe(true);
  expect(result.statistics.signatureBandProof).toBe(false);
});

test("a native feasible covered request is fully decoded and followed by a distinct strict-improvement closure", async () => {
  vi.spyOn(signatureBand, "hasStrictlyBetterFactorCombination").mockReturnValue(true);
  // A deliberately loose, but valid, cover also retains the tied GCD signature.
  // This isolates the coordinator contract from the planner's exact enumeration.
  vi.spyOn(coverModule, "prepareStrictImprovementCover").mockImplementation(({ prepared }) => ({
    status: "covered", targetCount: 1,
    rows: prepared.groups.map((group) => ({ name: `strict_improvement_cover_${group.name}`,
      terms: new Map(group.classes.map((entry) => [entry.variable, 1])), sense: ">=", rhs: 1 })),
  }));
  const solve = vi.spyOn(highs, "solveIntegerModel");
  const messages: string[] = [];
  const options = fixture();
  options.onProgress = (message) => messages.push(message);
  const result = (await findBestLoadoutExactMip(options))!;
  expect(result.statistics.excludedSignatures).toBe(2);
  expect(result.statistics.solverRuns).toBe(3);
  expect(product(options, result.selection)).toBe(product(options, options.slots[0]!.slice(0, 1)));
  expect(messages.some((message) => message.includes("严格改善因子覆盖在完整候选约束下不可行"))).toBe(true);
  const requests = solve.mock.calls.map(([request]) => request);
  expect(requests[0]!.rows.some((row) => row.name.startsWith("strict_improvement_cover_"))).toBe(false);
  for (const request of requests.slice(1)) {
    expect(request.rows.some((row) => row.name === "surrogate_band_cutoff")).toBe(true);
    expect(request.rows.some((row) => row.name === "main_lower")).toBe(true);
    expect(request.rows.some((row) => row.name === "strict_improvement_cover_main")).toBe(true);
  }
});

test.each(["off", "DPS", "untrusted"])("%s preserves the original native request path", async (mode) => {
  vi.spyOn(signatureBand, "hasStrictlyBetterFactorCombination").mockReturnValue(true);
  const cover = vi.spyOn(coverModule, "prepareStrictImprovementCover");
  const solve = vi.spyOn(highs, "solveIntegerModel");
  let options = fixture();
  if (mode === "off") options.strategies = { ...options.strategies, factorReachability: "off" };
  if (mode === "DPS") options.objective = "dps";
  if (mode === "untrusted") options = { ...options };
  expect(await findBestLoadoutExactMip(options)).toBeDefined();
  expect(cover).not.toHaveBeenCalled();
  expect(solve.mock.calls.every(([request]) => !request.rows.some((row) => row.name.startsWith("strict_improvement_cover_")))).toBe(true);
});

test("a skipped plan submits the unchanged band and never uses the strict-cover completion branch", async () => {
  vi.spyOn(signatureBand, "hasStrictlyBetterFactorCombination").mockReturnValue(true);
  vi.spyOn(coverModule, "prepareStrictImprovementCover").mockReturnValue({ status: "skipped", reason: "local work budget" });
  const solve = vi.spyOn(highs, "solveIntegerModel");
  const messages: string[] = [];
  const options = fixture();
  options.onProgress = (message) => messages.push(message);
  expect(await findBestLoadoutExactMip(options)).toBeDefined();
  expect(solve.mock.calls.every(([request]) => !request.rows.some((row) => row.name.startsWith("strict_improvement_cover_")))).toBe(true);
  expect(messages.some((message) => message.includes("严格改善因子覆盖在完整候选约束下不可行"))).toBe(false);
});

test("cancellation during cover preparation propagates before submitting a native band request", async () => {
  vi.spyOn(signatureBand, "hasStrictlyBetterFactorCombination").mockReturnValue(true);
  const options = fixture();
  let cancelled = false;
  options.isCancelled = () => cancelled;
  const original = coverModule.prepareStrictImprovementCover;
  vi.spyOn(coverModule, "prepareStrictImprovementCover").mockImplementation((request) => {
    cancelled = true;
    return original(request);
  });
  const solve = vi.spyOn(highs, "solveIntegerModel");
  await expect(findBestLoadoutExactMip(options)).rejects.toThrow();
  expect(solve.mock.calls.map(([request]) => request.name)).toEqual(["exact_damage_initial"]);
});
