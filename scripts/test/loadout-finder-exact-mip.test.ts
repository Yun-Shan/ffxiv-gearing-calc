import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import type { Job, JobLevel } from "../../src/domain/search/equipped-effects.ts";
import type { Stat } from "../../src/domain/types.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "../../src/domain/search/equipped-effects.ts";
import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
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

const globalSlots: EquipInfo[][] = [
  [
    equipment(1, 160, { 1: 590, 2: 440, 3: 300, 4: 180, 5: 115, 6: 100 }),
    equipment(2, 159, { 1: 610, 2: 420, 3: 320, 4: 160, 5: 135, 6: 120 }),
  ],
  [
    equipment(3, 0, { 1: 620, 2: 390, 3: 310, 4: 200, 5: 120, 6: 130 }),
    equipment(4, 0, { 1: 600, 2: 470, 3: 280, 4: 210, 5: 110, 6: 110 }),
  ],
];

const slots = globalSlots;

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
    result[index] += Math.min(param.maxValue, Math.trunc(result[index]! * (param.multiplier - 1) + 1e-7));
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
    speedMin?: number;
    toughMin?: number;
    maxToughnessMode?: boolean;
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
        if (constraints.speedMin !== undefined && attributes[5]! < constraints.speedMin) continue;
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
  if (constraints.maxToughnessMode === true) {
    const maximum = Math.max(...candidates.map((candidate) => candidate.attributes[6]!));
    const maxCandidates = candidates.filter((candidate) => candidate.attributes[6] === maximum);
    maxCandidates.sort((a, b) => {
      const aScore = constraints.gcd === undefined
        ? a.score * BigInt(b.gcdCentiseconds)
        : a.score;
      const bScore = constraints.gcd === undefined
        ? b.score * BigInt(a.gcdCentiseconds)
        : b.score;
      return aScore > bScore ? -1 : aScore < bScore ? 1 : 0;
    });
    return { ...maxCandidates[0]!, maximum };
  }
  candidates.sort((a, b) => {
    const aScore = constraints.gcd === undefined
      ? a.score * BigInt(b.gcdCentiseconds)
      : a.score;
    const bScore = constraints.gcd === undefined
      ? b.score * BigInt(a.gcdCentiseconds)
      : b.score;
    return aScore > bScore ? -1 : aScore < bScore ? 1 : 0;
  });
  return candidates[0];
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
  const worker = new Worker(new URL("./exact-mip-worker.mjs", import.meta.url), {
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

test("exact MIP preserves BLU INT-based weapon damage", async () => {
  const jobLevel = 80 as JobLevel;
  const slots = globalSlots.map((slot) => slot.map((equip) => ({ ...equip, baseParams: equip.baseParams.map((param) => param.baseParamId === 1 ? { ...param, value: param.value - 30 } : param) })));
  const bluEvaluate = createDamageGcdVectorEvaluator("BLU", jobLevel, statIndexes, maximums);
  const bluFactors = createIntegerDamageFactorEvaluator("BLU", jobLevel, statIndexes);
  let expected: { product: bigint; gcd: number; selection: EquipInfo[]; food: FoodInfo; factors: NonNullable<ReturnType<typeof bluFactors>> } | undefined;
  for (const first of slots[0]!) {
    for (const second of slots[1]!) {
      for (const food of foods) {
        const attributes = attributesFor([first, second], food);
        const factors = bluFactors(attributes);
        assert.ok(factors);
        const score = BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
          BigInt(factors.determination) * BigInt(factors.tenacity) *
          BigInt(factors.critical) * BigInt(factors.directHit);
        if (expected === undefined ||
            score * BigInt(expected.gcd) > expected.product * BigInt(factors.gcdCentiseconds)) {
          expected = { product: score, gcd: factors.gcdCentiseconds, selection: [first, second], food, factors };
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
    slots,
    foods,
    speedAttributeId: 5,
    toughnessAttributeId: 6,
    equipmentAttributeExtractor,
    evaluationFunction: bluEvaluate,
    maxSearchMs: 20_000,
  });
  assert.ok(result);
  const resultVector = attributesFor(result.selection, result.food!);
  const resultFactors = bluFactors(resultVector);
  assert.ok(resultFactors);
  const resultProduct = BigInt(resultFactors.weaponDamage) * BigInt(resultFactors.mainStat) *
    BigInt(resultFactors.determination) * BigInt(resultFactors.tenacity) *
    BigInt(resultFactors.critical) * BigInt(resultFactors.directHit);
  assert.equal(resultProduct * BigInt(expected.gcd), expected.product * BigInt(resultFactors.gcdCentiseconds));
});
