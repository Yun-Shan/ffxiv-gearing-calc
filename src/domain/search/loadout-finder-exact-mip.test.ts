import assert from "node:assert/strict";
import { test, vi } from "vitest";
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
import { createParallelBaselineExecutor } from "./parallel-baseline-executor.ts";
import { paretoRingCandidates } from "./candidate-pareto.ts";
import {
  canonicalFoodBonusUpperBoundAtRaw,
  candidateUpperBoundCannotImproveIncumbent,
  candidateUpperBoundIsStrictlyWorse,
  markCanonicalEvaluatorCandidateUpperBound,
  shouldEnableCanonicalCandidateUpperBound,
} from "./exact-mip-candidate-upper-bound.ts";
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
const candidateBoundFood: FoodInfo = {
  itemId: 5999,
  itemLevel: 795,
  key: "candidate-bound-food",
  baseParams: [
    { baseParamId: 1, baseValue: 1_300, multiplier: 1.1, maxValue: 70 },
    { baseParamId: 2, baseValue: 0, multiplier: 1.1, maxValue: 35 },
    { baseParamId: 5, baseValue: 900, multiplier: 1.1, maxValue: 90 },
  ],
};

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

function canonicalOptions(overrides: Partial<ExactMipOptions> = {}): ExactMipOptions {
  const sourceSlots = overrides.slots ?? slots;
  const canonicalSlots = sourceSlots.map((slot, slotIndex) => slot.map((equip) => {
    if (slotIndex !== 0 || equip.baseParams.some((param) => param.baseParamId === -1)) return equip;
    return {
      ...equip,
      baseParams: [...equip.baseParams, { baseParamId: -1, value: equip.MDMG || equip.PDMG }],
    };
  }));
  return markCanonicalEvaluatorCandidateUpperBound({
    job: "RDM",
    jobLevel: 100,
    attributeIds,
    statIndexes,
    foods,
    evaluationFunction: evaluate,
    objective: "damage",
    maxSearchMs: 20_000,
    ...overrides,
    slots: canonicalSlots,
  });
}

function canonicalAttributes(
  selection: readonly EquipInfo[],
  food: FoodInfo | undefined,
): number[] {
  const result = new Array<number>(attributeIds.length).fill(0);
  for (const equip of selection) {
    for (const param of equip.baseParams) {
      const index = attributeIds.indexOf(param.baseParamId);
      if (index >= 0) result[index] += param.value;
    }
  }
  if (food !== undefined) {
    for (const param of food.baseParams) {
      const index = attributeIds.indexOf(param.baseParamId);
      if (index < 0) continue;
      result[index] += Math.min(
        param.maxValue,
        Math.trunc((result[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
      );
    }
  }
  return result;
}

function exhaustiveCanonical(options: ExactMipOptions) {
  const constraints = options.constraints ?? {};
  const foodsToCheck: (FoodInfo | undefined)[] = options.foods.length === 0
    ? [undefined]
    : [...options.foods];
  const candidates: {
    selection: EquipInfo[];
    food: FoodInfo | undefined;
    attributes: number[];
    factors: NonNullable<ReturnType<typeof evaluateFactors>>;
  }[] = [];
  const visit = (slotIndex: number, selection: EquipInfo[]) => {
    if (slotIndex < options.slots.length) {
      for (const equip of options.slots[slotIndex]!) visit(slotIndex + 1, [...selection, equip]);
      return;
    }
    const selectedUniqueRings = new Set<number>();
    for (const equip of selection) {
      if (equip.ringSlotIndex === undefined || equip.isUnique !== true) continue;
      if (selectedUniqueRings.has(equip.itemId)) return;
      selectedUniqueRings.add(equip.itemId);
    }
    for (const food of foodsToCheck) {
      const attributes = canonicalAttributes(selection, food);
      const factors = evaluateFactors(attributes);
      if (factors === undefined) continue;
      if (constraints.speedMin !== undefined && attributes[5]! < constraints.speedMin) continue;
      if (constraints.speedMax !== undefined && attributes[5]! > constraints.speedMax) continue;
      if (constraints.toughMin !== undefined && attributes[6]! < constraints.toughMin) continue;
      const gcds = constraints.gcdChoices ??
        (constraints.gcd === undefined ? undefined : [constraints.gcd]);
      if (gcds !== undefined && !gcds.some((gcd) => {
        const range = options.gcdToSpeedRange?.(gcd);
        return range !== undefined && attributes[5]! >= range.min && attributes[5]! <= range.max;
      })) continue;
      candidates.push({ selection, food, attributes, factors });
    }
  };
  visit(0, []);
  if (candidates.length === 0) return undefined;
  const useDps = options.objective === "dps" ||
    (options.objective === undefined && constraints.gcd === undefined);
  const score = (factors: (typeof candidates)[number]["factors"]) =>
    BigInt(factors.weaponDamage) * BigInt(factors.mainStat) * BigInt(factors.determination) *
    BigInt(factors.tenacity) * BigInt(factors.critical) * BigInt(factors.directHit);
  candidates.sort((left, right) => {
    if (constraints.maxToughnessMode === true && left.attributes[6] !== right.attributes[6]) {
      return right.attributes[6]! - left.attributes[6]!;
    }
    const leftScore = score(left.factors);
    const rightScore = score(right.factors);
    const leftCompared = useDps ? leftScore * BigInt(right.factors.gcdCentiseconds) : leftScore;
    const rightCompared = useDps ? rightScore * BigInt(left.factors.gcdCentiseconds) : rightScore;
    return leftCompared > rightCompared ? -1 : leftCompared < rightCompared ? 1 : 0;
  });
  return candidates[0];
}

function exactFactorProduct(factors: NonNullable<ReturnType<typeof evaluateFactors>>): bigint {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) * BigInt(factors.determination) *
    BigInt(factors.tenacity) * BigInt(factors.critical) * BigInt(factors.directHit);
}

test("exact canonical MIP matches enumeration with capped base-value food", async () => {
  const rawSlots = [
    [
      equipment(8100, 180, { 1: 700, 2: 500, 3: 330, 4: 210, 5: 140, 6: 120 }),
      equipment(8101, 120, { 1: 420, 2: 250, 3: 180, 4: 110, 5: 70, 6: 60 }),
    ],
    [
      equipment(8200, 0, { 1: 620, 2: 410, 3: 300, 4: 190, 5: 120, 6: 100 }),
      equipment(8201, 0, { 1: 400, 2: 220, 3: 160, 4: 90, 5: 50, 6: 40 }),
    ],
  ];
  const baseValueFoods: FoodInfo[] = [
    {
      itemId: 8300, itemLevel: 795, key: "base-value-capped-food",
      baseParams: [
        { baseParamId: 1, baseValue: 1_300, multiplier: 1.1, maxValue: 70 },
        { baseParamId: 2, baseValue: 0, multiplier: 1.1, maxValue: 35 },
        { baseParamId: 5, baseValue: 900, multiplier: 1.1, maxValue: 90 },
      ],
    },
    {
      itemId: 8301, itemLevel: 795, key: "base-value-alternate-food",
      baseParams: [
        { baseParamId: 1, baseValue: 250, multiplier: 1.1, maxValue: 90 },
        { baseParamId: 3, baseValue: 500, multiplier: 1.1, maxValue: 40 },
        { baseParamId: 6, baseValue: 100, multiplier: 1.1, maxValue: 30 },
      ],
    },
  ];
  const options = canonicalOptions({ slots: rawSlots, foods: baseValueFoods });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  const actualFactors = evaluateFactors(canonicalAttributes(result.selection, result.food));
  assert.ok(actualFactors);
  assert.equal(exactFactorProduct(actualFactors), exactFactorProduct(expected.factors));
});

test("primary-resource support inequalities strengthen the canonical proof without changing its optimum", async () => {
  const options = canonicalOptions({
    slots: [
      [
        equipment(8350, 180, { 1: 700, 2: 500, 3: 330, 4: 210, 5: 140, 6: 120 }),
        equipment(8351, 120, { 1: 420, 2: 250, 3: 180, 4: 110, 5: 70, 6: 60 }),
      ],
      [
        equipment(8360, 0, { 1: 620, 2: 410, 3: 300, 4: 190, 5: 120, 6: 100 }),
        equipment(8361, 0, { 1: 400, 2: 220, 3: 160, 4: 90, 5: 50, 6: 40 }),
      ],
    ],
    foods: [candidateBoundFood],
  });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);
  const lean = await findBestLoadoutExactMip(options);
  const strengthened = await findBestLoadoutExactMip({ ...options, primaryResourceSupports: true });
  assert.ok(lean);
  assert.ok(strengthened);
  const leanFactors = evaluateFactors(canonicalAttributes(lean.selection, lean.food));
  const strengthenedFactors = evaluateFactors(canonicalAttributes(strengthened.selection, strengthened.food));
  assert.ok(leanFactors);
  assert.ok(strengthenedFactors);
  assert.equal(exactFactorProduct(leanFactors), exactFactorProduct(expected.factors));
  assert.equal(exactFactorProduct(strengthenedFactors), exactFactorProduct(expected.factors));
  assert.equal(strengthened.statistics.primaryResourceSupportsEnabled, true);
  assert.ok(strengthened.statistics.constraints > lean.statistics.constraints,
    "the selected strategy adds only implied support rows to the exact model");
});

test("main-stat-only resource support preserves the canonical optimum", async () => {
  const options = canonicalOptions({
    slots: [
      [
        equipment(8370, 180, { 1: 700, 2: 500, 3: 330, 4: 210, 5: 140, 6: 120 }),
        equipment(8371, 120, { 1: 420, 2: 250, 3: 180, 4: 110, 5: 70, 6: 60 }),
      ],
      [
        equipment(8380, 0, { 1: 620, 2: 410, 3: 300, 4: 190, 5: 120, 6: 100 }),
        equipment(8381, 0, { 1: 400, 2: 220, 3: 160, 4: 90, 5: 50, 6: 40 }),
      ],
    ],
    foods: [candidateBoundFood],
  });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);
  const lean = await findBestLoadoutExactMip(options);
  const strengthened = await findBestLoadoutExactMip({ ...options, mainStatResourceSupport: true });
  assert.ok(lean);
  assert.ok(strengthened);
  const leanFactors = evaluateFactors(canonicalAttributes(lean.selection, lean.food));
  const strengthenedFactors = evaluateFactors(canonicalAttributes(strengthened.selection, strengthened.food));
  assert.ok(leanFactors);
  assert.ok(strengthenedFactors);
  assert.equal(exactFactorProduct(leanFactors), exactFactorProduct(expected.factors));
  assert.equal(exactFactorProduct(strengthenedFactors), exactFactorProduct(expected.factors));
  assert.equal(strengthened.statistics.mainStatResourceSupportEnabled, true);
  assert.equal(strengthened.statistics.primaryResourceSupportsEnabled, false);
  assert.equal(strengthened.statistics.constraints, lean.statistics.constraints + 1,
    "the strategy adds only the main-stat resource inequality");
});

