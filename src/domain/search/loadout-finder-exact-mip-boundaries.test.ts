import assert from "node:assert/strict";
import { test } from "vitest";
import type { IntegerDamageFactors, Job, JobLevel } from "./equipped-effects.ts";
import type { Stat } from "../types.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedSpeedRangeForGcd,
} from "./equipped-effects.ts";
import {
  findBestJointFactorMip,
  findBestLoadoutExactMip,
} from "./loadout-finder-exact-mip.ts";
import type { ExactMipOptions, ExactMipResult } from "./loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo, ParamInfo, SharedSlotProjection } from "./types.ts";

// Vector IDs are local coordinates for the test fixtures, not game-data IDs.
const attributeIds = [-1, 1, 2, 3, 4, 5, 6];
const statIndexes = new Map<Stat, number>([
  ["MDMG", 0],
  ["INT", 1],
  ["CRT", 2],
  ["DET", 3],
  ["DHT", 4],
  ["SPS", 5],
  ["TEN", 6],
]);
const jobLevel = 100 as JobLevel;
const evaluate = createDamageGcdVectorEvaluator("RDM", jobLevel, statIndexes);

function equipment(
  itemId: number,
  attributes: Readonly<Record<number, number>>,
  weaponDamage: number,
): EquipInfo {
  const baseParams: ParamInfo[] = [
    { baseParamId: -1, value: weaponDamage },
    ...Object.entries(attributes).map(([baseParamId, value]) => ({
      baseParamId: Number(baseParamId),
      value,
    })),
  ];
  return {
    itemId,
    itemLevel: 795,
    key: `fixture-${itemId}`,
    baseParams,
    PDMG: 0,
    MDMG: weaponDamage,
    DLY: 0,
  };
}

function sumAttributes(selection: readonly EquipInfo[], ids: readonly number[] = attributeIds): number[] {
  return ids.map((attributeId) => selection.reduce((total, equip) =>
    total + equip.baseParams.reduce((sum, param) =>
      sum + (param.baseParamId === attributeId ? param.value : 0), 0), 0));
}

function exactDamageProduct(factors: IntegerDamageFactors): bigint {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
    BigInt(factors.determination) * BigInt(factors.tenacity) *
    BigInt(factors.critical) * BigInt(factors.directHit);
}

function equipmentPool(candidateSlots: readonly (readonly EquipInfo[])[] = slots) {
  return candidateSlots[0]!.flatMap((first) => candidateSlots[1]!.map((second) => {
    const selection = [first, second];
    const attributes = sumAttributes(selection);
    const evaluation = evaluate(attributes);
    assert.ok(evaluation);
    return {
      selection,
      attributes,
      speed: attributes[statIndexes.get("SPS")!]!,
      gcd: Math.round(evaluation.gcd * 100) / 100,
    };
  }));
}

const slots: EquipInfo[][] = [
  [
    equipment(1001, { 1: 500, 2: 150, 3: 100, 4: 90, 5: 110, 6: 50 }, 160),
    equipment(1002, { 1: 480, 2: 125, 3: 130, 4: 110, 5: 125, 6: 45 }, 158),
  ],
  [
    equipment(2001, { 1: 45, 2: 25, 3: 20, 4: 15, 5: 15, 6: 10 }, 0),
    equipment(2002, { 1: 35, 2: 15, 3: 30, 4: 25, 5: 5, 6: 20 }, 0),
  ],
];

function exactOptions(overrides: Partial<ExactMipOptions> = {}): ExactMipOptions {
  return {
    job: "RDM" as Job,
    jobLevel,
    attributeIds,
    statIndexes,
    slots,
    foods: [],
    speedAttributeId: 5,
    evaluationFunction: evaluate,
    objective: "damage",
    maxSearchMs: 20_000,
    ...overrides,
  };
}

function jointJobs() {
  const factorEvaluator = createIntegerDamageFactorEvaluator("RDM", jobLevel, statIndexes);
  const baselineAttributes = attributeIds.map((attributeId) => slots.reduce((total, candidates) =>
    total + candidates[0]!.baseParams.reduce((sum, param) =>
      sum + (param.baseParamId === attributeId ? param.value : 0), 0), 0));
  const baseline = factorEvaluator(baselineAttributes);
  assert.ok(baseline);

  return ["first", "second"].map((id) => ({
    id,
    slotNames: ["weapon", "ring"],
    options: exactOptions(),
    baseline,
  }));
}

