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
type SlotName = "weapon" | "ring" | "head";
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
  name: Exclude<SlotName, "ring">,
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
