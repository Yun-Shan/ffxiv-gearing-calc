import assert from "node:assert/strict";
import { test } from "vitest";
import { Worker } from "node:worker_threads";
import type { Job, JobLevel } from "./equipped-effects.ts";
import type { Stat } from "../types.ts";
import { gameData } from "../data.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "./equipped-effects.ts";
import { findBestJointFactorMip, findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
import type { ExactMipOptions } from "./loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

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

function equipment(
  itemId: number,
  weaponDamage: number,
  attributes: Record<number, number>,
): EquipInfo {
  const baseParams: ParamInfo[] = Object.entries(attributes).map(([id, value]) => ({
    baseParamId: Number(id),
    value,
  }));
  return {
    itemId,
    itemLevel: 795,
    key: baseParams.map((param) => param.baseParamId).join("-"),
    baseParams,
    PDMG: 0,
    MDMG: weaponDamage,
    DLY: 0,
  };
}

const slots: EquipInfo[][] = [
  [
    equipment(1, 160, { 1: 590, 2: 440, 3: 300, 4: 180, 5: 115, 6: 100 }),
    equipment(2, 159, { 1: 610, 2: 420, 3: 320, 4: 160, 5: 135, 6: 120 }),
  ],
  [
    equipment(3, 0, { 1: 620, 2: 390, 3: 310, 4: 200, 5: 120, 6: 130 }),
    equipment(4, 0, { 1: 600, 2: 470, 3: 280, 4: 210, 5: 110, 6: 110 }),
  ],
];

const foods: FoodInfo[] = [
  {
    itemId: 5001,
    itemLevel: 795,
    key: "1-2-5",
    baseParams: [
      { baseParamId: 1, multiplier: 1.1, maxValue: 90 },
      { baseParamId: 2, multiplier: 1.1, maxValue: 90 },
      { baseParamId: 5, multiplier: 1.1, maxValue: 90 },
    ],
  },
  {
    itemId: 5002,
    itemLevel: 795,
    key: "1-3-6",
    baseParams: [
      { baseParamId: 1, multiplier: 1.1, maxValue: 90 },
      { baseParamId: 3, multiplier: 1.1, maxValue: 90 },
      { baseParamId: 6, multiplier: 1.1, maxValue: 90 },
    ],
  },
];

const equipmentAttributeExtractor = (equip: EquipInfo) => [
  ...equip.baseParams,
  { baseParamId: -1, value: equip.MDMG },
];
const maximums = attributeIds.map((id) =>
  slots.reduce((sum, slot) => sum + Math.max(...slot.map((equip) =>
    (id === -1 ? equip.MDMG : equip.baseParams.find((param) => param.baseParamId === id)?.value ?? 0))), 0) +
  Math.max(0, ...foods.map((food) => food.baseParams.find((param) => param.baseParamId === id)?.maxValue ?? 0)));
const evaluate = createDamageGcdVectorEvaluator("RDM", 100, statIndexes, maximums);
const evaluateFactors = createIntegerDamageFactorEvaluator("RDM", 100, statIndexes);

function attributesFor(selection: readonly EquipInfo[], food: FoodInfo): number[] {
  const result = new Array<number>(attributeIds.length).fill(0);
  for (const equip of selection) {
    for (const param of equipmentAttributeExtractor(equip)) {
      result[attributeIds.indexOf(param.baseParamId)] += param.value;
    }
  }
  for (const param of food.baseParams) {
    const index = attributeIds.indexOf(param.baseParamId);
    result[index] += Math.min(param.maxValue, Math.trunc((result[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7));
  }
  return result;
}

function product(selection: readonly EquipInfo[], food: FoodInfo): bigint {
  const factors = evaluateFactors(attributesFor(selection, food));
  assert.ok(factors);
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
    BigInt(factors.determination) * BigInt(factors.tenacity) *
    BigInt(factors.critical) * BigInt(factors.directHit);
}

function exhaustive(
  constraints: {
    gcd?: number;
    gcdChoices?: readonly number[];
    speedMin?: number;
    speedMax?: number;
    toughMin?: number;
    maxToughnessMode?: boolean;
    objective?: "damage" | "dps";
  } = {},
) {
  const candidates: { selection: EquipInfo[]; food: FoodInfo; attributes: number[]; score: bigint; gcdCentiseconds: number }[] = [];
  for (const first of slots[0]!) {
    for (const second of slots[1]!) {
      for (const food of foods) {
        const selection = [first, second];
        const attributes = attributesFor(selection, food);
        const gcd = evaluate(attributes)!.gcd;
        const gcdRange = constraints.gcd === undefined
          ? undefined
          : equippedSpeedRangeForGcd("RDM", 100, constraints.gcd);
        if (gcdRange !== undefined && (attributes[5]! < gcdRange.min || attributes[5]! > gcdRange.max)) continue;
        if (constraints.gcdChoices !== undefined && !constraints.gcdChoices.some((choice) => {
          const range = equippedSpeedRangeForGcd("RDM", 100, choice);
          return range !== undefined && attributes[5]! >= range.min && attributes[5]! <= range.max;
        })) continue;
        if (constraints.speedMin !== undefined && attributes[5]! < constraints.speedMin) continue;
        if (constraints.speedMax !== undefined && attributes[5]! > constraints.speedMax) continue;
        if (constraints.toughMin !== undefined && attributes[6]! < constraints.toughMin) continue;
        candidates.push({
          selection,
          food,
          attributes,
          score: product(selection, food),
          gcdCentiseconds: Math.round(gcd * 100),
        });
      }
    }
  }
  if (candidates.length === 0) return undefined;
  const useDps = constraints.objective === "dps" ||
    (constraints.objective === undefined && constraints.gcd === undefined);
  const compare = (left: (typeof candidates)[number], right: (typeof candidates)[number]) => {
    const leftScore = useDps ? left.score * BigInt(right.gcdCentiseconds) : left.score;
    const rightScore = useDps ? right.score * BigInt(left.gcdCentiseconds) : right.score;
    return leftScore > rightScore ? -1 : leftScore < rightScore ? 1 : 0;
  };
  if (constraints.maxToughnessMode === true) {
    const maximum = Math.max(...candidates.map((candidate) => candidate.attributes[6]!));
    const maxCandidates = candidates.filter((candidate) => candidate.attributes[6] === maximum);
    maxCandidates.sort(compare);
    return { ...maxCandidates[0]!, maximum };
  }
  candidates.sort(compare);
  return candidates[0];
}

function exactMipOptions(overrides: Partial<ExactMipOptions> = {}): ExactMipOptions {
  return {
    job: "RDM",
    jobLevel: 100,
    attributeIds,
    statIndexes,
    slots,
    foods,
    equipmentAttributeExtractor,
    evaluationFunction: evaluate,
    objective: "damage",
    ...overrides,
  };
}

test("exact MIP matches exhaustive v2-style DPS and food evaluation", async () => {
  const expected = exhaustive();
  assert.ok(expected);
  const result = await findBestLoadoutExactMip({
    job: "RDM" as Job,
    jobLevel: 100 as JobLevel,
    attributeIds,
    statIndexes,
    slots,
    foods,
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    equipmentAttributeExtractor,
    evaluationFunction: evaluate,
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
    toughnessPercentToMinimum: (percentage) => equippedToughnessForMitigationPercent("RDM", 100, percentage),
    maxSearchMs: 20_000,
  });
  assert.ok(result);
  const resultFactors = evaluateFactors(attributesFor(result.selection, result.food!))!;
  assert.equal(BigInt(resultFactors.gcdCentiseconds) * expected.score, BigInt(expected.gcdCentiseconds) * product(result.selection, result.food!));
  assert.equal(result.statistics.solverRuns >= 1, true);
});

test("exact MIP honors fixed GCD and lexicographic maximum toughness", async () => {
  const sample = evaluate(attributesFor([slots[0]![0]!, slots[1]![0]!], foods[0]!))!;
  const constraints = { gcd: Math.round(sample.gcd * 100) / 100, maxToughnessMode: true } as const;
  const expected = exhaustive(constraints);
  assert.ok(expected);
  assert.ok("maximum" in expected);
  const result = await findBestLoadoutExactMip({
    job: "RDM" as Job,
    jobLevel: 100 as JobLevel,
    attributeIds,
    statIndexes,
    slots,
    foods,
    constraints,
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    equipmentAttributeExtractor,
    evaluationFunction: evaluate,
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
    toughnessPercentToMinimum: (percentage) => equippedToughnessForMitigationPercent("RDM", 100, percentage),
    maxSearchMs: 20_000,
  });
  assert.ok(result);
  assert.equal(result.maximumToughness, expected.maximum);
  assert.equal(product(result.selection, result.food!), expected.score);
});

test("exact MIP worker returns its result through structured clone", async () => {
  const worker = new Worker(new URL("scripts/node-tests/exact-mip-worker.mjs", `file:///${process.cwd().replaceAll("\\", "/")}/`), {
    workerData: {
      job: "RDM",
      jobLevel: 100,
      attributeIds,
      statIndexes: [...statIndexes.entries()],
      maxContributions: maximums,
      slots,
      foods,
      constraints: {},
      speedAttributeId: 5,
      toughnessAttributeId: 6,
      weaponDamageStat: "MDMG",
      weaponDamageId: -1,
      maxSearchMs: 20_000,
    },
  });
  try {
    const result = await new Promise<any>((resolve, reject) => {
      worker.once("error", reject);
      worker.on("message", (message) => {
        if (message.type === "error") reject(new Error(message.error.message));
        if (message.type === "result") resolve(message.result);
      });
    });
    assert.ok(result);
    assert.equal(typeof result.damage, "number");
    assert.equal(result.selection.length, slots.length);
  } finally {
    await worker.terminate();
  }
});

test("exact MIP rejects a job absent from generated game data", async () => {
  const jobLevel = 80 as JobLevel;
  const unsupportedJob = "UNKNOWN" as unknown as Job;
  const evaluate = createDamageGcdVectorEvaluator(unsupportedJob, jobLevel, statIndexes, maximums);
  assert.throws(() => evaluate([]), /未知职业/);
  await assert.rejects(findBestLoadoutExactMip({
    job: unsupportedJob,
    jobLevel,
    attributeIds,
    statIndexes,
    slots,
    foods,
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    equipmentAttributeExtractor,
    evaluationFunction: evaluate,
    maxSearchMs: 20_000,
  }), /未知职业/);
});


test("exact MIP preserves BLU INT-based weapon damage", async () => {
  const jobLevel = 80 as JobLevel;
  const bluEvaluate = createDamageGcdVectorEvaluator("BLU" as Job, jobLevel, statIndexes, maximums);
  const bluFactors = createIntegerDamageFactorEvaluator("BLU" as Job, jobLevel, statIndexes);
  const intelligenceId = attributeIds[statIndexes.get("INT")!]!;
  const maximumIntelligenceContribution = slots.reduce((total, slot) =>
    total + Math.max(...slot.map((equip) =>
      equip.baseParams.find((param) => param.baseParamId === intelligenceId)?.value ?? 0)), 0) +
    Math.max(0, ...foods.map((food) =>
      food.baseParams.find((param) => param.baseParamId === intelligenceId)?.maxValue ?? 0));
  const legalIntelligenceContribution = gameData.bluMdmgAdditions.length - 1;
  const perSlotReduction = Math.ceil(Math.max(
    0,
    maximumIntelligenceContribution - legalIntelligenceContribution,
  ) / slots.length);
  const bluSlots = slots.map((slot) => slot.map((equip) => ({
    ...equip,
    baseParams: equip.baseParams.map((param) => param.baseParamId === intelligenceId
      ? { ...param, value: Math.max(0, param.value - perSlotReduction) }
      : param),
  })));
  let expected: {
    product: bigint;
    gcd: number;
  } | undefined;
  for (const first of bluSlots[0]!) {
    for (const second of bluSlots[1]!) {
      for (const selectedFood of foods) {
        const attributes = attributesFor([first, second], selectedFood);
        const factors = bluFactors(attributes);
        assert.ok(factors);
        const score = BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
          BigInt(factors.determination) * BigInt(factors.tenacity) *
          BigInt(factors.critical) * BigInt(factors.directHit);
        if (expected === undefined ||
            score * BigInt(expected.gcd) > expected.product * BigInt(factors.gcdCentiseconds)) {
          expected = { product: score, gcd: factors.gcdCentiseconds };
        }
      }
    }
  }
  assert.ok(expected);
  const result = await findBestLoadoutExactMip({
    job: "BLU" as Job,
    jobLevel,
    attributeIds,
    statIndexes,
    slots: bluSlots,
    foods,
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    equipmentAttributeExtractor,
    evaluationFunction: bluEvaluate,
    maxSearchMs: 20_000,
  });
  assert.ok(result);
  const resultFactors = bluFactors(attributesFor(result.selection, result.food!));
  assert.ok(resultFactors);
  const resultProduct = BigInt(resultFactors.weaponDamage) * BigInt(resultFactors.mainStat) *
    BigInt(resultFactors.determination) * BigInt(resultFactors.tenacity) *
    BigInt(resultFactors.critical) * BigInt(resultFactors.directHit);
  assert.equal(
    resultProduct * BigInt(expected.gcd),
    expected.product * BigInt(resultFactors.gcdCentiseconds),
  );
});


test("food percentages include base attributes before truncation and caps", async () => {
  const offsetFoods = foods.map(item => ({ ...item, baseParams: item.baseParams.map(param => ({ ...param, baseValue: 420 })) }));
  const candidates = slots[0]!.flatMap(first => slots[1]!.flatMap(second => offsetFoods.map(food => ({ selection: [first, second], food, score: product([first, second], food) }))));
  const expected = candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best);
  const result = await findBestLoadoutExactMip({ job: "RDM", jobLevel: 100, attributeIds, statIndexes, slots, foods: offsetFoods, equipmentAttributeExtractor, evaluationFunction: evaluate, objective: "damage" });
  assert.ok(result);
  assert.equal(product(result.selection, result.food!), expected.score);
  assert.equal(result.damage, evaluate(attributesFor(result.selection, result.food!))!.damage);
});

test("exact MIP tolerates ignored attributes and a selected food with no effective bonus", async () => {
  const options = exactMipOptions({
    slots: [[{
      ...slots[0]![0]!,
      baseParams: [...slots[0]![0]!.baseParams, { baseParamId: 999_999, value: 123 }],
    }]],
    foods: [{
      itemId: 5999,
      itemLevel: 795,
      key: "no-op",
      baseParams: [
        { baseParamId: 1, multiplier: 1, maxValue: 0 },
        { baseParamId: 999_999, multiplier: 1.1, maxValue: 50 },
      ],
    }],
  });

  const result = await findBestLoadoutExactMip(options);

  assert.ok(result);
  assert.equal(result.food?.itemId, 5999);
  assert.equal(result.selection.length, 1);
});

test("joint factor MIP rejects a shared slot with no common physical equipment", async () => {
  const firstOptions = exactMipOptions();
  const secondOptions = exactMipOptions({
    slots: [
      [equipment(8101, 160, { 1: 590, 2: 440, 3: 300, 4: 180, 5: 115, 6: 100 })],
      [equipment(8102, 0, { 1: 620, 2: 390, 3: 310, 4: 200, 5: 120, 6: 130 })],
    ],
  });
  const baselineFor = (options: ExactMipOptions) => {
    const factors = evaluateFactors(attributesFor(options.slots.map((slot) => slot[0]!), foods[0]!));
    assert.ok(factors);
    return factors;
  };

  const result = await findBestJointFactorMip({
    jobs: [
      { id: "first", slotNames: ["ring", "head"], options: firstOptions, baseline: baselineFor(firstOptions) },
      { id: "second", slotNames: ["ring", "head"], options: secondOptions, baseline: baselineFor(secondOptions) },
    ],
    commonSlots: ["ring"],
    sharedFood: false,
    equipmentIdentity: (item) => String(item.itemId),
    foodIdentity: (item) => String(item.itemId),
    objective: "damage",
    maxSearchMs: 20_000,
  });

  assert.equal(result, undefined);
});

test("exact MIP matches enumeration for multiple GCD choices intersected with speed bounds", async () => {
  const allCandidates = slots[0]!.flatMap((first) =>
    slots[1]!.flatMap((second) =>
      foods.map((food) => {
        const attributes = attributesFor([first, second], food);
        return {
          attributes,
          gcd: Math.round(evaluate(attributes)!.gcd * 100) / 100,
        };
      }),
    ),
  );
  const gcdChoices = [...new Set(allCandidates.map((candidate) => candidate.gcd))];
  assert.ok(gcdChoices.length >= 2);
  const constrainedChoice = gcdChoices[1]!;
  const speed = allCandidates.find((candidate) => candidate.gcd === constrainedChoice)!
    .attributes[5]!;
  const constraints = {
    gcdChoices: gcdChoices.slice(0, 2),
    speedMin: speed,
    speedMax: speed,
    objective: "dps" as const,
  };
  const expected = exhaustive(constraints);
  assert.ok(expected, "the exact speed of a candidate must retain at least one GCD choice");
  const result = await findBestLoadoutExactMip({
    job: "RDM" as Job,
    jobLevel: 100 as JobLevel,
    attributeIds,
    statIndexes,
    slots,
    foods,
    constraints,
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    equipmentAttributeExtractor,
    evaluationFunction: evaluate,
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
    objective: "dps",
  });
  assert.ok(result);
  const resultAttributes = attributesFor(result.selection, result.food!);
  const resultFactors = evaluateFactors(resultAttributes)!;
  assert.equal(resultAttributes[5], speed);
  assert.ok(constraints.gcdChoices.includes(Math.round(evaluate(resultAttributes)!.gcd * 100) / 100));
  assert.equal(
    BigInt(resultFactors.gcdCentiseconds) * expected.score,
    BigInt(expected.gcdCentiseconds) * product(result.selection, result.food!),
    "the exact DPS ratio must equal the constrained exhaustive optimum",
  );

  const scalarGcd = constrainedChoice;
  const otherGcd = gcdChoices.find((choice) => choice !== scalarGcd)!;
  const combinedConstraints = {
    gcd: scalarGcd,
    gcdChoices: [otherGcd, scalarGcd],
    speedMin: speed,
    speedMax: speed,
  };
  const combinedExpected = exhaustive(combinedConstraints);
  assert.ok(combinedExpected);
  const combinedResult = await findBestLoadoutExactMip({
    ...exactMipOptions({ constraints: combinedConstraints }),
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
  });
  assert.ok(combinedResult);
  assert.equal(product(combinedResult.selection, combinedResult.food!), combinedExpected.score);
  assert.equal(
    Math.round(evaluate(attributesFor(combinedResult.selection, combinedResult.food!))!.gcd * 100) / 100,
    scalarGcd,
  );
});

test("exact MIP rejects cancelled work and returns no solution for empty or unsupported GCD choices", async () => {
  const common = {
    job: "RDM" as Job,
    jobLevel: 100 as JobLevel,
    attributeIds,
    statIndexes,
    slots,
    foods,
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    equipmentAttributeExtractor,
    evaluationFunction: evaluate,
    gcdToSpeedRange: (gcd: number) => equippedSpeedRangeForGcd("RDM", 100, gcd),
  };
  await assert.rejects(
    findBestLoadoutExactMip({ ...common, isCancelled: () => true }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  await assert.rejects(
    findBestLoadoutExactMip({ ...common, maxSearchMs: 0 }),
    /maxSearchMs.*正有限值/,
  );
  assert.equal(
    await findBestLoadoutExactMip({ ...common, constraints: { gcdChoices: [] } }),
    undefined,
  );
  assert.equal(
    await findBestLoadoutExactMip({
      ...common,
      constraints: { gcdChoices: [2.5] },
      gcdToSpeedRange: () => undefined,
    }),
    undefined,
  );
  await assert.rejects(
    findBestLoadoutExactMip({ ...common, constraints: { gcdChoices: [0] } }),
    /GCD 备选值必须为正有限数/,
  );
});

test("exact MIP rejects invalid resource ranges, food rates, and unconfigured constraint attributes", async () => {
  assert.equal(
    await findBestLoadoutExactMip(exactMipOptions({ slots: [[], slots[1]!] })),
    undefined,
    "an empty equipment slot is an infeasible model, not a solver error",
  );

  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      equipmentAttributeExtractor: (equip) => [
        { baseParamId: 1, value: equip.itemId === 1 ? -1 : equip.itemId === 2 ? 1 : 0 },
        { baseParamId: -1, value: equip.MDMG },
      ],
    })),
    /装备属性下界不是非负安全整数/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      foods: [{
        ...foods[0]!,
        baseParams: [{ baseParamId: 1, multiplier: 1.005, maxValue: 90 }],
      }],
    })),
    /整数比例模型与 v2 取整不一致/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      foods: [{
        ...foods[0]!,
        baseParams: [{
          baseParamId: 1,
          baseValue: Number.MAX_SAFE_INTEGER,
          multiplier: 1.3,
          maxValue: 90,
        }],
      }],
    })),
    /食物基础属性必须为非负安全整数/,
  );

  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({ constraints: { gcd: 2.5 } })),
    /按 GCD 搜索需要配置 gcdToSpeedRange/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { gcd: 2.5 },
      gcdToSpeedRange: () => ({ min: 100, max: 200 }),
    })),
    /按 GCD 搜索缺少速度属性 id/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { gcdChoices: [2.5] },
    })),
    /多个 GCD 搜索需要配置 gcdToSpeedRange/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { gcdChoices: [2.5] },
      gcdToSpeedRange: () => ({ min: 100, max: 200 }),
    })),
    /多个 GCD 搜索缺少速度属性 id/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { gcdChoices: [2.5] },
      gcdToSpeedRange: () => ({ min: 200, max: 100 }),
      speedAttributeId: 5,
    })),
    /GCD 2.5 对应的速度范围无效/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { gcdChoices: [2.5] },
      gcdToSpeedRange: () => ({ min: 100, max: 200 }),
      speedAttributeId: 99,
    })),
    /GCD 搜索的速度属性未配置：99/,
  );
  assert.equal(
    await findBestLoadoutExactMip(exactMipOptions({
      constraints: { gcd: 2.5 },
      gcdToSpeedRange: () => undefined,
    })),
    undefined,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { speedMin: 200, speedMax: 100 },
      speedAttributeId: 5,
    })),
    /属性 5 的约束范围为空/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { speedMin: 100 },
    })),
    /速度约束缺少速度属性 id/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { speedMin: 100 },
      speedAttributeId: 99,
    })),
    /属性约束包含未配置的属性 id：99/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({ constraints: { toughMin: 100 } })),
    /坚韧约束需要配置坚韧属性 id/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { toughnessMinPercent: 5 },
      toughnessAttributeId: 6,
    })),
    /按坚韧百分比搜索需要配置 toughnessPercentToMinimum/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      constraints: { maxToughnessMode: true },
    })),
    /坚韧约束需要配置坚韧属性 id/,
  );
});

test("exact MIP rejects equipment reconstruction that diverges after the model is built", async () => {
  let solverReturned = false;
  const mutableExtractor = (equip: EquipInfo) => {
    const params = equipmentAttributeExtractor(equip);
    if (!solverReturned) return params;
    return params.map((param) => param.baseParamId === 1
      ? { ...param, value: param.value + 1 }
      : param);
  };

  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      foods: [],
      equipmentAttributeExtractor: mutableExtractor,
      onProgress: (message) => {
        if (message.startsWith("HiGHS ")) solverReturned = true;
      },
    })),
    /MIP 属性重建不一致/,
  );
});