function jointOptions(overrides: {
  jobs?: ReturnType<typeof jointJobs>;
  commonSlots?: readonly string[];
  commonSlotProjections?: readonly SharedSlotProjection[];
  initialResults?: readonly ExactMipResult[];
  maxSearchMs?: number;
} = {}) {
  return {
    jobs: jointJobs(),
    commonSlots: [],
    sharedFood: false,
    equipmentIdentity: (item: EquipInfo) => String(item.itemId),
    foodIdentity: (food: { itemId: number }) => String(food.itemId),
    objective: "damage" as const,
    maxSearchMs: 20_000,
    ...overrides,
  };
}

test("exact MIP rejects unsafe public bounds and equipment attribute ranges", async () => {
  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({ maxSearchMs: Number.NaN })),
    /maxSearchMs 必须是正有限值/,
  );

  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({
      speedAttributeId: 5,
      constraints: { speedMin: Number.MAX_SAFE_INTEGER + 1 },
    })),
    /模型行 attribute_range_5_min 的右侧不是安全整数/,
  );

  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({
      equipmentAttributeExtractor: () => [{ baseParamId: 1, value: Number.POSITIVE_INFINITY }],
    })),
    /装备属性范围不是非负安全整数/,
  );

  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({
      slots: [[
        equipment(3001, { 1: Number.MAX_SAFE_INTEGER, 2: 1 }, 160),
      ], [
        equipment(3002, { 1: 1, 2: 1 }, 0),
      ]],
    })),
    /装备属性范围不是非负安全整数/,
  );
});

test("exact MIP fails closed when required stat indexes are missing or out of range", async () => {
  for (const missing of ["INT", "MDMG", "SPS"] as const) {
    const incomplete = new Map(statIndexes);
    incomplete.delete(missing);
    await assert.rejects(
      findBestLoadoutExactMip(exactOptions({ statIndexes: incomplete })),
      /精确 MIP 模型缺少主属性、武器伤害或职业速度属性/,
      `missing ${missing} must fail before a solver result can be returned`,
    );
  }

  const outOfRange = new Map(statIndexes);
  outOfRange.set("INT", attributeIds.length + 10);
  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({ statIndexes: outOfRange })),
    /精确 MIP 模型缺少主属性、武器伤害或职业速度属性/,
    "a stat index that does not address the supplied vector must fail closed",
  );
});

test("exact MIP aggregates repeated equipment coordinates and returns no result for an empty slot", async () => {
  const repeatedCoordinate = equipment(4001, { 2: 150, 3: 100, 4: 90, 5: 110, 6: 50 }, 160);
  repeatedCoordinate.baseParams.push(
    { baseParamId: 1, value: 250 },
    { baseParamId: 1, value: 250 },
  );
  const result = await findBestLoadoutExactMip(exactOptions({
    slots: [[repeatedCoordinate], [slots[1]![0]!]],
  }));
  assert.ok(result);
  assert.equal(result.selection[0]!.itemId, 4001);
  assert.equal(
    result.damage,
    evaluate([160, 545, 175, 120, 105, 125, 60])!.damage,
    "both entries with the same public attribute ID must contribute to the evaluated total",
  );

  assert.equal(
    await findBestLoadoutExactMip(exactOptions({ slots: [[], slots[1]!] })),
    undefined,
    "an empty candidate slot has no feasible loadout",
  );
});

test("exact MIP observes cancellation requested after real solver progress", async () => {
  let cancelled = false;
  let solverProgressObserved = false;
  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({
      isCancelled: () => cancelled,
      onProgress: (message) => {
        if (message.startsWith("精确候选已核验")) {
          solverProgressObserved = true;
          cancelled = true;
        }
      },
    })),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(solverProgressObserved, true,
    "the cancellation must be requested after a successful real HiGHS solve, not at entry");
});

test("exact MIP reports an expired positive time budget before claiming an optimality proof", async () => {
  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({ maxSearchMs: Number.MIN_VALUE })),
    /精确 MIP 搜索达到时限，未完成最优性证明/,
  );
});

