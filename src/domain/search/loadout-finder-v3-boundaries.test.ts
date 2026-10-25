import assert from "node:assert/strict";
import { test } from "vitest";
import type { Job, JobLevel } from "./equipped-effects.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedToughnessForMitigationPercent,
  equippedSpeedRangeForGcd,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import { findBestJointLoadoutV3 } from "./loadout-finder-v3.ts";
import type { JointLoadoutJobV3 } from "./loadout-finder-v3.ts";
import type { Stat } from "../types.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

const attributeIds = [-2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const attributeIndex = new Map(attributeIds.map((id, index) => [id, index]));
const statIndexes: Record<"RDM" | "SAM" | "PLD" | "WHM", ReadonlyMap<Stat, number>> = {
  RDM: new Map<Stat, number>([
    ["MDMG", 1], ["INT", 2], ["CRT", 3], ["DET", 4], ["DHT", 5], ["SPS", 6], ["TEN", 7],
  ]),
  SAM: new Map<Stat, number>([
    ["PDMG", 0], ["STR", 8], ["CRT", 3], ["DET", 4], ["DHT", 5], ["SKS", 9], ["TEN", 7],
  ]),
  PLD: new Map<Stat, number>([
    ["PDMG", 0], ["STR", 8], ["CRT", 3], ["DET", 4], ["DHT", 5], ["SKS", 9], ["TEN", 7],
  ]),
  WHM: new Map<Stat, number>([
    ["MDMG", 1], ["MND", 10], ["CRT", 3], ["DET", 4], ["DHT", 5], ["SPS", 6], ["TEN", 7],
  ]),
};

type JobCode = keyof typeof statIndexes;
type FixtureOptions = {
  inactive?: boolean;
  constraints?: JointLoadoutJobV3["options"]["constraints"];
  toughnessPercentToMinimum?: (percentage: number) => number;
};

function equipment(
  itemId: number,
  attributes: Record<number, number>,
  weapon: { PDMG?: number; MDMG?: number } = {},
): EquipInfo {
  const baseParams: ParamInfo[] = Object.entries(attributes)
    .map(([baseParamId, value]) => ({ baseParamId: Number(baseParamId), value }))
    .sort((left, right) => left.baseParamId - right.baseParamId);
  return {
    itemId,
    itemLevel: 795,
    key: baseParams.map(({ baseParamId, value }) => `${baseParamId}:${value}`).join("-"),
    baseParams,
    PDMG: weapon.PDMG ?? 0,
    MDMG: weapon.MDMG ?? 0,
    DLY: 0,
  };
}

function food(itemId: number, baseParamId: number): FoodInfo {
  return {
    itemId,
    itemLevel: 795,
    key: `${baseParamId}:1.2:35`,
    baseParams: [{ baseParamId, multiplier: 1.2, maxValue: 35 }],
  };
}

function equipmentAttributes(item: EquipInfo): readonly ParamInfo[] {
  return [
    ...item.baseParams,
    { baseParamId: -2, value: item.PDMG },
    { baseParamId: -1, value: item.MDMG },
  ];
}

function makeJob(
  job: JobCode,
  slotNames: readonly string[],
  slots: readonly (readonly EquipInfo[])[],
  foods: readonly FoodInfo[],
  fixtureOptions: FixtureOptions = {},
): JointLoadoutJobV3 {
  const evaluate = createDamageGcdVectorEvaluator(
    job as Job,
    100 as JobLevel,
    statIndexes[job],
  );
  return {
    id: job,
    slotNames,
    options: {
      clanIndex: 0,
      objective: "dps",
      job: job as Job,
      jobLevel: 100 as JobLevel,
      attributeIds,
      statIndexes: statIndexes[job],
      slots,
      foods,
      speedAttributeId: job === "RDM" || job === "WHM" ? 5 : 8,
      gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd(job as Job, 100 as JobLevel, gcd),
      ...(fixtureOptions.constraints === undefined ? {} : { constraints: fixtureOptions.constraints }),
      ...(fixtureOptions.toughnessPercentToMinimum === undefined
        ? {}
        : { toughnessPercentToMinimum: fixtureOptions.toughnessPercentToMinimum }),
      toughnessAttributeId: 6,
      equipmentAttributeExtractor: equipmentAttributes,
      evaluationFunction: fixtureOptions.inactive
        ? (attributes) => {
            const result = evaluate(attributes);
            return result === undefined ? undefined : { damage: 0, gcd: result.gcd };
          }
        : evaluate,
      maxSearchMs: 30_000,
    },
  };
}

function attributesFor(selection: readonly EquipInfo[], selectedFood?: FoodInfo): number[] {
  const attributes = new Array<number>(attributeIds.length).fill(0);
  for (const item of selection) {
    for (const param of equipmentAttributes(item)) {
      const index = attributeIndex.get(param.baseParamId)!;
      attributes[index] = attributes[index]! + param.value;
    }
  }
  if (selectedFood !== undefined) {
    for (const param of selectedFood.baseParams) {
      const index = attributeIndex.get(param.baseParamId)!;
      attributes[index] += Math.min(
        param.maxValue,
        Math.trunc((attributes[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
      );
    }
  }
  return attributes;
}

function exactProduct(factors: IntegerDamageFactors): bigint {
  return BigInt(factors.weaponDamage) *
    BigInt(factors.mainStat) *
    BigInt(factors.determination) *
    BigInt(factors.tenacity) *
    BigInt(factors.critical) *
    BigInt(factors.directHit);
}

function physicalEquipmentIdentity(item: EquipInfo): string {
  return JSON.stringify({
    ...(item.variantKey === undefined ? {} : { variantKey: item.variantKey }),
    itemId: item.itemId,
    itemLevel: item.itemLevel,
    baseParams: [...item.baseParams]
      .sort((left, right) => left.baseParamId - right.baseParamId || left.value - right.value)
      .map(({ baseParamId, value }) => [baseParamId, value]),
    PDMG: item.PDMG,
    MDMG: item.MDMG,
    DLY: item.DLY,
  });
}

function productFor(job: JobCode, selection: readonly EquipInfo[], selectedFood?: FoodInfo): bigint {
  const evaluate = createIntegerDamageFactorEvaluator(job as Job, 100 as JobLevel, statIndexes[job]);
  const factors = evaluate(attributesFor(selection, selectedFood));
  assert.ok(factors);
  return exactProduct(factors);
}

function physicalFoodIdentity(item: FoodInfo | undefined): string {
  if (item === undefined) return "no-food";
  if (item.physicalKey !== undefined) return item.physicalKey;
  return JSON.stringify({
    itemId: item.itemId,
    itemLevel: item.itemLevel,
    baseParams: item.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [baseParamId, multiplier, maxValue] as const)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]),
  });
}

function cartesian<T>(sets: readonly (readonly T[])[]): T[][] {
  return sets.reduce<T[][]>(
    (prefixes, set) => prefixes.flatMap((prefix) => set.map((value) => [...prefix, value])),
    [[]],
  );
}

type OracleCandidate = {
  selection: EquipInfo[];
  food: FoodInfo | undefined;
  attributes: number[];
  product: bigint;
};
type Fraction = { numerator: bigint; denominator: bigint };

function gcdBigInt(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  const divisor = gcdBigInt(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function addFraction(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function compareFraction(left: Fraction, right: Fraction): number {
  const a = left.numerator * right.denominator;
  const b = right.numerator * left.denominator;
  return a < b ? -1 : a > b ? 1 : 0;
}

function satisfiesConstraints(job: JointLoadoutJobV3, candidate: OracleCandidate): boolean {
  const constraints = job.options.constraints ?? {};
  const speedIndex = job.options.attributeIds.indexOf(job.options.speedAttributeId ?? -999);
  const matchesGcd = (gcd: number) => {
    const range = job.options.gcdToSpeedRange?.(gcd);
    return range !== undefined && speedIndex >= 0 &&
      candidate.attributes[speedIndex]! >= range.min &&
      candidate.attributes[speedIndex]! <= range.max;
  };
  if (constraints.gcd !== undefined && !matchesGcd(constraints.gcd)) return false;
  if (constraints.gcdChoices !== undefined && !constraints.gcdChoices.some(matchesGcd)) return false;
  if (constraints.speedMin !== undefined && candidate.attributes[speedIndex]! < constraints.speedMin) return false;
  if (constraints.speedMax !== undefined && candidate.attributes[speedIndex]! > constraints.speedMax) return false;
  const toughnessIndex = job.options.attributeIds.indexOf(job.options.toughnessAttributeId ?? -999);
  const toughnessMinimum = Math.max(
    constraints.toughMin ?? 0,
    constraints.toughnessMinPercent === undefined
      ? 0
      : (job.options.toughnessPercentToMinimum?.(constraints.toughnessMinPercent) ?? Number.POSITIVE_INFINITY),
  );
  return toughnessIndex < 0 || candidate.attributes[toughnessIndex]! >= toughnessMinimum;
}

function enumerate(job: JointLoadoutJobV3): OracleCandidate[] {
  const evaluate = createIntegerDamageFactorEvaluator(job.options.job, job.options.jobLevel, job.options.statIndexes);
  const foodChoices = job.options.foods.length === 0 ? [undefined] : job.options.foods;
  return cartesian(job.options.slots).flatMap((selection) => foodChoices.flatMap((selectedFood) => {
    const attributes = attributesFor(selection, selectedFood);
    const factors = evaluate(attributes);
    if (factors === undefined) return [];
    const candidate = { selection, food: selectedFood, attributes, product: exactProduct(factors) };
    return satisfiesConstraints(job, candidate) ? [candidate] : [];
  }));
}

function exhaustiveJointValue(
  jobs: readonly JointLoadoutJobV3[],
  commonSlots: readonly string[],
  foodStrategy: "shared" | "independent",
): { value: Fraction; common: ReadonlyMap<string, EquipInfo>; food: FoodInfo | undefined } | undefined {
  const candidates = jobs.map(enumerate);
  if (candidates.some((entries) => entries.length === 0)) return undefined;
  const baselines = candidates.map((entries) => entries.reduce(
    (best, candidate) => candidate.product > best ? candidate.product : best,
    0n,
  ));
  const commonChoices = commonSlots.map((slotName) => {
    const firstJob = jobs[0]!;
    const firstIndex = firstJob.slotNames.indexOf(slotName);
    if (firstIndex < 0) throw new Error(`oracle fixture lacks common slot ${slotName}`);
    const identities = jobs.slice(1).map((job) => {
      const index = job.slotNames.indexOf(slotName);
      if (index < 0) throw new Error(`oracle fixture lacks common slot ${slotName}`);
      return new Set(job.options.slots[index]!.map(physicalEquipmentIdentity));
    });
    const seen = new Set<string>();
    return firstJob.options.slots[firstIndex]!.filter((item) => {
      const identity = physicalEquipmentIdentity(item);
      if (seen.has(identity) || identities.some((available) => !available.has(identity))) return false;
      seen.add(identity);
      return true;
    });
  });
  if (commonChoices.some((choices) => choices.length === 0)) return undefined;

  let sharedFoods: (FoodInfo | undefined)[] = [undefined];
  if (foodStrategy === "shared") {
    if (!jobs.every((job) => job.options.foods.length === 0)) {
      const seen = new Set<string>();
      sharedFoods = jobs[0]!.options.foods.filter((item) => {
        const identity = physicalFoodIdentity(item);
        if (seen.has(identity) || jobs.slice(1).some((job) =>
          !job.options.foods.some((other) => physicalFoodIdentity(other) === identity))) return false;
        seen.add(identity);
        return true;
      });
    }
    if (sharedFoods.length === 0) return undefined;
  }

  let best: { value: Fraction; common: Map<string, EquipInfo>; food: FoodInfo | undefined } | undefined;
  for (const commonTuple of cartesian(commonChoices)) {
    for (const selectedFood of sharedFoods) {
      let value = fraction(0n, 1n);
      const chosenByJob: OracleCandidate[] = [];
      let feasible = true;
      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
        const job = jobs[jobIndex]!;
        const allowed = candidates[jobIndex]!.filter((candidate) =>
          commonSlots.every((slotName, slotIndex) => {
            const candidateIndex = job.slotNames.indexOf(slotName);
            return candidateIndex >= 0 &&
              physicalEquipmentIdentity(candidate.selection[candidateIndex]!) ===
                physicalEquipmentIdentity(commonTuple[slotIndex]!);
          }) && (foodStrategy !== "shared" ||
            physicalFoodIdentity(candidate.food) === physicalFoodIdentity(selectedFood)),
        );
        const chosen = allowed.reduce<OracleCandidate | undefined>(
          (current, candidate) => current === undefined || candidate.product > current.product ? candidate : current,
          undefined,
        );
        if (chosen === undefined) {
          feasible = false;
          break;
        }
        chosenByJob.push(chosen);
        value = addFraction(value, fraction(chosen.product, baselines[jobIndex]!));
      }
      if (feasible && (best === undefined || compareFraction(value, best.value) > 0)) {
        best = {
          value,
          common: new Map(commonSlots.map((name, index) => [name, commonTuple[index]!])),
          food: selectedFood,
        };
      }
    }
  }
  return best;
}

function assertJointValueMatches(
  actual: Awaited<ReturnType<typeof findBestJointLoadoutV3>>,
  expected: ReturnType<typeof exhaustiveJointValue>,
): asserts actual is NonNullable<typeof actual> {
  assert.ok(expected, "the exhaustive fixture should have a feasible shared result");
  assert.ok(actual);
  assert.equal(
    BigInt(actual.value.numerator) * expected.value.denominator,
    expected.value.numerator * BigInt(actual.value.denominator),
    "the V3 result must equal the exact BigInt exhaustive normalized objective",
  );
}

test("shared food requires a physical intersection when one job has no food choices", async () => {
  const rdmRing = equipment(9101, { 1: 120, 2: 20 });
  const samRing = equipment(9102, { 7: 120, 3: 20 });
  const samFood = food(9202, 7);
  const jobs = [
    makeJob("RDM", ["ring"], [[rdmRing]], []),
    makeJob("SAM", ["ring"], [[samRing]], [samFood]),
  ];

  const shared = await findBestJointLoadoutV3({ objective: "damage", jobs, commonSlots: [], foodStrategy: "shared" });
  assert.equal(shared, undefined, "shared food must fail when the physical food intersection is empty");

  const independent = await findBestJointLoadoutV3({ objective: "damage", jobs, commonSlots: [], foodStrategy: "independent" });
  assert.ok(independent);
  assert.equal(independent.proof.complete, true);
  assert.equal(independent.jobResults.RDM!.food, undefined);
  assert.equal(independent.jobResults.SAM!.food?.itemId, samFood.itemId);
});

test("a one-entry V3 cache preserves the exhaustive result during conflict recursion", async () => {
  const strengthRing = equipment(9301, { 1: 160, 2: 35, 6: 0 });
  const tenacityRing = equipment(9302, { 1: 80, 2: 25, 7: 60, 6: 50 });
  const active = makeJob("RDM", ["ring"], [[strengthRing, tenacityRing]], []);
  const inactive = makeJob(
    "SAM",
    ["ring"],
    [[tenacityRing, strengthRing]],
    [],
    { inactive: true, constraints: { toughMin: 50 } },
  );
  const baselineProduct = [strengthRing, tenacityRing]
    .map((item) => productFor("RDM", [item]))
    .reduce((best, value) => value > best ? value : best);
  const expectedProduct = productFor("RDM", [tenacityRing]);

  const result = await findBestJointLoadoutV3({
    objective: "damage",
    jobs: [active, inactive],
    commonSlots: ["ring"],
    foodStrategy: "independent",
    cacheLimit: 1,
  });

  assert.ok(result);
  assert.equal(
    BigInt(result.value.numerator) * baselineProduct,
    expectedProduct * BigInt(result.value.denominator),
    "the exact normalized result must match enumeration of the only feasible shared ring",
  );
  assert.equal(result.statistics.cacheLimit, 1);
  assert.equal(result.statistics.cacheEntries, 1);
  assert.ok(result.statistics.outerNodes >= 2);
  assert.equal(physicalEquipmentIdentity(result.commonEquipments.ring!), physicalEquipmentIdentity(tenacityRing));
  for (const job of [active, inactive]) {
    assert.equal(
      physicalEquipmentIdentity(result.jobResults[job.id]!.selection[0]!),
      physicalEquipmentIdentity(tenacityRing),
    );
  }
});

test("V3 applies the public toughness percentage threshold and caps the search budget", async () => {
  const toughnessMinimum = equippedToughnessForMitigationPercent("PLD" as Job, 100 as JobLevel, 5);
  const candidates = [
    equipment(9401, { 7: 260, 2: 35, 6: toughnessMinimum - 1 }),
    equipment(9402, { 7: 240, 2: 30, 6: toughnessMinimum }),
    equipment(9403, { 7: 220, 2: 45, 6: toughnessMinimum + 100 }),
  ];
  const eligible = candidates.filter(
    (item) => (item.baseParams.find((param) => param.baseParamId === 6)?.value ?? 0) >= toughnessMinimum,
  );
  const expected = eligible
    .map((item) => ({ item, product: productFor("PLD", [item]) }))
    .reduce((best, candidate) => candidate.product > best.product ? candidate : best);
  const job = makeJob(
    "PLD",
    ["ring"],
    [candidates],
    [],
    {
      constraints: { toughnessMinPercent: 5 },
      toughnessPercentToMinimum: (percentage) =>
        equippedToughnessForMitigationPercent("PLD" as Job, 100 as JobLevel, percentage),
    },
  );

  const result = await findBestJointLoadoutV3({
    objective: "damage",
    jobs: [job],
    commonSlots: [],
    foodStrategy: "independent",
    maxSearchMs: 240_000,
  });

  assert.ok(result);
  assert.equal(physicalEquipmentIdentity(result.optima.PLD!.selection[0]!), physicalEquipmentIdentity(expected.item));
  assert.equal(result.value.numerator, result.value.denominator, "the constrained solo optimum is its own V3 baseline");
  assert.equal(result.statistics.timeLimitMs, 235_000, "the public budget must be capped at V3's documented ceiling");
});

test("effect-equivalent physical foods retain the baseline-preferred shared identity", async () => {
  const sharedRing = equipment(9501, { 1: 100, 7: 100, 2: 25, 3: 20, 4: 15 });
  const firstFood = food(9511, 2);
  const secondFood = food(9512, 2);
  const jobs = [
    makeJob("RDM", ["ring"], [[sharedRing]], [firstFood, secondFood]),
    makeJob("SAM", ["ring"], [[sharedRing]], [secondFood, firstFood]),
  ];
  assert.deepEqual(
    firstFood.baseParams,
    secondFood.baseParams,
    "the physical foods differ by identity while their effects are identical",
  );
  const expected = exhaustiveJointValue(jobs, ["ring"], "shared");

  const result = await findBestJointLoadoutV3({
    objective: "damage",
    jobs,
    commonSlots: ["ring"],
    foodStrategy: "shared",
  });

  assertJointValueMatches(result, expected);
  assert.notEqual(result.optima.RDM!.food?.itemId, result.optima.SAM!.food?.itemId);
  const firstBaselineCount = Number(result.optima.RDM!.food?.itemId === firstFood.itemId) +
    Number(result.optima.SAM!.food?.itemId === firstFood.itemId);
  const secondBaselineCount = Number(result.optima.RDM!.food?.itemId === secondFood.itemId) +
    Number(result.optima.SAM!.food?.itemId === secondFood.itemId);
  const preferredIdentity = physicalFoodIdentity(
    firstBaselineCount >= secondBaselineCount ? firstFood : secondFood,
  );
  for (const job of jobs) {
    assert.equal(physicalFoodIdentity(result.jobResults[job.id]!.food), preferredIdentity);
    assert.equal(
      physicalEquipmentIdentity(result.jobResults[job.id]!.selection[0]!),
      physicalEquipmentIdentity(sharedRing),
    );
  }
  assert.equal(
    physicalEquipmentIdentity(result.commonEquipments.ring!),
    physicalEquipmentIdentity(sharedRing),
  );
});

test("equal shared equipment metrics keep the identity preferred by the solo baselines", async () => {
  const firstVariant = equipment(9601, { 1: 110, 9: 110, 2: 30, 3: 22, 4: 16 });
  const secondVariant = equipment(9602, { 1: 110, 9: 110, 2: 30, 3: 22, 4: 16 });
  const jobs = [
    makeJob("RDM", ["ring"], [[firstVariant, secondVariant]], []),
    makeJob("WHM", ["ring"], [[secondVariant, firstVariant]], []),
  ];
  assert.deepEqual(firstVariant.baseParams, secondVariant.baseParams);
  assert.notEqual(physicalEquipmentIdentity(firstVariant), physicalEquipmentIdentity(secondVariant));
  const expected = exhaustiveJointValue(jobs, ["ring"], "shared");

  const result = await findBestJointLoadoutV3({
    objective: "damage",
    jobs,
    commonSlots: ["ring"],
    foodStrategy: "shared",
  });

  assertJointValueMatches(result, expected);
  const firstBaselineCount = Number(
    physicalEquipmentIdentity(result.optima.RDM!.selection[0]!) === physicalEquipmentIdentity(firstVariant),
  ) + Number(
    physicalEquipmentIdentity(result.optima.WHM!.selection[0]!) === physicalEquipmentIdentity(firstVariant),
  );
  const secondBaselineCount = 2 - firstBaselineCount;
  assert.notEqual(
    physicalEquipmentIdentity(result.optima.RDM!.selection[0]!),
    physicalEquipmentIdentity(result.optima.WHM!.selection[0]!),
    "reversed candidate order should give the equivalent physical variants opposite solo baselines",
  );
  const expectedSharedIdentity = physicalEquipmentIdentity(
    firstBaselineCount >= secondBaselineCount ? firstVariant : secondVariant,
  );
  assert.equal(physicalEquipmentIdentity(result.commonEquipments.ring!), expectedSharedIdentity);
  for (const job of jobs) {
    assert.equal(
      physicalEquipmentIdentity(result.jobResults[job.id]!.selection[0]!),
      expectedSharedIdentity,
    );
  }
});

test("GCD and speedMax constraints preserve a lower-speed shared candidate during pruning", async () => {
  const rdmRange = equippedSpeedRangeForGcd("RDM" as Job, 100 as JobLevel, 2.48);
  const whmRange = equippedSpeedRangeForGcd("WHM" as Job, 100 as JobLevel, 2.48);
  assert.ok(rdmRange && whmRange);
  const slowSpeed = Math.max(rdmRange.min, whmRange.min);
  const lastValidSpeed = Math.min(rdmRange.max, whmRange.max);
  assert.ok(slowSpeed <= lastValidSpeed, "RDM and WHM should share a valid exact GCD speed range");
  const slow = equipment(9701, {
    1: 80, 9: 80, 2: 24, 3: 18, 4: 12, 5: slowSpeed,
  }, { MDMG: 160 });
  const fast = equipment(9702, {
    1: 120, 9: 120, 2: 32, 3: 24, 4: 18, 5: lastValidSpeed + 1,
  }, { MDMG: 160 });
  const speedIndex = attributeIndex.get(5)!;
  const slowAttributes = attributesFor([slow]);
  const fastAttributes = attributesFor([fast]);
  assert.ok(fastAttributes[speedIndex]! > slowAttributes[speedIndex]!);
  assert.ok(fastAttributes.some((value, index) => index !== speedIndex && value > slowAttributes[index]!));
  assert.ok(fastAttributes.every((value, index) => index === speedIndex || value >= slowAttributes[index]!));

  for (const constraints of [{ gcd: 2.48 }, { speedMax: slowSpeed }] as const) {
    const jobs = [
      makeJob("RDM", ["ring"], [[fast, slow]], [], { constraints }),
      makeJob("WHM", ["ring"], [[slow, fast]], [], { constraints }),
    ];
    const expected = exhaustiveJointValue(jobs, ["ring"], "shared");
    const result = await findBestJointLoadoutV3({
      objective: "damage",
      jobs,
      commonSlots: ["ring"],
      foodStrategy: "shared",
    });

    assertJointValueMatches(result, expected);
    assert.equal(physicalEquipmentIdentity(result.commonEquipments.ring!), physicalEquipmentIdentity(slow));
    for (const job of jobs) {
      const selected: EquipInfo = result.jobResults[job.id]!.selection[0]!;
      assert.equal(physicalEquipmentIdentity(selected), physicalEquipmentIdentity(slow));
      const evaluated = job.options.evaluationFunction(attributesFor([selected]));
      assert.ok(evaluated);
      assert.equal(Math.round(evaluated.gcd * 100) / 100, 2.48);
    }
  }
});
