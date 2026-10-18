import { jobSchemas } from "../jobs.ts";
import { calculateBaseStats, getSpeedStat } from "../rules.ts";
import {
  equippedEffects,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "../search/equipped-effects.ts";
import {
  findBestLoadoutExactMip,
  type ExactMipOptions,
} from "../search/loadout-finder-exact-mip.ts";
import type { LinearMipProgress } from "../search/linear-mip.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "../search/exact-mip-candidate-upper-bound.ts";
import type {
  Food,
  JobId,
  MeldedGear,
  OptimizationConfig,
  SearchOptions,
  Stat,
  Stats,
} from "../types.ts";
import { calculationJobLevelFor } from "../gear-options.ts";
import {
  attributeIds,
  attributeIndex,
  jobSlots,
  statIndexes,
  throwIfAborted,
  type PreparedSearch,
  type SearchSlot,
  type SolverFood,
} from "./context.ts";
import {
  candidatePools,
  createFoodInfo,
  foodIdentity,
  foodsFor,
} from "./equipment-candidates.ts";

function makeExactOptions(
  config: OptimizationConfig,
  jobLevel: number,
  slots: SearchSlot[],
  solverFoods: SolverFood[],
  options: SearchOptions,
): ExactMipOptions {
  const jobId = config.jobId;
  const schema = jobSchemas[jobId];
  const clanIndex = config.clanIndex ?? 0;
  const speedStat = getSpeedStat(schema);
  const toughnessAttributeId = schema.stats.includes("TEN")
    ? attributeIndex.get("TEN")
    : undefined;
  const speedAttributeId = attributeIndex.get(speedStat);
  if (speedAttributeId === undefined)
    throw new Error(`职业 ${jobId} 缺少 ${speedStat} 搜索坐标`);
  const baseStats = calculateBaseStats(schema, jobLevel, clanIndex);
  const constraints = {
    ...(config.gcdTarget !== undefined ? { gcd: config.gcdTarget } : {}),
    ...(config.gcdChoices !== undefined
      ? { gcdChoices: config.gcdChoices }
      : {}),
    ...(config.speedMin !== undefined
      ? { speedMin: Math.max(0, config.speedMin - (baseStats[speedStat] ?? 0)) }
      : {}),
    ...(config.speedMax !== undefined
      ? { speedMax: config.speedMax - (baseStats[speedStat] ?? 0) }
      : {}),
    ...((config.minTenacity ?? config.toughnessMin) !== undefined
      ? {
          toughMin: Math.max(
            0,
            (config.minTenacity ?? config.toughnessMin ?? 0) -
              (baseStats.TEN ?? 0),
          ),
        }
      : {}),
    ...(config.toughnessMinPercent !== undefined
      ? { toughnessMinPercent: config.toughnessMinPercent }
      : {}),
    ...(config.maximizeTenacity ? { maxToughnessMode: true } : {}),
  };
  const candidateItemLevelRanges = [
    { min: config.maxItemLevel - 20, max: config.maxItemLevel },
    ...(config.syncLevel === undefined
      ? []
      : [{ min: config.syncLevel - 20, max: config.syncLevel }]),
  ]
    .map(({ min, max }) => ({
      min: Math.max(config.minItemLevel, min),
      max: Math.min(config.maxItemLevel, max),
    }))
    .filter(({ min, max }) => min <= max)
    .sort((left, right) => left.min - right.min || left.max - right.max)
    .reduce<{ min: number; max: number }[]>((ranges, next) => {
      const previous = ranges.at(-1);
      if (previous !== undefined && next.min <= previous.max + 1) {
        previous.max = Math.max(previous.max, next.max);
      } else {
        ranges.push({ ...next });
      }
      return ranges;
    }, []);
  const usesToughness =
    config.minTenacity !== undefined ||
    config.toughnessMin !== undefined ||
    config.toughnessMinPercent !== undefined ||
    config.maximizeTenacity;
  if (usesToughness && toughnessAttributeId === undefined) {
    throw new RangeError(`职业 ${jobId} 不使用坚韧属性`);
  }
  return markCanonicalEvaluatorCandidateUpperBound({
    job: jobId,
    jobLevel,
    clanIndex,
    attributeIds,
    statIndexes,
    slots: slots.map((slot) => slot.candidates),
    foods: solverFoods,
    ...(candidateItemLevelRanges.length === 0
      ? {}
      : { candidateItemLevelRanges }),
    constraints,
    speedAttributeId,
    ...(toughnessAttributeId !== undefined ? { toughnessAttributeId } : {}),
    gcdToSpeedRange: (gcd) => equippedSpeedRangeForGcd(jobId, jobLevel, gcd, clanIndex),
    ...(toughnessAttributeId !== undefined
      ? {
          toughnessPercentToMinimum: (percent: number) =>
            equippedToughnessForMitigationPercent(jobId, jobLevel, percent, clanIndex),
        }
      : {}),
    evaluationFunction: (attributes) => {
      const contributions: Stats = {};
      for (const [stat, index] of attributeIndex)
        contributions[stat] = attributes[index] ?? 0;
      const effects = equippedEffects(jobId, jobLevel, contributions, clanIndex);
      return effects === undefined
        ? undefined
        : { damage: effects.damage, gcd: effects.gcd };
    },
    objective: config.objective ?? "damage",
    ...(config.maxSearchMs !== undefined
      ? { maxSearchMs: config.maxSearchMs }
      : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.onSolverProgress
      ? {
          onSolverProgress: (event: LinearMipProgress) => {
            if (event.kind !== "log" || event.message?.startsWith("PROFILE ")) {
              options.onSolverProgress?.(event);
            }
          },
        }
      : {}),
    ...(options.onSolverCallback
      ? { onSolverCallback: options.onSolverCallback }
      : {}),
    isCancelled: () => options.signal?.aborted === true,
  });
}

export function prepareSearch(
  config: OptimizationConfig,
  options: SearchOptions,
  preserveRingOrder = false,
  independentRingSlots = true,
  paretoSlots?: ReadonlySet<string>,
  paretoIndependentRings = false,
): PreparedSearch {
  throwIfAborted(options.signal);
  if (
    !Number.isSafeInteger(config.minItemLevel) ||
    !Number.isSafeInteger(config.maxItemLevel) ||
    config.minItemLevel > config.maxItemLevel
  ) {
    throw new RangeError("装备品级范围无效");
  }
  if (
    config.syncLevel !== undefined &&
    (!Number.isSafeInteger(config.syncLevel) || config.syncLevel <= 0)
  ) {
    throw new RangeError("等级同步品级必须是正整数");
  }
  const gearsByIdentity = new Map<string, MeldedGear>();
  const candidatePoolsResult = candidatePools(
    config,
    gearsByIdentity,
    preserveRingOrder,
    independentRingSlots,
    paretoSlots,
    paretoIndependentRings,
  );
  const slots = candidatePoolsResult.slots;
  const jobLevel = calculationJobLevelFor(config);
  if (slots.some((slot) => slot.candidates.length === 0)) {
    throwIfAborted(options.signal);
  }
  const selectedFoods = foodsFor(config);
  const foodsByIdentity = new Map<string, Food>();
  const solverFoods = selectedFoods.map((food) => {
    const info = createFoodInfo(food, config, jobLevel);
    foodsByIdentity.set(foodIdentity(info), food);
    return info;
  });
  const slotCandidateCount = slots.reduce(
    (sum, slot) => sum + slot.candidates.length,
    0,
  );
  const exactOptions = makeExactOptions(
    config,
    jobLevel,
    slots,
    solverFoods,
    options,
  );
  options.onCandidateCounts?.({
    jobId: config.jobId,
    slots: slots.map((slot) => ({
      slot: slot.name,
      count: slot.candidates.length,
    })),
    foodCount: solverFoods.length,
  });
  return {
    jobId: config.jobId,
    jobLevel,
    jobSchema: jobSchemas[config.jobId],
    clanIndex: config.clanIndex ?? 0,
    objective: config.objective ?? "damage",
    slots,
    foods: solverFoods,
    gearsByIdentity,
    foodsByIdentity,
    searchedCandidates: slotCandidateCount,
    options: exactOptions,
  };
}

export function privateParetoSlots(
  config: OptimizationConfig,
  preservedSlots: readonly string[] = [],
): ReadonlySet<string> {
  const preserved = new Set(preservedSlots);
  return new Set(
    jobSlots(config.jobId).filter(
      (slot) => slot !== "rings" && !preserved.has(slot),
    ),
  );
}