test("canonical candidate upper bound preserves the optimum across multiple GCDs and exact speed bounds", async () => {
  const rawSlots = [
    [
      equipment(8400, 170, { 1: 670, 2: 480, 3: 320, 4: 200, 5: 150, 6: 120 }),
      equipment(8401, 160, { 1: 610, 2: 450, 3: 300, 4: 190, 5: 100, 6: 100 }),
    ],
    [
      equipment(8410, 0, { 1: 620, 2: 410, 3: 300, 4: 190, 5: 140, 6: 100 }),
      equipment(8411, 0, { 1: 590, 2: 430, 3: 280, 4: 180, 5: 90, 6: 90 }),
    ],
  ];
  const seed = canonicalOptions({ slots: rawSlots, foods: [foods[0]!] });
  const combinations = seed.slots[0]!.flatMap((first) => seed.slots[1]!.map((second) => {
    const attributes = canonicalAttributes([first, second], seed.foods[0]);
    return { attributes, factors: evaluateFactors(attributes)! };
  }));
  const gcdChoices = [...new Set(combinations.map(({ factors }) => factors.gcdCentiseconds / 100))];
  assert.ok(gcdChoices.length >= 2);
  const target = combinations[combinations.length - 1]!;
  const speed = target.attributes[5]!;
  const targetGcd = target.factors.gcdCentiseconds / 100;
  const otherGcd = gcdChoices.find((gcd) => gcd !== targetGcd)!;
  const options = canonicalOptions({
    slots: [
      rawSlots[0]!,
      [
        rawSlots[1]![0]!,
        rawSlots[1]![1]!,
        ...Array.from({ length: 49_996 }, (_, index) => ({
          ...equipment(84_100 + index, 0, { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }),
          key: `multi-gcd-weak-${index}`,
        })),
      ],
    ],
    foods: [foods[0]!],
    objective: "dps",
    constraints: { gcdChoices: [targetGcd, otherGcd], speedMin: speed, speedMax: speed },
    speedAttributeId: 5,
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
  });
  const oracleOptions = canonicalOptions({
    slots: rawSlots,
    foods: [foods[0]!],
    objective: "dps",
    constraints: { gcdChoices: [targetGcd, otherGcd], speedMin: speed, speedMax: speed },
    speedAttributeId: 5,
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd("RDM", 100, gcd),
  });
  const expected = exhaustiveCanonical(oracleOptions);
  assert.ok(expected);
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.deepEqual(result.selection, expected.selection);
  assert.strictEqual(result.food, expected.food);
  const actualFactors = evaluateFactors(canonicalAttributes(result.selection, result.food));
  assert.ok(actualFactors);
  assert.equal(canonicalAttributes(result.selection, result.food)[5], speed);
  assert.deepEqual(actualFactors, expected.factors,
    "the pruned search must return exactly the oracle's integer damage and GCD factors");
  assert.ok(result.statistics.candidateUpperBound,
    "the 50k formal threshold must activate candidate upper-bound pruning");
  assert.equal(result.statistics.candidateUpperBound.candidatesBefore, 50_000);
  assert.ok(result.statistics.candidateUpperBound.candidatesAfter < 50_000,
    "strictly inferior weak variants must be removed before the exact MIP proof");
});

test("canonical candidate upper bound remains safe with unique ring conflicts", async () => {
  const weapon = equipment(8500, 170, { 1: 650, 2: 450, 3: 300, 4: 190, 5: 120, 6: 100 });
  const ring = (itemId: number, ringSlotIndex: 0 | 1, isUnique: boolean, main: number, crt: number) => ({
    ...equipment(itemId, 0, { 1: main, 2: crt, 3: 280, 4: 180, 5: 100, 6: 100 }),
    ringSlotIndex,
    isUnique,
  });
  const rawSlots = [
    [weapon],
    [ring(8510, 0, true, 700, 500), ring(8511, 0, false, 500, 300)],
    [ring(8510, 1, true, 700, 500), ring(8512, 1, false, 520, 320)],
  ];
  const options = canonicalOptions({ slots: rawSlots, foods: [foods[0]!] });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  const firstRing = result.selection[1]!;
  const secondRing = result.selection[2]!;
  assert.ok(firstRing.itemId !== secondRing.itemId || firstRing.isUnique !== true);
  assert.equal(
    exactFactorProduct(evaluateFactors(canonicalAttributes(result.selection, result.food))!),
    exactFactorProduct(expected.factors),
  );
});

