import { parentPort, workerData } from "node:worker_threads";
import {
  createDamageGcdVectorEvaluator,
  equippedAttributeTier,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "../equipped-effects.ts";
import { LoadoutFinderV2 } from "./loadout-finder-v2.ts";

const {
  job,
  jobLevel,
  attributeIds,
  statIndexes,
  maxContributions,
  slots,
  foods,
  constraints,
  tierStats,
  primaryStatId,
  speedAttributeId,
  toughnessAttributeId,
  weaponDamageStat,
  weaponDamageId,
  partitionIndex,
  partitionCount,
  debug,
  suffixPrefixGridUpperBound,
  suffixPrefixGridSize,
  prefixFrontierBatch,
  suffixSumNecessaryBound,
  prefixSuffixBlockUpperBound,
  suffixPairAttributes,
  suffixPairStride,
  suffixPrefixTierLookup,
  suffixFutureTierCompression,
  suffixFrontierSlotCount,
  suffixFrontierMaxCombinations,
  compactDominance,
  abortFlag,
} = workerData;
const abortView = abortFlag === undefined ? undefined : new Int32Array(abortFlag);
const indexes = new Map(statIndexes);
const evaluate = createDamageGcdVectorEvaluator(job, jobLevel, indexes, maxContributions);
const attributeIndex = new Set(attributeIds);
const tierProjectors = new Map(
  tierStats.map(([attributeId, stat]) => [
    attributeId,
    (value) => equippedAttributeTier(job, jobLevel, stat, value),
  ]),
);
const finder = new LoadoutFinderV2(
  (attributes) => evaluate(attributes)?.damage ?? Number.NEGATIVE_INFINITY,
  attributeIds.length,
  speedAttributeId,
  toughnessAttributeId,
  {
    attributeIds,
    greedyPriorityAttributeIds: [primaryStatId, ...tierStats
      .map(([attributeId]) => attributeId)
      .filter((attributeId) => attributeId !== primaryStatId)],
    attributeTierProjectors: tierProjectors,
    equipmentAttributeExtractor: (equipment) => [
      ...equipment.baseParams.filter((param) => attributeIndex.has(param.baseParamId)),
      { baseParamId: weaponDamageId, value: equipment[weaponDamageStat] },
    ],
    evaluationFunction: evaluate,
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd(job, jobLevel, gcd),
    toughnessPercentToMinimum: (percentage) =>
      equippedToughnessForMitigationPercent(job, jobLevel, percentage),
    shouldAbort: () => abortView !== undefined && Atomics.load(abortView, 0) !== 0,
    combinedDamageFunction: constraints.gcd === undefined
      ? evaluate.combinedDps
      : evaluate.combinedDamage,
    combinedDamageFlatFunction: constraints.gcd === undefined
      ? evaluate.combinedDpsFlat
      : evaluate.combinedDamageFlat,
    maxCombinedDamageFlat: constraints.gcd === undefined
      ? evaluate.maxCombinedDpsFlat
      : evaluate.maxCombinedDamageFlat,
    maxCombinedDamageFlatColumnsFunction: constraints.gcd === undefined
      ? evaluate.maxCombinedDpsFlatColumns
      : evaluate.maxCombinedDamageFlatColumns,
    maxCombinedDamageFlatBatch: constraints.gcd === undefined
      ? evaluate.maxCombinedDpsFlatBatch
      : evaluate.maxCombinedDamageFlatBatch,
    suffixPrefixGridUpperBound: suffixPrefixGridUpperBound === true,
    suffixPrefixGridSize: suffixPrefixGridSize === undefined || suffixPrefixGridSize === ""
      ? undefined
      : Number(suffixPrefixGridSize),
    prefixFrontierBatch: prefixFrontierBatch === true,
    suffixSumNecessaryBound: suffixSumNecessaryBound !== false,
    prefixSuffixBlockUpperBound: prefixSuffixBlockUpperBound === true,
    suffixPairAttributes,
    suffixPairStride:
      suffixPairStride === undefined ? undefined : Number(suffixPairStride),
    suffixPrefixTierLookup: suffixPrefixTierLookup === true,
    suffixFutureTierCompression: suffixFutureTierCompression === true,
    suffixFrontierSlotCount:
      suffixFrontierSlotCount === undefined ? undefined : Number(suffixFrontierSlotCount),
    suffixFrontierMaxCombinations:
      suffixFrontierMaxCombinations === undefined
        ? undefined
        : Number(suffixFrontierMaxCombinations),
    compactDominance: compactDominance !== false,
    combinedDamageUpperBoundFunction: constraints.gcd === undefined
      ? evaluate.combinedDpsUpperBound
      : evaluate.combinedDamageUpperBound,
    debug,
    debugLabel: `V2-worker-${partitionIndex}`,
  },
);
const result = finder.findBest(slots, foods, constraints);
const objectiveScore = (() => {
  if (result === undefined) return Number.NEGATIVE_INFINITY;
  const attributes = new Array(attributeIds.length).fill(0);
  for (const equipment of result.selection) {
    for (const param of equipment.baseParams) {
      const index = attributeIds.indexOf(param.baseParamId);
      if (index >= 0) attributes[index] += param.value;
    }
  }
  if (result.food !== undefined) {
    for (const param of result.food.baseParams) {
      const index = attributeIds.indexOf(param.baseParamId);
      if (index >= 0) {
        attributes[index] += Math.min(
          param.maxValue,
          Math.trunc(attributes[index] * (param.multiplier - 1) + 1e-7),
        );
      }
    }
  }
  const evaluation = evaluate(attributes);
  if (evaluation === undefined || !Number.isFinite(evaluation.damage)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (constraints.gcd === undefined) {
    return evaluation.gcd > 0 && Number.isFinite(evaluation.gcd)
      ? evaluation.damage / evaluation.gcd
      : Number.NEGATIVE_INFINITY;
  }
  return evaluation.damage;
})();
parentPort.postMessage({ result, objectiveScore, statistics: finder.statistics });
