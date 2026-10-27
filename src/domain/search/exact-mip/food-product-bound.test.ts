import { describe, expect, test, vi } from "vitest";
import type { Stat } from "../../types.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedSpeedRangeForGcd,
} from "../equipped-effects.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { getAttributeVector } from "./attributes.ts";
import { prepareExactMipModel } from "./model-preparation.ts";
import { completeFeasibleMipStart, greedyMipStart } from "./initial-solution.ts";
import { exactProduct } from "./factor-model.ts";
import { findBestLoadoutExactMip } from "./single-search.ts";
import type { ExactMipOptions } from "./types.ts";
import { completeProductBounds, maxProfit, minkowski, prepareFoodProductBound, upperChain } from "./food-product-bound.ts";

const ids = [-1, 1, 2, 3, 4, 5, 6];
const indexes = new Map<Stat, number>([
  ["MDMG", 0], ["INT", 1], ["CRT", 2], ["DET", 3], ["DHT", 4], ["SPS", 5], ["TEN", 6],
]);
const equipment = (itemId: number, values: number[]): EquipInfo => ({
  itemId, itemLevel: 795, key: `item-${itemId}`, PDMG: 0, MDMG: values[0]!, DLY: 0,
  baseParams: ids.map((baseParamId, index) => ({ baseParamId, value: values[index]! })),
});
const factorEvaluator = createIntegerDamageFactorEvaluator("RDM", 100, indexes);

function optionsFor(overrides: Partial<ExactMipOptions> = {}): ExactMipOptions {
  const good: FoodInfo = {
    itemId: 9001, itemLevel: 795, key: "main-food",
    baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 100, baseValue: 1000 }],
  };
  const bad: FoodInfo = { itemId: 9002, itemLevel: 795, key: "no-bonus", baseParams: [] };
  return markCanonicalEvaluatorCandidateUpperBound({
    clanIndex: 0, job: "RDM", jobLevel: 100, objective: "damage",
    attributeIds: ids, statIndexes: indexes, speedAttributeId: 5, toughnessAttributeId: 6,
    slots: [[equipment(1, [150, 1000, 400, 300, 200, 0, 0])]],
    foods: [good, bad], evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, indexes),
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
    ...overrides,
  });
}

async function preparedFixture(options = optionsFor()) {
  const prepared = (await prepareExactMipModel(options))!;
  const greedy = greedyMipStart(options, prepared.model, prepared.useDps, Infinity, () => false)!;
  expect(greedy).toBeDefined();
  const hint = completeFeasibleMipStart(options, prepared.model, prepared.groups, prepared.factorEvaluator, greedy, {
    main: prepared.mainAttribute, det: prepared.detAttribute, ten: prepared.tenAttribute,
    crt: prepared.crtAttribute, dht: prepared.dhtAttribute, gcd: prepared.speedAttribute,
  });
  expect(hint.size).toBe(prepared.model.bounds.length);
  return { options, prepared, seed: { ...greedy, hint } };
}

function oracle(options: ExactMipOptions) {
  const evaluateFactors = createIntegerDamageFactorEvaluator(options.job, options.jobLevel, options.statIndexes, options.clanIndex);
  let selections: EquipInfo[][] = [[]];
  for (const slot of options.slots) selections = selections.flatMap((selection) => slot.map((candidate) => [...selection, candidate]));
  const candidates = selections.flatMap((selection) => options.foods.flatMap((food, foodIndex) => {
    const attributes = getAttributeVector(selection, food, options.attributeIds, undefined, options.statIndexes);
    const factors = evaluateFactors(attributes)!;
    const constraints = options.constraints ?? {};
    if (constraints.speedMin !== undefined && attributes[5]! < constraints.speedMin) return [];
    if (constraints.speedMax !== undefined && attributes[5]! > constraints.speedMax) return [];
    if (constraints.toughMin !== undefined && attributes[6]! < constraints.toughMin) return [];
    if (constraints.gcdChoices !== undefined && !constraints.gcdChoices.some((gcd) => Math.round(gcd * 100) === factors.gcdCentiseconds)) return [];
    if (constraints.gcd !== undefined && Math.round(constraints.gcd * 100) !== factors.gcdCentiseconds) return [];
    return [{ selection, food, foodIndex, product: exactProduct(factors), gcd: factors.gcdCentiseconds }];
  }));
  const best = candidates.reduce((winner, candidate) => {
    if (winner === undefined) return candidate;
    const left = candidate.product * BigInt(options.objective === "dps" ? winner.gcd : 1);
    const right = winner.product * BigInt(options.objective === "dps" ? candidate.gcd : 1);
    return left > right ? candidate : winner;
  }, undefined as (typeof candidates)[number] | undefined);
  expect(best).toBeDefined();
  return { candidates, best: best! };
}

