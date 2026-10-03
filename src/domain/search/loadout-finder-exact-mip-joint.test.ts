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
import { buildRingPairEquipInfos } from "./ring-pairs.ts";
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
  slotNames: readonly string[];
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

function ringCandidate(
  itemId: number,
  variantKey: string,
  stats: Readonly<Record<number, number>>,
  isUnique: boolean,
): EquipInfo {
  return {
    ...equipment(itemId, stats),
    variantKey,
    isUnique,
  } as EquipInfo;
}

function ringPairWithUniqueness(
  first: EquipInfo,
  second: EquipInfo,
  ringUniqueByItemId: readonly (readonly [number, boolean])[],
): EquipInfo & {
  ringEquips: readonly [EquipInfo, EquipInfo];
  ringUniqueByItemId: readonly (readonly [number, boolean])[];
} {
  const totals = new Map<number, number>();
  for (const param of [...first.baseParams, ...second.baseParams]) {
    totals.set(param.baseParamId, (totals.get(param.baseParamId) ?? 0) + param.value);
  }
  const baseParams = [...totals].map(([baseParamId, value]) => ({ baseParamId, value }))
    .sort((left, right) => left.baseParamId - right.baseParamId);
  return {
    itemId: first.itemId * 100_000 + second.itemId,
    itemLevel: first.itemLevel + second.itemLevel,
    key: baseParams.map((param) => param.baseParamId).join("-"),
    baseParams,
    PDMG: first.PDMG + second.PDMG,
    MDMG: first.MDMG + second.MDMG,
    DLY: first.DLY + second.DLY,
    ringEquips: [first, second],
    ringUniqueByItemId,
  };
}

function ringPairs(
  firstRings: readonly EquipInfo[],
  secondRings: readonly EquipInfo[] = firstRings,
): EquipInfo[] {
  const uniqueByItemId = new Map<number, boolean>();
  for (const ring of [...firstRings, ...secondRings]) {
    uniqueByItemId.set(ring.itemId, (ring as EquipInfo & { isUnique: boolean }).isUnique);
  }
  const uniqueness = [...uniqueByItemId].sort(([left], [right]) => left - right);
  return firstRings.flatMap((first) => secondRings.flatMap((second) =>
    first.itemId === second.itemId && uniqueByItemId.get(first.itemId) === true
      ? []
      : [ringPairWithUniqueness(first, second, uniqueness)]));
}

function pairFixtureJob(
  base: FixtureJob,
  firstRings: readonly EquipInfo[],
  secondRings: readonly EquipInfo[] = firstRings,
  slotName = "Finger",
): FixtureJob {
  const pairs = ringPairs(firstRings, secondRings);
  const job: FixtureJob = {
    ...base,
    slotNames: ["weapon", slotName],
    options: { ...base.options, slots: [base.options.slots[0]!, pairs] },
  };
  return { ...job, options: { ...job.options, objective: "damage" } };
}

function pairEquipmentIdentity(item: EquipInfo): string {
  const pair = (item as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] }).ringEquips;
  if (pair !== undefined) return JSON.stringify(pair.map(pairEquipmentIdentity).sort());
  return JSON.stringify({
    itemId: item.itemId,
    variantKey: item.variantKey,
    baseParams: item.baseParams.map(({ baseParamId, value }) => [baseParamId, value]),
  });
}

test("ring pair generation carries complete uniqueness metadata without cloning child equipment", () => {
  const unique = ringCandidate(990, "unique", { 1: 100 }, true);
  const repeatable = ringCandidate(991, "repeatable", { 1: 50 }, false);
  const pairs = buildRingPairEquipInfos([unique, repeatable], (itemId) => itemId === unique.itemId);
  const pair = pairs.find((candidate) =>
    candidate.ringEquips[0] === unique && candidate.ringEquips[1] === repeatable);

  assert.ok(pair);
  assert.deepEqual(pair.ringUniqueByItemId, [[990, true], [991, false]]);
  assert.strictEqual(pair.ringEquips[0], unique);
  assert.strictEqual(pair.ringEquips[1], repeatable);
});

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

