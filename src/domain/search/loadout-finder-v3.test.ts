import assert from "node:assert/strict";
import { test } from "vitest";
import type { Job, JobLevel } from "./equipped-effects.ts";
import type { Stat } from "../types.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import { findBestJointLoadoutV3 } from "./loadout-finder-v3.ts";
import type { JointLoadoutV3Result } from "./loadout-finder-v3.ts";
import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
import { createParallelBaselineExecutor } from "./parallel-baseline-executor.ts";
import type {
  ExactMipOptions,
  ExactMipResult,
} from "./loadout-finder-exact-mip.ts";
import type {
  EquipInfo,
  FoodInfo,
  ParamInfo,
  SharedSlotProjection,
} from "./types.ts";

// These IDs are test-vector coordinates only. The fixtures below are synthetic
// objects used to compare V3 against exhaustive enumeration.
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

type JobCode = "RDM" | "SAM" | "WHM" | "RPR" | "VPR" | "MCH" | "PCT";
type SlotName = "weapon" | "ring" | "ring2" | "head";
type JobInput = {
  id: JobCode;
  slotNames: readonly SlotName[];
  options: ExactMipOptions;
};
type Candidate = {
  selection: EquipInfo[];
  food: FoodInfo | undefined;
  attributes: number[];
  factors: IntegerDamageFactors;
  product: bigint;
  gcdCentiseconds: number;
  damage: number;
  gcd: number;
};
type OracleResult = {
  numerator: bigint;
  denominator: bigint;
  approximate: number;
  commonIdentity: Record<string, string>;
  chosen: Record<string, Candidate>;
  optima: Record<string, Candidate>;
  maximumToughness: Record<string, number | undefined>;
};

function equipment(
  itemId: number,
  attributes: Record<number, number>,
  weapon: { PDMG?: number; MDMG?: number } = {},
): EquipInfo {
  const baseParams: ParamInfo[] = Object.entries(attributes)
    .map(([baseParamId, value]) => ({
      baseParamId: Number(baseParamId),
      value,
    }))
    .sort((a, b) => a.baseParamId - b.baseParamId);
  return {
    itemId,
    itemLevel: 795,
    key: baseParams
      .map(({ baseParamId, value }) => `${baseParamId}:${value}`)
      .join("-"),
    baseParams,
    PDMG: weapon.PDMG ?? 0,
    MDMG: weapon.MDMG ?? 0,
    DLY: 0,
  };
}

function food(itemId: number, attributes: readonly number[]): FoodInfo {
  return {
    itemId,
    itemLevel: 795,
    key: attributes.join("-"),
    baseParams: attributes.map((baseParamId) => ({
      baseParamId,
      multiplier: 1.1,
      maxValue: 35,
    })),
  };
}

function equipmentAttributeExtractor(equip: EquipInfo): readonly ParamInfo[] {
  return [
    ...equip.baseParams,
    { baseParamId: -2, value: equip.PDMG },
    { baseParamId: -1, value: equip.MDMG },
  ];
}

function jobStatIndexes(job: JobCode): ReadonlyMap<Stat, number> {
  const mainStat: Stat =
    job === "RDM"
      ? "INT"
      : job === "WHM"
        ? "MND"
        : job === "VPR" || job === "MCH"
          ? "DEX"
          : job === "PCT"
            ? "INT"
            : "STR";
  const speedStat: Stat =
    job === "SAM" || job === "RPR" || job === "VPR" || job === "MCH"
      ? "SKS"
      : "SPS";
  const weaponStat: Stat =
    job === "RDM" || job === "WHM" || job === "PCT" ? "MDMG" : "PDMG";
  const stats: Stat[] = [
    weaponStat,
    mainStat,
    "CRT",
    "DET",
    "DHT",
    speedStat,
    "TEN",
  ];
  const vectorIndex = new Map(attributeIds.map((id, index) => [id, index]));
  return new Map(
    stats.map((stat) => [stat, vectorIndex.get(attributeIdByStat[stat]!)!]),
  );
}

const sharedRings = [
  equipment(1001, { 2: 24, 3: 9, 4: 4, 5: 10, 6: 11, 8: 10 }),
  equipment(1002, { 2: 7, 3: 27, 4: 12, 5: 4, 6: 3, 8: 4 }),
];

const foods: FoodInfo[] = [
  food(9001, [2, 3, 5, 6, 8]),
  food(9002, [1, 2, 3, 4, 7, 9, 10]),
];

function localCandidates(
  job: JobCode,
  name: Exclude<SlotName, "ring" | "ring2">,
): EquipInfo[] {
  if (name === "weapon") {
    if (job === "RDM") {
      return [
        equipment(
          1101,
          { 1: 570, 2: 44, 3: 24, 4: 14, 5: 23, 6: 8 },
          { MDMG: 160 },
        ),
        equipment(
          1102,
          { 1: 535, 2: 26, 3: 42, 4: 20, 5: 9, 6: 21 },
          { MDMG: 157 },
        ),
      ];
    }
    if (job === "PCT") {
      return [
        equipment(
          3101,
          { 1: 570, 2: 44, 3: 24, 4: 14, 5: 0, 6: 8 },
          { MDMG: 160 },
        ),
        equipment(
          3102,
          { 1: 550, 2: 26, 3: 42, 4: 20, 5: 120, 6: 21 },
          { MDMG: 158 },
        ),
      ];
    }
    if (job === "SAM" || job === "RPR") {
      return [
        equipment(
          1201,
          { 7: 570, 2: 42, 3: 22, 4: 12, 6: 8, 8: 27 },
          { PDMG: 160 },
        ),
        equipment(
          1202,
          { 7: 535, 2: 25, 3: 40, 4: 20, 6: 20, 8: 8 },
          { PDMG: 157 },
        ),
      ];
    }
    if (job === "VPR" || job === "MCH") {
      return [
        equipment(
          1401,
          { 10: 570, 2: 42, 3: 22, 4: 12, 6: 8, 8: 27 },
          { PDMG: 160 },
        ),
        equipment(
          1402,
          { 10: 535, 2: 25, 3: 40, 4: 20, 6: 20, 8: 8 },
          { PDMG: 157 },
        ),
      ];
    }
    return [
      equipment(
        1301,
        { 9: 570, 2: 42, 3: 22, 4: 12, 5: 27, 6: 8 },
        { MDMG: 160 },
      ),
      equipment(
        1302,
        { 9: 535, 2: 25, 3: 40, 4: 20, 5: 8, 6: 20 },
        { MDMG: 157 },
      ),
    ];
  }
  if (job === "RDM") {
    return [
      equipment(2101, { 1: 330, 2: 26, 3: 13, 4: 18, 5: 16, 6: 4 }),
      equipment(2102, { 1: 305, 2: 11, 3: 31, 4: 8, 5: 5, 6: 18 }),
    ];
  }
  if (job === "PCT") {
    return [
      equipment(3201, { 1: 330, 2: 36, 3: 8, 4: 18, 5: 0, 6: 4 }),
      equipment(3202, { 1: 305, 2: 9, 3: 34, 4: 8, 5: 7, 6: 18 }),
    ];
  }
  if (job === "SAM" || job === "RPR") {
    return [
      equipment(2201, { 7: 330, 2: 26, 3: 13, 4: 18, 6: 4, 8: 16 }),
      equipment(2202, { 7: 305, 2: 11, 3: 31, 4: 8, 6: 18, 8: 5 }),
    ];
  }
  if (job === "VPR" || job === "MCH") {
    return [
      equipment(2401, { 10: 330, 2: 26, 3: 13, 4: 18, 6: 4, 8: 16 }),
      equipment(2402, { 10: 305, 2: 11, 3: 31, 4: 8, 6: 18, 8: 5 }),
    ];
  }
  return [
    equipment(2301, { 9: 330, 2: 26, 3: 13, 4: 18, 5: 16, 6: 4 }),
    equipment(2302, { 9: 305, 2: 11, 3: 31, 4: 8, 5: 5, 6: 18 }),
  ];
}

const slotOrders: Record<JobCode, readonly SlotName[]> = {
  RDM: ["weapon", "ring", "head"],
  SAM: ["ring", "head", "weapon"],
  WHM: ["head", "weapon", "ring"],
  RPR: ["head", "weapon", "ring"],
  VPR: ["weapon", "ring", "head"],
  MCH: ["ring", "weapon", "head"],
  PCT: ["weapon", "ring", "head"],
};

function makeJob(
  job: JobCode,
  options: {
    ringCandidates?: readonly EquipInfo[];
    weaponCandidates?: readonly EquipInfo[];
    headCandidates?: readonly EquipInfo[];
    slotNames?: readonly SlotName[];
    foods?: readonly FoodInfo[];
    constraints?: ExactMipOptions["constraints"];
    damageOverride?: (
      attributes: readonly number[],
    ) => { damage: number; gcd: number } | undefined;
  } = {},
): JobInput {
  const slotNames = options.slotNames ?? slotOrders[job];
  const slotsByName: Record<SlotName, readonly EquipInfo[]> = {
    weapon: options.weaponCandidates ?? localCandidates(job, "weapon"),
    ring: options.ringCandidates ?? sharedRings,
    ring2: options.ringCandidates ?? sharedRings,
    head: options.headCandidates ?? localCandidates(job, "head"),
  };
  const slots = slotNames.map((name) => slotsByName[name]);
  const statIndexes = jobStatIndexes(job);
  const maxContributions = attributeIds.map((id) => {
    const gearMaximum = slots.reduce(
      (sum, slot) =>
        sum +
        Math.max(
          0,
          ...slot.map(
            (item) =>
              equipmentAttributeExtractor(item).find(
                (param) => param.baseParamId === id,
              )?.value ?? 0,
          ),
        ),
      0,
    );
    const foodMaximum = Math.max(
      0,
      ...(options.foods ?? foods).map(
        (item) =>
          item.baseParams.find((param) => param.baseParamId === id)?.maxValue ??
          0,
      ),
    );
    return Math.min(100_000, gearMaximum + foodMaximum);
  });
  const level = 100 as JobLevel;
  const fallbackEvaluation = createDamageGcdVectorEvaluator(
    job as Job,
    level,
    statIndexes,
    maxContributions,
  );
  const speedAttributeId =
    job === "SAM" || job === "RPR" || job === "VPR" || job === "MCH" ? 8 : 5;
  return {
    id: job,
    slotNames,
    options: {
      job: job as Job,
      jobLevel: level,
      attributeIds,
      statIndexes,
      slots,
      foods: [...(options.foods ?? foods)],
      ...(options.constraints === undefined
        ? {}
        : { constraints: options.constraints }),
      speedAttributeId,
      toughnessAttributeId: 6,
      gcdToSpeedRange: (gcd) =>
        equippedSpeedRangeForGcd(job as Job, level, gcd),
      toughnessPercentToMinimum: (percentage) =>
        equippedToughnessForMitigationPercent(job as Job, level, percentage),
      equipmentAttributeExtractor,
      evaluationFunction: options.damageOverride ?? fallbackEvaluation,
      maxSearchMs: 30_000,
    },
  };
}