describe("complete-product food bounds in the production model", () => {
  test("actually excludes a worse food and preserves the independently enumerated optimum", async () => {
    const { options, prepared, seed } = await preparedFixture();
    const originalRows = structuredClone(prepared.model.rows);
    const originalFoods = [...options.foods];
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    const expected = oracle(options);
    expect(result.statistics.execution).toBe("completed");
    expect(result.statistics.foodsExcluded).toBe(1);
    expect(result.rows).toMatchObject([{ name: "food_product_exclude_1", sense: "=", rhs: 0 }]);
    for (const candidate of expected.candidates) expect(result.upperProducts![candidate.foodIndex]).toBeGreaterThanOrEqual(candidate.product);
    expect(result.rows[0]!.terms.has(prepared.model.foodVariables[expected.best.foodIndex]!)).toBe(false);
    expect(prepared.model.rows).toEqual(originalRows);
    expect(options.foods).toEqual(originalFoods);
    const optimized = (await findBestLoadoutExactMip(options))!;
    const factors = factorEvaluator(getAttributeVector(optimized.selection, optimized.food, ids, undefined, indexes))!;
    expect(exactProduct(factors)).toBe(expected.best.product);
    expect(optimized.food).toBe(expected.best.food);
    expect(optimized.statistics.foodProductBound?.foodsExcluded).toBe(1);
    expect(optimized.statistics.solverRuns).toBeGreaterThan(0);
  });

  test("covers full-factor tradeoffs and every allowed DPS/GCD candidate with food floor and caps", async () => {
    const options = optionsFor({
      objective: "dps",
      slots: [
        [equipment(10, [150, 900, 400, 250, 200, 0, 0]), equipment(11, [148, 940, 360, 290, 170, 70, 0])],
        [equipment(20, [0, 600, 350, 280, 220, 60, 0]), equipment(21, [0, 620, 300, 350, 260, 100, 0])],
      ],
      foods: [
        { itemId: 1, itemLevel: 795, key: "crt-speed", baseParams: [
          { baseParamId: 2, baseValue: 700, multiplier: 1.1, maxValue: 70 },
          { baseParamId: 5, baseValue: 420, multiplier: 1.1, maxValue: 35 },
        ] },
        { itemId: 2, itemLevel: 795, key: "main-det", baseParams: [
          { baseParamId: 1, baseValue: 1000, multiplier: 1.05, maxValue: 100 },
          { baseParamId: 3, baseValue: 500, multiplier: 1.1, maxValue: 80 },
        ] },
      ],
    });
    const possibleGcds = [...new Set(oracle(options).candidates.map(({ gcd }) => gcd / 100))];
    options.constraints = { gcdChoices: possibleGcds, speedMin: 40, speedMax: 220 };
    const { prepared, seed } = await preparedFixture(options);
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    expect(result.statistics.execution).toBe("completed");
    expect(result.statistics.speedFibers).toBeGreaterThan(1);
    const expected = oracle(options);
    for (const candidate of expected.candidates) {
      expect(result.upperProducts![candidate.foodIndex]).toBeGreaterThanOrEqual(candidate.product);
      expect(result.upperProducts![candidate.foodIndex]! * BigInt(candidate.gcd)).toBeGreaterThanOrEqual(candidate.product * BigInt(result.gcdLowerBound!));
    }
    const optimized = (await findBestLoadoutExactMip(options))!;
    const actual = factorEvaluator(getAttributeVector(optimized.selection, optimized.food, ids, undefined, indexes))!;
    expect(exactProduct(actual) * BigInt(expected.best.gcd)).toBe(expected.best.product * BigInt(actual.gcdCentiseconds));
  });

  test("identical food identities at an equal optimum are both retained", async () => {
    const options = optionsFor();
    options.foods = [options.foods[0]!, { ...options.foods[0]!, itemId: 9003, key: "same-bonus-other-food" }];
    const { prepared, seed } = await preparedFixture(options);
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    expect(result.statistics.execution).toBe("completed");
    expect(result.rows).toEqual([]);
    expect(result.upperProducts![0]).toBe(result.upperProducts![1]);
  });

  test("tank bounds include weapon, main-stat and tenacity tradeoffs under a hard tenacity minimum", async () => {
    const tankIndexes = new Map<Stat, number>([
      ["PDMG", 0], ["STR", 1], ["CRT", 2], ["DET", 3], ["DHT", 4], ["SKS", 5], ["TEN", 6],
    ]);
    const options = optionsFor({
      job: "WAR", statIndexes: tankIndexes,
      evaluationFunction: createDamageGcdVectorEvaluator("WAR", 100, tankIndexes),
      gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("WAR", 100, gcd),
      constraints: { toughMin: 150 },
      slots: [[
        equipment(10, [150, 1000, 400, 300, 200, 0, 160]),
        equipment(11, [149, 1060, 380, 350, 190, 0, 400]),
      ]],
      foods: [
        { itemId: 1, itemLevel: 795, key: "ten-food", baseParams: [{ baseParamId: 6, multiplier: 1.25, maxValue: 100 }] },
        { itemId: 2, itemLevel: 795, key: "str-food", baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 100 }] },
      ],
    });
    const { prepared, seed } = await preparedFixture(options);
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    expect(result.statistics.execution).toBe("completed");
    expect(result.statistics.nonConstantFactors).toBeGreaterThanOrEqual(3);
    const expected = oracle(options);
    for (const candidate of expected.candidates) expect(result.upperProducts![candidate.foodIndex]).toBeGreaterThanOrEqual(candidate.product);
    const optimized = (await findBestLoadoutExactMip(options))!;
    const factors = createIntegerDamageFactorEvaluator("WAR", 100, tankIndexes)(getAttributeVector(optimized.selection, optimized.food, ids, undefined, tankIndexes))!;
    expect(exactProduct(factors)).toBe(expected.best.product);
  });

  test.each(["untrusted", "custom", "maximum-tenacity", "no-food-choice", "no-seed", "speed-projection"] as const)(
    "unsupported production capability leaves rows and foods intact: %s", async (reason) => {
      const { options, prepared, seed } = await preparedFixture();
      let request = options;
      if (reason === "untrusted") request = { ...options };
      if (reason === "custom") options.equipmentAttributeExtractor = (item) => item.baseParams;
      if (reason === "maximum-tenacity") options.constraints = { maxToughnessMode: true };
      if (reason === "no-food-choice") options.foods = options.foods.slice(0, 1);
      if (reason === "speed-projection") options.constraints = { speedMin: 0 };
      const before = structuredClone(prepared.model.rows);
      const foods = [...options.foods];
      const result = prepareFoodProductBound(request, prepared, reason === "no-seed" ? undefined : seed, { deadline: Infinity });
      expect(result.statistics.execution).toBe("skipped");
      expect(result.rows).toEqual([]);
      expect(result.upperProducts).toBeUndefined();
      expect(prepared.model.rows).toEqual(before);
      expect(options.foods).toEqual(foods);
    },
  );

  test("dynamic weapon allocations reject food pruning before an unfrozen allocation can supply a seed", async () => {
    const options = optionsFor();
    options.slots[0]![0]!.resistanceWeaponAdjust = { stats: ["DET"], maxEachStat: 3, maxTotalStats: 3 };
    const prepared = (await prepareExactMipModel(options))!;
    const result = prepareFoodProductBound(options, prepared, undefined, { deadline: Infinity });
    expect(result.statistics.skipReason).toBe("variable-attributes");
    expect(result.rows).toEqual([]);
  });

  test("a repeated unique ring cannot serve as a lower-bound witness", async () => {
    const options = optionsFor({ slots: [0, 1].map((ringSlotIndex) => [1, 2].map((itemId) => ({
      ...equipment(itemId, [0, 500, 100, 100, 100, 0, 0]),
      ringSlotIndex: ringSlotIndex as 0 | 1, isUnique: true,
    }))) });
    const { prepared, seed } = await preparedFixture(options);
    for (let slot = 0; slot < 2; slot++) {
      for (const variable of prepared.model.slotVariables[slot]!) seed.hint.set(variable, 0);
      seed.selection[slot] = options.slots[slot]![0]!;
      seed.hint.set(prepared.model.slotVariables[slot]![0]!, 1);
    }
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    expect(result.statistics.skipReason).toBe("invalid-incumbent");
    expect(result.rows).toEqual([]);
  });

  test.each(["single", "choices"] as const)("validates the seed's actual %s GCD against the request", async (kind) => {
    const { options, prepared, seed } = await preparedFixture(optionsFor({ constraints: { speedMin: 0 } }));
    options.constraints = kind === "single" ? { gcd: 2.4 } : { gcdChoices: [2.4] };
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    expect(result.statistics.skipReason).toBe("invalid-incumbent");
  });

  test.each(["selection-size", "hint-size", "foreign-food", "food-bit", "foreign-gear", "fractional-hint", "row-violation", "wrong-final", "no-factors"] as const)(
    "rejects an unproved incumbent: %s", async (reason) => {
      const { options, prepared, seed } = await preparedFixture();
      if (reason === "selection-size") seed.selection = [];
      if (reason === "hint-size") seed.hint.delete(prepared.model.bounds[0]!.name);
      if (reason === "foreign-food") seed.food = { ...seed.food! };
      if (reason === "food-bit") seed.hint.set(prepared.model.foodVariables[0]!, 0);
      if (reason === "foreign-gear") seed.selection = [{ ...seed.selection[0]! }];
      if (reason === "fractional-hint") seed.hint.set(prepared.model.bounds[0]!.name, 0.5);
      if (reason === "row-violation") seed.hint.set(prepared.model.rawVariables[1]!, seed.hint.get(prepared.model.rawVariables[1]!)! + 1);
      if (reason === "wrong-final") prepared.model.finalVariables[1] = prepared.model.rawVariables[1]!;
      if (reason === "no-factors") prepared.factorEvaluator = () => undefined;
      const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
      expect(result.statistics.skipReason).toBe("invalid-incumbent");
      expect(result.rows).toEqual([]);
    },
  );

  test.each(["missing-group", "invalid-factor", "partial-auxiliary", "invalid-gcd", "wrong-candidate-count", "negative-candidate", "duplicate-food-parameter", "missing-food-bonus"] as const)(
    "uncertain prepared data never publishes exclusions: %s", async (reason) => {
      const { options, prepared, seed } = await preparedFixture();
      if (reason === "missing-group") prepared.groups.splice(prepared.groups.findIndex(({ name }) => name === "crt"), 1);
      if (reason === "invalid-factor") prepared.groups.find(({ name }) => name === "main")!.classes[0]!.value = 0;
      if (reason === "partial-auxiliary") prepared.groups.find(({ name }) => name === "main")!.classes[0]!.auxiliary = 1;
      if (reason === "invalid-gcd") prepared.groups.find(({ name }) => name === "gcd")!.classes[0]!.value = 0;
      if (reason === "wrong-candidate-count") prepared.model.fixedEquipmentAttributes[0]!.pop();
      if (reason === "negative-candidate") prepared.model.fixedEquipmentAttributes[0]![0]![1] = -1;
      if (reason === "duplicate-food-parameter") options.foods[1]!.baseParams.push(
        { baseParamId: 1, multiplier: 1.1, maxValue: 10 }, { baseParamId: 1, multiplier: 1.1, maxValue: 20 });
      if (reason === "missing-food-bonus") options.foods[1]!.baseParams.push({ baseParamId: 1, multiplier: 1.1, maxValue: 10 });
      const before = structuredClone(prepared.model.rows);
      const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
      expect(result.statistics.execution).toBe("skipped");
      expect(result.rows).toEqual([]);
      expect(prepared.model.rows).toEqual(before);
    },
  );

  test.each(["negative-base", "negative-cap", "duplicate-bonus"] as const)("food metadata must retain its proved integer domain: %s", async (kind) => {
    const { options, prepared, seed } = await preparedFixture();
    const template = prepared.model.foodBonuses[0]!;
    if (kind === "duplicate-bonus") prepared.model.foodBonuses.push({ ...template });
    else {
      options.foods[1]!.baseParams.push({ baseParamId: 1, multiplier: 1.1, maxValue: 10, baseValue: kind === "negative-base" ? -1 : 0 });
      prepared.model.foodBonuses.push({ ...template, foodIndex: 1, cap: kind === "negative-cap" ? -1 : 10 });
    }
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    expect(result.statistics.skipReason).toBe("unproved-food-domain");
    expect(result.rows).toEqual([]);
  });

  test("a varying factor without an attribute coordinate rejects the certificate", async () => {
    const { options, prepared, seed } = await preparedFixture(optionsFor({ slots: [[
      equipment(1, [150, 1000, 400, 100, 200, 0, 0]), equipment(2, [150, 1000, 400, 500, 200, 0, 0]),
    ]] }));
    prepared.detAttribute = undefined;
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity });
    expect(result.statistics.skipReason).toBe("unproved-factor-domain");
  });

  test.each(["unsafe-main", "nonpositive-gcd"] as const)("rejects an invalid reconstructed factor: %s", async (kind) => {
    const { options, prepared, seed } = await preparedFixture();
    const evaluate = prepared.factorEvaluator;
    prepared.factorEvaluator = (attributes) => ({ ...evaluate(attributes)!,
      ...(kind === "unsafe-main" ? { mainStat: NaN } : { gcdCentiseconds: 0 }),
    });
    expect(prepareFoodProductBound(options, prepared, seed, { deadline: Infinity }).statistics.skipReason).toBe("invalid-incumbent");
  });

  test.each([
    { maxWork: 1 }, { maxPoints: 1 }, { deadline: -Infinity }, { maxWork: 0 }, { maxPoints: 0 },
  ])("every guard abandons the whole optional certificate: %j", async (limits) => {
    const options = optionsFor({ slots: [[
      equipment(1, [150, 1000, 400, 300, 200, 0, 0]), equipment(2, [149, 1020, 350, 340, 210, 0, 0]),
    ]] });
    const { prepared, seed } = await preparedFixture(options);
    const before = structuredClone(prepared.model.rows);
    const result = prepareFoodProductBound(options, prepared, seed, { deadline: Infinity, ...limits });
    expect(result.statistics.execution).toBe("skipped");
    expect(result.rows).toEqual([]);
    expect(result.upperProducts).toBeUndefined();
    expect(prepared.model.rows).toEqual(before);
  });

  test("cancellation propagates atomically and runtime telemetry survives PROFILE JSON", async () => {
    const { options, prepared, seed } = await preparedFixture();
    const before = structuredClone(prepared.model.rows);
    options.isCancelled = () => true;
    expect(() => prepareFoodProductBound(options, prepared, seed)).toThrowError("搜索已取消");
    expect(prepared.model.rows).toEqual(before);
    let checks = 0;
    options.isCancelled = () => ++checks >= 15;
    expect(() => prepareFoodProductBound(options, prepared, seed, { deadline: Infinity })).toThrowError();
    expect(prepared.model.rows).toEqual(before);
    options.isCancelled = () => false;
    const profiles: string[] = [];
    options.onSolverProgress = (event) => { if (event.message?.startsWith("PROFILE ")) profiles.push(event.message); };
    vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
    try {
      const result = await findBestLoadoutExactMip(options);
      expect(result?.statistics.foodProductBound?.execution).toBe("completed");
      const profile = profiles.map((line) => JSON.parse(line.slice(8))).find(({ phase }) => phase === "food-product-bound");
      expect(profile.foodsExcluded).toBe(1);
      expect(profile.work).toBeGreaterThan(0);
    } finally { vi.unstubAllEnvs(); }
  });
});