test("joint ring splitting keeps unique item ID variants from occupying both ring slots", async () => {
  const rings = [
    ringCandidate(100, "unique-a", { 1: 900, 7: 900 }, true),
    ringCandidate(100, "unique-b", { 1: 880, 7: 880 }, true),
    ringCandidate(200, "ordinary-a", { 1: 300, 7: 300 }, false),
    ringCandidate(300, "ordinary-b", { 1: 100, 7: 100 }, false),
  ];
  const jobs = tradeoffJobs().map((job) => pairFixtureJob(job, rings));
  const actual = await findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: [],
    sharedFood: false,
    equipmentIdentity: pairEquipmentIdentity,
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  assert.ok(actual);
  for (const result of actual.results) {
    const pair = result.selection[1] as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] };
    assert.ok(pair.ringEquips, "the joint result must restore its pair-shaped ring selection");
    assert.equal(
      pair.ringEquips[0].itemId === 100 && pair.ringEquips[1].itemId === 100,
      false,
      "variants of one unique item must conflict by physical itemId across both slots",
    );
  }
});

test("initial results reject an ordered pair of two variants of one unique ring", async () => {
  const uniqueA = ringCandidate(150, "unique-a", { 1: 900, 7: 900 }, true);
  const uniqueB = ringCandidate(150, "unique-b", { 1: 880, 7: 880 }, true);
  const ordinary = ringCandidate(151, "ordinary", { 1: 300, 7: 300 }, false);
  const rings = [uniqueA, uniqueB, ordinary];
  const jobs = tradeoffJobs().map((job) => pairFixtureJob(job, rings));
  const solveOptions = {
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: [],
    sharedFood: false,
    equipmentIdentity: pairEquipmentIdentity,
    foodIdentity: (item: FoodInfo) => String(item.itemId),
    objective: "damage" as const,
    maxSearchMs: 20_000,
  };
  const valid = await findBestJointFactorMip(solveOptions);
  assert.ok(valid);
  assert.ok(jobs[0]!.options.slots[1]!.some((candidate) =>
    (candidate as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] }).ringEquips?.[0] === uniqueA));
  assert.ok(jobs[0]!.options.slots[1]!.some((candidate) =>
    (candidate as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] }).ringEquips?.[1] === uniqueB));

  const invalidPair = ringPairWithUniqueness(uniqueA, uniqueB, [[150, true], [151, false]]);
  const initialResults = [...valid.results];
  initialResults[0] = {
    ...initialResults[0]!,
    selection: [initialResults[0]!.selection[0]!, invalidPair],
  };
  await assert.rejects(
    findBestJointFactorMip({ ...solveOptions, initialResults }),
    /联合初始方案装备不属于模型候选/,
    "individually present children do not make an excluded unique pair a valid initial candidate",
  );
});

test("joint ring splitting still allows the same nonunique item in both ring slots", async () => {
  const rings = [
    ringCandidate(400, "repeatable", { 1: 1200, 7: 1200 }, false),
    ringCandidate(401, "weaker", { 1: 20, 7: 20 }, false),
  ];
  const jobs = tradeoffJobs().map((job) => pairFixtureJob(job, rings));
  const actual = await findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: [],
    sharedFood: false,
    equipmentIdentity: pairEquipmentIdentity,
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  assert.ok(actual);
  for (const result of actual.results) {
    const pair = result.selection[1] as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] };
    assert.deepEqual(pair.ringEquips?.map((ring) => ring.itemId), [400, 400]);
  }
});

test("shared full ring pairs use unordered child identity and restore each ordered pair", async () => {
  const left = ringCandidate(510, "left", { 1: 400, 7: 400 }, false);
  const right = ringCandidate(511, "right", { 1: 390, 7: 390 }, false);
  const bases = tradeoffJobs();
  const jobs = [
    pairFixtureJob(bases[0]!, [left], [right]),
    pairFixtureJob(bases[1]!, [right], [left]),
  ];
  const actual = await findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: ["Finger"],
    sharedFood: false,
    equipmentIdentity: pairEquipmentIdentity,
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  assert.ok(actual);
  const first = (actual.results[0]!.selection[1] as EquipInfo & {
    ringEquips?: readonly [EquipInfo, EquipInfo];
  }).ringEquips;
  const second = (actual.results[1]!.selection[1] as EquipInfo & {
    ringEquips?: readonly [EquipInfo, EquipInfo];
  }).ringEquips;
  assert.deepEqual(first?.map((ring) => ring.itemId), [510, 511]);
  assert.deepEqual(second?.map((ring) => ring.itemId), [511, 510]);
  assert.deepEqual(first?.map(pairEquipmentIdentity).sort(), second?.map(pairEquipmentIdentity).sort());
});