test("joint exact MIP rejects invalid shared-slot projections at its public boundary", async () => {
  const invalidProjections: readonly (readonly SharedSlotProjection[])[] = [
    [{ commonSlot: "other", slotName: "ring", ringIndex: 0 }],
    [{ commonSlot: "ring", slotName: "", ringIndex: 0 }],
    [{ commonSlot: "ring", slotName: "ring", ringIndex: 2 as 0 | 1 }],
    [
      { commonSlot: "ring", slotName: "ring", ringIndex: 0 },
      { commonSlot: "ring", slotName: "head", ringIndex: 1 },
    ],
  ];

  for (const commonSlotProjections of invalidProjections) {
    await assert.rejects(
      findBestJointFactorMip(jointOptions({
        commonSlots: ["ring"],
        commonSlotProjections,
      })),
      /联合因子 MIP 的共享槽位投影 .* 无效/,
    );
  }
});

test("joint exact MIP enforces a positive search budget after model preparation", async () => {
  await assert.rejects(
    findBestJointFactorMip(jointOptions({ maxSearchMs: Number.MIN_VALUE })),
    /联合因子 MIP 达到时限，未完成最优性复核/,
  );
});

test("joint exact MIP rejects an initial-result list that does not match its jobs", async () => {
  await assert.rejects(
    findBestJointFactorMip(jointOptions({ initialResults: [] })),
    /联合初始方案职业数不匹配/,
  );
});

test("joint exact MIP rejects stale warm-start equipment and food from real exact results", async () => {
  const staleFood: FoodInfo = {
    itemId: 7301,
    itemLevel: 795,
    key: "stale-food",
    baseParams: [{ baseParamId: 1, multiplier: 1, maxValue: 0 }],
  };
  const replacementFood: FoodInfo = {
    ...staleFood,
    itemId: 7302,
    key: "replacement-food",
  };
  const jobs = jointJobs().map((job) => ({
    ...job,
    options: exactOptions({ foods: [staleFood] }),
  }));
  const initialResults = await Promise.all(jobs.map(async (job) => {
    const result = await findBestLoadoutExactMip(job.options);
    assert.ok(result);
    assert.equal(result.food?.itemId, staleFood.itemId);
    return result;
  }));
  const evaluateFactors = createIntegerDamageFactorEvaluator("RDM", jobLevel, statIndexes);
  for (let index = 0; index < jobs.length; index++) {
    const baseline = evaluateFactors(sumAttributes(initialResults[index]!.selection));
    assert.ok(baseline);
    jobs[index] = { ...jobs[index]!, baseline };
  }

  const staleSelection = [...initialResults[1]!.selection];
  staleSelection[0] = {
    ...staleSelection[0]!,
    itemId: 7399,
    key: "removed-equipment-candidate",
  };
  await assert.rejects(
    findBestJointFactorMip(jointOptions({
      jobs,
      initialResults: [initialResults[0]!, { ...initialResults[1]!, selection: staleSelection }],
    })),
    /联合初始方案装备不属于模型候选/,
    "a real cached result whose selection contains a removed candidate must not seed joint search",
  );

  const refreshedJobs = jobs.map((job, index) => index === 1
    ? { ...job, options: exactOptions({ foods: [replacementFood] }) }
    : job);
  await assert.rejects(
    findBestJointFactorMip(jointOptions({ jobs: refreshedJobs, initialResults })),
    /联合初始方案食物不属于模型候选/,
    "a real cached result using food removed from the refreshed job options must not seed joint search",
  );
});

test("joint exact MIP rejects corrupted baseline factors after preparing valid job models", async () => {
  for (const invalidFactor of [0, Number.NaN, 1.5]) {
    const jobs = jointJobs();
    jobs[0] = {
      ...jobs[0]!,
      baseline: { ...jobs[0]!.baseline, mainStat: invalidFactor },
    };

    await assert.rejects(
      findBestJointFactorMip(jointOptions({ jobs })),
      /伤害因子必须是正安全整数/,
      `baseline mainStat=${invalidFactor} must fail closed`,
    );
  }
});