function jobWithIndependentUniqueRings(job: JobCode): JobInput {
  const base = makeJob(job, { slotNames: ["weapon", "ring", "head"], foods: [] });
  const attributes = { 1: 800, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 800, 8: 100, 9: 800, 10: 800 };
  const uniqueFirst: EquipInfo = {
    ...equipment(8_620, attributes),
    ringSlotIndex: 0,
    isUnique: true,
  };
  const uniqueSecond: EquipInfo = {
    ...equipment(8_620, attributes),
    ringSlotIndex: 1,
    isUnique: true,
  };
  const ordinarySecond: EquipInfo = {
    ...equipment(8_621, { 1: 100, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 100, 8: 10, 9: 100, 10: 100 }),
    ringSlotIndex: 1,
    isUnique: false,
  };
  const [weaponSlot, , headSlot] = base.options.slots;
  assert.ok(weaponSlot);
  assert.ok(headSlot);
  return {
    ...base,
    slotNames: ["weapon", "ring", "ring2", "head"],
    options: {
      ...base.options,
      slots: [weaponSlot, [uniqueFirst], [uniqueSecond, ordinarySecond], headSlot],
    },
  };
}

function vectorFor(
  selection: readonly EquipInfo[],
  selectedFood: FoodInfo | undefined,
): number[] {
  const vector = new Array<number>(attributeIds.length).fill(0);
  const indexes = new Map(attributeIds.map((id, index) => [id, index]));
  for (const item of selection) {
    for (const param of equipmentAttributeExtractor(item)) {
      vector[indexes.get(param.baseParamId)!] += param.value;
    }
  }
  if (selectedFood !== undefined) {
    for (const param of selectedFood.baseParams) {
      const index = indexes.get(param.baseParamId)!;
      vector[index] += Math.min(
        param.maxValue,
        Math.trunc(
          (vector[index]! + (param.baseValue ?? 0)) *
            (param.multiplier - 1) +
            1e-7,
        ),
      );
    }
  }
  return vector;
}

function exactProduct(factors: IntegerDamageFactors): bigint {
  return (
    BigInt(factors.weaponDamage) *
    BigInt(factors.mainStat) *
    BigInt(factors.determination) *
    BigInt(factors.tenacity) *
    BigInt(factors.critical) *
    BigInt(factors.directHit)
  );
}