test("candidate upper-bound arithmetic preserves food caps and exact strict damage/DPS ordering", () => {
  assert.equal(canonicalFoodBonusUpperBoundAtRaw(0, {
    baseParamId: 1, baseValue: 100, multiplier: 1.1, maxValue: 90,
  }), 10, "food baseValue contributes before percentage flooring");
  assert.equal(canonicalFoodBonusUpperBoundAtRaw(500, {
    baseParamId: 1, baseValue: 100, multiplier: 1.1, maxValue: 30,
  }), 30, "the legal food cap bounds its percentage bonus");
  assert.equal(canonicalFoodBonusUpperBoundAtRaw(200, {
    baseParamId: 1, baseValue: 0, multiplier: 1.005, maxValue: 90,
  }), undefined, "a formula edge the exact model cannot represent must fail open");

  const baseline = evaluateFactors(new Array<number>(attributeIds.length).fill(0));
  assert.ok(baseline);
  assert.equal(candidateUpperBoundIsStrictlyWorse(baseline, baseline, false), false,
    "equal upper bounds must be retained");
  assert.equal(candidateUpperBoundCannotImproveIncumbent(baseline, baseline, false), true,
    "an equal per-candidate upper bound can be excluded from a strict-improvement proof");
  assert.equal(candidateUpperBoundCannotImproveIncumbent({ ...baseline, weaponDamage: 2 }, {
    ...baseline, weaponDamage: 1,
  }, false), true, "a strictly worse candidate cannot improve the damage incumbent");
  assert.equal(candidateUpperBoundCannotImproveIncumbent({ ...baseline, weaponDamage: 1 }, {
    ...baseline, weaponDamage: 2,
  }, false), false, "a strictly better upper bound must remain eligible");
  assert.equal(candidateUpperBoundIsStrictlyWorse({ ...baseline, weaponDamage: 2 }, {
    ...baseline, weaponDamage: 1,
  }, false), true, "strictly lower exact damage factors may be removed");
  assert.equal(candidateUpperBoundIsStrictlyWorse({ ...baseline, weaponDamage: 2, gcdCentiseconds: 200 }, {
    ...baseline, weaponDamage: 1, gcdCentiseconds: 100,
  }, true), false, "equal exact DPS ratios must be retained");
  assert.equal(candidateUpperBoundIsStrictlyWorse({ ...baseline, weaponDamage: 3, gcdCentiseconds: 200 }, {
    ...baseline, weaponDamage: 1, gcdCentiseconds: 100,
  }, true), true, "strictly better exact incumbent DPS proves the upper bound inferior");
  assert.equal(candidateUpperBoundCannotImproveIncumbent({
    ...baseline, weaponDamage: 2, gcdCentiseconds: 200,
  }, {
    ...baseline, weaponDamage: 2, gcdCentiseconds: 201,
  }, true), true, "a slower equal-damage upper bound cannot improve DPS");
  assert.equal(candidateUpperBoundCannotImproveIncumbent({
    ...baseline, weaponDamage: 2, gcdCentiseconds: 200,
  }, {
    ...baseline, weaponDamage: 2, gcdCentiseconds: 199,
  }, true), false, "a faster equal-damage upper bound must remain eligible for DPS");

  const largeCandidatePool = [new Array(50_000).fill({})];
  assert.equal(shouldEnableCanonicalCandidateUpperBound({ slots: largeCandidatePool }, true), true);
  assert.equal(shouldEnableCanonicalCandidateUpperBound({ slots: largeCandidatePool }, false), false,
    "direct options without the internal optimizer marker stay on the existing path");
  assert.equal(shouldEnableCanonicalCandidateUpperBound({
    slots: largeCandidatePool,
    equipmentAttributeExtractor: () => [],
  }, true), false, "custom extractors cannot use the canonical bound");
  assert.equal(shouldEnableCanonicalCandidateUpperBound({
    slots: largeCandidatePool,
    constraints: { maxToughnessMode: true },
  }, true), false, "maximum-toughness mode cannot use the damage upper bound");
  assert.equal(shouldEnableCanonicalCandidateUpperBound({ slots: new Array(1_999).fill([{}]) }, true), false,
    "candidate pools below 2k avoid the preprocessing path");
  assert.equal(shouldEnableCanonicalCandidateUpperBound({ slots: new Array(2_000).fill([{}]) }, true), true,
    "large canonical candidate pools enter the preprocessing path at 2k");

});

test("50k canonical candidate pruning rebuilds and restores the original winning candidate", async () => {
  const weak = equipment(8600, 90, { 1: 300, 2: 200, 3: 120, 4: 80, 5: 40, 6: 30 });
  const winner = equipment(8601, 180, { 1: 700, 2: 500, 3: 330, 4: 210, 5: 140, 6: 120 });
  const candidates = [weak, winner];
  for (let index = 2; index < 50_000; index++) {
    candidates.push({ ...weak, itemId: 86_000 + index, key: `weak-${index}` });
  }
  const options = canonicalOptions({ slots: [candidates], foods: [candidateBoundFood] });
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.strictEqual(result.selection[0], options.slots[0]![1],
    "MIP columns rebuilt from the pruned slot must restore the caller's original candidate object");
  assert.ok(result.statistics.candidateUpperBound);
  assert.equal(result.statistics.candidateUpperBound.candidatesBefore, 50_000);
  assert.ok(result.statistics.candidateUpperBound.candidatesAfter < 50_000);
});

test("50k canonical pruning remains exact when the independent ring slots conflict on a unique item", async () => {
  const weapon = equipment(8700, 170, { 1: 650, 2: 450, 3: 300, 4: 190, 5: 120, 6: 100 });
  const ring = (itemId: number, ringSlotIndex: 0 | 1, isUnique: boolean, main: number, crt: number) => ({
    ...equipment(itemId, 0, { 1: main, 2: crt, 3: 280, 4: 180, 5: 100, 6: 100 }),
    ringSlotIndex,
    isUnique,
  });
  const ring0 = [ring(8710, 0, true, 700, 500), ring(8711, 0, false, 500, 300)];
  const ring1 = [ring(8710, 1, true, 700, 500), ring(8712, 1, false, 520, 320)];
  const weak = equipment(8720, 0, { 1: 100, 2: 80, 3: 50, 4: 30, 5: 20, 6: 10 });
  const winner = equipment(8721, 0, { 1: 600, 2: 420, 3: 300, 4: 180, 5: 120, 6: 100 });
  const accessoryCandidates = [weak, winner];
  for (let index = 2; index < 49_995; index++) {
    accessoryCandidates.push({ ...weak, itemId: 87_200 + index, key: `weak-accessory-${index}` });
  }
  const allSlots = [[weapon], ring0, ring1, accessoryCandidates];
  const options = canonicalOptions({ slots: allSlots, foods: [candidateBoundFood] });
  const oracleOptions = canonicalOptions({
    slots: [[weapon], ring0, ring1, [weak, winner]],
    foods: [candidateBoundFood],
  });
  const expected = exhaustiveCanonical(oracleOptions);
  assert.ok(expected);
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.notEqual(result.selection[1]!.itemId, result.selection[2]!.itemId,
    "the exact model must keep the unique ring cross-slot conflict");
  const actualFactors = evaluateFactors(canonicalAttributes(result.selection, result.food));
  assert.ok(actualFactors);
  assert.equal(exactFactorProduct(actualFactors), exactFactorProduct(expected.factors));
  assert.ok(result.statistics.candidateUpperBound);
  assert.ok(result.statistics.candidateUpperBound.candidatesAfter < 50_000);
});

test("canonical candidate upper bound is skipped in maximum-toughness mode", async () => {
  const options = canonicalOptions({
    constraints: { maxToughnessMode: true },
    toughnessAttributeId: 6,
  });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.equal(result.maximumToughness, expected.attributes[6]);
  assert.equal(result.statistics.candidateUpperBound, undefined);
});