test("exact MIP exhaustively matches when only required stat coordinates are indexed", async () => {
  const reducedAttributeIds = [-1, 1, 5];
  const reducedStatIndexes = new Map<Stat, number>([
    ["MDMG", 0],
    ["INT", 1],
    ["SPS", 2],
  ]);
  const reducedEvaluate = createDamageGcdVectorEvaluator("RDM", jobLevel, reducedStatIndexes);
  const reducedFactors = createIntegerDamageFactorEvaluator("RDM", jobLevel, reducedStatIndexes);

  const scores = slots[0]!.flatMap((first) => slots[1]!.map((second) => {
    const factors = reducedFactors(sumAttributes([first, second], reducedAttributeIds));
    assert.ok(factors);
    return exactDamageProduct(factors);
  }));
  const expected = scores.reduce((best, score) => score > best ? score : best);

  const result = await findBestLoadoutExactMip(exactOptions({
    attributeIds: reducedAttributeIds,
    statIndexes: reducedStatIndexes,
    evaluationFunction: reducedEvaluate,
    objective: "damage",
  }));

  assert.ok(result);
  const resultAttributes = sumAttributes(result.selection, reducedAttributeIds);
  const resultFactors = reducedFactors(resultAttributes);
  const resultEvaluation = reducedEvaluate(resultAttributes);
  assert.ok(resultFactors);
  assert.ok(resultEvaluation);
  assert.equal(exactDamageProduct(resultFactors), expected,
    "omitted DET/TEN/CRT/DHT coordinates contribute only their formula-defined base stats");
  assert.equal(result.damage, resultEvaluation.damage);
});

test("exact MIP intersects scalar GCD and choices, skips unsupported choices, and honors a speed maximum", async () => {
  const pool = equipmentPool();
  const scalarGcd = pool[0]!.gcd;
  const scalarRange = equippedSpeedRangeForGcd("RDM", jobLevel, scalarGcd);
  assert.ok(scalarRange);
  const speedMax = pool.find((candidate) => candidate.gcd === scalarGcd)!.speed;
  const expectedCandidates = pool.filter((candidate) =>
    candidate.gcd === scalarGcd && candidate.speed <= speedMax &&
    candidate.speed >= scalarRange.min && candidate.speed <= scalarRange.max);
  assert.ok(expectedCandidates.length > 0);
  assert.equal(equippedSpeedRangeForGcd("RDM", jobLevel, 5), undefined,
    "the extra positive GCD choice must be valid input whose production range is unsupported");
  const expected = expectedCandidates.map((candidate) => {
    const factors = createIntegerDamageFactorEvaluator("RDM", jobLevel, statIndexes)(candidate.attributes);
    assert.ok(factors);
    return exactDamageProduct(factors);
  }).reduce((best, score) => score > best ? score : best);

  const result = await findBestLoadoutExactMip(exactOptions({
    constraints: { gcd: scalarGcd, gcdChoices: [5, scalarGcd], speedMax },
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", jobLevel, gcd),
  }));

  assert.ok(result);
  const resultAttributes = sumAttributes(result.selection);
  const resultFactors = createIntegerDamageFactorEvaluator("RDM", jobLevel, statIndexes)(resultAttributes);
  assert.ok(resultFactors);
  assert.equal(Math.round(evaluate(resultAttributes)!.gcd * 100) / 100, scalarGcd);
  assert.ok(resultAttributes[statIndexes.get("SPS")!]! <= speedMax);
  assert.equal(exactDamageProduct(resultFactors), expected);
});

test("exact MIP applies a one-sided speed maximum alongside a production GCD choice range", async () => {
  const pool = equipmentPool();
  const gcdChoice = pool[0]!.gcd;
  const speedMax = pool[0]!.speed;
  const choiceRange = equippedSpeedRangeForGcd("RDM", jobLevel, gcdChoice);
  assert.ok(choiceRange);
  const expectedCandidates = pool.filter((candidate) =>
    candidate.speed >= choiceRange.min && candidate.speed <= choiceRange.max &&
    candidate.speed <= speedMax);
  assert.ok(expectedCandidates.length > 0);
  const evaluateFactors = createIntegerDamageFactorEvaluator("RDM", jobLevel, statIndexes);
  const expected = expectedCandidates.map((candidate) => {
    const factors = evaluateFactors(candidate.attributes);
    assert.ok(factors);
    return exactDamageProduct(factors);
  }).reduce((best, score) => score > best ? score : best);

  const result = await findBestLoadoutExactMip(exactOptions({
    constraints: { gcdChoices: [gcdChoice], speedMax },
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", jobLevel, gcd),
  }));

  assert.ok(result);
  const resultAttributes = sumAttributes(result.selection);
  const resultFactors = evaluateFactors(resultAttributes);
  assert.ok(resultFactors);
  assert.equal(Math.round(evaluate(resultAttributes)!.gcd * 100) / 100, gcdChoice);
  assert.ok(resultAttributes[statIndexes.get("SPS")!]! <= speedMax);
  assert.equal(exactDamageProduct(resultFactors), expected);
});

