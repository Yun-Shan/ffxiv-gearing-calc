import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
} from "../equipped-effects.ts";
import type { ExactMipResult } from "../loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import type { Stat } from "../../types.ts";
import type {
  CommonChoice,
  JobContext,
  JointLoadoutV3Options,
  MutableStatistics,
} from "./types.ts";
import { buildRawAttributes, applyFood } from "./attributes.ts";
import { integerDamageProduct } from "./score.ts";
import { equipmentIdentity } from "../equipment-identity.ts";

export function equip(
  itemId: number,
  values: readonly number[] = [100, 3000, 400, 300, 200, 100, 0],
  extra: Partial<EquipInfo> = {},
): EquipInfo {
  return {
    itemId,
    itemLevel: 795,
    key: `${itemId}:${values.join(",")}`,
    baseParams: values.map((value, i) => ({ baseParamId: i + 1, value })),
    PDMG: values[0] ?? 0,
    MDMG: 0,
    DLY: 3,
    ...extra,
  };
}

export function food(
  itemId: number,
  baseParamId: number,
  multiplier = 1.1,
  maxValue = 10,
): FoodInfo {
  return {
    itemId,
    itemLevel: 795,
    key: String(itemId),
    baseParams: [{ baseParamId, multiplier, maxValue }],
  };
}

export function resultFor(
  context: JobContext,
  selection: readonly EquipInfo[],
  selectedFood?: FoodInfo,
): ExactMipResult {
  const evaluation = context.job.options.evaluationFunction(
    applyFood(
      buildRawAttributes(context, selection),
      selectedFood,
      context.attributeIndexes,
    ),
  )!;
  return {
    selection: [...selection],
    food: selectedFood,
    damage: evaluation.damage,
    statistics: {
      elapsedMs: 1,
      solverRuns: 1,
      excludedSignatures: 0,
      signatureBandChecks: 0,
      signatureBandElapsedMs: 0,
      signatureBandProof: true,
      variables: 0,
      constraints: 0,
      maximumSurrogate: 0,
      nextSurrogate: undefined,
      memoryUsage: {},
    },
  };
}

export function contextFor(
  slots: readonly (readonly EquipInfo[])[] = [[equip(1)]],
  names: readonly string[] = ["body"],
  id = "SAM",
): JobContext {
  const statIndexes = new Map<Stat, number>([
    ["PDMG", 0],
    ["STR", 1],
    ["CRT", 2],
    ["DET", 3],
    ["DHT", 4],
    ["SKS", 5],
    ["TEN", 6],
  ]);
  const context: JobContext = {
    job: {
      id,
      slotNames: names,
      options: {
        job: "SAM",
        jobLevel: 100,
        attributeIds: [1, 2, 3, 4, 5, 6, 7],
        statIndexes,
        slots,
        foods: [],
        speedAttributeId: 6,
        toughnessAttributeId: 7,
        evaluationFunction: createDamageGcdVectorEvaluator(
          "SAM",
          100,
          statIndexes,
        ),
      },
    },
    solverSlots: slots,
    indexByName: new Map(names.map((name, i) => [name, i])),
    factorEvaluator: createIntegerDamageFactorEvaluator(
      "SAM",
      100,
      statIndexes,
    ),
    attributeIndexes: new Map([1, 2, 3, 4, 5, 6, 7].map((id, i) => [id, i])),
    equipAttributes: new WeakMap(),
    optimum: undefined as unknown as ExactMipResult,
    optimumProduct: 0n,
    optimumGcd: 0,
    active: true,
    constraints: undefined,
  };
  context.optimum = resultFor(
    context,
    slots.map((slot) => slot[0]!),
  );
  const factors = context.factorEvaluator(
    buildRawAttributes(context, context.optimum.selection),
  )!;
  context.optimumProduct = integerDamageProduct(factors);
  context.optimumGcd = factors.gcdCentiseconds;
  return context;
}

export function choice(
  contexts: readonly JobContext[],
  equipment: EquipInfo,
): CommonChoice {
  return {
    key: equipmentIdentity(equipment),
    equipments: new Map(contexts.map((context) => [context.job.id, equipment])),
  };
}

export function optionsFor(
  contexts: readonly JobContext[],
): JointLoadoutV3Options {
  return {
    jobs: contexts.map((context) => context.job),
    commonSlots: ["body"],
    foodStrategy: "independent",
  };
}

export function statistics(): MutableStatistics {
  return {
    outerNodes: 0,
    completeNodes: 0,
    upperBoundPrunes: 0,
    relaxedOptimaAttained: 0,
    innerSolves: 0,
    parentResultReuses: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEntries: 0,
  };
}