test("support chains preserve all Minkowski sums and round clipped interpolation upward", () => {
  const left = [{ c: 0, p: 10 }, { c: 3, p: 15 }, { c: 5, p: 3 }];
  const right = [{ c: 0, p: 0 }, { c: 2, p: 1 }, { c: 4, p: 0 }];
  const sums = left.flatMap((a) => right.map((b) => ({ c: a.c + b.c, p: a.p + b.p })));
  expect(minkowski(upperChain(left), upperChain(right))).toEqual(upperChain(sums));
  expect(maxProfit([{ c: 0, p: 0 }, { c: 2, p: 1 }], 1, 1)).toBe(1n);
  expect(maxProfit([], 0, 0)).toBeUndefined();
  expect(minkowski([], right)).toEqual([]);
  expect(() => minkowski([{ c: Number.MAX_SAFE_INTEGER, p: 0 }], [{ c: 1, p: 0 }])).toThrowError("unsafe-arithmetic");
  expect(() => upperChain([{ c: 0, p: -1 }])).toThrowError("unsafe-arithmetic");
});

test("the mathematical kernel rejects unsupported integer domains without publishing partial bounds", () => {
  const fixed = { min: 0, max: 0, value: 1 };
  const input: Parameters<typeof completeProductBounds>[0] = {
    slots: [[{ weapon: 0, main: 0, det: 0, ten: 0, dht: 0, crt: 0, speed: 0 }]], foods: [{}, {}],
    classes: { weapon: [fixed], main: [fixed], det: [fixed], ten: [fixed], dht: [fixed], crt: [fixed] },
    seedFactors: { weapon: 1, main: 1, det: 1, ten: 1, dht: 1, crt: 1 },
  };
  expect(completeProductBounds({ ...input, maximumTenacityUnfrozen: true })).toMatchObject({ status: "skipped" });
  expect(completeProductBounds({ ...input, maximumWeaponAuxiliary: -1 })).toMatchObject({ status: "skipped" });
  expect(completeProductBounds({ ...input, classes: { ...input.classes, crt: [] } })).toMatchObject({ status: "skipped" });
  expect(completeProductBounds({ ...input, seedFactors: { ...input.seedFactors, main: 0 } })).toMatchObject({ status: "skipped" });
  expect(completeProductBounds({ ...input, slots: [[{ ...input.slots[0]![0]!, speed: NaN }]] })).toMatchObject({ status: "skipped" });
});