function gcdBigInt(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function addFraction(
  left: { numerator: bigint; denominator: bigint },
  right: { numerator: bigint; denominator: bigint },
): { numerator: bigint; denominator: bigint } {
  const numerator =
    left.numerator * right.denominator + right.numerator * left.denominator;
  const denominator = left.denominator * right.denominator;
  const divisor = gcdBigInt(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function equipmentIdentity(item: EquipInfo): string {
  const ringEquips = (item as EquipInfo & { ringEquips?: readonly EquipInfo[] })
    .ringEquips;
  if (ringEquips !== undefined) {
    return `ring-pair:${ringEquips.map(equipmentIdentity).sort().join("||")}`;
  }
  const params = [...item.baseParams]
    .sort((a, b) => a.baseParamId - b.baseParamId)
    .map(({ baseParamId, value }) => `${baseParamId}:${value}`)
    .join(",");
  return [
    item.itemId,
    item.itemLevel,
    params,
    item.PDMG,
    item.MDMG,
    item.DLY,
  ].join("|");
}

function commonSlotEquipment(
  item: EquipInfo,
  commonSlot: string,
  projections: readonly SharedSlotProjection[],
): EquipInfo {
  const projection = projections.find((candidate) => candidate.commonSlot === commonSlot);
  if (projection === undefined) return item;
  const ringEquips = (item as EquipInfo & { ringEquips?: readonly EquipInfo[] }).ringEquips;
  const projected = ringEquips?.[projection.ringIndex];
  if (projected === undefined) throw new Error(`missing projected ring for ${commonSlot}`);
  return projected;
}

function sourceSlotName(
  commonSlot: string,
  projections: readonly SharedSlotProjection[],
): string {
  return projections.find((candidate) => candidate.commonSlot === commonSlot)?.slotName ?? commonSlot;
}

function foodIdentity(item: FoodInfo | undefined): string {
  if (item === undefined) return "<no-food>";
  const params = [...item.baseParams]
    .sort((a, b) => a.baseParamId - b.baseParamId)
    .map(
      ({ baseParamId, multiplier, maxValue }) =>
        `${baseParamId}:${multiplier}:${maxValue}`,
    )
    .join(",");
  return [item.itemId, item.itemLevel, params].join("|");
}

function cartesian<T>(sets: readonly (readonly T[])[]): T[][] {
  return sets.reduce<T[][]>(
    (prefixes, set) =>
      prefixes.flatMap((prefix) => set.map((value) => [...prefix, value])),
    [[]],
  );
}

function candidateMetric(
  candidate: Candidate,
  objective: "damage" | "dps",
): { numerator: bigint; denominator: bigint } {
  return objective === "dps"
    ? {
        numerator: candidate.product,
        denominator: BigInt(candidate.gcdCentiseconds),
      }
    : { numerator: candidate.product, denominator: 1n };
}

function normalizedMetric(
  candidate: Candidate,
  baseline: Candidate,
  objective: "damage" | "dps",
): { numerator: bigint; denominator: bigint } {
  const current = candidateMetric(candidate, objective);
  const optimum = candidateMetric(baseline, objective);
  return {
    numerator: current.numerator * optimum.denominator,
    denominator: current.denominator * optimum.numerator,
  };
}

function compareCandidates(
  left: Candidate,
  right: Candidate,
  objective: "damage" | "dps",
): number {
  const a = candidateMetric(left, objective);
  const b = candidateMetric(right, objective);
  const leftScaled = a.numerator * b.denominator;
  const rightScaled = b.numerator * a.denominator;
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function constraintAllows(
  options: ExactMipOptions,
  candidate: Candidate,
): boolean {
  const constraints = options.constraints ?? {};
  const speedIndex = options.attributeIds.indexOf(
    options.speedAttributeId ?? -999,
  );
  const tenacityIndex = options.attributeIds.indexOf(
    options.toughnessAttributeId ?? -999,
  );
  if (constraints.gcd !== undefined) {
    const range = options.gcdToSpeedRange?.(constraints.gcd);
    if (
      range === undefined ||
      candidate.attributes[speedIndex]! < range.min ||
      candidate.attributes[speedIndex]! > range.max
    )
      return false;
  }
  if (constraints.gcdChoices !== undefined) {
    const matchesChoice = constraints.gcdChoices.some((gcd) => {
      const range = options.gcdToSpeedRange?.(gcd);
      return (
        range !== undefined &&
        candidate.attributes[speedIndex]! >= range.min &&
        candidate.attributes[speedIndex]! <= range.max
      );
    });
    if (!matchesChoice) return false;
  }
  if (
    constraints.speedMin !== undefined &&
    candidate.attributes[speedIndex]! < constraints.speedMin
  )
    return false;
  if (
    constraints.speedMax !== undefined &&
    candidate.attributes[speedIndex]! > constraints.speedMax
  )
    return false;
  const toughnessMinimum = Math.max(
    constraints.toughMin ?? 0,
    constraints.toughnessMinPercent === undefined
      ? 0
      : (options.toughnessPercentToMinimum?.(constraints.toughnessMinPercent) ??
          Number.POSITIVE_INFINITY),
  );
  return (
    tenacityIndex < 0 ||
    candidate.attributes[tenacityIndex]! >= toughnessMinimum
  );
}

function enumerateJob(job: JobInput): Candidate[] {
  const factorEvaluator = createIntegerDamageFactorEvaluator(
    job.options.job,
    job.options.jobLevel,
    job.options.statIndexes,
  );
  const foodChoices =
    job.options.foods.length === 0 ? [undefined] : job.options.foods;
  const candidates: Candidate[] = [];
  for (const selection of cartesian(job.options.slots)) {
    for (const selectedFood of foodChoices) {
      const attributes = vectorFor(selection, selectedFood);
      const factors = factorEvaluator(attributes);
      const evaluation = job.options.evaluationFunction(attributes);
      if (
        factors === undefined ||
        evaluation === undefined ||
        !Number.isFinite(evaluation.damage) ||
        !Number.isFinite(evaluation.gcd)
      )
        continue;
      const candidate: Candidate = {
        selection,
        food: selectedFood,
        attributes,
        factors,
        product: exactProduct(factors),
        gcdCentiseconds: factors.gcdCentiseconds,
        damage: evaluation.damage,
        gcd: evaluation.gcd,
      };
      if (constraintAllows(job.options, candidate)) candidates.push(candidate);
    }
  }
  return candidates;
}

function bestSolo(
  job: JobInput,
  candidates: readonly Candidate[],
  objective: "damage" | "dps",
):
  | {
      candidate: Candidate;
      maximumToughness: number | undefined;
    }
  | undefined {
  if (candidates.length === 0) return undefined;
  let allowed = candidates;
  let maximumToughness: number | undefined;
  if (job.options.constraints?.maxToughnessMode === true) {
    const tenacityIndex = job.options.attributeIds.indexOf(
      job.options.toughnessAttributeId ?? -999,
    );
    maximumToughness = Math.max(
      ...candidates.map((candidate) => candidate.attributes[tenacityIndex]!),
    );
    allowed = candidates.filter(
      (candidate) => candidate.attributes[tenacityIndex] === maximumToughness,
    );
  }
  const candidate = allowed.reduce((best, next) =>
    compareCandidates(next, best, objective) > 0 ? next : best,
  );
  return { candidate, maximumToughness };
}

function matchingFoods(
  jobs: readonly JobInput[],
): ReadonlyMap<string, FoodInfo | undefined>[] {
  if (jobs.every((job) => job.options.foods.length === 0)) {
    return [new Map(jobs.map((job) => [job.id, undefined]))];
  }
  if (jobs.some((job) => job.options.foods.length === 0)) return [];
  const foodByJobAndIdentity = jobs.map((job) =>
    new Map(job.options.foods.map((candidate) => [foodIdentity(candidate), candidate])),
  );
  const firstFoods = new Map(
    jobs[0]!.options.foods.map((candidate) => [foodIdentity(candidate), candidate]),
  );
  return [...firstFoods.keys()]
    .filter((identity) => foodByJobAndIdentity.every((foods) => foods.has(identity)))
    .map((identity) =>
      new Map(
        jobs.map((job, index) => [
          job.id,
          foodByJobAndIdentity[index]!.get(identity),
        ]),
      ),
    );
}

function oracle(
  jobs: readonly JobInput[],
  commonSlots: readonly string[],
  foodStrategy: "shared" | "independent",
  objective: "damage" | "dps" = "damage",
  commonSlotProjections: readonly SharedSlotProjection[] = [],
): OracleResult | undefined {
  const allCandidates = new Map(jobs.map((job) => [job.id, enumerateJob(job)]));
  const baselines = new Map<
    string,
    { candidate: Candidate; maximumToughness: number | undefined }
  >();
  for (const job of jobs) {
    const baseline = bestSolo(job, allCandidates.get(job.id)!, objective);
    if (baseline === undefined) return undefined;
    baselines.set(job.id, baseline);
  }

  const commonChoices = commonSlots.map((slotName) => {
    const first = jobs[0]!;
    const index = first.slotNames.indexOf(sourceSlotName(slotName, commonSlotProjections) as SlotName);
    if (index < 0)
      throw new Error(`Fixture has no slot ${sourceSlotName(slotName, commonSlotProjections)} for ${first.id}`);
    const otherIdentities = jobs.slice(1).map((job) => {
      const jobIndex = job.slotNames.indexOf(sourceSlotName(slotName, commonSlotProjections) as SlotName);
      if (jobIndex < 0)
        throw new Error(`Fixture has no slot ${sourceSlotName(slotName, commonSlotProjections)} for ${job.id}`);
      return new Set(job.options.slots[jobIndex]!.map((item) =>
        equipmentIdentity(commonSlotEquipment(item, slotName, commonSlotProjections))));
    });
    const choices = new Map<string, { item: EquipInfo; identity: string }>();
    for (const item of first.options.slots[index]!) {
      const projected = commonSlotEquipment(item, slotName, commonSlotProjections);
      const identity = equipmentIdentity(projected);
      if (otherIdentities.every((identities) => identities.has(identity)) && !choices.has(identity)) {
        choices.set(identity, { item: projected, identity });
      }
    }
    return [...choices.values()];
  });
  if (commonChoices.some((choices) => choices.length === 0)) return undefined;
  const sharedFoods =
    foodStrategy === "shared" ? matchingFoods(jobs) : [undefined];
  if (foodStrategy === "shared" && sharedFoods.length === 0) return undefined;

  let best: OracleResult | undefined;
  for (const commonTuple of cartesian(commonChoices)) {
    const commonIdentity = Object.fromEntries(
      commonSlots.map((name, index) => [name, commonTuple[index]!.identity]),
    );
    for (const sharedFoodByJob of sharedFoods) {
      const chosen: Record<string, Candidate> = {};
      let value = { numerator: 0n, denominator: 1n };
      let feasible = true;
      for (const job of jobs) {
        const maximumToughness = baselines.get(job.id)!.maximumToughness;
        const tenacityIndex = job.options.attributeIds.indexOf(
          job.options.toughnessAttributeId ?? -999,
        );
        let allowed = allCandidates.get(job.id)!.filter((candidate) => {
          for (const commonName of commonSlots) {
            const slotIndex = job.slotNames.indexOf(sourceSlotName(commonName, commonSlotProjections) as SlotName);
            if (
              equipmentIdentity(commonSlotEquipment(
                candidate.selection[slotIndex]!,
                commonName,
                commonSlotProjections,
              )) !==
              commonIdentity[commonName]
            )
              return false;
          }
          if (
            job.options.constraints?.maxToughnessMode === true &&
            candidate.attributes[tenacityIndex] !== maximumToughness
          )
            return false;
          return true;
        });
        if (foodStrategy === "shared") {
          const sharedFood = sharedFoodByJob?.get(job.id);
          allowed = allowed.filter(
            (candidate) =>
              foodIdentity(candidate.food) === foodIdentity(sharedFood),
          );
        }
        if (allowed.length === 0) {
          feasible = false;
          break;
        }
        const candidate = allowed.reduce((currentBest, next) =>
          compareCandidates(next, currentBest, objective) > 0
            ? next
            : currentBest,
        );
        chosen[job.id] = candidate;
        value = addFraction(
          value,
          normalizedMetric(
            candidate,
            baselines.get(job.id)!.candidate,
            objective,
          ),
        );
      }
      if (
        feasible &&
        (best === undefined ||
          value.numerator * best.denominator >
            best.numerator * value.denominator)
      ) {
        best = {
          numerator: value.numerator,
          denominator: value.denominator,
          approximate: Number(value.numerator) / Number(value.denominator),
          commonIdentity,
          chosen,
          optima: Object.fromEntries(
            [...baselines].map(([id, result]) => [id, result.candidate]),
          ),
          maximumToughness: Object.fromEntries(
            [...baselines].map(([id, result]) => [id, result.maximumToughness]),
          ),
        };
      }
    }
  }
  return best;
}

function assertMatchesOracle(
  result: Awaited<ReturnType<typeof findBestJointLoadoutV3>>,
  expected: OracleResult | undefined,
  jobs: readonly JobInput[],
  commonSlots: readonly string[],
  foodStrategy: "shared" | "independent",
  objective: "damage" | "dps" = "damage",
  commonSlotProjections: readonly SharedSlotProjection[] = [],
): void {
  if (expected === undefined) {
    assert.equal(result, undefined);
    return;
  }
  assert.ok(result);
  const actual = result as JointLoadoutV3Result;
  assert.equal(actual.proof.complete, true);
  assert.equal(actual.proof.objective, objective);
  assert.equal(
    BigInt(actual.value.numerator) * expected.denominator,
    expected.numerator * BigInt(actual.value.denominator),
    "joint result must equal the exact independently enumerated rational objective",
  );
  assert.ok(
    Math.abs(actual.value.approximate - expected.approximate) < 1e-10,
    `expected normalized objective ${expected.approximate}, got ${actual.value.approximate}`,
  );
  for (const job of jobs) {
    const chosen: ExactMipResult | undefined = actual.jobResults[job.id];
    const expectedChosen: Candidate = expected.chosen[job.id]!;
    const opt: ExactMipResult | undefined = actual.optima[job.id];
    assert.ok(chosen, `missing joint result for ${job.id}`);
    assert.ok(opt, `missing solo optimum for ${job.id}`);
    assert.ok(
      Math.abs(chosen.damage - expectedChosen.damage) <=
        Math.max(1e-8, Math.abs(expectedChosen.damage) * 1e-10),
    );
    assert.ok(
      Math.abs(opt.damage - expected.optima[job.id]!.damage) <=
        Math.max(1e-8, Math.abs(expected.optima[job.id]!.damage) * 1e-10),
    );
    if (foodStrategy === "shared") {
      assert.equal(
        foodIdentity(chosen.food),
        foodIdentity(actual.jobResults[jobs[0]!.id]!.food),
      );
    }
    for (const slotName of commonSlots) {
      const slotIndex = job.slotNames.indexOf(sourceSlotName(slotName, commonSlotProjections) as SlotName);
      assert.notEqual(slotIndex, -1);
      const projectedSelection = commonSlotEquipment(
        chosen.selection[slotIndex]!,
        slotName,
        commonSlotProjections,
      );
      assert.equal(
        equipmentIdentity(projectedSelection),
        equipmentIdentity(actual.commonEquipments[slotName]!),
        `${job.id} must read the shared ${slotName} at its own slot index`,
      );
      assert.equal(
        equipmentIdentity(actual.commonEquipments[slotName]!),
        expected.commonIdentity[slotName],
      );
    }
    const maximumToughness: number | undefined =
      expected.maximumToughness[job.id];
    if (maximumToughness !== undefined) {
      const tenacityIndex = job.options.attributeIds.indexOf(
        job.options.toughnessAttributeId ?? -999,
      );
      assert.equal(
        vectorFor(chosen.selection, chosen.food)[tenacityIndex],
        maximumToughness,
        `${job.id} must preserve the solo max-toughness target in the restricted solve`,
      );
      assert.equal(opt.maximumToughness, maximumToughness);
    }
  }
}

async function runJoint(
  jobs: readonly JobInput[],
  commonSlots: readonly string[],
  foodStrategy: "shared" | "independent",
  extra: {
    maxSearchMs?: number;
    cacheLimit?: number;
    objective?: "damage" | "dps";
    commonSlotProjections?: readonly SharedSlotProjection[];
  } = {},
) {
  return findBestJointLoadoutV3({
    jobs: jobs.map(({ id, slotNames, options }) => ({
      id,
      slotNames,
      options,
    })),
    commonSlots,
    foodStrategy,
    maxSearchMs: 30_000,
    cacheLimit: 256,
    ...extra,
  });
}

test("V3 preserves the weaker legal ring partner when the stronger candidate conflicts by unique itemId", async () => {
  const jobs = [jobWithIndependentUniqueRings("RDM"), jobWithIndependentUniqueRings("SAM")];
  const result = await runJoint(jobs, [], "independent");

  assert.ok(result);
  assert.equal(result.proof.complete, true);
  for (const job of jobs) {
    const selection: readonly EquipInfo[] = result.jobResults[job.id]!.selection;
    assert.equal(selection[1]!.itemId, 8_620);
    assert.equal(selection[2]!.itemId, 8_621,
      "single-slot Pareto pruning must leave the weaker different-ID ring available");
  }
});

function markedRing(
  itemId: number,
  ringSlotIndex: 0 | 1,
  attributes: Record<number, number>,
  isUnique: boolean,
): EquipInfo {
  return {
    ...equipment(itemId, attributes),
    ringSlotIndex,
    isUnique,
  };
}

async function capturePrunedRings(
  firstRings: readonly EquipInfo[],
  secondRings: readonly EquipInfo[],
  constraints?: ExactMipOptions["constraints"],
  expectFeasible = true,
): Promise<readonly [readonly EquipInfo[], readonly EquipInfo[]]> {
  const base = makeJob("RDM", {
    slotNames: ["weapon", "ring", "ring2", "head"],
    ringCandidates: firstRings,
    weaponCandidates: [equipment(9_700, { "-1": 160, 1: 2_000, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100 })],
    headCandidates: [equipment(9_701, { 1: 100, 2: 50, 3: 50, 4: 50, 5: 50, 6: 50 })],
    foods: [],
  });
  const slots = [...base.options.slots];
  slots[2] = secondRings;
  const jobOptions = { ...base.options, slots, ...(constraints === undefined ? {} : { constraints }) };
  Reflect.deleteProperty(jobOptions, "equipmentAttributeExtractor");

  let prunedSlots: readonly (readonly EquipInfo[])[] | undefined;
  const result = await findBestJointLoadoutV3({
    jobs: [{ id: base.id, slotNames: base.slotNames, options: jobOptions }],
    commonSlots: [],
    foodStrategy: "independent",
    maxSearchMs: 20_000,
    baselineExecutor: async (tasks) => {
      if (prunedSlots === undefined) prunedSlots = tasks[0]?.slots;
      try {
        return await Promise.all(tasks.map((task) => findBestLoadoutExactMip(task)));
      } catch (error) {
        if (expectFeasible) throw error;
        return tasks.map(() => undefined);
      }
    },
  });
  if (expectFeasible) assert.ok(result, "the exact fixture should produce a feasible result");
  else assert.equal(result, undefined, "incomplete unique metadata should fail closed after conservative pruning");
  assert.ok(prunedSlots, "V3 should submit the initial baseline task");
  return [prunedSlots[1]!, prunedSlots[2]!];
}

test("ring pruning shares a frontier across non-unique IDs and unique IDs absent from the opposite slot", async () => {
  const nonUnique = await capturePrunedRings(
    [
      markedRing(9_710, 0, { 1: 100, 2: 60 }, false),
      markedRing(9_711, 0, { 1: 90, 2: 50 }, false),
    ],
    [markedRing(9_712, 1, { 1: 10, 2: 10 }, false)],
  );
  assert.deepEqual(nonUnique[0].map(({ itemId }) => itemId), [9_710]);

  const absentUnique = await capturePrunedRings(
    [
      markedRing(9_713, 0, { 1: 90, 2: 50 }, true),
      markedRing(9_714, 0, { 1: 100, 2: 60 }, false),
    ],
    [markedRing(9_715, 1, { 1: 10, 2: 10 }, true)],
  );
  assert.deepEqual(absentUnique[0].map(({ itemId }) => itemId), [9_714],
    "a unique ring without an opposite-slot partner has the same empty conflict set as a non-unique ring");
});

test("ring pruning keeps separate frontiers for distinct unique conflict behavior", async () => {
  const rings = await capturePrunedRings(
    [
      markedRing(9_720, 0, { 1: 100, 2: 60 }, true),
      markedRing(9_721, 0, { 1: 90, 2: 50 }, false),
    ],
    [markedRing(9_720, 1, { 1: 10, 2: 10 }, true)],
  );
  assert.deepEqual(rings[0].map(({ itemId }) => itemId), [9_720, 9_721],
    "the weaker no-conflict ring remains available when the stronger ring conflicts with the opposite slot");
});

test("ring pruning falls back to per-item frontiers when unique metadata is incomplete", async () => {
  const rings = await capturePrunedRings(
    [
      { ...markedRing(9_725, 0, { 1: 90, 2: 50 }, false), isUnique: undefined },
      markedRing(9_726, 0, { 1: 100, 2: 60 }, false),
    ],
    [markedRing(9_727, 1, { 1: 10, 2: 10 }, false)],
    undefined,
    false,
  );
  assert.deepEqual(rings[0].map(({ itemId }) => itemId), [9_725, 9_726],
    "unknown uniqueness must not enable cross-ID pruning");
});

test("ring pruning deduplicates identical attributes only inside the same conflict group", async () => {
  const noConflict = await capturePrunedRings(
    [
      markedRing(9_730, 0, { 1: 100, 2: 60 }, false),
      markedRing(9_731, 0, { 1: 100, 2: 60 }, true),
    ],
    [markedRing(9_732, 1, { 1: 10, 2: 10 }, true)],
  );
  assert.deepEqual(noConflict[0].map(({ itemId }) => itemId), [9_730],
    "equal attribute vectors retain the first input candidate when conflict behavior also matches");

  const distinctConflictGroups = await capturePrunedRings(
    [
      markedRing(9_733, 0, { 1: 100, 2: 60 }, true),
      markedRing(9_734, 0, { 1: 100, 2: 60 }, false),
    ],
    [markedRing(9_733, 1, { 1: 10, 2: 10 }, true)],
  );
  assert.deepEqual(distinctConflictGroups[0].map(({ itemId }) => itemId), [9_733, 9_734],
    "equal vectors with different legal partner sets must both remain");
});

test("ring pruning keeps speed-distinct candidates when a speed constraint is active", async () => {
  const rings = await capturePrunedRings(
    [
      markedRing(9_740, 0, { 1: 100, 2: 60, 5: 20 }, false),
      markedRing(9_741, 0, { 1: 90, 2: 50, 5: 30 }, false),
    ],
    [markedRing(9_742, 1, { 1: 10, 2: 10, 5: 10 }, false)],
    { speedMax: 1_000 },
  );
  assert.deepEqual(rings[0].map(({ itemId }) => itemId), [9_740, 9_741],
    "a speed-constrained frontier must not dominate across different speed totals");
});

test("V3 exactly matches exhaustive joint DAMAGE for 2 and 3 jobs under both food strategies", async () => {
  for (const jobCount of [2, 3]) {
    const jobs = (["RDM", "SAM", "WHM"] as const)
      .slice(0, jobCount)
      .map((job) => makeJob(job));
    for (const strategy of ["shared", "independent"] as const) {
      const expected = oracle(jobs, ["ring"], strategy);
      assert.ok(expected);
      const result = await runJoint(jobs, ["ring"], strategy);
      assertMatchesOracle(result, expected, jobs, ["ring"], strategy);
    }
  }
});

test("small shared-gear domains are estimated before selecting exact warm starts", async () => {
  const jobs = [makeJob("RDM"), makeJob("SAM")];
  const commonSlots = ["ring"] as const;
  const expected = oracle(jobs, commonSlots, "independent");
  assert.ok(expected);
  const progress: string[] = [];
  const result = await findBestJointLoadoutV3({
    jobs: jobs.map(({ id, slotNames, options }) => ({ id, slotNames, options })),
    commonSlots,
    foodStrategy: "independent",
    onProgress: (message) => progress.push(message),
  });
  assertMatchesOracle(result, expected, jobs, commonSlots, "independent");
  assert.ok(progress.some((message) => message.includes("共享候选组合估分 2 个")),
    "the exact seed ranking should inspect each combination in this small shared domain");
});

test("four-job direct joint warm starts preserve the exhaustive normalized optimum", async () => {
  const jobs = (["RDM", "SAM", "VPR", "MCH"] as const).map((job) =>
    makeJob(job, { foods: [] }));
  const expected = oracle(jobs, ["ring"], "independent");
  assert.ok(expected);

  const actual = await runJoint(jobs, ["ring"], "independent");

  assertMatchesOracle(actual, expected, jobs, ["ring"], "independent");
  assert.equal(actual?.proof.complete, true);
});

test("a single shared assignment is proved with exact per-job solves instead of a joint MIP", async () => {
  const sharedRing = equipment(8_600, { 2: 20, 3: 20, 4: 20, 5: 20, 6: 20, 8: 20 });
  const jobs = (["RDM", "SAM", "VPR", "MCH"] as const).map((job, index) => {
    const mainStatId = job === "RDM" ? 1 : job === "SAM" ? 7 : 10;
    const personalRing = equipment(8_610 + index, { [mainStatId]: 1_000 });
    return makeJob(job, { ringCandidates: [personalRing, sharedRing], foods: [] });
  });
  const expected = oracle(jobs, ["ring"], "independent");
  assert.ok(expected);
  for (const job of jobs) {
    const ringIndex = job.slotNames.indexOf("ring");
    assert.notEqual(expected.optima[job.id]!.selection[ringIndex]!.itemId, sharedRing.itemId,
      `${job.id} must have a conflicting independent baseline`);
  }

  const callbackModels: string[] = [];
  const actual = await findBestJointLoadoutV3({
    jobs: jobs.map(({ id, slotNames, options }) => ({ id, slotNames, options })),
    commonSlots: ["ring"],
    foodStrategy: "independent",
    onSolverCallback: (event) => callbackModels.push(event.model),
  });

  assertMatchesOracle(actual, expected, jobs, ["ring"], "independent");
  assert.equal(actual!.statistics.outerNodes, 1);
  assert.equal(actual!.statistics.completeNodes, 1);
  assert.ok(!callbackModels.some((model) => model.startsWith("joint:")),
    "the singleton shared domain must be proved without starting the joint factor MIP");
});

test("fixed shared assignments solve independent job bounds in one parallel batch", async () => {
  const sharedRing = equipment(8_650, { 2: 25, 3: 25, 4: 25, 5: 25, 6: 25, 8: 25 });
  const inputJobs = [
    makeJob("RDM", {
      ringCandidates: [equipment(8_651, { 1: 900 }), sharedRing],
      foods: [],
    }),
    makeJob("SAM", {
      ringCandidates: [equipment(8_652, { 7: 900 }), sharedRing],
      foods: [],
    }),
  ];
  const expected = oracle(inputJobs, ["ring"], "independent");
  assert.ok(expected);
  const jobs = inputJobs.map((job) => {
    const slots = job.options.slots.map((slot) => slot.map((item) => ({
      ...item,
      baseParams: [
        ...item.baseParams,
        ...(item.PDMG === 0 ? [] : [{ baseParamId: -2, value: item.PDMG }]),
        ...(item.MDMG === 0 ? [] : [{ baseParamId: -1, value: item.MDMG }]),
      ],
    })));
    const options: ExactMipOptions = { ...job.options, slots };
    delete options.equipmentAttributeExtractor;
    return { ...job, options };
  });
  const workerExecutor = await createParallelBaselineExecutor();
  assert.ok(workerExecutor);
  const taskBatches: string[][] = [];
  const supportPolicies: (string | undefined)[][] = [];
  let actual: JointLoadoutV3Result | undefined;
  try {
    actual = await findBestJointLoadoutV3({
      jobs: jobs.map(({ id, slotNames, options }) => ({ id, slotNames, options })),
      commonSlots: ["ring"],
      foodStrategy: "independent",
      maxSearchMs: 20_000,
      baselineExecutor: async (tasks, control) => {
        taskBatches.push(tasks.map((task) => task.job));
        supportPolicies.push(tasks.map((task) => task.candidateResourceSupportProfile));
        return workerExecutor(tasks, control);
      },
    });
  } finally {
    await workerExecutor.dispose?.();
  }

  assertMatchesOracle(actual, expected, inputJobs, ["ring"], "independent");
  assert.equal(taskBatches.length, 2,
    "one batch computes the solo baselines and one batch computes the fixed shared assignment");
  assert.deepEqual(taskBatches.map((batch) => batch.length), [2, 2],
    "both independent per-job bounds must be submitted together");
  assert.deepEqual(new Set(taskBatches[1]), new Set(["RDM", "SAM"]));
  assert.deepEqual(supportPolicies, [["disabled", "disabled"], ["compact", "compact"]],
    "two-job searches use lean solo baselines and compact restricted proof models");
});

test("large shared warm starts batch independent constrained job solves", async () => {
  const sharedRings = [
    equipment(8_660, { 2: 25, 3: 20, 4: 15, 5: 15, 6: 5, 10: 60 }),
    equipment(8_661, { 2: 20, 3: 25, 4: 15, 5: 15, 6: 5, 10: 60 }),
    equipment(8_662, { 2: 15, 3: 20, 4: 25, 5: 15, 6: 5, 10: 60 }),
  ];
  const sharedHeads = [
    equipment(8_670, { 2: 20, 3: 15, 4: 15, 5: 25, 6: 5, 10: 55 }),
    equipment(8_671, { 2: 15, 3: 20, 4: 15, 5: 25, 6: 5, 10: 55 }),
    equipment(8_672, { 2: 15, 3: 15, 4: 20, 5: 25, 6: 5, 10: 55 }),
  ];
  const inputJobs = (["VPR", "MCH"] as const).map((job, index) => makeJob(job, {
    ringCandidates: [equipment(8_680 + index, { 2: 10, 3: 10, 4: 10, 5: 10, 6: 5, 10: 1_200 }), ...sharedRings],
    headCandidates: [equipment(8_690 + index, { 2: 10, 3: 10, 4: 10, 5: 10, 6: 5, 10: 1_100 }), ...sharedHeads],
    foods: [],
  }));
  const expected = oracle(inputJobs, ["ring", "head"], "independent");
  assert.ok(expected);
  const workerExecutor = await createParallelBaselineExecutor();
  assert.ok(workerExecutor);
  const taskBatches: string[][] = [];
  const progress: string[] = [];
  let actual: JointLoadoutV3Result | undefined;
  try {
    actual = await findBestJointLoadoutV3({
      jobs: inputJobs.map(({ id, slotNames, options }) => ({ id, slotNames, options })),
      commonSlots: ["ring", "head"],
      foodStrategy: "independent",
      maxSearchMs: 20_000,
      onProgress: (message) => progress.push(message),
      baselineExecutor: async (tasks, control) => {
        taskBatches.push(tasks.map((task) => task.job));
        return workerExecutor(tasks, control);
      },
    });
  } finally {
    await workerExecutor.dispose?.();
  }

  assertMatchesOracle(actual, expected, inputJobs, ["ring", "head"], "independent");
  assert.equal(actual!.proof.complete, true);
  const twoSeedBatch = taskBatches.find((batch) => batch.length === 4);
  assert.ok(twoSeedBatch, "both large-domain seeds should share one bounded worker batch");
  assert.equal(twoSeedBatch!.filter((job) => job === "VPR").length, 2);
  assert.equal(twoSeedBatch!.filter((job) => job === "MCH").length, 2);
  assert.ok(progress.some((message) =>
    message.includes("共享候选组合估分 9 个") && message.includes("精确尝试 2 个")),
  "the fixture should stay on the large-domain, two-seed warm-start path");
});

test("V3 stops a seed batch as soon as a completed seed proves the global ceiling", async () => {
  const sharedRings = Array.from({ length: 9 }, (_, index) =>
    equipment(8_800 + index, { 1: index, 2: 0, 8: 0, 9: 8 - index }),
  );
  const inputJobs = (["VPR", "MCH"] as const).map((job, index) => makeJob(job, {
    ringCandidates: [equipment(8_820 + index, { 2: 100, 8: 10 }), ...sharedRings],
    headCandidates: [equipment(8_830, { 2: 0, 8: 0 }), equipment(8_831, { 2: 100, 8: 10 })],
    weaponCandidates: [equipment(8_840, {}, { PDMG: 160 })],
    foods: [],
    constraints: { speedMin: 10, speedMax: 10 },
    damageOverride: (attributes) => ({ damage: attributes[3] ?? 0, gcd: 100 }),
  }));
  const jobs = inputJobs.map(({ id, slotNames, options }) => {
    const workerOptions: ExactMipOptions = { ...options };
    delete workerOptions.equipmentAttributeExtractor;
    return { id, slotNames, options: workerOptions };
  });
  const taskBatches: string[][] = [];
  const completedTaskIndexes: number[][] = [];
  const baselineSelections: string[][] = [];
  const stoppedAt: number[] = [];
  let cancelled = false;
  const run = (onProgress?: (message: string) => void) => findBestJointLoadoutV3({
    jobs,
    commonSlots: ["ring"],
    foodStrategy: "independent",
    maxSearchMs: 20_000,
    ...(onProgress === undefined ? {} : { onProgress }),
    isCancelled: () => cancelled,
    baselineExecutor: async (tasks, control) => {
      const results = new Array<ExactMipResult | undefined>(tasks.length).fill(undefined);
      taskBatches.push(tasks.map((task) => task.job));
      const completions: number[] = [];
      completedTaskIndexes.push(completions);
      for (let index = 0; index < tasks.length; index++) {
        let result = await findBestLoadoutExactMip(tasks[index]!);
        assert.ok(result, `fixture task ${tasks[index]!.job} should be feasible`);
        if (control.onTaskComplete === undefined) {
          const fixture = inputJobs.find((job) => job.id === tasks[index]!.job)!;
          const ringIndex = fixture.slotNames.indexOf("ring");
          const headIndex = fixture.slotNames.indexOf("head");
          const personalRing = fixture.options.slots[ringIndex]!.find((item) =>
            item.itemId === 8_820 + inputJobs.indexOf(fixture));
          const lowHead = fixture.options.slots[headIndex]!.find((item) => item.itemId === 8_830);
          assert.ok(personalRing && lowHead);
          const tiedSelection = [...result.selection];
          tiedSelection[ringIndex] = personalRing;
          tiedSelection[headIndex] = lowHead;
          // Both candidates have the same CRT, speed, and weapon factors as the
          // worker's optimum; select the tied personal-ring optimum so the
          // first shared seed requires exact refinement.
          result = { ...result, selection: tiedSelection };
          baselineSelections.push(result.selection.map((item) => String(item.itemId)));
        }
        results[index] = result;
        completions.push(index);
        if (control.onTaskComplete?.(index, result) === true) {
          stoppedAt.push(index);
          break;
        }
      }
      return results;
    },
  });

  const result = await run();
  assert.ok(result, "the exact search should return its proved incumbent");
  assert.equal(result.value.numerator, "2");
  assert.equal(result.value.denominator, "1");
  assert.equal(result.proof.complete, true);
  assert.match(result.proof.terminationReason, /全局上界/);
  assert.equal(stoppedAt.length, 1,
    `the callback should stop exactly one refinement batch; baselines=${JSON.stringify(baselineSelections)} batches=${JSON.stringify(taskBatches)}`);
  const stoppedBatchIndex = stoppedAt[0]!;
  const stoppedBatch = taskBatches.at(-1)!;
  const stoppedCompletions = completedTaskIndexes.at(-1)!;
  assert.ok(stoppedBatch.length > stoppedBatchIndex + 1,
    `another seed task must remain queued when the global ceiling is reached; batch=${JSON.stringify(stoppedBatch)} stoppedAt=${stoppedBatchIndex}`);
  assert.equal(stoppedCompletions.length, stoppedBatchIndex + 1,
    "the executor should return without starting later seed tasks");

  cancelled = false;
  await assert.rejects(
    run((message) => {
      if (message.includes("V3 incumbent 更新")) cancelled = true;
    }).then((value) => value),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
    "cancellation requested by the incumbent callback must win over early-stop completion",
  );
});

test("baseline Pareto pruning keeps exact optima and leaves dominated shared identities in the joint domain", async () => {
  const dominatedSharedRing = equipment(8500, { 2: 10, 3: 10 });
  const rdmSoloRing = equipment(8501, { 2: 20, 3: 20 });
  const samSoloRing = equipment(8502, { 2: 30, 3: 30 });
  const headTradeoffs = [
    equipment(8510, { 1: 80, 2: 60, 3: 15, 7: 20 }),
    equipment(8511, { 1: 20, 2: 15, 3: 60, 7: 80 }),
  ];
  const jobs = [
    makeJob("RDM", {
      slotNames: ["weapon", "ring", "head"],
      weaponCandidates: [equipment(8520, {}, { MDMG: 160 })],
      ringCandidates: [rdmSoloRing, dominatedSharedRing],
      headCandidates: headTradeoffs,
      foods: [],
    }),
    makeJob("SAM", {
      slotNames: ["weapon", "ring", "head"],
      weaponCandidates: [equipment(8521, {}, { PDMG: 160 })],
      ringCandidates: [samSoloRing, dominatedSharedRing],
      headCandidates: headTradeoffs,
      foods: [],
    }),
  ];

  const dominatedVector = vectorFor([dominatedSharedRing], undefined);
  for (const personalRing of [rdmSoloRing, samSoloRing]) {
    assert.ok(
      vectorFor([personalRing], undefined).every((value, index) => value >= dominatedVector[index]!),
      "the shared ring must be dominated in every attribute coordinate of each solo baseline",
    );
  }

  const expected = oracle(jobs, ["ring", "head"], "independent");
  assert.ok(expected);
  assert.equal(expected.optima.RDM!.selection[1]!.itemId, rdmSoloRing.itemId);
  assert.equal(expected.optima.SAM!.selection[1]!.itemId, samSoloRing.itemId);

  const result = await runJoint(jobs, ["ring", "head"], "independent");
  assertMatchesOracle(result, expected, jobs, ["ring", "head"], "independent");
  assert.equal(result!.commonEquipments.ring.itemId, dominatedSharedRing.itemId);
  assert.equal(result!.jobResults.RDM!.selection[1]!.itemId, dominatedSharedRing.itemId);
  assert.equal(result!.jobResults.SAM!.selection[1]!.itemId, dominatedSharedRing.itemId);
});

test("shared food identity keeps each job's baseValue when compared with enumeration", async () => {
  const physicalFood = food(9003, attributeIds.filter((id) => id > 0));
  const forMainStat = (baseParamId: number, baseValue: number): FoodInfo => ({
    ...physicalFood,
    baseParams: physicalFood.baseParams.map((param) => ({
      ...param,
      ...(param.baseParamId === baseParamId ? { baseValue } : {}),
    })),
  });
  const rdmFood = forMainStat(1, 240);
  const samFood = forMainStat(7, 180);
  assert.equal(foodIdentity(rdmFood), foodIdentity(samFood));
  const jobs = [
    makeJob("RDM", { foods: [rdmFood] }),
    makeJob("SAM", { foods: [samFood] }),
  ];
  const expected = oracle(jobs, ["ring"], "shared");
  assert.ok(expected);
  const result = await runJoint(jobs, ["ring"], "shared");
  assertMatchesOracle(result, expected, jobs, ["ring"], "shared");
  assert.equal(
    result!.jobResults.RDM!.food!.baseParams.find((param) => param.baseParamId === 1)!.baseValue,
    240,
  );
  assert.equal(
    result!.jobResults.SAM!.food!.baseParams.find((param) => param.baseParamId === 7)!.baseValue,
    180,
  );
});

test("V3 removes physically distinct food entries with identical effects against enumeration", async () => {
  const firstFood = food(9005, [2, 3, 5, 6, 8]);
  const equivalentFood = { ...firstFood, itemId: 9006 };
  const jobs = [
    makeJob("RDM", { foods: [firstFood, equivalentFood] }),
    makeJob("SAM", { foods: [firstFood, equivalentFood] }),
  ];
  const expected = oracle(jobs, ["ring"], "shared");
  assert.ok(expected);
  const result = await runJoint(jobs, ["ring"], "shared");
  assertMatchesOracle(result, expected, jobs, ["ring"], "shared");
  assert.equal(result!.jobResults.RDM!.food?.itemId, firstFood.itemId);
  assert.equal(result!.jobResults.SAM!.food?.itemId, firstFood.itemId);
});

test("V3 with no common gear matches the exhaustive food-policy optimum", async () => {
  const jobs = (["RDM", "SAM", "WHM"] as const).map((job) => makeJob(job));
  for (const strategy of ["shared", "independent"] as const) {
    const expected = oracle(jobs, [], strategy);
    assert.ok(expected);
    const result = await runJoint(jobs, [], strategy);
    assertMatchesOracle(result, expected, jobs, [], strategy);
    assert.deepEqual(result?.commonEquipments, {});
  }
});

test("V3 cacheLimit zero keeps the exhaustive result and stores no restricted solves", async () => {
  const commonRing = equipment(9004, { 2: 12, 3: 8, 6: 3 });
  const jobs = [
    makeJob("RDM", { ringCandidates: [commonRing], foods: [] }),
    makeJob("SAM", { ringCandidates: [commonRing], foods: [] }),
  ];
  const expected = oracle(jobs, ["ring"], "independent");
  assert.ok(expected);
  const result = await runJoint(jobs, ["ring"], "independent", {
    cacheLimit: 0,
  });
  assertMatchesOracle(result, expected, jobs, ["ring"], "independent");
  assert.equal(result!.statistics.cacheLimit, 0);
  assert.equal(result!.statistics.cacheEntries, 0);
});

test("joint factor product is only a filter and cannot replace the normalized sum", async () => {
  const rings = [
    equipment(7101, { 7: 1000, 1: 100 }),
    equipment(7102, { 7: 500, 1: 500 }),
    equipment(7103, { 7: 0, 1: 1000 }),
  ];
  const jobs = (["RDM", "SAM"] as const).map((job) => makeJob(job, {
    ringCandidates: rings,
    weaponCandidates: [equipment(job === "RDM" ? 7201 : 7202, {}, { MDMG: 160, PDMG: 160 })],
    headCandidates: [equipment(7301, {})],
    foods: [],
  }));
  const expected = oracle(jobs, ["ring"], "shared");
  assert.ok(expected);
  const candidates = jobs.map(enumerateJob);
  let geometricBest: { product: bigint; itemId: number } | undefined;
  for (const ring of rings) {
    const matching = candidates.map((list, jobIndex) => list.find((candidate) =>
      candidate.selection[jobs[jobIndex]!.slotNames.indexOf("ring")]!.itemId === ring.itemId)!);
    const product = matching[0]!.product * matching[1]!.product;
    if (geometricBest === undefined || product > geometricBest.product) geometricBest = { product, itemId: ring.itemId };
  }
  const arithmeticItemId = expected.chosen.RDM!.selection[jobs[0]!.slotNames.indexOf("ring")]!.itemId;
  assert.notEqual(arithmeticItemId, geometricBest!.itemId, "fixture must separate sum and product optima");
  const result = await runJoint(jobs, ["ring"], "shared");
  assertMatchesOracle(result, expected, jobs, ["ring"], "shared");
});

test("universal shared profiles restore identical equipment across multiple slots", async () => {
  const rings = [equipment(7401, { 1: 140, 7: 50, 2: 18, 5: 35, 8: 35 }),
    equipment(7402, { 1: 50, 7: 140, 3: 18, 5: 10, 8: 10 })];
  const heads = [equipment(7411, { 1: 70, 7: 20, 3: 35, 5: 10, 8: 10 }),
    equipment(7412, { 1: 20, 7: 70, 2: 35, 5: 35, 8: 35 })];
  const jobs = (["RDM", "SAM"] as const).map((job) => makeJob(job, {
    ringCandidates: rings, headCandidates: heads,
  }));
  for (const strategy of ["shared", "independent"] as const) {
    const expected = oracle(jobs, ["ring", "head"], strategy);
    assert.ok(expected);
    const result = await runJoint(jobs, ["ring", "head"], strategy);
    assertMatchesOracle(result, expected, jobs, ["ring", "head"], strategy);
  }
});

test("shared variants compare complete materia output and slot names map per job", async () => {
  const sameItemVariantA = equipment(1500, { 2: 35, 3: 4, 6: 12 });
  const sameItemVariantB = equipment(1500, { 2: 4, 3: 35, 6: 12 });
  const jobs = [
    makeJob("RDM", { ringCandidates: [sameItemVariantA, sameItemVariantB] }),
    makeJob("SAM", { ringCandidates: [sameItemVariantB, sameItemVariantA] }),
  ];
  const expected = oracle(jobs, ["ring"], "independent");
  assert.ok(expected);
  const result = await runJoint(jobs, ["ring"], "independent");
  assertMatchesOracle(result, expected, jobs, ["ring"], "independent");
  assert.equal(result?.commonEquipments.ring.itemId, 1500);
  assert.equal(
    equipmentIdentity(result!.commonEquipments.ring),
    equipmentIdentity(result!.jobResults.RDM!.selection[1]!),
  );
  assert.equal(
    equipmentIdentity(result!.commonEquipments.ring),
    equipmentIdentity(result!.jobResults.SAM!.selection[0]!),
  );

  const impossible = [
    makeJob("RDM", { ringCandidates: [sameItemVariantA] }),
    makeJob("SAM", { ringCandidates: [sameItemVariantB] }),
  ];
  const impossibleExpected = oracle(impossible, ["ring"], "independent");
  assert.equal(impossibleExpected, undefined);
  assert.equal(
    await runJoint(impossible, ["ring"], "independent"),
    undefined,
    "same item ID with different materia output is not one shared equipment variant",
  );

  const firstChild = equipment(1511, { 2: 18, 3: 9, 6: 5 });
  const secondChild = equipment(1512, { 2: 8, 3: 17, 6: 7 });
  const makeRingPair = (itemId: number, ringEquips: readonly EquipInfo[]) => {
    const summed: Record<number, number> = {};
    for (const child of ringEquips) {
      for (const param of child.baseParams) {
        summed[param.baseParamId] =
          (summed[param.baseParamId] ?? 0) + param.value;
      }
    }
    return Object.assign(equipment(itemId, summed), { ringEquips });
  };
  const pairAB = makeRingPair(1521, [firstChild, secondChild]);
  const pairBA = makeRingPair(1522, [secondChild, firstChild]);
  assert.notEqual(pairAB.itemId, pairBA.itemId);
  const swappedPairs = [
    makeJob("RDM", { ringCandidates: [pairAB] }),
    makeJob("SAM", { ringCandidates: [pairBA] }),
  ];
  const pairExpected = oracle(swappedPairs, ["ring"], "independent");
  assert.ok(pairExpected);
  const pairResult = await runJoint(swappedPairs, ["ring"], "independent");
  assertMatchesOracle(
    pairResult,
    pairExpected,
    swappedPairs,
    ["ring"],
    "independent",
  );
  assert.notEqual(
    pairResult!.jobResults.RDM!.selection[1]!.itemId,
    pairResult!.jobResults.SAM!.selection[0]!.itemId,
  );
});

test("single-ring projection links equal gear only by item identity inside the joint factor MIP", async () => {
  const sharedA = equipment(1531, { 2: 15, 3: 9, 6: 4 });
  const sharedB = equipment(1532, { 2: 15, 3: 9, 6: 4 });
  assert.deepEqual(sharedA.baseParams, sharedB.baseParams);
  assert.notEqual(equipmentIdentity(sharedA), equipmentIdentity(sharedB));

  const makePair = (first: EquipInfo, second: EquipInfo): EquipInfo => {
    const attributes: Record<number, number> = {};
    for (const child of [first, second]) {
      for (const param of child.baseParams) {
        attributes[param.baseParamId] =
          (attributes[param.baseParamId] ?? 0) + param.value;
      }
    }
    return Object.assign(equipment(1539, attributes), {
      ringEquips: [first, second] as const,
    });
  };

  for (const ringIndex of [0, 1] as const) {
    const rdmStrong = equipment(1541, { 1: 260, 2: 8, 3: 7, 4: 8, 5: 8, 6: 3 });
    const rdmWeak = equipment(1542, { 1: 20, 2: 8, 3: 7, 4: 8, 5: 8, 6: 3 });
    const samWeak = equipment(1543, { 7: 20, 2: 8, 3: 7, 4: 8, 8: 8, 6: 3 });
    const samStrong = equipment(1544, { 7: 260, 2: 8, 3: 7, 4: 8, 8: 8, 6: 3 });
    const pair = (common: EquipInfo, filler: EquipInfo) =>
      ringIndex === 0 ? makePair(common, filler) : makePair(filler, common);
    const jobs = [
      makeJob("RDM", {
        ringCandidates: [pair(sharedA, rdmStrong), pair(sharedB, rdmWeak)],
        weaponCandidates: [localCandidates("RDM", "weapon")[0]!],
        headCandidates: [localCandidates("RDM", "head")[0]!],
        foods: [],
      }),
      makeJob("SAM", {
        ringCandidates: [pair(sharedA, samWeak), pair(sharedB, samStrong)],
        weaponCandidates: [localCandidates("SAM", "weapon")[0]!],
        headCandidates: [localCandidates("SAM", "head")[0]!],
        foods: [],
      }),
    ];
    const commonSlot = ringIndex === 0 ? "ring1" : "ring2";
    const projections: readonly SharedSlotProjection[] = [
      { commonSlot, slotName: "ring", ringIndex },
    ];
    const rdmOptimum = oracle([jobs[0]!], [], "independent")!.optima.RDM!;
    const samOptimum = oracle([jobs[1]!], [], "independent")!.optima.SAM!;
    assert.notEqual(
      equipmentIdentity(commonSlotEquipment(rdmOptimum.selection[1]!, commonSlot, projections)),
      equipmentIdentity(commonSlotEquipment(samOptimum.selection[0]!, commonSlot, projections)),
      "the independent optima must require different same-stat ring identities",
    );

    const expected = oracle(jobs, [commonSlot], "independent", "damage", projections);
    assert.ok(expected);
    const result = await runJoint(jobs, [commonSlot], "independent", {
      commonSlotProjections: projections,
    });
    assertMatchesOracle(
      result,
      expected,
      jobs,
      [commonSlot],
      "independent",
      "damage",
      projections,
    );
    assert.ok(
      result!.statistics.completeNodes >= 1,
      "the complete joint factor model must validate a shared ring identity",
    );
  }
});

test("V3 DPS objective matches exact exhaustive normalized DPS for no-GCD shared accessories", async () => {
  for (const pair of [
    ["RPR", "SAM"],
    ["VPR", "MCH"],
  ] as const) {
    const jobs = pair.map((job) => makeJob(job));
    for (const strategy of ["shared", "independent"] as const) {
      const expected = oracle(jobs, ["ring"], strategy, "dps");
      assert.ok(expected);
      const result = await runJoint(jobs, ["ring"], strategy, {
        objective: "dps",
      });
      assertMatchesOracle(result, expected, jobs, ["ring"], strategy, "dps");
    }
  }
});

test("V3 keeps a PCT union of exact GCD choices through shared-equipment DPS optimization", async () => {
  const commonRings = [
    equipment(4011, { 2: 37, 3: 8, 4: 17, 6: 7 }),
    equipment(4012, { 2: 8, 3: 38, 4: 6, 6: 9 }),
  ];
  const commonHeads = [
    equipment(4021, { 2: 35, 3: 7, 4: 14, 5: 0, 6: 6 }),
    equipment(4022, { 2: 7, 3: 36, 4: 5, 5: 0, 6: 8 }),
  ];
  const rdmWeapons = [
    equipment(
      4031,
      { 1: 570, 2: 150, 3: 23, 4: 15, 5: 120, 6: 8 },
      { MDMG: 160 },
    ),
    equipment(
      4032,
      { 1: 550, 2: 25, 3: 41, 4: 20, 5: 120, 6: 20 },
      { MDMG: 158 },
    ),
  ];
  const pctWeapons = [
    equipment(4041, { 1: 570, 2: 42, 3: 23, 4: 15, 5: 0, 6: 8 }, { MDMG: 160 }),
    equipment(
      4042,
      { 1: 570, 2: 25, 3: 41, 4: 20, 5: 120, 6: 20 },
      { MDMG: 158 },
    ),
  ];
  const jobs = [
    makeJob("RDM", {
      weaponCandidates: rdmWeapons,
      ringCandidates: [commonRings[0]!],
      headCandidates: [commonHeads[0]!],
      constraints: { gcd: 2.48 },
    }),
    makeJob("PCT", {
      weaponCandidates: pctWeapons,
      ringCandidates: commonRings,
      headCandidates: commonHeads,
      constraints: { gcdChoices: [2.48, 2.5] },
    }),
  ];
  const expected = oracle(jobs, ["ring", "head"], "shared", "dps");
  assert.ok(
    expected,
    "fixture should have feasible gear at both PCT GCD ranges",
  );
  const result = await runJoint(jobs, ["ring", "head"], "shared", {
    objective: "dps",
  });
  assertMatchesOracle(
    result,
    expected,
    jobs,
    ["ring", "head"],
    "shared",
    "dps",
  );

  const pct = jobs[1]!;
  const gcdOf = (loadout: ExactMipResult) =>
    pct.options.evaluationFunction(vectorFor(loadout.selection, loadout.food))!
      .gcd;
  assert.equal(Math.round(gcdOf(result!.jobResults.RDM!) * 100) / 100, 2.48);
  assert.ok(
    [2.48, 2.5].includes(
      Math.round(gcdOf(result!.jobResults.PCT!) * 100) / 100,
    ),
  );
  const soloPctGcd = Math.round(gcdOf(result!.optima.PCT!) * 100) / 100;
  const jointPctGcd = Math.round(gcdOf(result!.jobResults.PCT!) * 100) / 100;
  assert.notEqual(
    jointPctGcd,
    soloPctGcd,
    "PCT's best allowed GCD should depend on the shared ring/head choice in this fixture",
  );
});

test("V3 excludes a higher-damage forbidden middle GCD and intersects speed bounds with a GCD union", async () => {
  const level = 100 as JobLevel;
  const rangeFor = (job: JobCode, gcd: number) =>
    equippedSpeedRangeForGcd(job as Job, level, gcd);
  const pct248 = rangeFor("PCT", 2.48);
  const pct249 = rangeFor("PCT", 2.49);
  const pct250 = rangeFor("PCT", 2.5);
  const rdm248 = rangeFor("RDM", 2.48);
  assert.ok(pct248 && pct249 && pct250 && rdm248);

  const commonRing = equipment(4051, {});
  const commonHead = equipment(4052, {});
  const rdmWeapon = equipment(
    4053,
    { 1: 520, 2: 40, 3: 35, 4: 10, 5: rdm248.min },
    { MDMG: 155 },
  );
  const pctWeapons = [
    equipment(
      4054,
      { 1: 510, 2: 40, 3: 35, 4: 10, 5: pct248.min },
      { MDMG: 155 },
    ),
    equipment(
      4055,
      { 1: 590, 2: 150, 3: 125, 4: 20, 5: pct249.min },
      { MDMG: 175 },
    ),
    equipment(
      4056,
      { 1: 510, 2: 40, 3: 35, 4: 10, 5: pct250.min },
      { MDMG: 155 },
    ),
  ];
  const pctUnconstrained = makeJob("PCT", {
    weaponCandidates: pctWeapons,
    ringCandidates: [commonRing],
    headCandidates: [commonHead],
    foods: [],
  });
  const allPctCandidates = enumerateJob(pctUnconstrained);
  const middleCandidate = allPctCandidates.find(
    (candidate) => candidate.selection[0]!.itemId === 4055,
  );
  assert.ok(middleCandidate);
  assert.equal(Math.round(middleCandidate.gcd * 100) / 100, 2.49);
  assert.ok(
    allPctCandidates
      .filter((candidate) => candidate.selection[0]!.itemId !== 4055)
      .every((candidate) => candidate.product < middleCandidate.product),
    "the forbidden 2.49 weapon must have the highest exact DAMAGE score before constraints",
  );

  const makeJobs = (pctConstraints: ExactMipOptions["constraints"]) => [
    makeJob("RDM", {
      weaponCandidates: [rdmWeapon],
      ringCandidates: [commonRing],
      headCandidates: [commonHead],
      foods: [],
      constraints: { gcd: 2.48 },
    }),
    makeJob("PCT", {
      weaponCandidates: pctWeapons,
      ringCandidates: [commonRing],
      headCandidates: [commonHead],
      foods: [],
      constraints: pctConstraints,
    }),
  ];
  const commonSlots = ["ring", "head"] as const;
  const union = { gcdChoices: [2.48, 2.5] };
  const jobs = makeJobs(union);
  const expected = oracle(jobs, commonSlots, "shared", "damage");
  assert.ok(expected);
  const result = await runJoint(jobs, commonSlots, "shared", {
    objective: "damage",
  });
  assertMatchesOracle(result, expected, jobs, commonSlots, "shared", "damage");
  const selectedPct = result!.jobResults.PCT!;
  const selectedPctGcd = jobs[1]!.options.evaluationFunction(
    vectorFor(selectedPct.selection, selectedPct.food),
  )!.gcd;
  assert.ok([2.48, 2.5].includes(Math.round(selectedPctGcd * 100) / 100));
  assert.notEqual(selectedPct.selection[0]!.itemId, 4055);

  const only248Jobs = makeJobs({
    ...union,
    speedMin: pct248.min,
    speedMax: pct248.max,
  });
  const only248Expected = oracle(only248Jobs, commonSlots, "shared", "damage");
  assert.ok(only248Expected);
  const only248Result = await runJoint(only248Jobs, commonSlots, "shared", {
    objective: "damage",
  });
  assertMatchesOracle(
    only248Result,
    only248Expected,
    only248Jobs,
    commonSlots,
    "shared",
    "damage",
  );
  const only248Pct = only248Result!.jobResults.PCT!;
  const only248Gcd = only248Jobs[1]!.options.evaluationFunction(
    vectorFor(only248Pct.selection, only248Pct.food),
  )!.gcd;
  assert.equal(Math.round(only248Gcd * 100) / 100, 2.48);
  const only248Speed = only248Pct.selection[0]!.baseParams.find(
    (param) => param.baseParamId === 5,
  )!.value;
  assert.ok(only248Speed >= pct248.min && only248Speed <= pct248.max);

  const forbiddenOnlyJobs = makeJobs({
    ...union,
    speedMin: pct249.min,
    speedMax: pct249.max,
  });
  assert.equal(
    oracle(forbiddenOnlyJobs, commonSlots, "shared", "damage"),
    undefined,
    "speed bounds limited to 2.49 must be infeasible when the allowed union is 2.48 or 2.50",
  );
  assert.equal(
    await runJoint(forbiddenOnlyJobs, commonSlots, "shared", {
      objective: "damage",
    }),
    undefined,
  );
});

test("V3 keeps V2 GCD and toughness constraints while optimizing normalized DAMAGE", async () => {
  const unconstrained = makeJob("RDM", { foods: [] });
  const all = enumerateJob(unconstrained);
  const gcdCounts = new Map<number, Candidate[]>();
  for (const candidate of all) {
    const centiseconds = Math.round(candidate.gcd * 100);
    gcdCounts.set(centiseconds, [
      ...(gcdCounts.get(centiseconds) ?? []),
      candidate,
    ]);
  }
  const selected = [...gcdCounts.values()].find(
    (candidates) =>
      candidates.length > 1 &&
      new Set(candidates.map((candidate) => candidate.attributes[6])).size > 1,
  );
  assert.ok(
    selected,
    "fixture must contain a GCD bucket with different toughness values",
  );
  const gcd = Math.round(selected[0]!.gcd * 100) / 100;
  const toughValues = selected.map((candidate) => candidate.attributes[6]);
  const constraints = {
    gcd,
    toughMin: Math.min(...toughValues) + 1,
  };
  const job = makeJob("RDM", { foods: [], constraints });
  const expected = oracle([job], [], "independent");
  assert.ok(expected);
  const result = await runJoint([job], [], "independent");
  assertMatchesOracle(result, expected, [job], [], "independent");
  const chosen = result!.jobResults.RDM!;
  const attributes = vectorFor(chosen.selection, chosen.food);
  const speedIndex = job.options.attributeIds.indexOf(
    job.options.speedAttributeId!,
  );
  const range = job.options.gcdToSpeedRange!(gcd)!;
  assert.ok(
    attributes[speedIndex]! >= range.min &&
      attributes[speedIndex]! <= range.max,
  );
  assert.ok(
    attributes[
      job.options.attributeIds.indexOf(job.options.toughnessAttributeId!)
    ]! >= constraints.toughMin,
  );
});

test("max-toughness mode retains each solo maximum under shared-slot restrictions", async () => {
  const toughRings = [
    equipment(1601, { 2: 20, 3: 9, 6: 36 }),
    equipment(1602, { 2: 7, 3: 29, 6: 2 }),
  ];
  const jobs = [
    makeJob("RDM", {
      ringCandidates: toughRings,
      foods: [],
      constraints: { maxToughnessMode: true },
    }),
    makeJob("SAM", {
      ringCandidates: toughRings,
      foods: [],
      constraints: { maxToughnessMode: true },
    }),
  ];
  const expected = oracle(jobs, ["ring"], "independent");
  assert.ok(expected);
  const result = await runJoint(jobs, ["ring"], "independent");
  assertMatchesOracle(result, expected, jobs, ["ring"], "independent");
  for (const job of jobs) {
    assert.equal(
      result!.optima[job.id]!.maximumToughness,
      expected.maximumToughness[job.id],
    );
  }
});

test("V3 returns no result for infeasible constraints or incompatible shared food", async () => {
  const impossibleGcd = makeJob("RDM", {
    foods: [],
    constraints: { gcd: 1.01 },
  });
  assert.equal(await runJoint([impossibleGcd], [], "independent"), undefined);

  const firstFood = food(9901, [2, 3, 5]);
  const secondFood = food(9902, [1, 4, 9]);
  const foodConflict = [
    makeJob("RDM", { foods: [firstFood] }),
    makeJob("SAM", { foods: [secondFood] }),
  ];
  assert.equal(await runJoint(foodConflict, [], "shared"), undefined);
  const independent = await runJoint(foodConflict, [], "independent");
  assert.ok(independent);
  assert.notEqual(
    foodIdentity(independent.jobResults.RDM!.food),
    foodIdentity(independent.jobResults.SAM!.food),
  );
});

test("zero solo DAMAGE normalization and empty food lists remain finite and usable", async () => {
  const zeroDamage = makeJob("RDM", {
    foods: [],
    damageOverride: (attributes) => ({
      damage: 0,
      gcd: createDamageGcdVectorEvaluator(
        "RDM" as Job,
        100 as JobLevel,
        jobStatIndexes("RDM"),
        new Array(attributeIds.length).fill(10_000),
      )(attributes)!.gcd,
    }),
  });
  const zeroExpected = oracle([zeroDamage], [], "independent");
  assert.ok(zeroExpected);
  const zeroResult = await runJoint([zeroDamage], [], "independent");
  assert.ok(zeroResult);
  assert.ok(Number.isFinite(zeroResult.value.approximate));
  assert.equal(zeroResult.value.approximate, 0);
  assert.equal(zeroResult.optima.RDM!.damage, 0);

  const noFoodJob = makeJob("WHM", { foods: [] });
  const noFoodExpected = oracle([noFoodJob], [], "independent");
  assert.ok(noFoodExpected);
  const noFoodResult = await runJoint([noFoodJob], [], "independent");
  assertMatchesOracle(
    noFoodResult,
    noFoodExpected,
    [noFoodJob],
    [],
    "independent",
  );
  assert.equal(noFoodResult!.jobResults.WHM!.food, undefined);
  const noFoodShared = await runJoint([noFoodJob], [], "shared");
  assert.ok(noFoodShared);
  assert.equal(noFoodShared.jobResults.WHM!.food, undefined);
});

test("inactive jobs still branch on a conflicting shared-slot relaxation", async () => {
  const intRing = equipment(9911, { 1: 80, 2: 5 });
  const strRing = equipment(9912, { 7: 80, 3: 5 });
  const zeroDamageJob = (job: "RDM" | "SAM", ringCandidates: readonly EquipInfo[]) =>
    makeJob(job, {
      slotNames: ["ring"],
      ringCandidates,
      foods: [],
      damageOverride: (attributes) => ({
        damage: 0,
        gcd: createDamageGcdVectorEvaluator(
          job as Job,
          100 as JobLevel,
          jobStatIndexes(job),
          new Array(attributeIds.length).fill(10_000),
        )(attributes)!.gcd,
      }),
    });
  const jobs = [
    zeroDamageJob("RDM", [intRing, strRing]),
    zeroDamageJob("SAM", [strRing, intRing]),
  ];

  const result = await runJoint(jobs, ["ring"], "independent");

  assert.ok(result);
  assert.equal(result.value.approximate, 0);
  assert.ok(result.statistics.outerNodes >= 2, "the shared-slot disagreement should recurse once");
  assert.ok(result.statistics.completeNodes >= 1);
});

test("V3 refuses to return a partial result when the proof deadline expires", async () => {
  const manySharedCandidates = Array.from({ length: 24 }, (_, index) =>
    equipment(1700 + index, {
      2: index * 2,
      3: 46 - index,
      4: (index * 7) % 31,
      6: index % 5,
    }),
  );
  const jobs = [
    makeJob("RDM", { ringCandidates: manySharedCandidates, foods: [] }),
    makeJob("SAM", { ringCandidates: manySharedCandidates, foods: [] }),
  ];
  await assert.rejects(
    runJoint(jobs, ["ring"], "independent", { maxSearchMs: 1 }),
    /时限|timeout|timed out|optimal|证明|deadline/i,
  );
});

test("V3 observes cancellation requested by the baseline progress callback", async () => {
  const job = makeJob("RDM", { foods: [] });
  let cancelled = false;

  await assert.rejects(
    findBestJointLoadoutV3({
      jobs: [{ id: job.id, slotNames: job.slotNames, options: job.options }],
      commonSlots: [],
      foodStrategy: "independent",
      onProgress: () => { cancelled = true; },
      isCancelled: () => cancelled,
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});


test("V3 rejects malformed search inputs before accepting a proof", async () => {
  const job = makeJob("RDM");
  const valid = { jobs: [job], commonSlots: [] as string[], foodStrategy: "independent" as const };
  for (const patch of [
    { maxSearchMs: 0 },
    { maxSearchMs: Infinity },
    { cacheLimit: -1 },
    { cacheLimit: 50_001 },
    { cacheLimit: 0.5 },
    { objective: "unknown" as never },
    { foodStrategy: "unknown" as never },
    { jobs: [] },
    { jobs: [job, job] },
    { commonSlots: ["ring", "ring"] },
    { commonSlots: ["missing"] },
  ]) {
    await assert.rejects(findBestJointLoadoutV3({ ...valid, ...patch }), RangeError);
  }
  for (const malformed of [
    { ...job, id: "" },
    { ...job, slotNames: [] },
    { ...job, slotNames: job.slotNames.map(() => "ring") },
    { ...job, options: { ...job.options, attributeIds: [1, 1] } },
  ]) await assert.rejects(findBestJointLoadoutV3({ ...valid, jobs: [malformed] }), RangeError);
  await assert.rejects(findBestJointLoadoutV3({ ...valid, isCancelled: () => true }), /取消|cancel/i);
  const cancelledJob = {
    ...job,
    options: { ...job.options, isCancelled: () => true },
  };
  await assert.rejects(
    findBestJointLoadoutV3({ ...valid, jobs: [cancelledJob] }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  const invalidProjectionCases: {
    commonSlots: string[];
    projections: readonly SharedSlotProjection[];
    error: RegExp;
  }[] = [
    {
      commonSlots: [],
      projections: [{ commonSlot: "ring1", slotName: "ring", ringIndex: 0 }],
      error: /不在 commonSlots 中/,
    },
    {
      commonSlots: ["ring1"],
      projections: [{ commonSlot: "ring1", slotName: "", ringIndex: 0 }],
      error: /投影 ring1 无效/,
    },
    {
      commonSlots: ["ring1"],
      projections: [{ commonSlot: "ring1", slotName: "ring", ringIndex: 2 as never }],
      error: /投影 ring1 无效/,
    },
    {
      commonSlots: ["ring1"],
      projections: [
        { commonSlot: "ring1", slotName: "ring", ringIndex: 0 },
        { commonSlot: "ring1", slotName: "ring", ringIndex: 1 },
      ],
      error: /有重复投影/,
    },
    {
      commonSlots: ["ring1", "ring2"],
      projections: [
        { commonSlot: "ring1", slotName: "ring", ringIndex: 0 },
        { commonSlot: "ring2", slotName: "ring", ringIndex: 0 },
      ],
      error: /重复指向 ring:0/,
    },
    {
      commonSlots: ["ring", "ring1"],
      projections: [{ commonSlot: "ring1", slotName: "ring", ringIndex: 0 }],
      error: /与其共享投影不能同时选择/,
    },
  ];
  for (const { commonSlots, projections, error } of invalidProjectionCases) {
    await assert.rejects(
      findBestJointLoadoutV3({
        ...valid,
        jobs: [job],
        commonSlots,
        commonSlotProjections: projections,
      }),
      error,
    );
  }
  await assert.rejects(
    findBestJointLoadoutV3({
      ...valid,
      jobs: [job],
      commonSlots: ["ring1"],
      commonSlotProjections: [{ commonSlot: "ring1", slotName: "missing", ringIndex: 0 }],
    }),
    /不存在/,
  );
  await assert.rejects(
    findBestJointLoadoutV3({
      ...valid,
      jobs: [job],
      commonSlots: ["ring1"],
      commonSlotProjections: [{ commonSlot: "ring1", slotName: "ring", ringIndex: 0 }],
    }),
    /缺少对应戒指/,
  );
  assert.equal(await findBestJointLoadoutV3({ ...valid, jobs: [{ ...job, options: { ...job.options, slots: [[]] }, slotNames: ["weapon"] }] }), undefined);
});