test("custom exact-MIP evaluators do not opt into canonical candidate pruning", async () => {
  const result = await findBestLoadoutExactMip(exactMipOptions());
  assert.ok(result);
  assert.equal(result.statistics.candidateUpperBound, undefined);
});

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

test("exact MIP enforces unique ring item IDs across meld variants and permits ordinary duplicates", async () => {
  const meldedRing = (
    itemId: number,
    variantKey: string,
    main: number,
    critical: number,
  ): EquipInfo => ({
    ...equipment(itemId, 0, { 1: main, 2: critical, 3: 400, 4: 200, 5: 100, 6: 100 }),
    variantKey,
  });
  const weapon = slots[0]![0]!;
  const uniqueA = meldedRing(9100, "unique-meld-a", 600, 450);
  const uniqueB = meldedRing(9100, "unique-meld-b", 590, 460);
  const ordinaryA = meldedRing(9200, "ordinary-meld-a", 600, 450);
  const ordinaryB = meldedRing(9200, "ordinary-meld-b", 590, 460);
  const weakA = meldedRing(9201, "weak-a", 100, 100);
  const weakB = meldedRing(9202, "weak-b", 100, 100);
  const ringCandidate = (equipment: EquipInfo, ringSlotIndex: 0 | 1, isUnique: boolean): EquipInfo => ({
    ...equipment,
    ringSlotIndex,
    isUnique,
  });

  const uniqueResult = await findBestLoadoutExactMip(exactMipOptions({
    slots: [
      [weapon],
      [ringCandidate(uniqueA, 0, true), ringCandidate(weakA, 0, false)],
      [ringCandidate(uniqueB, 1, true), ringCandidate(weakB, 1, false)],
    ],
    foods: [foods[0]!],
    objective: "damage",
    maxSearchMs: 20_000,
  }));
  assert.ok(uniqueResult);
  assert.notDeepEqual(
    uniqueResult.selection.slice(1).map((ring) => ring.itemId),
    [9100, 9100],
    "different meld variants of one unique physical item cannot fill both ring slots",
  );

  const ordinaryResult = await findBestLoadoutExactMip(exactMipOptions({
    slots: [
      [weapon],
      [ringCandidate(ordinaryA, 0, false), ringCandidate(weakA, 0, false)],
      [ringCandidate(ordinaryB, 1, false), ringCandidate(weakB, 1, false)],
    ],
    foods: [foods[0]!],
    objective: "damage",
    maxSearchMs: 20_000,
  }));
  assert.ok(ordinaryResult);
  assert.deepEqual(ordinaryResult.selection.slice(1).map((ring) => ring.itemId), [9200, 9200]);
  assert.deepEqual(ordinaryResult.selection.slice(1).map((ring) => ring.variantKey), [
    "ordinary-meld-a",
    "ordinary-meld-b",
  ]);
});

test("ring Pareto frontiers preserve a weaker unique ring needed to pair with the only opposite unique ring", async () => {
  const weapon = slots[0]![0]!;
  const ring = (
    itemId: number,
    ringSlotIndex: 0 | 1,
    main: number,
    critical: number,
    determination: number,
    directHit: number,
    speed: number,
    tenacity: number,
  ): EquipInfo => ({
    ...equipment(itemId, 0, {
      1: main,
      2: critical,
      3: determination,
      4: directHit,
      5: speed,
      6: tenacity,
    }),
    variantKey: `ring-${itemId}-${ringSlotIndex}`,
    ringSlotIndex,
    isUnique: true,
  });
  const firstSlot = [
    ring(9600, 0, 700, 500, 400, 300, 150, 120),
    ring(9601, 0, 600, 400, 300, 200, 100, 100),
  ];
  const oppositeSlot = [ring(9600, 1, 700, 500, 400, 300, 150, 120)];
  const attributes = (candidate: EquipInfo) => [1, 2, 3, 4, 5, 6].map((id) =>
    candidate.baseParams.find((param) => param.baseParamId === id)?.value ?? 0);
  const optimizedFirstSlot = paretoRingCandidates(
    firstSlot.map((value, order) => ({
      value,
      itemId: value.itemId,
      isUnique: value.isUnique === true,
      attributes: attributes(value),
      order,
    })),
    oppositeSlot.map(({ itemId, isUnique }) => ({ itemId, isUnique: isUnique === true })),
  ).map(({ value }) => value);
  const result = await findBestLoadoutExactMip(exactMipOptions({
    slots: [[weapon], optimizedFirstSlot, oppositeSlot],
    foods: [foods[0]!],
    objective: "damage",
    maxSearchMs: 20_000,
  }));

  assert.ok(result);
  assert.deepEqual(result.selection.slice(1).map(({ itemId }) => itemId), [9601, 9600]);
  assert.equal(result.statistics.signatureBandProof, true,
    "the exact solver must prove the legal weaker-plus-stronger pair optimal");
});

test("exact MIP removes symmetric ring-slot assignments while keeping the exact optimum", async () => {
  const baseWeapon = slots[0]![0]!;
  const weapon = {
    ...baseWeapon,
    baseParams: [...baseWeapon.baseParams, { baseParamId: -1, value: baseWeapon.MDMG }],
  };
  const ring = (itemId: number, ringSlotIndex: 0 | 1, main: number, critical: number): EquipInfo => ({
    ...equipment(itemId, 0, { 1: main, 2: critical, 3: 400, 4: 200, 5: 100, 6: 100 }),
    variantKey: `ring-${itemId}`,
    ringSlotIndex,
    isUnique: true,
  });
  const firstRing0 = ring(9500, 0, 600, 450);
  const secondRing0 = ring(9501, 0, 590, 460);
  const firstRing1 = ring(9500, 1, 600, 450);
  const secondRing1 = ring(9501, 1, 590, 460);
  const options = exactMipOptions({
    slots: [[weapon], [secondRing0, firstRing0], [firstRing1, secondRing1]],
    foods: [foods[0]!],
    objective: "damage",
    maxSearchMs: 20_000,
  });
  Reflect.deleteProperty(options, "equipmentAttributeExtractor");

  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.deepEqual(result.selection.slice(1).map(({ itemId }) => itemId), [9500, 9501],
    "the lexicographic identity order should select one representative of the symmetric pair");
  assert.equal(result.statistics.signatureBandProof, true,
    "symmetry reduction must retain the full exact optimality proof");
});

test("exact MIP rejects incomplete or contradictory independent ring uniqueness metadata", async () => {
  const weapon = slots[0]![0]!;
  const first: EquipInfo = {
    ...equipment(9400, 0, { 1: 400, 2: 300, 3: 250, 4: 150, 5: 100, 6: 100 }),
    ringSlotIndex: 0,
    isUnique: true,
  };
  const second: EquipInfo = { ...first, ringSlotIndex: 1 };
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      slots: [[weapon], [first], [equipment(9401, 0, {})]],
      foods: [foods[0]!],
      maxSearchMs: 20_000,
    })),
    /必须同时包含戒指1和戒指2槽/,
  );
  await assert.rejects(
    findBestLoadoutExactMip(exactMipOptions({
      slots: [[weapon], [first], [{ ...second, isUnique: false }]],
      foods: [foods[0]!],
      maxSearchMs: 20_000,
    })),
    /IsUnique 元数据不一致/,
  );
});