function constantSupportInput(speedsBySlot: number[][]): Parameters<typeof completeProductBounds>[0] {
  const fixed = [{ min: 0, max: 0, value: 1 }];
  return {
    slots: speedsBySlot.map((slot) => slot.map((speed) => ({ weapon: 0, main: 0, det: 0, ten: 0, dht: 0, crt: 0, speed }))),
    foods: [{}, {}], classes: { weapon: fixed, main: fixed, det: fixed, ten: fixed, dht: fixed, crt: fixed },
    seedFactors: { weapon: 1, main: 1, det: 1, ten: 1, dht: 1, crt: 1 },
  };
}

test("nonnegative speed projection prevents irrelevant high-speed candidates exhausting the same work budget", () => {
  const input = constantSupportInput(Array.from({ length: 3 }, () => Array.from({ length: 300 }, (_, index) => index * 10)));
  const narrow = completeProductBounds({ ...input, allowedSpeedsByFood: [[0], [0]] }, { maxWork: 4000 });
  expect(narrow.status).toBe("complete");
  if (narrow.status !== "complete") return;
  expect(narrow.products).toEqual([1n, 1n]);
  expect(narrow.statistics.fibers).toBe(1);
  const broad = completeProductBounds({ ...input, allowedSpeedsByFood: [[0, 8970], [8970]] }, { maxWork: 4000 });
  expect(broad).toMatchObject({ status: "skipped", reason: "work-budget" });
});