test("exact MIP returns no candidate when a valid scalar GCD is disjoint from every GCD choice", async () => {
  const gcdSlots: EquipInfo[][] = [
    [
      equipment(5101, { 1: 500, 2: 150, 3: 100, 4: 90, 5: 0, 6: 50 }, 160),
      equipment(5102, { 1: 480, 2: 125, 3: 130, 4: 110, 5: 700, 6: 45 }, 158),
    ],
    [
      equipment(5201, { 1: 45, 2: 25, 3: 20, 4: 15, 5: 0, 6: 10 }, 0),
      equipment(5202, { 1: 35, 2: 15, 3: 30, 4: 25, 5: 400, 6: 20 }, 0),
    ],
  ];
  const pool = equipmentPool(gcdSlots);
  const scalarGcd = pool[0]!.gcd;
  const choiceGcd = pool.find((candidate) => candidate.gcd !== scalarGcd)!.gcd;
  const scalarRange = equippedSpeedRangeForGcd("RDM", jobLevel, scalarGcd);
  const choiceRange = equippedSpeedRangeForGcd("RDM", jobLevel, choiceGcd);
  assert.ok(scalarRange);
  assert.ok(choiceRange);
  assert.ok(scalarRange.max < choiceRange.min || choiceRange.max < scalarRange.min,
    "distinct GCD values from the production evaluator must have disjoint speed ranges");
  assert.equal(pool.some((candidate) => candidate.speed >= scalarRange.min &&
    candidate.speed <= scalarRange.max && candidate.speed >= choiceRange.min &&
    candidate.speed <= choiceRange.max), false,
  "the exhaustive candidate pool must also have an empty range intersection");

  const result = await findBestLoadoutExactMip(exactOptions({
    slots: gcdSlots,
    constraints: { gcd: scalarGcd, gcdChoices: [choiceGcd] },
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", jobLevel, gcd),
  }));

  assert.equal(result, undefined,
    "conflicting but individually valid scalar and choice GCD constraints are infeasible");
});

test("exact MIP fails closed when a public evaluator cannot produce finite damage and GCD", async () => {
  const neutralFood: FoodInfo = {
    itemId: 7001,
    itemLevel: 795,
    key: "neutral-food",
    baseParams: [{ baseParamId: 1, multiplier: 1, maxValue: 0 }],
  };
  const invalidEvaluators: ExactMipOptions["evaluationFunction"][] = [
    () => undefined,
    () => ({ damage: Number.NaN, gcd: 2.5 }),
    () => ({ damage: 1, gcd: Number.POSITIVE_INFINITY }),
  ];

  for (const evaluationFunction of invalidEvaluators) {
    await assert.rejects(
      findBestLoadoutExactMip(exactOptions({
        slots: [[slots[0]![0]!], [slots[1]![0]!]],
        foods: [neutralFood],
        evaluationFunction,
      })),
      /MIP 返回的配装无法计算伤害或 GCD/,
      "an invalid greedy hint must not allow the exact solver to return an unevaluated result",
    );
  }
});

test("exact MIP rejects invalid public food rates and negative base offsets", async () => {
  const food = (multiplier: number, maxValue: number, baseValue?: number): FoodInfo => ({
    itemId: 7002,
    itemLevel: 795,
    key: `food-${multiplier}-${maxValue}-${baseValue}`,
    baseParams: [{ baseParamId: 1, ...(baseValue === undefined ? {} : { baseValue }), multiplier, maxValue }],
  });
  const validEquipment = [[slots[0]![0]!], [slots[1]![0]!]];

  for (const multiplier of [Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      findBestLoadoutExactMip(exactOptions({
        slots: validEquipment,
        foods: [food(multiplier, 90)],
      })),
      /食物加成比例不是百分比整数/,
      `non-finite food multiplier ${multiplier} must not be silently treated as a usable rate`,
    );
  }

  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({
      slots: validEquipment,
      foods: [food(1.1, 90, -1)],
    })),
    /整数比例模型与 v2 取整不一致/,
    "a negative base value with a positive fractional rate must not pass the public formula check",
  );

  await assert.rejects(
    findBestLoadoutExactMip(exactOptions({
      slots: validEquipment,
      foods: [food(2, 90, Number.MAX_SAFE_INTEGER + 1)],
    })),
    /食物基础属性必须为非负安全整数/,
    "an unsafe base offset must fail after its integral rate and valid cap have been checked",
  );
});