test("shared projected ring and ring2 choices link directly to the matching split child slot", async () => {
  const rings = [
    ringCandidate(610, "a", { 1: 440, 7: 440 }, false),
    ringCandidate(611, "b", { 1: 390, 7: 390 }, false),
    ringCandidate(612, "c", { 1: 200, 7: 200 }, false),
  ];
  const bases = tradeoffJobs();
  for (const ringIndex of [0, 1] as const) {
    const jobs = bases.map((job) => pairFixtureJob(job, rings));
    const commonSlot = ringIndex === 0 ? "ring" : "ring2";
    const actual = await findBestJointFactorMip({
      jobs: jointJobArgs(jobs, "damage"),
      commonSlots: [commonSlot],
      commonSlotProjections: [{ commonSlot, slotName: "Finger", ringIndex }],
      sharedFood: false,
      equipmentIdentity: pairEquipmentIdentity,
      foodIdentity: (item) => String(item.itemId),
      objective: "damage",
      maxSearchMs: 20_000,
    });

    assert.ok(actual);
    const selected = actual.results.map((result) => {
      const pair = result.selection[1] as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] };
      return pair.ringEquips?.[ringIndex];
    });
    assert.equal(pairEquipmentIdentity(selected[0]!), pairEquipmentIdentity(selected[1]!));
  }
});

test("an incomplete pair domain falls back to pair variables instead of splitting", async () => {
  const rings = [
    ringCandidate(710, "a", { 1: 500, 7: 500 }, false),
    ringCandidate(711, "b", { 1: 300, 7: 300 }, false),
    ringCandidate(712, "c", { 1: 100, 7: 100 }, false),
  ];
  const bases = tradeoffJobs();
  const completeJobs = bases.map((job) => pairFixtureJob(job, rings));
  const incompleteJobs = [...completeJobs];
  const incompletePairJob = incompleteJobs[1]!;
  const incompletePairs = [...incompletePairJob.options.slots[1]!];
  incompletePairs.splice(1, 1);
  incompleteJobs[1] = {
    ...incompletePairJob,
    options: { ...incompletePairJob.options, slots: [incompletePairJob.options.slots[0]!, incompletePairs] },
  };
  const solve = (jobs: readonly FixtureJob[]) => findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: ["Finger"],
    sharedFood: false,
    equipmentIdentity: pairEquipmentIdentity,
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  const split = await solve(completeJobs);
  const fallback = await solve(incompleteJobs);
  assert.ok(split);
  assert.ok(fallback);
  assert.ok(
    split.results[0]!.statistics.variables < fallback.results[0]!.statistics.variables,
    `a validated Cartesian pair domain must split ring variables (${split.results[0]!.statistics.variables} vs ${fallback.results[0]!.statistics.variables})`,
  );
});

test("pair domains without uniqueness metadata conservatively use the legacy model", async () => {
  const rings = [
    ringCandidate(810, "a", { 1: 500, 7: 500 }, false),
    ringCandidate(811, "b", { 1: 300, 7: 300 }, false),
    ringCandidate(812, "c", { 1: 100, 7: 100 }, false),
  ];
  const bases = tradeoffJobs();
  const completeJobs = bases.map((job) => pairFixtureJob(job, rings));
  const metadataFreeJobs = completeJobs.map((job) => ({
    ...job,
    options: {
      ...job.options,
      slots: [job.options.slots[0]!, job.options.slots[1]!.map((candidate) => {
        const { ringUniqueByItemId: _metadata, ...legacyPair } = candidate as EquipInfo & {
          ringUniqueByItemId?: readonly (readonly [number, boolean])[];
        };
        return legacyPair as EquipInfo;
      })],
    },
  }));
  const solve = (jobs: readonly FixtureJob[]) => findBestJointFactorMip({
    jobs: jointJobArgs(jobs, "damage"),
    commonSlots: ["Finger"],
    sharedFood: false,
    equipmentIdentity: pairEquipmentIdentity,
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  const split = await solve(completeJobs);
  const legacy = await solve(metadataFreeJobs);
  assert.ok(split);
  assert.ok(legacy);
  assert.ok(
    split.results[0]!.statistics.variables < legacy.results[0]!.statistics.variables,
    "missing physical uniqueness metadata must disable the split layout",
  );
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
