import { foods, searchFoods } from "../../data.ts";
import { jobSchemas } from "../../jobs.ts";
import { calculateBaseStats } from "../../rules.ts";
import type { Food, JobId, OptimizationConfig, Stat, Stats } from "../../types.ts";
import { attributeIndex, type SolverFood } from "../context.ts";

export function foodIdentity(food: SolverFood): string {
  if (food.physicalKey !== undefined) return food.physicalKey;
  return JSON.stringify({
    itemId: food.itemId,
    itemLevel: food.itemLevel,
    baseParams: food.baseParams
      .map(({ baseParamId, multiplier, maxValue }) => [
        baseParamId,
        multiplier,
        maxValue,
      ])
      .sort((left, right) => left[0] - right[0]),
  });
}

function physicalFoodIdentity(food: Food): string {
  const sortStats = (stats: Stats) =>
    Object.entries(stats)
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    itemId: food.id,
    itemLevel: food.level,
    stats: sortStats(food.stats),
    statRates: sortStats(food.statRates),
  });
}

export function foodStatsForJob(
  food: Food,
  jobId: JobId,
): { stats: Stats; statRates: Stats } {
  const allowed = new Set(jobSchemas[jobId].stats);
  const filter = (values: Stats): Stats =>
    Object.fromEntries(
      Object.entries(values).filter(
        ([stat, value]) => allowed.has(stat as Stat) && value !== undefined,
      ),
    ) as Stats;
  return { stats: filter(food.stats), statRates: filter(food.statRates) };
}

export function createFoodInfo(
  food: Food,
  config: OptimizationConfig,
  jobLevel: number,
): SolverFood {
  const schema = jobSchemas[config.jobId];
  const baseStats = calculateBaseStats(schema, jobLevel, config.clanIndex);
  const applicableFood = foodStatsForJob(food, config.jobId);
  const baseParams = Object.entries(applicableFood.stats)
    .flatMap(([key, maxValue]) => {
      const stat = key as Stat;
      const index = attributeIndex.get(stat);
      const rate = applicableFood.statRates[stat] ?? 0;
      return index === undefined || !maxValue || rate <= 0
        ? []
        : [
            {
              baseParamId: index,
              multiplier: 1 + rate / 100,
              maxValue,
              baseValue: baseStats[stat] ?? 0,
            },
          ];
    })
    .sort((left, right) => left.baseParamId - right.baseParamId);
  return {
    itemId: food.id,
    itemLevel: food.level,
    key: baseParams.map(({ baseParamId }) => baseParamId).join("-"),
    physicalKey: physicalFoodIdentity(food),
    baseParams,
  };
}

export function foodsFor(config: OptimizationConfig): Food[] {
  if (config.foodId !== 0)
    return foods.filter((food) => food.id === config.foodId);
  return searchFoods.filter((food) => food.best && (food.stats.VIT ?? 0) > 0);
}