test("complete same-speed hull unions fit the retained-point budget rather than counting all historical point pairs", () => {
  const input = constantSupportInput(Array.from({ length: 2 }, () => Array.from({ length: 20 }, (_, index) => index)));
  const allowed = Array.from({ length: 39 }, (_, index) => index);
  const result = completeProductBounds({ ...input, allowedSpeedsByFood: [allowed, allowed] }, { maxPoints: 50 });
  expect(result.status).toBe("complete");
  if (result.status !== "complete") return;
  expect(result.statistics.fibers).toBe(39);
  expect(result.statistics.peakPoints).toBeLessThanOrEqual(50);
  expect(result.products).toEqual([1n, 1n]);
});

test("an empty allowed-speed union certifies an empty support and malformed speed projections reject safely", () => {
  const input = constantSupportInput([[0, 1], [0, 2]]);
  const empty = completeProductBounds({ ...input, allowedSpeedsByFood: [[], []] });
  expect(empty).toMatchObject({ status: "complete", products: [0n, 0n] });
  expect(completeProductBounds({ ...input, allowedSpeedsByFood: [[-1], []] })).toMatchObject({ status: "skipped", reason: "invalid-domain" });
  expect(completeProductBounds({ ...input, allowedSpeedsByFood: [[0]] })).toMatchObject({ status: "skipped", reason: "invalid-domain" });
  const negative = constantSupportInput([[-1, 0], [0]]);
  expect(completeProductBounds({ ...negative, allowedSpeedsByFood: [[], []] })).toMatchObject({ status: "skipped", reason: "invalid-domain" });
});

