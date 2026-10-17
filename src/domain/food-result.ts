import type { Food, FoodResult, Stats } from "./types.ts";

/** Snapshot the already-applied food effect; no formula or search is rerun. */
export function describeFoodResult(
  food: Food,
  before: Stats,
  after: Stats,
): FoodResult {
  const actualStats: Stats = {};
  let totalCap = 0;
  let totalActual = 0;
  for (const stat of Object.keys(food.stats) as (keyof Stats)[]) {
    const actual = (after[stat] ?? 0) - (before[stat] ?? 0);
    actualStats[stat] = actual;
    totalCap += food.stats[stat] ?? 0;
    totalActual += actual;
  }
  return {
    ...food,
    actualStats,
    utilization:
      totalCap > 0 ? Math.trunc((totalActual / totalCap) * 100 + 1e-7) : 0,
  };
}
