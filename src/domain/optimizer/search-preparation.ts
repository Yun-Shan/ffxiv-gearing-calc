import { jobSchemas } from "../jobs.ts";
import { gameData } from "../data.ts";
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
import { normalizeOptimizationConfig } from "../config-validation.ts";
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
  const clanIndex = config.clanIndex;
  const speedStat = getSpeedStat(schema);
  const toughnessAttributeId = schema.stats.includes("TEN")
    ? attributeIndex.get("TEN")
    : undefined;
  const speedAttributeId = attributeIndex.get(speedStat);
  if (speedAttributeId === undefined)
    throw new Error(`职业 ${jobId} 缺少 ${speedStat} 搜索坐标`);
  const baseStats = calculateBaseStats(schema, jobLevel, clanIndex);
  const constraints = {
    ...(config.gcdChoices !== undefined
      ? { gcdChoices: config.gcdChoices }
      : {}),
    ...(config.speedMin !== undefined
      ? { speedMin: Math.max(0, config.speedMin - (baseStats[speedStat] ?? 0)) }
      : {}),
    ...(config.speedMax !== undefined
      ? { speedMax: config.speedMax - (baseStats[speedStat] ?? 0) }
      : {}),
    ...(config.minTenacity !== undefined
      ? {
          toughMin: Math.max(
            0,
            config.minTenacity! -
              (baseStats.TEN ?? 0),
          ),
        }
      : {}),
    ...(config.toughnessMinPercent !== undefined
      ? { toughnessMinPercent: config.toughnessMinPercent }
      : {}),
    ...(config.maximizeTenacity ? { maxToughnessMode: true } : {}),
  };
  const syncItemLevel = config.sync === undefined
    ? undefined
    : syncItemLevelForCandidateRange(config.sync, jobLevel);
  const candidateItemLevelRanges = [
    { min: config.maxItemLevel - 20, max: config.maxItemLevel },
    ...(syncItemLevel === undefined
      ? []
      : [{ min: syncItemLevel - 20, max: syncItemLevel }]),
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
    objective: config.objective,
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
  config = normalizeOptimizationConfig(config);
  throwIfAborted(options.signal);
  const jobLevel = calculationJobLevelFor(config);
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
    clanIndex: config.clanIndex,
    objective: config.objective,
    slots,
    foods: solverFoods,
    gearsByIdentity,
    foodsByIdentity,
    forcedGear: config.forcedGear,
    searchedCandidates: slotCandidateCount,
    options: exactOptions,
  };
}

function syncItemLevelForCandidateRange(
  sync: NonNullable<OptimizationConfig["sync"]>,
  calculationLevel: number,
): number {
  if (sync.kind === "itemLevel") return sync.value;
  const rule = gameData.sync.levels.find(({ jobLevel }) => jobLevel === calculationLevel);
  if (rule === undefined) throw new RangeError(`不支持的等级同步：${calculationLevel}`);
  return rule.defaultItemLevel;
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
