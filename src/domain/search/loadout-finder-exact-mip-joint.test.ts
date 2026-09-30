import assert from "node:assert/strict";
import { test } from "vitest";
import type { Job, JobLevel } from "./equipped-effects.ts";
import type { Stat } from "../types.ts";
import { gameData } from "../data.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import {
  findBestJointFactorMip,
  findBestLoadoutExactMip,
} from "./loadout-finder-exact-mip.ts";
import type {
  ExactMipOptions,
  ExactMipResult,
} from "./loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

// These are isolated vector coordinates for synthetic test objects. Damage
// factors and job-specific base stats still come from the generated game data.
const attributeIds = [-2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const attributeIdByStat: Partial<Record<Stat, number>> = {
  PDMG: -2,
  MDMG: -1,
  INT: 1,
  CRT: 2,
  DET: 3,
  DHT: 4,
  SPS: 5,
  TEN: 6,
  STR: 7,
  SKS: 8,
  MND: 9,
  DEX: 10,
};
const attributeIndexById = new Map(attributeIds.map((id, index) => [id, index]));
const jobLevel = 100 as JobLevel;
type JobId = "RDM" | "SAM";
type Objective = "damage" | "dps";

type Candidate = {
  selection: EquipInfo[];
  food: FoodInfo | undefined;
  attributes: number[];
  factors: IntegerDamageFactors;
};

type Fraction = { numerator: bigint; denominator: bigint };
type FixtureJob = {
  id: string;
  job: JobId;
  slotNames: readonly ["weapon", "ring"];
  options: ExactMipOptions;
  evaluateFactors: (attributes: readonly number[]) => IntegerDamageFactors | undefined;
  speedAttributeId: number;
};

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduce(value: Fraction): Fraction {
  const divisor = gcd(value.numerator, value.denominator);
  return { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}

function add(left: Fraction, right: Fraction): Fraction {
  return reduce({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

function multiply(left: Fraction, right: Fraction): Fraction {
  return reduce({
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  });
}

function compare(left: Fraction, right: Fraction): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function exactProduct(factors: IntegerDamageFactors): bigint {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
    BigInt(factors.determination) * BigInt(factors.tenacity) *
    BigInt(factors.critical) * BigInt(factors.directHit);
}

function normalizedScore(
  candidate: IntegerDamageFactors,
  baseline: IntegerDamageFactors,
  objective: Objective,
): Fraction {
  return reduce({
    numerator: exactProduct(candidate) *
      (objective === "dps" ? BigInt(baseline.gcdCentiseconds) : 1n),
    denominator: exactProduct(baseline) *
      (objective === "dps" ? BigInt(candidate.gcdCentiseconds) : 1n),
  });
}

function equipment(
  itemId: number,
  stats: Readonly<Record<number, number>>,
  weapon?: { stat: "PDMG" | "MDMG"; damage: number },
): EquipInfo {
  const params: ParamInfo[] = Object.entries({
    ...stats,
    ...(weapon === undefined ? {} : { [attributeIdByStat[weapon.stat]!]: weapon.damage }),
  })
    .map(([baseParamId, value]) => ({ baseParamId: Number(baseParamId), value }))
    .sort((left, right) => left.baseParamId - right.baseParamId);
  return {
    itemId,
    itemLevel: 795,
    key: `synthetic-${itemId}`,
    baseParams: params,
    PDMG: weapon?.stat === "PDMG" ? weapon.damage : 0,
    MDMG: weapon?.stat === "MDMG" ? weapon.damage : 0,
    DLY: 0,
  };
}

function food(itemId: number, stats: readonly number[]): FoodInfo {
  return {
    itemId,
    itemLevel: 795,
    key: `synthetic-food-${itemId}`,
    baseParams: stats.map((baseParamId) => ({
      baseParamId,
      multiplier: 1.1,
      maxValue: 35,
    })),
  };
}

function statIndexesFor(job: JobId): ReadonlyMap<Stat, number> {
  const schema = gameData.jobSchemas[job];
  assert.ok(schema.dataSources?.some((source) =>
    source.kind === "mcp" && source.server === "ffxiv-mcp-lumina"));
  assert.ok(schema.mainStat);
  const attackStat: Stat = schema.mainStat === "VIT" ? "STR" : schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const stats: Stat[] = [attackStat, weaponStat, "CRT", "DET", "DHT", "TEN", speedStat];
  return new Map(stats.map((stat) => {
    const attributeId = attributeIdByStat[stat];
    assert.notEqual(attributeId, undefined, `fixture must map the ${stat} vector coordinate`);
    return [stat, attributeIndexById.get(attributeId!)!] as const;
  }));
}

function makeJob(
  job: JobId,
  weapons: readonly EquipInfo[],
  rings: readonly EquipInfo[],
  foods: readonly FoodInfo[],
  constraints?: ExactMipOptions["constraints"],
): FixtureJob {
  const schema = gameData.jobSchemas[job];
  assert.ok(schema.mainStat);
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const speedAttributeId = attributeIdByStat[speedStat]!;
  const statIndexes = statIndexesFor(job);
  const evaluate = createDamageGcdVectorEvaluator(job as Job, jobLevel, statIndexes);
  const evaluateFactors = createIntegerDamageFactorEvaluator(job as Job, jobLevel, statIndexes);
  return {
    id: job,
    job,
    slotNames: ["weapon", "ring"],
    speedAttributeId,
    evaluateFactors,
    options: {
      job: job as Job,
      jobLevel,
      attributeIds,
      statIndexes,
      slots: [weapons, rings],
      foods,
      ...(constraints === undefined ? {} : { constraints }),
      speedAttributeId,
      evaluationFunction: evaluate,
      objective: "damage",
      maxSearchMs: 20_000,
      // Deliberately omit equipmentAttributeExtractor: production defaults to
      // EquipInfo.baseParams, including the weapon-attribute coordinates.
    },
  };
}

function vectorFor(selection: readonly EquipInfo[], selectedFood: FoodInfo | undefined): number[] {
  const attributes = new Array<number>(attributeIds.length).fill(0);
  for (const item of selection) {
    for (const param of item.baseParams) {
      const index = attributeIndexById.get(param.baseParamId);
      if (index !== undefined) attributes[index] += param.value;
    }
  }
  if (selectedFood !== undefined) {
    for (const param of selectedFood.baseParams) {
      const index = attributeIndexById.get(param.baseParamId);
      if (index === undefined) continue;
      attributes[index] += Math.min(
        param.maxValue,
        Math.trunc((attributes[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
      );
    }
  }
  return attributes;
}

function enumerateJob(job: FixtureJob): Candidate[] {
  const candidates: Candidate[] = [];
  const foodChoices: readonly (FoodInfo | undefined)[] = job.options.foods.length === 0
    ? [undefined]
    : job.options.foods;
  for (const weapon of job.options.slots[0]!) {
    for (const ring of job.options.slots[1]!) {
      for (const selectedFood of foodChoices) {
        const selection = [weapon, ring];
        const attributes = vectorFor(selection, selectedFood);
        const factors = job.evaluateFactors(attributes);
        assert.ok(factors);
        candidates.push({ selection, food: selectedFood, attributes, factors });
      }
    }
  }
  return candidates;
}

function soloBaseline(job: FixtureJob, objective: Objective): IntegerDamageFactors {
  const candidates = enumerateJob(job);
  let best = candidates[0]!;
  for (const candidate of candidates.slice(1)) {
    if (compare(
      normalizedScore(candidate.factors, best.factors, objective),
      { numerator: 1n, denominator: 1n },
    ) > 0) best = candidate;
  }
  return best.factors;
}

function jointOracle(
  jobs: readonly FixtureJob[],
  sharedFood: boolean,
  objective: Objective,
): { value: Fraction; results: Candidate[] } | undefined {
  const candidateLists = jobs.map(enumerateJob);
  const baselines = jobs.map((job) => soloBaseline(job, objective));
  let best: { value: Fraction; results: Candidate[] } | undefined;
  const chosen: Candidate[] = [];
  const visit = (jobIndex: number): void => {
    if (jobIndex < jobs.length) {
      for (const candidate of candidateLists[jobIndex]!) {
        chosen[jobIndex] = candidate;
        visit(jobIndex + 1);
      }
      return;
    }
    const sharedRingId = chosen[0]!.selection[1]!.itemId;
    if (chosen.some((candidate) => candidate.selection[1]!.itemId !== sharedRingId)) return;
    if (sharedFood && chosen.some((candidate) => candidate.food?.itemId !== chosen[0]!.food?.itemId)) return;
    const value = chosen.reduce(
      (sum, candidate, index) => add(sum, normalizedScore(candidate.factors, baselines[index]!, objective)),
      { numerator: 0n, denominator: 1n },
    );
    if (best === undefined || compare(value, best.value) > 0) {
      best = { value, results: [...chosen] };
    }
  };
  visit(0);
  return best;
}

function jointJobArgs(jobs: readonly FixtureJob[], objective: Objective) {
  return jobs.map((job) => ({
    id: job.id,
    slotNames: job.slotNames,
    options: job.options,
    baseline: soloBaseline(job, objective),
  }));
}

function assertJointMatchesEnumeration(
  actual: Awaited<ReturnType<typeof findBestJointFactorMip>>,
  expected: ReturnType<typeof jointOracle>,
  jobs: readonly FixtureJob[],
  sharedFood: boolean,
  objective: Objective,
): asserts actual is NonNullable<Awaited<ReturnType<typeof findBestJointFactorMip>>> {
  assert.ok(expected);
  assert.ok(actual);
  const actualValue = actual.results.reduce((sum, result, index) => {
    const attributes = vectorFor(result.selection, result.food);
    const factors = jobs[index]!.evaluateFactors(attributes);
    assert.ok(factors);
    return add(sum, normalizedScore(factors, soloBaseline(jobs[index]!, objective), objective));
  }, { numerator: 0n, denominator: 1n });
  assert.equal(
    actualValue.numerator * expected.value.denominator,
    expected.value.numerator * actualValue.denominator,
    "the public joint solver must equal exhaustive exact normalized-ratio enumeration",
  );
  assert.equal(actual.results.length, jobs.length);
  assert.equal(actual.results[0]!.selection[1]!.itemId, actual.results[1]!.selection[1]!.itemId,
    "both jobs must select the same physical ring");
  if (sharedFood) {
    assert.equal(actual.results[0]!.food?.itemId, actual.results[1]!.food?.itemId,
      "shared food must resolve to one physical food identity");
  }
  assert.equal(actual.solverRuns, actual.signatures + 1,
    "the final solver run must close the signature search or reach the all-solo-baselines upper bound");
}

const tradeoffRings = [
  equipment(7101, { 7: 1000, 1: 100 }),
  equipment(7102, { 7: 500, 1: 500 }),
  equipment(7103, { 7: 0, 1: 1000 }),
];

function tradeoffJobs(foods: readonly FoodInfo[] = []): FixtureJob[] {
  const rdmWeapon = equipment(7201, {}, { stat: "MDMG", damage: 160 });
  const samWeapon = equipment(7202, {}, { stat: "PDMG", damage: 160 });
  return [
    makeJob("RDM", [rdmWeapon], tradeoffRings, foods),
    makeJob("SAM", [samWeapon], tradeoffRings, foods),
  ];
}

test("direct joint factor MIP proves the exact shared-gear sum without initial results", async () => {
  const jobs = tradeoffJobs();
  const expected = jointOracle(jobs, false, "damage");
  assert.ok(expected);

  // This fixture separates the geometric/product filter's best ring from the
  // exact arithmetic sum, so a second improving signature is needed.
  const soloBaselines = jobs.map((job) => soloBaseline(job, "damage"));
  const productWinner = tradeoffRings.reduce((best, ring) => {
    const candidateProduct = jobs.reduce((product, job, index) => {
      const candidate = enumerateJob(job).find((entry) => entry.selection[1]!.itemId === ring.itemId)!;
      return multiply(product, normalizedScore(candidate.factors, soloBaselines[index]!, "damage"));
    }, { numerator: 1n, denominator: 1n });
    return compare(candidateProduct, best.product) > 0 ? { itemId: ring.itemId, product: candidateProduct } : best;
  }, { itemId: -1, product: { numerator: 0n, denominator: 1n } });
  assert.notEqual(expected.results[0]!.selection[1]!.itemId, productWinner.itemId,
    "the exhaustive normalized sum must distinguish the arithmetic optimum from the product filter");

  const actual = await findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: ["ring"],
    sharedFood: false,
    equipmentIdentity: (item) => String(item.itemId),
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  assertJointMatchesEnumeration(actual, expected, jobs, false, "damage");
  assert.ok(actual.signatures >= 2,
    "the direct call without a warm start must inspect a later factor signature that improves the sum");
});

test("direct joint factor MIP selects one shared food identity and matches enumeration", async () => {
  const sharedFoods = [food(9001, [1]), food(9002, [7])];
  const jobs = tradeoffJobs(sharedFoods);
  const expected = jointOracle(jobs, true, "dps");
  assert.ok(expected);

  const actual = await findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "dps"),
    commonSlots: ["ring"],
    sharedFood: true,
    equipmentIdentity: (item) => String(item.itemId),
    foodIdentity: (item) => String(item.itemId),
    objective: "dps",
    maxSearchMs: 20_000,
  });

  assertJointMatchesEnumeration(actual, expected, jobs, true, "dps");
  assert.ok(actual.results[0]!.food);
});

test("direct joint factor MIP reports infeasible when jobs have no common food identity", async () => {
  const jobs = [
    makeJob("RDM", [equipment(7301, {}, { stat: "MDMG", damage: 160 })], tradeoffRings, [food(9101, [1])]),
    makeJob("SAM", [equipment(7302, {}, { stat: "PDMG", damage: 160 })], tradeoffRings, [food(9102, [7])]),
  ];

  const actual = await findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: ["ring"],
    sharedFood: true,
    equipmentIdentity: (item) => String(item.itemId),
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  assert.equal(actual, undefined);
});

function exactOptionsForOneSidedSpeed(
  constraints: NonNullable<ExactMipOptions["constraints"]>,
): ExactMipOptions {
  const rings = [
    equipment(8101, { 2: 34, 3: 12, 4: 8, 5: 12, 6: 6 }),
    equipment(8102, { 2: 8, 3: 31, 4: 18, 5: 3, 6: 15 }),
  ];
  const weapons = [
    equipment(8201, { 1: 520, 2: 30, 3: 20, 4: 15, 5: 24, 6: 8 }, { stat: "MDMG", damage: 160 }),
    equipment(8202, { 1: 490, 2: 15, 3: 38, 4: 24, 5: 5, 6: 16 }, { stat: "MDMG", damage: 158 }),
  ];
  const foods = [food(9301, [5]), food(9302, [1, 2])];
  const job = makeJob("RDM", weapons, rings, foods, constraints);
  return job.options;
}

function bestExactDamage(candidates: readonly Candidate[]): bigint {
  assert.ok(candidates.length > 0);
  return candidates.reduce((best, candidate) =>
    exactProduct(candidate.factors) > best ? exactProduct(candidate.factors) : best,
    0n,
  );
}

test("exact MIP honors lower-only and upper-only speed constraints against enumeration", async () => {
  for (const bound of ["minimum", "maximum"] as const) {
    const probe = exactOptionsForOneSidedSpeed({});
    const probeFactors = createIntegerDamageFactorEvaluator("RDM", jobLevel, probe.statIndexes);
    const all = probe.slots[0]!.flatMap((weapon) => probe.slots[1]!.flatMap((ring) =>
      probe.foods.map((selectedFood) => {
        const selection = [weapon, ring];
        const attributes = vectorFor(selection, selectedFood);
        const factors = probeFactors(attributes);
        assert.ok(factors);
        return { selection, food: selectedFood, attributes, factors };
      }),
    ));
    const speedIndex = attributeIndexById.get(5)!;
    const distinctSpeeds = [...new Set(all.map((candidate) => candidate.attributes[speedIndex]!))].sort((a, b) => a - b);
    assert.ok(distinctSpeeds.length >= 3);
    const speedBound = bound === "minimum" ? distinctSpeeds[1]! : distinctSpeeds[distinctSpeeds.length - 2]!;
    const eligible = all.filter((candidate) => bound === "minimum"
      ? candidate.attributes[speedIndex]! >= speedBound
      : candidate.attributes[speedIndex]! <= speedBound);
    assert.ok(eligible.length > 0 && eligible.length < all.length,
      "the one-sided bound must remove some, but not all, reachable gear-food choices");

    const objective: Objective = "damage";
    const options = exactOptionsForOneSidedSpeed(bound === "minimum"
      ? { speedMin: speedBound }
      : { speedMax: speedBound });
    const evaluator = createIntegerDamageFactorEvaluator("RDM", jobLevel, options.statIndexes);
    const expectedCandidates = eligible.map((candidate) => {
      const factors = evaluator(candidate.attributes);
      assert.ok(factors);
      return factors;
    });
    const expected = bestExactDamage(expectedCandidates.map((factors) => ({
      selection: [], food: undefined, attributes: [], factors,
    })));
    const result = await findBestLoadoutExactMip(options);
    assert.ok(result);
    const actualFactors = evaluator(vectorFor(result.selection, result.food));
    assert.ok(actualFactors);
    assert.equal(
      exactProduct(actualFactors),
      expected,
      `${bound}-only speed filtering must preserve the exact best reachable damage factors`,
    );
    assert.equal(
      bound === "minimum"
        ? vectorFor(result.selection, result.food)[speedIndex]! >= speedBound
        : vectorFor(result.selection, result.food)[speedIndex]! <= speedBound,
      true,
    );
  }
});
