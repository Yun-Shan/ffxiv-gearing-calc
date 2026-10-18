import { describe, expect, it } from "vitest";
import { foods, searchFoods } from "./data";
import type { Food } from "./types";

const damageStats = ["CRT", "DET", "DHT"] as const;
const speedStats = ["SKS", "SPS"] as const;
const allStats = [
  ...new Set(
    searchFoods.flatMap((food) => [
      ...Object.keys(food.stats),
      ...Object.keys(food.statRates),
    ]),
  ),
].sort();

function value(food: Food, table: "stats" | "statRates", stat: string): number {
  return (food[table] as Record<string, number | undefined>)[stat] ?? 0;
}

function speedKey(food: Food): string {
  return JSON.stringify(
    speedStats.map((stat) => [value(food, "stats", stat), value(food, "statRates", stat)]),
  );
}

function isDominatedBy(candidate: Food, other: Food): boolean {
  if (speedKey(candidate) !== speedKey(other)) return false;
  let strictlyBetter = false;
  for (const stat of allStats) {
    for (const table of ["stats", "statRates"] as const) {
      const candidateValue = value(candidate, table, stat);
      const otherValue = value(other, table, stat);
      if (otherValue < candidateValue) return false;
      if (otherValue > candidateValue) strictlyBetter = true;
    }
  }
  return strictlyBetter;
}

describe("food search candidates", () => {
  it("keeps the complete food catalog for imports but prunes only search candidates", () => {
    expect(foods.some((food) => food.id === 4650)).toBe(true);
    expect(foods.length).toBeGreaterThan(searchFoods.length);
    expect(searchFoods.length).toBeGreaterThan(0);
    expect(searchFoods.some((food) => food.best === true)).toBe(true);
    for (const food of searchFoods) {
      expect(
        damageStats.some((stat) => value(food, "stats", stat) > 0),
      ).toBe(true);
    }
    for (const candidate of searchFoods) {
      for (const other of searchFoods) {
        if (candidate === other) continue;
        expect(isDominatedBy(candidate, other)).toBe(false);
      }
    }
  });
});
