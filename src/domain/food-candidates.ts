import type { Food, Stats } from "./types.ts";

const damageStats = ["CRT", "DET", "DHT"] as const;
const speedStats = ["SKS", "SPS"] as const;

function value(stats: Stats, stat: string): number {
  return (stats as Record<string, number | undefined>)[stat] ?? 0;
}

function speedKey(food: Food): string {
  return JSON.stringify(
    speedStats.map((stat) => [value(food.stats, stat), value(food.statRates, stat)]),
  );
}

function statKey(food: Food, stats: readonly string[]): string {
  return JSON.stringify(
    stats.map((stat) => [
      stat,
      value(food.stats, stat),
      value(food.statRates, stat),
    ]),
  );
}

/**
 * 搜索候选食物：只保留至少包含一项伤害副属性的食物，并按支配关系剪枝。
 * 速度坐标不同的食物互不支配，避免在速度上限或精确 GCD 约束下丢失可行候选。
 */
export function selectFoodCandidates(foods: readonly Food[]): Food[] {
  const candidates = foods.filter((food) =>
    damageStats.some((stat) => value(food.stats, stat) > 0),
  );
  if (candidates.length === 0) throw new Error("没有包含暴击、信念或直击的食物候选");
  const stats = [...new Set(candidates.flatMap((food) => [
    ...Object.keys(food.stats),
    ...Object.keys(food.statRates),
  ]))].sort();
  const isDominatedBy = (candidate: Food, other: Food): boolean => {
    if (speedKey(candidate) !== speedKey(other)) return false;
    let strictlyBetter = false;
    for (const stat of stats) {
      for (const table of ["stats", "statRates"] as const) {
        const candidateValue = value(candidate[table], stat);
        const otherValue = value(other[table], stat);
        if (otherValue < candidateValue) return false;
        if (otherValue > candidateValue) strictlyBetter = true;
      }
    }
    return strictlyBetter;
  };
  const frontier = candidates.filter((candidate) =>
    !candidates.some(
      (other) => other !== candidate && isDominatedBy(candidate, other),
    ),
  );
  // 相同效果只保留一项；优先保留带 best 标记的记录，以免缩小默认食物池。
  const selectedByKey = new Map<string, Food>();
  for (const food of frontier) {
    const key = statKey(food, stats);
    const previous = selectedByKey.get(key);
    if (previous === undefined || (food.best === true && previous.best !== true))
      selectedByKey.set(key, food);
  }
  return frontier.filter((food) => selectedByKey.get(statKey(food, stats)) === food);
}