test("exact MIP keeps a complete feasible start when the bounded greedy scan expires", async () => {
  const previousProfileSetting = process.env.FFXIV_PROFILE_TIMING;
  process.env.FFXIV_PROFILE_TIMING = "1";
  const clock = { now: 0 };
  const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  const progressEvents: { model: string; message?: string }[] = [];
  let evaluationCount = 0;
  let result: Awaited<ReturnType<typeof findBestLoadoutExactMip>>;
  try {
    result = await findBestLoadoutExactMip(exactMipOptions({
      slots: [
        Array.from({ length: 64 }, (_, index) => ({
          ...slots[0]![0]!,
          itemId: 10_000 + index,
          variantKey: `deadline-${index}`,
        })),
        [slots[1]![0]!],
      ],
      foods: [foods[0]!],
      maxSearchMs: 30_000,
      evaluationFunction: (attributes) => {
        evaluationCount++;
        if (evaluationCount === 2) clock.now = 101;
        return evaluate(attributes);
      },
      onSolverProgress: (event) => progressEvents.push(event),
    }));
  } finally {
    nowSpy.mockRestore();
    if (previousProfileSetting === undefined) delete process.env.FFXIV_PROFILE_TIMING;
    else process.env.FFXIV_PROFILE_TIMING = previousProfileSetting;
  }

  assert.ok(result);
  const startEvent = progressEvents.find((event) =>
    event.model.startsWith("exact_damage_initial") && (event.message ?? "").includes('"phase":"highs-call-start"'));
  assert.ok(startEvent, "the exact MIP must run with profile details for its initial model");
  const startProfile = JSON.parse((startEvent.message ?? "").slice("PROFILE ".length)) as {
    hintTerms: number;
    variables: number;
  };
  assert.equal(startProfile.hintTerms, startProfile.variables,
    "every equipment, food, attribute, and factor variable should be present in the validated start");
  assert.equal(result!.statistics.signatureBandProof, true,
    "the complete start remains only a hint; the exact signature proof still runs");
});

test("exact MIP withholds its sparse hint when selected unique rings conflict across slots", async () => {
  const previousProfileSetting = process.env.FFXIV_PROFILE_TIMING;
  process.env.FFXIV_PROFILE_TIMING = "1";
  const progressEvents: { model: string; message?: string }[] = [];
  let result: Awaited<ReturnType<typeof findBestLoadoutExactMip>>;
  try {
    const first: EquipInfo = {
      ...equipment(10_100, 0, { 1: 600, 2: 450, 3: 300, 4: 180, 5: 115, 6: 100 }),
      ringSlotIndex: 0,
      isUnique: true,
    };
    const second: EquipInfo = { ...first, ringSlotIndex: 1 };
    result = await findBestLoadoutExactMip(exactMipOptions({
      slots: [[slots[0]![0]!], [first], [second]],
      foods: [foods[0]!],
      maxSearchMs: 20_000,
      onSolverProgress: (event) => progressEvents.push(event),
    }));
  } finally {
    if (previousProfileSetting === undefined) delete process.env.FFXIV_PROFILE_TIMING;
    else process.env.FFXIV_PROFILE_TIMING = previousProfileSetting;
  }

  assert.equal(result, undefined, "one unique physical ring cannot fill both ring slots");
  const startEvent = progressEvents.find((event) =>
    event.model.startsWith("exact_damage_initial") && (event.message ?? "").includes('"phase":"highs-call-start"'));
  assert.ok(startEvent, "the infeasible model should reach HiGHS with an observable start");
  const startProfile = JSON.parse((startEvent.message ?? "").slice("PROFILE ".length)) as { hintTerms: number };
  assert.equal(startProfile.hintTerms, 0, "an infeasible unique-ring selection must not be submitted as a hint");
});

test("parallel baseline worker preserves solver-side unique ring markers in serialized slots", async () => {
  const executor = await createParallelBaselineExecutor();
  assert.ok(executor);
  const workerWeapon = {
    ...slots[0]![0]!,
    baseParams: [...slots[0]![0]!.baseParams, { baseParamId: -1, value: slots[0]![0]!.MDMG }],
  };
  const firstRing: EquipInfo = {
    ...equipment(9300, 0, { 1: 400, 2: 300, 3: 250, 4: 150, 5: 100, 6: 100 }),
    ringSlotIndex: 0,
    isUnique: true,
  };
  const secondRing: EquipInfo = {
    ...firstRing,
    ringSlotIndex: 1,
  };
  try {
    const results = await executor([exactMipOptions({
      slots: [[workerWeapon], [firstRing], [secondRing]],
      equipmentAttributeExtractor: undefined,
      foods: [foods[0]!],
      objective: "damage",
      maxSearchMs: 20_000,
    })], {
      remainingMs: () => 20_000,
      isCancelled: () => false,
      maxConcurrency: 1,
    });
    assert.deepEqual(results, [undefined]);
  } finally {
    await executor.dispose?.();
  }
});

