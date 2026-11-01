import type { FoodInfo } from "./types.ts";

export function assertUniqueFoodAttributes(food: Pick<FoodInfo, "itemId" | "baseParams">, source = `食物 ${food.itemId}`): void {
  const seen = new Set<number>();
  for (const { baseParamId } of food.baseParams) {
    if (seen.has(baseParamId)) throw new Error(`${source} 的属性 ${baseParamId} 重复`);
    seen.add(baseParamId);
  }
}

export function assertUniqueJobFoodAttributes(jobs: readonly { options: { foods: readonly FoodInfo[] } }[]): void {
  for (const { options } of jobs) {
    for (const food of options.foods) assertUniqueFoodAttributes(food);
  }
}