test("speed caps preserve full-product upper bounds for every small-domain food/speed witness", () => {
  let state = 0x341180;
  const next = (maximum: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
  for (let trial = 0; trial < 100; trial++) {
    const input = constantSupportInput(Array.from({ length: 3 }, () => [0, 0, 0]));
    input.slots = input.slots.map((slot) => slot.map((point) => ({ ...point, speed: next(5), main: next(7), crt: next(7) })));
    const slots = input.slots;
    const seedRawMain = slots.reduce((sum, slot) => sum + slot[0]!.main, 0);
    const seedRawCrt = slots.reduce((sum, slot) => sum + slot[0]!.crt, 0);
    const lowSpeed = slots.reduce((sum, slot) => sum + slot[0]!.speed, 0);
    const otherSpeed = slots.reduce((sum, slot) => sum + slot[2]!.speed, 0);
    const maximumMain = slots.reduce((sum, slot) => sum + Math.max(...slot.map(({ main }) => main)), 0) + 2;
    const maximumCrt = slots.reduce((sum, slot) => sum + Math.max(...slot.map(({ crt }) => crt)), 0) + 3;
    input.classes.main = Array.from({ length: maximumMain + 1 }, (_, value) => ({ min: value, max: value, value: 100 + value }));
    input.classes.crt = Array.from({ length: maximumCrt + 1 }, (_, value) => ({ min: value, max: value, value: 10000 + value * value }));
    input.seedFactors.main = 100 + seedRawMain;
    input.seedFactors.crt = 10000 + seedRawCrt * seedRawCrt;
    input.foods = [{}, {
      main: { base: 3, numerator: 1, denominator: 4, cap: 2 },
      crt: { base: 2, numerator: 1, denominator: 10, cap: 3 },
    }, {}];
    const allowed = [[lowSpeed], [otherSpeed, next(13)], []];
    input.allowedSpeedsByFood = allowed;
    const result = completeProductBounds(input, { deadline: Infinity });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") continue;
    expect(result.products[2]).toBe(0n);
    for (const first of slots[0]!) for (const second of slots[1]!) for (const third of slots[2]!) {
      const speed = first.speed + second.speed + third.speed;
      const rawMain = first.main + second.main + third.main;
      const rawCrt = first.crt + second.crt + third.crt;
      input.foods.forEach((food, index) => {
        if (!allowed[index]!.includes(speed)) return;
        const main = rawMain + (food.main ? Math.min(2, Math.floor((rawMain + 3) / 4)) : 0);
        const crt = rawCrt + (food.crt ? Math.min(3, Math.floor((rawCrt + 2) / 10)) : 0);
        const exact = BigInt(100 + main) * BigInt(10000 + crt * crt);
        expect(result.products[index]).toBeGreaterThanOrEqual(exact);
      });
    }
  }
});