test("exact MIP falls back to complete factor classes when reachable-value work exceeds its budget", async () => {
  const wideSlots = Array.from({ length: 12 }, (_, index) => [
    equipment(7000 + index * 2, index === 0 ? 160 : 0, { 1: 0 }),
    equipment(7001 + index * 2, index === 0 ? 160 : 0, { 1: 2 ** index }),
  ]);
  const manyFoods: FoodInfo[] = Array.from({ length: 300 }, (_, index) => ({
    itemId: 8000 + index,
    itemLevel: 795,
    key: `empty-food-${index}`,
    baseParams: [],
  }));
  let expected = 0n;
  for (let mask = 0; mask < 1 << wideSlots.length; mask++) {
    const selection = wideSlots.map((slot, index) => slot[(mask >> index) & 1]!);
    const score = product(selection, manyFoods[0]!);
    if (score > expected) expected = score;
  }

  const previousProfileSetting = process.env.FFXIV_PROFILE_TIMING;
  process.env.FFXIV_PROFILE_TIMING = "1";
  const progressEvents: { model: string; message?: string }[] = [];
  let result: Awaited<ReturnType<typeof findBestLoadoutExactMip>>;
  try {
    result = await findBestLoadoutExactMip(exactMipOptions({
      slots: wideSlots,
      foods: manyFoods,
      objective: "damage",
      maxSearchMs: 30_000,
      onSolverProgress: (event) => progressEvents.push(event),
    }));
  } finally {
    if (previousProfileSetting === undefined) delete process.env.FFXIV_PROFILE_TIMING;
    else process.env.FFXIV_PROFILE_TIMING = previousProfileSetting;
  }

  assert.ok(result);
  assert.equal(product(result.selection, result.food!), expected);
  const summary = progressEvents.find((event) =>
    event.model === "exact_search_RDM" && (event.message ?? "").includes("exact-search-summary"));
  assert.ok(summary);
  const profile = JSON.parse((summary.message ?? "").slice("PROFILE ".length)) as {
    reachableAttributePruningSkipped: number;
  };
  assert.ok(profile.reachableAttributePruningSkipped > 0,
    "the 4096 reachable main-stat values times 300 foods must trigger the whole-axis fallback");
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
      generatedDataBinary: globalThis.__FFXIV_GENERATED_DATA_BINARY__,
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
  const bluSlots = slots.map((slot, slotIndex) => slot.map((equip, candidateIndex) => ({
    ...equip,
    MDMG: slotIndex === 0 ? (candidateIndex === 0 ? 160 : 80) : 0,
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
  const previousProfileSetting = process.env.FFXIV_PROFILE_TIMING;
  process.env.FFXIV_PROFILE_TIMING = "1";
  const progressEvents: { model: string; message?: string }[] = [];
  let result: Awaited<ReturnType<typeof findBestLoadoutExactMip>>;
  try {
    result = await findBestLoadoutExactMip({
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
      onSolverProgress: (event) => progressEvents.push(event),
    });
  } finally {
    if (previousProfileSetting === undefined) delete process.env.FFXIV_PROFILE_TIMING;
    else process.env.FFXIV_PROFILE_TIMING = previousProfileSetting;
  }
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
  const summary = progressEvents.find((event) =>
    event.model === "exact_search_BLU" && (event.message ?? "").includes("exact-search-summary"));
  assert.ok(summary);
  const profile = JSON.parse((summary.message ?? "").slice("PROFILE ".length)) as {
    reachableWeaponFactorClassesRemoved: number;
    reachableWeaponPruningSkipped: number;
  };
  assert.ok(profile.reachableWeaponFactorClassesRemoved > 0,
    "BLU weapon classes must retain only sums reachable from MDMG and evaluator-derived INT additions");
  assert.equal(profile.reachableWeaponPruningSkipped, 0);
});


test("exact MIP prunes unreachable non-BLU weapon classes with food modifiers and preserves the exhaustive optimum", async () => {
  const weaponSlots = slots.map((slot, slotIndex) => slot.map((equip, candidateIndex) => ({
    ...equip,
    MDMG: slotIndex === 0 ? (candidateIndex === 0 ? 160 : 140) : 0,
  })));
  const weaponFood: FoodInfo = {
    itemId: 5988,
    itemLevel: 795,
    key: "sparse-weapon-attribute-food",
    baseParams: [{ baseParamId: -1, multiplier: 1.01, maxValue: 90 }],
  };
  let expected: bigint | undefined;
  for (const first of weaponSlots[0]!) {
    for (const second of weaponSlots[1]!) {
      const score = product([first, second], weaponFood);
      if (expected === undefined || score > expected) expected = score;
    }
  }
  assert.ok(expected !== undefined);

  const previousProfileSetting = process.env.FFXIV_PROFILE_TIMING;
  process.env.FFXIV_PROFILE_TIMING = "1";
  const progressEvents: { model: string; message?: string }[] = [];
  let result: Awaited<ReturnType<typeof findBestLoadoutExactMip>>;
  try {
    result = await findBestLoadoutExactMip(exactMipOptions({
      slots: weaponSlots,
      foods: [weaponFood],
      objective: "damage",
      onSolverProgress: (event) => progressEvents.push(event),
    }));
  } finally {
    if (previousProfileSetting === undefined) delete process.env.FFXIV_PROFILE_TIMING;
    else process.env.FFXIV_PROFILE_TIMING = previousProfileSetting;
  }

  assert.ok(result);
  assert.equal(product(result.selection, result.food!), expected);
  const summary = progressEvents.find((event) =>
    event.model === "exact_search_RDM" && (event.message ?? "").includes("exact-search-summary"));
  assert.ok(summary);
  const profile = JSON.parse((summary.message ?? "").slice("PROFILE ".length)) as {
    reachableFactorClassesRemoved: number;
    reachableWeaponFactorClassesRemoved: number;
    reachableWeaponPruningSkipped: number;
  };
  assert.ok(profile.reachableWeaponFactorClassesRemoved > 0,
    "non-BLU weapon damage classes absent from the gear/food reachable set must be removed");
  assert.ok(profile.reachableFactorClassesRemoved >= profile.reachableWeaponFactorClassesRemoved);
  assert.equal(profile.reachableWeaponPruningSkipped, 0);
  assert.equal(result.statistics.reachableWeaponFactorClassesRemoved,
    profile.reachableWeaponFactorClassesRemoved);
});


test("duplicate food weapon modifiers skip the whole weapon reachability axis", async () => {
  const duplicateWeaponFood: FoodInfo = {
    itemId: 5989,
    itemLevel: 795,
    key: "duplicate-weapon-attribute-food",
    baseParams: [
      { baseParamId: -1, multiplier: 1.1, maxValue: 10 },
      { baseParamId: -1, multiplier: 1, maxValue: 0 },
    ],
  };
  let expected: bigint | undefined;
  for (const first of slots[0]!) {
    for (const second of slots[1]!) {
      const score = product([first, second], duplicateWeaponFood);
      if (expected === undefined || score > expected) expected = score;
    }
  }
  assert.ok(expected !== undefined);

  const previousProfileSetting = process.env.FFXIV_PROFILE_TIMING;
  process.env.FFXIV_PROFILE_TIMING = "1";
  const progressEvents: { model: string; message?: string }[] = [];
  let result: Awaited<ReturnType<typeof findBestLoadoutExactMip>>;
  try {
    result = await findBestLoadoutExactMip(exactMipOptions({
      foods: [duplicateWeaponFood],
      objective: "damage",
      onSolverProgress: (event) => progressEvents.push(event),
    }));
  } finally {
    if (previousProfileSetting === undefined) delete process.env.FFXIV_PROFILE_TIMING;
    else process.env.FFXIV_PROFILE_TIMING = previousProfileSetting;
  }

  assert.ok(result);
  assert.equal(product(result.selection, result.food!), expected);
  const summary = progressEvents.find((event) =>
    event.model === "exact_search_RDM" && (event.message ?? "").includes("exact-search-summary"));
  assert.ok(summary);
  const profile = JSON.parse((summary.message ?? "").slice("PROFILE ".length)) as {
    reachableWeaponFactorClassesRemoved: number;
    reachableWeaponPruningSkipped: number;
  };
  assert.equal(profile.reachableWeaponFactorClassesRemoved, 0);
  assert.ok(profile.reachableWeaponPruningSkipped > 0,
    "ambiguous duplicate food modifiers must disable weapon-axis pruning");
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

test("exact MIP submits a complete capped-food and multiple-GCD start, then matches enumeration", async () => {
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
  const previousProfileSetting = process.env.FFXIV_PROFILE_TIMING;
  process.env.FFXIV_PROFILE_TIMING = "1";
  const progressEvents: { model: string; message?: string }[] = [];
  let result: Awaited<ReturnType<typeof findBestLoadoutExactMip>>;
  try {
    result = await findBestLoadoutExactMip({
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
      onSolverProgress: (event) => progressEvents.push(event),
    });
  } finally {
    if (previousProfileSetting === undefined) delete process.env.FFXIV_PROFILE_TIMING;
    else process.env.FFXIV_PROFILE_TIMING = previousProfileSetting;
  }
  assert.ok(result);
  const startEvent = progressEvents.find((event) =>
    event.model.startsWith("exact_damage_initial") && (event.message ?? "").includes('"phase":"highs-call-start"'));
  assert.ok(startEvent, "the exact model should receive a precomputed MIP start");
  const startProfile = JSON.parse((startEvent.message ?? "").slice("PROFILE ".length)) as {
    hintTerms: number;
    variables: number;
  };
  assert.equal(startProfile.hintTerms, startProfile.variables,
    "the start must cover food bonus/cap variables and the GCD-choice one-hot variables");
  const cappedIntFood = result!.food!.baseParams.find((param) => param.baseParamId === 1);
  const rawInt = result!.selection.reduce((total, equipment) => total +
    (equipmentAttributeExtractor(equipment).find((param) => param.baseParamId === 1)?.value ?? 0), 0);
  assert.ok(cappedIntFood);
  assert.ok(Math.trunc(rawInt * (cappedIntFood.multiplier - 1) + 1e-7) >= cappedIntFood.maxValue,
    "the selected ordinary food must exercise its cap in the complete hint");
  assert.equal(result!.statistics.signatureBandProof, true,
    "the complete start must not replace the exact optimality proof");
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

test("candidate-level conditional damage-resource supports preserve every exhaustive combination and optimum", async () => {
  const rangedSlots: EquipInfo[][] = [
    [
      { ...equipment(9601, 180, { 1: 700, 2: 500, 3: 330, 4: 210, 5: 140, 6: 120 }), itemLevel: 795 },
      { ...equipment(9602, 165, { 1: 650, 2: 470, 3: 310, 4: 190, 5: 130, 6: 110 }), itemLevel: 755 },
      { ...equipment(9604, 155, { 1: 625, 2: 450, 3: 300, 4: 180, 5: 125, 6: 105 }), itemLevel: 765 },
      { ...equipment(9603, 145, { 1: 600, 2: 440, 3: 290, 4: 170, 5: 120, 6: 100 }), itemLevel: 715 },
    ],
    [
      { ...equipment(9611, 0, { 1: 680, 2: 490, 3: 325, 4: 205, 5: 135, 6: 115 }), itemLevel: 795 },
      { ...equipment(9612, 0, { 1: 640, 2: 460, 3: 305, 4: 185, 5: 125, 6: 105 }), itemLevel: 735 },
      { ...equipment(9614, 0, { 1: 615, 2: 435, 3: 285, 4: 165, 5: 115, 6: 95 }), itemLevel: 765 },
      { ...equipment(9613, 0, { 1: 590, 2: 420, 3: 275, 4: 160, 5: 110, 6: 95 }), itemLevel: 715 },
    ],
  ];
  const ranges = [{ min: 775, max: 795 }, { min: 735, max: 755 }] as const;
  const options = canonicalOptions({
    slots: rangedSlots,
    foods,
    candidateItemLevelRanges: ranges,
  });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);

  const resourceIds = [-1, 1, 2, 3, 4, 5, 6];
  const resource = (equipmentInfo: EquipInfo) => resourceIds.reduce((sum, id) =>
    sum + (equipmentInfo.baseParams.find((param) => param.baseParamId === id)?.value ?? 0), 0);
  const rawMaximumById = new Map(resourceIds.map((id) => [id,
    rangedSlots.reduce((total, slot) => total + Math.max(...slot.map((candidate) =>
      candidate.baseParams.find((param) => param.baseParamId === id)?.value ?? 0)), 0),
  ]));
  const maximumFoodResource = Math.max(0, ...foods.map((food) => resourceIds.reduce((total, id) => {
    const param = food.baseParams.find((entry) => entry.baseParamId === id);
    if (param === undefined) return total;
    const rawMaximum = rawMaximumById.get(id)!;
    const bonus = Math.min(param.maxValue,
      Math.trunc((rawMaximum + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7));
    return total + bonus;
  }, 0)));
  const slotMaximumResources = rangedSlots.map((slot) => Math.max(...slot.map(resource)));
  for (const first of rangedSlots[0]!) {
    for (const second of rangedSlots[1]!) {
      const selection = [first, second];
      const outsideSlot = selection.findIndex((candidate) =>
        !ranges.some(({ min, max }) => candidate.itemLevel >= min && candidate.itemLevel <= max));
      if (outsideSlot < 0) continue;
      const selected = selection[outsideSlot]!;
      const selectedBand = Math.floor(selected.itemLevel / 20);
      const bandMaximum = Math.max(...rangedSlots[outsideSlot]!
        .filter((candidate) => !ranges.some(({ min, max }) =>
          candidate.itemLevel >= min && candidate.itemLevel <= max) &&
          Math.floor(candidate.itemLevel / 20) === selectedBand)
        .map(resource));
      const otherSlot = 1 - outsideSlot;
      const conditionalBudget = bandMaximum + slotMaximumResources[otherSlot]! + maximumFoodResource;
      for (const food of foods) {
        const finalAttributes = canonicalAttributes(selection, food);
        const actualResource = resourceIds.reduce((total, id) =>
          total + finalAttributes[attributeIds.indexOf(id)]!, 0);
        assert.ok(actualResource <= conditionalBudget,
          `配置 ${selection.map((entry) => entry.itemId).join("+")} / 食物 ${food.itemId} 超过条件资源预算`);
      }
    }
  }

  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  const actualFactors = evaluateFactors(canonicalAttributes(result.selection, result.food));
  assert.ok(actualFactors);
  assert.equal(exactFactorProduct(actualFactors), exactFactorProduct(expected.factors));
  assert.ok(result.statistics.conditionalResourceSupport);
  assert.equal(result.statistics.conditionalResourceSupport.candidateBands, 4,
    "the non-sync low segment and gap between the sync/high ranges are outside bands in both slots");
  assert.ok(result.statistics.conditionalResourceSupport.rowsAdded >= 4);
  assert.ok(result.statistics.conditionalResourceSupport.nonzerosAdded > 0);
});

test("conditional resource support includes main stat and weapon contribution", async () => {
  const reducedAttributeIds = [-1, 1, 5];
  const reducedStatIndexes = new Map<Stat, number>([
    ["MDMG", 0],
    ["INT", 1],
    ["SPS", 2],
  ]);
  const highItemLevel = { ...equipment(9651, 150, { 1: 1_000, 5: 100 }), itemLevel: 795 };
  const lowerItemLevel = { ...equipment(9652, 190, { 1: 950, 5: 100 }), itemLevel: 755 };
  const fixed = { ...equipment(9653, 0, { 1: 600, 5: 80 }), itemLevel: 795 };
  const candidateSlots = [[highItemLevel, lowerItemLevel], [fixed]];
  const reducedIndexes = new Map(reducedStatIndexes);
  const evaluateReduced = createIntegerDamageFactorEvaluator("RDM", 100, reducedIndexes);
  const attributesForReduced = (selection: readonly EquipInfo[]) => {
    const attributes = new Array<number>(reducedAttributeIds.length).fill(0);
    for (const [slotIndex, candidate] of selection.entries()) {
      for (const param of candidate.baseParams) {
        const index = reducedAttributeIds.indexOf(param.baseParamId);
        if (index >= 0) attributes[index] += param.value;
      }
      if (slotIndex === 0 && !candidate.baseParams.some((param) => param.baseParamId === -1)) {
        attributes[0] += candidate.MDMG;
      }
    }
    return attributes;
  };
  const productFor = (selection: readonly EquipInfo[]) => {
    const factors = evaluateReduced(attributesForReduced(selection));
    assert.ok(factors);
    return exactFactorProduct(factors);
  };
  assert.ok(productFor([lowerItemLevel, fixed]) > productFor([highItemLevel, fixed]),
    "the lower-level item trades a little main stat for enough weapon damage to win");

  const options = canonicalOptions({
    attributeIds: reducedAttributeIds,
    statIndexes: reducedStatIndexes,
    foods: [],
    slots: candidateSlots,
    candidateItemLevelRanges: [{ min: 775, max: 795 }],
    evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, reducedStatIndexes),
  });
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.equal(result.selection[0]!.itemId, lowerItemLevel.itemId);
  assert.equal(result.statistics.conditionalResourceSupport?.rowsAdded, 1,
    "main stat and weapon contribution alone must activate a prior-window resource row");

  const withoutConditionalSupport = await findBestLoadoutExactMip({
    ...options,
    candidateResourceSupportProfile: "disabled",
  });
  assert.ok(withoutConditionalSupport);
  assert.equal(withoutConditionalSupport.selection[0]!.itemId, lowerItemLevel.itemId);
  assert.equal(productFor(result.selection), productFor(withoutConditionalSupport.selection));
});

test("conditional resource support remains conservative for BLU main-stat weapon damage", async () => {
  const jobLevel = 80 as JobLevel;
  const highItemLevel = {
    ...equipment(9661, 160, { 1: 800, 2: 200, 3: 300, 4: 100, 5: 100, 6: 100 }),
    itemLevel: 795,
  };
  const lowerItemLevel = {
    ...equipment(9662, 170, { 1: 760, 2: 200, 3: 300, 4: 100, 5: 100, 6: 100 }),
    itemLevel: 755,
  };
  const fixed = {
    ...equipment(9663, 0, { 1: 500, 2: 200, 3: 300, 4: 100, 5: 100, 6: 100 }),
    itemLevel: 795,
  };
  const bluFactors = createIntegerDamageFactorEvaluator("BLU", jobLevel, statIndexes);
  const bluProduct = (selection: readonly EquipInfo[]) => {
    const attributes = new Array<number>(attributeIds.length).fill(0);
    for (const candidate of selection) {
      for (const param of equipmentAttributeExtractor(candidate)) {
        const index = attributeIds.indexOf(param.baseParamId);
        if (index >= 0) attributes[index] += param.value;
      }
    }
    const factors = bluFactors(attributes);
    assert.ok(factors);
    return {
      product: exactFactorProduct(factors),
      gcd: factors.gcdCentiseconds,
    };
  };
  const highScore = bluProduct([highItemLevel, fixed]);
  const lowerScore = bluProduct([lowerItemLevel, fixed]);
  assert.ok(lowerScore.product * BigInt(highScore.gcd) >
    highScore.product * BigInt(lowerScore.gcd));

  const options = canonicalOptions({
    job: "BLU" as Job,
    jobLevel,
    slots: [[highItemLevel, lowerItemLevel], [fixed]],
    foods: [],
    evaluationFunction: createDamageGcdVectorEvaluator("BLU", jobLevel, statIndexes),
    candidateItemLevelRanges: [{ min: 775, max: 795 }],
    objective: "dps",
  });
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.equal(result.selection[0]!.itemId, lowerItemLevel.itemId);
  assert.equal(result.statistics.conditionalResourceSupport?.rowsAdded, 1);

  const withoutConditionalSupport = await findBestLoadoutExactMip({
    ...options,
    candidateResourceSupportProfile: "disabled",
  });
  assert.ok(withoutConditionalSupport);
  assert.equal(withoutConditionalSupport.selection[0]!.itemId, lowerItemLevel.itemId);
  const supportedScore = bluProduct(result.selection);
  const unsupportedScore = bluProduct(withoutConditionalSupport.selection);
  assert.equal(supportedScore.product, unsupportedScore.product);
  assert.equal(supportedScore.gcd, unsupportedScore.gcd);
});

test("candidate-level conditional resource supports fail closed for ring-pair slots", async () => {
  const weapon = equipment(9701, 180, { 1: 700, 2: 500, 3: 330, 4: 210, 5: 140, 6: 120 });
  const ring = equipment(9702, 0, { 1: 600, 2: 400, 3: 250, 4: 150, 5: 100, 6: 80 });
  const preferredPair = {
    ...ring,
    itemId: 9703,
    itemLevel: 795,
    ringEquips: [
      { ...ring, itemId: 9704, itemLevel: 795 },
      { ...ring, itemId: 9705, itemLevel: 775 },
    ] as const,
  } as EquipInfo;
  const outsidePair = {
    ...ring,
    itemId: 9706,
    itemLevel: 795,
    ringEquips: [
      { ...ring, itemId: 9707, itemLevel: 715 },
      { ...ring, itemId: 9708, itemLevel: 795 },
    ] as const,
  } as EquipInfo;
  const options = canonicalOptions({
    slots: [[weapon], [preferredPair, outsidePair]],
    foods: [],
    candidateItemLevelRanges: [{ min: 775, max: 795 }],
  });
  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.equal(result.statistics.conditionalResourceSupport?.rowsAdded, 0);
  assert.equal(result.statistics.conditionalResourceSupport?.candidateBands, 0);
  assert.equal(result.statistics.conditionalResourceSupport?.skipReason, "ring-pair-candidates");
});

test("resource supports keep a lower-item-level winner when its stat tradeoff is better", async () => {
  const highLevel = equipment(9801, 180, { 1: 700, 2: 300, 3: 300, 4: 300, 5: 100, 6: 0 });
  const lowerLevel = {
    ...equipment(9802, 180, { 1: 700, 2: 10, 3: 720, 4: 160, 5: 100, 6: 0 }),
    itemLevel: 755,
  };
  const fixed = equipment(9811, 0, { 1: 680, 2: 300, 3: 300, 4: 300, 5: 250, 6: 0 });
  const candidateSlots = [[highLevel, lowerLevel], [fixed]];
  const maximums = attributeIds.map((id) => candidateSlots.reduce((total, slot) =>
    total + Math.max(...slot.map((candidate) => id === -1
      ? candidate.MDMG
      : candidate.baseParams.find((param) => param.baseParamId === id)?.value ?? 0)), 0));
  const options = canonicalOptions({
    slots: candidateSlots,
    foods: [],
    candidateItemLevelRanges: [{ min: 775, max: 795 }],
    evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, statIndexes, maximums),
  });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);
  assert.equal(expected.selection[0]!.itemId, lowerLevel.itemId,
    "the lower-level candidate's CRT/DET/DHT tradeoff is better despite a smaller combined resource total");

  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.equal(result.selection[0]!.itemId, lowerLevel.itemId,
    "the prior window may strengthen the proof but must not remove its outside-window winner");
  const actualFactors = evaluateFactors(canonicalAttributes(result.selection, result.food));
  assert.ok(actualFactors);
  assert.equal(exactFactorProduct(actualFactors), exactFactorProduct(expected.factors));
  assert.equal(result.statistics.conditionalResourceSupport?.rowsAdded, 1);

  const baselineOnly = await findBestLoadoutExactMip({
    ...options,
    candidateResourceSupportProfile: "disabled",
  });
  assert.ok(baselineOnly);
  const baselineFactors = evaluateFactors(canonicalAttributes(baselineOnly.selection, baselineOnly.food));
  assert.ok(baselineFactors);
  assert.equal(exactFactorProduct(baselineFactors), exactFactorProduct(expected.factors),
    "deferring optional cuts for solo baselines must retain the same exact optimum");
  assert.equal(baselineOnly.selection[0]!.itemId, lowerLevel.itemId);
  assert.equal(baselineOnly.statistics.conditionalResourceSupport?.rowsAdded, 0);
  assert.equal(baselineOnly.statistics.conditionalResourceSupport?.skipReason, "disabled-by-policy");
});

test("resource supports cap sampled thresholds and preserve an outside-window optimum", async () => {
  const candidates = Array.from({ length: 15 }, (_, index) => ({
    ...equipment(9820 + index, 180, {
      1: 700,
      2: 20 + index * 10,
      3: 500,
      4: 100,
      5: 100,
      6: 0,
    }),
    itemLevel: 715,
  }));
  const fixed = equipment(9840, 0, { 1: 680, 2: 300, 3: 200, 4: 200, 5: 250, 6: 0 });
  const candidateSlots = [candidates, [fixed]];
  const maximums = attributeIds.map((id) => candidateSlots.reduce((total, slot) =>
    total + Math.max(...slot.map((candidate) => id === -1
      ? candidate.MDMG
      : candidate.baseParams.find((param) => param.baseParamId === id)?.value ?? 0)), 0));
  const options = canonicalOptions({
    slots: candidateSlots,
    foods: [],
    candidateItemLevelRanges: [{ min: 775, max: 795 }],
    evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, statIndexes, maximums),
  });
  const expected = exhaustiveCanonical(options);
  assert.ok(expected);
  assert.equal(expected.selection[0]!.itemLevel, 715);

  const result = await findBestLoadoutExactMip(options);
  assert.ok(result);
  assert.equal(result.selection[0]!.itemLevel, 715);
  const actualFactors = evaluateFactors(canonicalAttributes(result.selection, result.food));
  assert.ok(actualFactors);
  assert.equal(exactFactorProduct(actualFactors), exactFactorProduct(expected.factors));
  assert.equal(result.statistics.conditionalResourceSupport?.candidateBands, 1);
  assert.equal(result.statistics.conditionalResourceSupport?.rowsAdded, 12,
    "at most twelve of the fourteen distinct lower resource thresholds may be emitted");
  assert.ok(result.statistics.conditionalResourceSupport?.nonzerosAdded > 0);

  const compact = await findBestLoadoutExactMip({
    ...options,
    candidateResourceSupportProfile: "compact",
  });
  assert.ok(compact);
  const compactFactors = evaluateFactors(canonicalAttributes(compact.selection, compact.food));
  assert.ok(compactFactors);
  assert.equal(exactFactorProduct(compactFactors), exactFactorProduct(expected.factors));
  assert.equal(compact.statistics.conditionalResourceSupport?.rowsAdded, 1,
    "the compact profile adds at most one exact resource threshold for this slot");

});
