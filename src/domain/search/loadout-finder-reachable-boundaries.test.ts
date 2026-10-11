import assert from "node:assert/strict";
import { test } from "vitest";
import type { Job, JobLevel } from "./equipped-effects.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import type { Stat } from "../types.ts";
import { findBestJointLoadoutV3 } from "./loadout-finder-v3.ts";
import type { JointLoadoutJobV3 } from "./loadout-finder-v3.ts";
import type { ExactMipOptions } from "./loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

const attributeIds = [-2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const attributeIndex = new Map(attributeIds.map((id, index) => [id, index]));
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

type JobCode = "RDM" | "SAM";
type FixtureJob = JointLoadoutJobV3 & {
  options: ExactMipOptions;
  factors: (attributes: readonly number[]) => IntegerDamageFactors | undefined;
};
type Fraction = { numerator: bigint; denominator: bigint };

function equipment(
  itemId: number,
  attributes: Readonly<Record<number, number>>,
  weapon?: { stat: "PDMG" | "MDMG"; damage: number },
): EquipInfo {
  const params: ParamInfo[] = Object.entries({
    ...attributes,
    ...(weapon === undefined
      ? {}
      : { [attributeIdByStat[weapon.stat]!]: weapon.damage }),
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

function statIndexesFor(job: JobCode): ReadonlyMap<Stat, number> {
  const mainStat: Stat = job === "RDM" ? "INT" : "STR";
  const weaponStat: Stat = job === "RDM" ? "MDMG" : "PDMG";
  const speedStat: Stat = job === "RDM" ? "SPS" : "SKS";
  const stats: Stat[] = [mainStat, weaponStat, "CRT", "DET", "DHT", "TEN", speedStat];
  return new Map(stats.map((stat) => {
    const id = attributeIdByStat[stat];
    assert.notEqual(id, undefined);
    return [stat, attributeIndex.get(id!)!] as const;
  }));
}

function makeJob(
  job: JobCode,
  weapon: EquipInfo,
  rings: readonly EquipInfo[],
): FixtureJob {
  const jobLevel = 100 as JobLevel;
  const statIndexes = statIndexesFor(job);
  const evaluate = createDamageGcdVectorEvaluator(job as Job, jobLevel, statIndexes);
  const factors = createIntegerDamageFactorEvaluator(job as Job, jobLevel, statIndexes);
  return {
    id: job,
    slotNames: ["weapon", "ring"],
    factors,
    options: {
      job: job as Job,
      jobLevel,
      attributeIds,
      statIndexes,
      slots: [[weapon], rings],
      foods: [],
      constraints: { maxToughnessMode: true },
      toughnessAttributeId: 6,
      evaluationFunction: evaluate,
      objective: "damage",
      maxSearchMs: 15_000,
      // These fixtures keep weapon damage in baseParams, as the production
      // optimizer does when no custom equipment extractor is configured.
    },
  };
}

function makeInactiveJob(job: FixtureJob, id: string): FixtureJob {
  const evaluate = job.options.evaluationFunction;
  assert.ok(evaluate);
  return {
    ...job,
    id,
    options: {
      ...job.options,
      evaluationFunction: (attributes) => {
        const result = evaluate(attributes);
        return result === undefined ? undefined : { ...result, damage: 0 };
      },
    },
  };
}

function attributesFor(selection: readonly EquipInfo[]): number[] {
  const result = new Array<number>(attributeIds.length).fill(0);
  for (const item of selection) {
    for (const param of item.baseParams) {
      const index = attributeIndex.get(param.baseParamId);
      if (index !== undefined) result[index] += param.value;
    }
  }
  return result;
}

function attributesForWithFood(
  selection: readonly EquipInfo[],
  selectedFood: FoodInfo,
): number[] {
  const result = attributesFor(selection);
  for (const param of selectedFood.baseParams) {
    const index = attributeIndex.get(param.baseParamId);
    if (index === undefined) continue;
    result[index] += Math.min(
      param.maxValue,
      Math.trunc((result[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
    );
  }
  return result;
}

function product(factors: IntegerDamageFactors): bigint {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
    BigInt(factors.determination) * BigInt(factors.tenacity) *
    BigInt(factors.critical) * BigInt(factors.directHit);
}

function reduceFraction(value: Fraction): Fraction {
  let left = value.numerator;
  let right = value.denominator;
  while (right !== 0n) [left, right] = [right, left % right];
  return { numerator: value.numerator / left, denominator: value.denominator / left };
}

function compareFractions(left: Fraction, right: Fraction): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function soloMaximum(job: FixtureJob): { tenacity: number; product: bigint } {
  let maximumTenacity = -1;
  const candidates: { tenacity: number; product: bigint }[] = [];
  for (const weapon of job.options.slots[0]!) {
    for (const ring of job.options.slots[1]!) {
      const attributes = attributesFor([weapon, ring]);
      const factors = job.factors(attributes);
      assert.ok(factors);
      const tenacity = attributes[attributeIndex.get(6)!]!;
      maximumTenacity = Math.max(maximumTenacity, tenacity);
      candidates.push({ tenacity, product: product(factors) });
    }
  }
  const eligible = candidates.filter((candidate) => candidate.tenacity === maximumTenacity);
  const bestProduct = eligible.reduce((best, candidate) =>
    candidate.product > best ? candidate.product : best, 0n);
  return { tenacity: maximumTenacity, product: bestProduct };
}

function soloDpsMaximum(job: FixtureJob): {
  tenacity: number;
  product: bigint;
  gcdCentiseconds: number;
  ringId: number;
} {
  let maximumTenacity = -1;
  const candidates: {
    tenacity: number;
    product: bigint;
    gcdCentiseconds: number;
    ringId: number;
  }[] = [];
  for (const weapon of job.options.slots[0]!) {
    for (const ring of job.options.slots[1]!) {
      const attributes = attributesFor([weapon, ring]);
      const factors = job.factors(attributes);
      assert.ok(factors);
      const tenacity = attributes[attributeIndex.get(6)!]!;
      maximumTenacity = Math.max(maximumTenacity, tenacity);
      candidates.push({
        tenacity,
        product: product(factors),
        gcdCentiseconds: factors.gcdCentiseconds,
        ringId: ring.itemId,
      });
    }
  }
  const eligible = candidates.filter((candidate) => candidate.tenacity === maximumTenacity);
  const best = eligible.reduce((current, candidate) =>
    candidate.product * BigInt(current.gcdCentiseconds) >
      current.product * BigInt(candidate.gcdCentiseconds)
      ? candidate
      : current,
  );
  return { ...best, tenacity: maximumTenacity };
}

function addFractions(left: Fraction, right: Fraction): Fraction {
  return reduceFraction({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

function jointOracle(
  jobs: readonly FixtureJob[],
): { fraction: Fraction; ringId: number; baselines: Map<string, bigint>; maxima: Map<string, number> } {
  const baselineByJob = jobs.map((job) => [job.id, soloMaximum(job)] as const);
  const commonRingIds = jobs.slice(1).map((job) => new Set(job.options.slots[1]!.map((ring) => ring.itemId)));
  const ringCandidates = jobs[0]!.options.slots[1]!.filter((ring) =>
    commonRingIds.every((ids) => ids.has(ring.itemId)));
  let best: { fraction: Fraction; ringId: number } | undefined;
  for (const ring of ringCandidates) {
    if (jobs.some((job) => {
      const weapon = job.options.slots[0]![0]!;
      const tenacity = attributesFor([weapon, ring])[attributeIndex.get(6)!]!;
      return tenacity !== baselineByJob.find(([id]) => id === job.id)![1].tenacity;
    })) continue;
    const products = jobs.map((job) => {
      const weapon = job.options.slots[0]![0]!;
      const factors = job.factors(attributesFor([weapon, ring]));
      assert.ok(factors);
      const tenacity = attributesFor([weapon, ring])[attributeIndex.get(6)!]!;
      assert.equal(tenacity, baselineByJob.find(([id]) => id === job.id)![1].tenacity);
      return product(factors);
    });
    const fraction = reduceFraction({
      numerator: products.reduce((sum, candidate, index) =>
        sum + candidate * baselineByJob[1 - index]![1].product, 0n),
      denominator: baselineByJob[0]![1].product * baselineByJob[1]![1].product,
    });
    if (best === undefined || compareFractions(fraction, best.fraction) > 0) {
      best = { fraction, ringId: ring.itemId };
    }
  }
  assert.ok(best);
  return {
    ...best,
    baselines: new Map(baselineByJob.map(([id, value]) => [id, value.product])),
    maxima: new Map(baselineByJob.map(([id, value]) => [id, value.tenacity])),
  };
}

function jointDpsOracle(
  jobs: readonly FixtureJob[],
): { fraction: Fraction; ringId: number; baselines: Map<string, bigint>; gcds: Map<string, number> } {
  const baselineByJob = jobs.map((job) => [job.id, soloDpsMaximum(job)] as const);
  const commonRingIds = jobs.slice(1).map((job) => new Set(job.options.slots[1]!.map((ring) => ring.itemId)));
  const ringCandidates = jobs[0]!.options.slots[1]!.filter((ring) =>
    commonRingIds.every((ids) => ids.has(ring.itemId)));
  let best: { fraction: Fraction; ringId: number } | undefined;
  for (const ring of ringCandidates) {
    const fraction = jobs.reduce((sum, job) => {
      const weapon = job.options.slots[0]![0]!;
      const factors = job.factors(attributesFor([weapon, ring]));
      assert.ok(factors);
      const candidateProduct = product(factors);
      const baseline = baselineByJob.find(([id]) => id === job.id)![1];
      assert.equal(attributesFor([weapon, ring])[attributeIndex.get(6)!], baseline.tenacity);
      return addFractions(sum, reduceFraction({
        numerator: candidateProduct * BigInt(baseline.gcdCentiseconds),
        denominator: BigInt(factors.gcdCentiseconds) * baseline.product,
      }));
    }, { numerator: 0n, denominator: 1n });
    if (best === undefined || compareFractions(fraction, best.fraction) > 0) {
      best = { fraction, ringId: ring.itemId };
    }
  }
  assert.ok(best);
  return {
    ...best,
    baselines: new Map(baselineByJob.map(([id, value]) => [id, value.product])),
    gcds: new Map(baselineByJob.map(([id, value]) => [id, value.gcdCentiseconds])),
  };
}

function sharedFoodsOracle(
  jobs: readonly FixtureJob[],
): { fraction: Fraction; bestFoodIds: number[] } {
  const baselineProducts = new Map(jobs.map((job) => {
    const selection = job.options.slots.map((slot) => slot[0]!);
    const baseline = job.options.foods.reduce((best, food) => {
      const factors = job.factors(attributesForWithFood(selection, food));
      assert.ok(factors);
      return product(factors) > best ? product(factors) : best;
    }, 0n);
    return [job.id, baseline] as const;
  }));
  let best: { fraction: Fraction; foodId: number } | undefined;
  for (const food of jobs[0]!.options.foods) {
    const fraction = jobs.reduce((sum, job) => {
      const selection = job.options.slots.map((slot) => slot[0]!);
      const factors = job.factors(attributesForWithFood(selection, food));
      assert.ok(factors);
      return addFractions(sum, reduceFraction({
        numerator: product(factors),
        denominator: baselineProducts.get(job.id)!,
      }));
    }, { numerator: 0n, denominator: 1n });
    if (best === undefined || compareFractions(fraction, best.fraction) > 0) {
      best = { fraction, foodId: food.itemId };
    }
  }
  assert.ok(best);
  const bestFoodIds = jobs[0]!.options.foods.filter((food) => {
    const factors = jobs.reduce((sum, job) => {
      const selection = job.options.slots.map((slot) => slot[0]!);
      const value = job.factors(attributesForWithFood(selection, food));
      assert.ok(value);
      return addFractions(sum, reduceFraction({
        numerator: product(value),
        denominator: baselineProducts.get(job.id)!,
      }));
    }, { numerator: 0n, denominator: 1n });
    return compareFractions(factors, best!.fraction) === 0;
  }).map((food) => food.itemId);
  return { fraction: best.fraction, bestFoodIds };
}

test("V3 keeps each job's maximum tenacity through the shared factor-MIP proof", async () => {
  const rings = [
    equipment(9601, { 1: 500, 7: 100, 2: 30, 3: 20, 4: 25, 5: 10, 6: 40, 8: 10 }),
    equipment(9602, { 1: 100, 7: 500, 2: 30, 3: 20, 4: 25, 5: 10, 6: 40, 8: 10 }),
  ];
  const jobs = [
    makeJob("RDM", equipment(9611, { 1: 400, 2: 12, 3: 12, 4: 12, 5: 12, 6: 0 },
      { stat: "MDMG", damage: 160 }), rings),
    makeJob("SAM", equipment(9612, { 7: 400, 2: 12, 3: 12, 4: 12, 6: 0, 8: 12 },
      { stat: "PDMG", damage: 160 }), rings),
  ];
  const expected = jointOracle(jobs);
  const soloRingIds = jobs.map((job) => {
    const optimum = soloMaximum(job);
    return job.options.slots[1]!.find((ring) =>
      product(job.factors(attributesFor([job.options.slots[0]![0]!, ring]))!) === optimum.product,
    )!.itemId;
  });
  assert.notEqual(soloRingIds[0], soloRingIds[1], "the solo max-tenacity optima must conflict on their shared ring");

  const result = await findBestJointLoadoutV3({
    jobs,
    commonSlots: ["ring"],
    foodStrategy: "independent",
    objective: "damage",
  });

  assert.ok(result);
  assert.equal(result.proof.complete, true);
  assert.ok(result.proof.innerSolverStatus === "Optimal" || result.proof.innerSolverStatus === "DualBound");
  assert.ok(result.statistics.completeNodes >= 1,
    "the fixture must reach the shared factor-MIP proof after restricted max-tenacity solves");
  assert.equal(result.commonEquipments.ring!.itemId, expected.ringId);
  assert.equal(
    BigInt(result.value.numerator) * expected.fraction.denominator,
    expected.fraction.numerator * BigInt(result.value.denominator),
    "the V3 normalized damage sum must match exact enumeration under both solo maximum-tenacity bounds",
  );

  for (const job of jobs) {
    const maximumTenacity = expected.maxima.get(job.id)!;
    assert.equal(result.optima[job.id]!.maximumToughness, maximumTenacity);
    assert.equal(
      attributesFor(result.jobResults[job.id]!.selection)[attributeIndex.get(6)!],
      maximumTenacity,
      `${job.id} must retain its own solo maximum TEN after the common ring is fixed`,
    );
  }
});

test("V3 finds the feasible shared ring after rejecting a max-TEN anchor", async () => {
  const tooLittleTenacity = equipment(9701, { 1: 260, 7: 260, 2: 30, 3: 20, 4: 25, 5: 10, 6: 0 });
  const commonMaxTenacity = equipment(9702, { 1: 120, 7: 120, 2: 30, 3: 20, 4: 25, 5: 10, 6: 80 });
  const rdmOnlyMaxTenacity = equipment(9703, { 1: 800, 2: 30, 3: 20, 4: 25, 5: 10, 6: 80 });
  const samOnlyMaxTenacity = equipment(9704, { 7: 800, 2: 30, 3: 20, 4: 25, 6: 80, 8: 10 });
  const jobs = [
    makeJob("RDM", equipment(9711, { 1: 400, 2: 12, 3: 12, 4: 12, 5: 12, 6: 0 },
      { stat: "MDMG", damage: 160 }), [tooLittleTenacity, commonMaxTenacity, rdmOnlyMaxTenacity]),
    makeJob("SAM", equipment(9712, { 7: 400, 2: 12, 3: 12, 4: 12, 6: 0, 8: 12 },
      { stat: "PDMG", damage: 160 }), [tooLittleTenacity, commonMaxTenacity, samOnlyMaxTenacity]),
  ];
  const expected = jointOracle(jobs);

  const result = await findBestJointLoadoutV3({
    jobs,
    commonSlots: ["ring"],
    foodStrategy: "independent",
    objective: "damage",
  });

  assert.ok(result);
  assert.equal(result.proof.complete, true);
  assert.ok(result.proof.innerSolverStatus === "Optimal" || result.proof.innerSolverStatus === "DualBound");
  assert.ok(result.statistics.cacheEntries >= 1,
    "the failed restricted solve should remain in the result cache as an infeasible entry");
  assert.ok(result.statistics.completeNodes >= 1,
    "after rejecting the infeasible anchor, the shared joint model must prove the feasible alternative");
  assert.equal(result.commonEquipments.ring!.itemId, expected.ringId);
  assert.equal(expected.ringId, commonMaxTenacity.itemId);
  assert.equal(
    BigInt(result.value.numerator) * expected.fraction.denominator,
    expected.fraction.numerator * BigInt(result.value.denominator),
    "the normalized joint damage must match exact enumeration at both solo maximum-TEN bounds",
  );
  for (const job of jobs) {
    assert.equal(result.optima[job.id]!.selection[1]!.itemId,
      job.id === "RDM" ? rdmOnlyMaxTenacity.itemId : samOnlyMaxTenacity.itemId);
    assert.equal(
      attributesFor(result.jobResults[job.id]!.selection)[attributeIndex.get(6)!],
      expected.maxima.get(job.id),
      `${job.id} must stay at its solo maximum TEN under the common solution`,
    );
  }
});

test("V3 proves conflicting DPS baselines with exact outer-search enumeration", async () => {
  const intRing = equipment(9801, { 1: 500, 7: 80, 2: 30, 3: 20, 4: 25, 5: 0, 6: 0, 8: 40 });
  const strRing = equipment(9802, { 1: 80, 7: 500, 2: 30, 3: 20, 4: 25, 5: 40, 6: 0, 8: 0 });
  const balancedRing = equipment(9803, { 1: 200, 7: 200, 2: 30, 3: 80, 4: 25, 5: 20, 6: 0, 8: 20 });
  const rings = [intRing, strRing, balancedRing];
  const rdm = makeJob("RDM", equipment(9811, { 1: 400, 2: 12, 3: 12, 4: 12, 5: 0, 6: 0 },
    { stat: "MDMG", damage: 160 }), rings);
  const sam = makeJob("SAM", equipment(9812, { 7: 400, 2: 12, 3: 12, 4: 12, 6: 0, 8: 0 },
    { stat: "PDMG", damage: 160 }), rings);
  const inactiveGuard = makeInactiveJob(rdm, "inactive-guard");
  const expected = jointDpsOracle([rdm, sam]);
  assert.notEqual(soloDpsMaximum(rdm).ringId, soloDpsMaximum(sam).ringId,
    "the independent DPS optima must conflict on the shared ring");

  const result = await findBestJointLoadoutV3({
    jobs: [rdm, sam, inactiveGuard],
    commonSlots: ["ring"],
    foodStrategy: "independent",
    objective: "dps",
  });

  assert.ok(result);
  assert.equal(result.proof.complete, true);
  assert.equal(result.proof.objective, "dps");
  assert.ok(result.proof.outerBound.includes("DPS"), "this fixture must reach the DPS outer-bound branch");
  assert.ok(result.statistics.outerNodes >= 2, "conflicting relaxed optima must create outer branches");
  assert.ok(result.statistics.parentResultReuses >= 1,
    "a child fixing one job's relaxed ring should reuse that parent's exact result");
  assert.ok(result.statistics.upperBoundPrunes >= 1,
    "the inferior constrained ring branch should be pruned by its exact normalized DPS upper bound");
  assert.equal(result.commonEquipments.ring!.itemId, expected.ringId);
  assert.equal(
    BigInt(result.value.numerator) * expected.fraction.denominator,
    expected.fraction.numerator * BigInt(result.value.denominator),
    "the exact normalized DPS sum must match exhaustive enumeration of both shared rings",
  );
});

test("V3 reports outer-search progress after enumerating non-dominated shared foods", async () => {
  const foods: FoodInfo[] = Array.from({ length: 45 }, (_, index) => {
    const intBonus = index + 1;
    const strBonus = 46 - intBonus;
    return {
      itemId: 9900 + intBonus,
      itemLevel: 795,
      key: `synthetic-tradeoff-${intBonus}`,
      baseParams: [
        { baseParamId: 1, multiplier: 1.5, maxValue: intBonus },
        { baseParamId: 7, multiplier: 1.5, maxValue: strBonus },
      ],
    };
  });
  const rdmBase = makeJob("RDM", equipment(9911, { 1: 400, 2: 20, 3: 15, 4: 15, 5: 20, 6: 0 },
    { stat: "MDMG", damage: 160 }), [equipment(9912, { 2: 20, 3: 15, 4: 15, 5: 20, 6: 0 })]);
  const samBase = makeJob("SAM", equipment(9921, { 7: 400, 2: 20, 3: 15, 4: 15, 6: 0, 8: 20 },
    { stat: "PDMG", damage: 160 }), [equipment(9922, { 2: 20, 3: 15, 4: 15, 6: 0, 8: 20 })]);
  const jobs = [
    { ...rdmBase, options: { ...rdmBase.options, foods } },
    { ...samBase, options: { ...samBase.options, foods } },
  ];
  const expected = sharedFoodsOracle(jobs);
  assert.ok(
    compareFractions(expected.fraction, { numerator: 2n, denominator: 1n }) < 0,
    "no single physical food may attain both independent per-job baselines",
  );
  const progress: string[] = [];

  const result = await findBestJointLoadoutV3({
    jobs,
    commonSlots: [],
    foodStrategy: "shared",
    objective: "damage",
    onProgress: (message) => progress.push(message),
  });

  assert.ok(result);
  assert.equal(result.proof.complete, true);
  assert.equal(result.proof.objective, "damage");
  assert.equal(result.statistics.outerNodes, foods.length,
    "all non-dominated shared foods must be visited without stopping at the score ceiling");
  assert.ok(result.statistics.completeNodes >= 1);
  assert.equal(result.statistics.completeNodes + result.statistics.upperBoundPrunes, foods.length,
    "each physical food should either finish its exact node or be pruned by its normalized upper bound");
  assert.ok(progress.some((message) =>
    message.includes("V3 搜索进度：外层节点=32") && message.includes("上界剪枝=") && message.includes("内层 MIP=")),
  "V3 should emit its periodic outer-search progress with the node and solver counters");
  assert.ok(expected.bestFoodIds.includes(result.jobResults.RDM!.food!.itemId));
  assert.equal(result.jobResults.RDM!.food!.itemId, result.jobResults.SAM!.food!.itemId,
    "shared-food search must return the same physical food for both jobs");
  assert.equal(
    BigInt(result.value.numerator) * expected.fraction.denominator,
    expected.fraction.numerator * BigInt(result.value.denominator),
    "the reported normalized damage sum must match a 45-food production-formula oracle",
  );
});
