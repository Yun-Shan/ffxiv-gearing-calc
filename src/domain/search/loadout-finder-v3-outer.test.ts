import assert from "node:assert/strict";
import { test } from "vitest";
import type { Job, JobLevel } from "./equipped-effects.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import { findBestJointLoadoutV3 } from "./loadout-finder-v3.ts";
import type { JointLoadoutJobV3 } from "./loadout-finder-v3.ts";
import type { Stat } from "../types.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

const attributeIds = [-2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const attributeIndex = new Map(attributeIds.map((id, index) => [id, index]));
const statIndexesByJob: Record<"RDM" | "SAM", ReadonlyMap<Stat, number>> = {
  RDM: new Map<Stat, number>([
    ["MDMG", 1],
    ["INT", 2],
    ["CRT", 3],
    ["DET", 4],
    ["DHT", 5],
    ["SPS", 6],
    ["TEN", 7],
  ]),
  SAM: new Map<Stat, number>([
    ["PDMG", 0],
    ["STR", 8],
    ["CRT", 3],
    ["DET", 4],
    ["DHT", 5],
    ["SKS", 9],
    ["TEN", 7],
  ]),
};

type JobCode = "RDM" | "SAM";
type SlotName = "ring" | "head";
type FixtureJob = JointLoadoutJobV3 & { slotNames: readonly SlotName[] };

function equipment(
  itemId: number,
  attributes: Record<number, number>,
): EquipInfo {
  const baseParams: ParamInfo[] = Object.entries(attributes)
    .map(([baseParamId, value]) => ({ baseParamId: Number(baseParamId), value }))
    .sort((left, right) => left.baseParamId - right.baseParamId);
  return {
    itemId,
    itemLevel: 795,
    key: baseParams.map(({ baseParamId, value }) => `${baseParamId}:${value}`).join("-"),
    baseParams,
    PDMG: 0,
    MDMG: 0,
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
  rings: readonly EquipInfo[],
  heads: readonly EquipInfo[],
  foods: readonly FoodInfo[],
  options: { inactive?: boolean; toughMin?: number } = {},
): FixtureJob {
  const evaluation = createDamageGcdVectorEvaluator(
    job as Job,
    100 as JobLevel,
    statIndexesByJob[job],
  );
  return {
    id: job,
    slotNames: ["ring", "head"],
    options: {
      clanIndex: 0,
      objective: "dps",
      job: job as Job,
      jobLevel: 100 as JobLevel,
      attributeIds,
      statIndexes: statIndexesByJob[job],
      slots: [rings, heads],
      foods,
      ...(options.toughMin === undefined
        ? {}
        : { constraints: { toughMin: options.toughMin } }),
      toughnessAttributeId: 6,
      equipmentAttributeExtractor: equipmentAttributes,
      evaluationFunction: options.inactive
        ? (attributes) => {
            const result = evaluation(attributes);
            return result === undefined
              ? undefined
              : { damage: 0, gcd: result.gcd };
          }
        : evaluation,
      maxSearchMs: 30_000,
    },
  };
}

function cartesian<T>(sets: readonly (readonly T[])[]): T[][] {
  return sets.reduce<T[][]>(
    (prefixes, set) => prefixes.flatMap((prefix) => set.map((value) => [...prefix, value])),
    [[]],
  );
}

function attributesFor(
  selection: readonly EquipInfo[],
  selectedFood: FoodInfo | undefined,
): number[] {
  const attributes = new Array<number>(attributeIds.length).fill(0);
  for (const item of selection) {
    for (const param of equipmentAttributes(item)) {
      attributes[attributeIndex.get(param.baseParamId)!] += param.value;
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

function equipmentIdentity(item: EquipInfo): string {
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

function foodIdentity(item: FoodInfo | undefined): string {
  if (item === undefined) return "no-food";
  if (item.physicalKey !== undefined) return item.physicalKey;
  return JSON.stringify({
    itemId: item.itemId,
    itemLevel: item.itemLevel,
    baseParams: item.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [baseParamId, multiplier, maxValue])
      .sort(([leftId], [rightId]) => leftId - rightId),
  });
}

function exhaustiveOracle(
  active: FixtureJob,
  constrainedInactive: FixtureJob,
): {
  baselineProduct: bigint;
  bestProduct: bigint;
  common: Record<SlotName, EquipInfo>;
  food: FoodInfo;
} {
  const factorEvaluator = createIntegerDamageFactorEvaluator(
    active.options.job,
    active.options.jobLevel,
    active.options.statIndexes,
  );
  const productsFor = (job: FixtureJob) =>
    cartesian(job.options.slots).flatMap((selection) =>
      job.options.foods.map((selectedFood) => {
        const factors = factorEvaluator(attributesFor(selection, selectedFood));
        assert.ok(factors);
        return { selection, food: selectedFood, product: exactProduct(factors) };
      }),
    );
  const baselineProduct = productsFor(active).reduce(
    (best, candidate) => candidate.product > best ? candidate.product : best,
    0n,
  );
  const sharedChoices = active.options.slots.map((slot, slotIndex) => {
    const identities = new Set(
      constrainedInactive.options.slots[slotIndex]!.map(equipmentIdentity),
    );
    return slot.filter((item) => identities.has(equipmentIdentity(item)));
  });
  const inactiveFoodIdentities = new Set(constrainedInactive.options.foods.map(foodIdentity));
  const sharedFoods = active.options.foods.filter((item) => inactiveFoodIdentities.has(foodIdentity(item)));
  const toughMin = constrainedInactive.options.constraints?.toughMin ?? 0;
  let bestProduct = -1n;
  let best: { selection: EquipInfo[]; food: FoodInfo } | undefined;
  for (const selection of cartesian(sharedChoices)) {
    const inactiveTenacity = attributesFor(selection, undefined)[attributeIndex.get(6)!];
    if (inactiveTenacity < toughMin) continue;
    for (const selectedFood of sharedFoods) {
      const factors = factorEvaluator(attributesFor(selection, selectedFood));
      assert.ok(factors);
      const product = exactProduct(factors);
      if (product > bestProduct) {
        bestProduct = product;
        best = { selection, food: selectedFood };
      }
    }
  }
  assert.ok(best);
  return {
    baselineProduct,
    bestProduct,
    common: { ring: best.selection[0]!, head: best.selection[1]! },
    food: best.food,
  };
}

test("V3 proves a two-slot shared-food conflict with an inactive constrained job", async () => {
  const ringInt = equipment(8101, { 1: 160, 2: 30, 6: 0 });
  const ringStr = equipment(8102, { 1: 50, 2: 30, 7: 160, 6: 50 });
  const headInt = equipment(8111, { 1: 120, 3: 20, 6: 0 });
  const headStr = equipment(8112, { 1: 30, 3: 20, 7: 120, 6: 50 });
  const intFood = food(8201, 1);
  const strFood = food(8202, 7);
  const active = makeJob("RDM", [ringInt, ringStr], [headInt, headStr], [intFood, strFood]);
  const inactive = makeJob(
    "SAM",
    [ringStr, ringInt],
    [headStr, headInt],
    [strFood, intFood],
    { inactive: true, toughMin: 80 },
  );
  const expected = exhaustiveOracle(active, inactive);

  const result = await findBestJointLoadoutV3({
    jobs: [active, inactive],
    commonSlots: ["ring", "head"],
    foodStrategy: "shared",
    objective: "damage",
  });

  assert.ok(result);
  assert.equal(result.proof.complete, true);
  assert.equal(result.proof.objective, "damage");
  assert.equal(
    BigInt(result.value.numerator) * expected.baselineProduct,
    expected.bestProduct * BigInt(result.value.denominator),
    "joint normalized value must match exhaustive shared-gear and shared-food enumeration",
  );
  assert.ok(result.statistics.outerNodes >= 2, "the conflicting relaxed gear must recurse in the outer search");
  assert.ok(result.statistics.completeNodes >= 1);
  assert.equal(result.jobResults.SAM!.damage, 0, "the constrained SAM fixture must be inactive in the joint objective");

  for (const slot of ["ring", "head"] as const) {
    const expectedIdentity = equipmentIdentity(expected.common[slot]);
    assert.equal(equipmentIdentity(result.commonEquipments[slot]!), expectedIdentity);
    for (const job of [active, inactive]) {
      const index = job.slotNames.indexOf(slot);
      assert.notEqual(index, -1);
      assert.equal(
        equipmentIdentity(result.jobResults[job.id]!.selection[index]!),
        expectedIdentity,
        `${job.id} must use the same full physical identity for ${slot}`,
      );
    }
    assert.notEqual(
      equipmentIdentity(result.optima.RDM!.selection[active.slotNames.indexOf(slot)]!),
      equipmentIdentity(result.optima.SAM!.selection[inactive.slotNames.indexOf(slot)]!),
      `independent baselines must conflict on ${slot}`,
    );
  }

  assert.equal(foodIdentity(result.jobResults.RDM!.food), foodIdentity(expected.food));
  assert.equal(foodIdentity(result.jobResults.SAM!.food), foodIdentity(expected.food));
  assert.notEqual(
    foodIdentity(result.optima.RDM!.food),
    foodIdentity(result.optima.SAM!.food),
    "the solo baselines should request different physical foods",
  );
});
