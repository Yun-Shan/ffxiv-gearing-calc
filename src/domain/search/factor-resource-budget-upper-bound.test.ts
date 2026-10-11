import { describe, expect, test } from "vitest";
import {
  prepareFactorResourceBudgetUpperBound,
  type ResourceBudgetFactorGroup,
} from "./factor-resource-budget-upper-bound";

function exhaustiveMaximum(groups: readonly ResourceBudgetFactorGroup[], budget: number): number | undefined {
  let scores: { cost: number; score: number }[] = [{ cost: 0, score: 0 }];
  for (const group of groups) {
    const next: typeof scores = [];
    for (const state of scores) for (const option of group.classes) {
      const cost = state.cost + option.min;
      if (cost <= budget) next.push({ cost, score: state.score + option.score });
    }
    scores = next;
  }
  return scores.length === 0 ? undefined : Math.max(...scores.map(({ score }) => score));
}

describe("factor resource budget upper bound", () => {
  test("never falls below the exhaustive best score for any feasible budget", () => {
    const groups: ResourceBudgetFactorGroup[] = [
      { classes: [{ min: 1, score: 2 }, { min: 3, score: 5 }, { min: 5, score: 7 }] },
      { classes: [{ min: 0, score: -2 }, { min: 2, score: 1 }, { min: 4, score: 3 }] },
      { classes: [{ min: 1, score: 0 }, { min: 4, score: 5 }, { min: 6, score: 6 }] },
    ];
    const prepared = prepareFactorResourceBudgetUpperBound(groups);
    expect(prepared).toBeDefined();
    for (let budget = prepared!.minimumCost; budget <= 18; budget += 1) {
      const exactRelaxedScore = exhaustiveMaximum(groups, budget);
      const upper = prepared!.query(budget);
      expect(upper).toBeDefined();
      expect(upper!).toBeGreaterThanOrEqual(BigInt(exactRelaxedScore!));
    }
  });

  test("is exact on a single linear support and inclusive at its resource boundary", () => {
    const prepared = prepareFactorResourceBudgetUpperBound([
      { classes: [{ min: 0, score: 0 }, { min: 2, score: 6 }] },
      { classes: [{ min: 0, score: 0 }, { min: 3, score: 9 }] },
    ]);
    expect(prepared?.query(4)).toBe(12n);
    expect(prepared?.query(5)).toBe(15n);
    expect(prepared?.query(3)).toBe(9n);
  });

  test("fails open for invalid classes, infeasible budgets, and excessive work", () => {
    const valid = [{ classes: [{ min: 0, score: 1 }, { min: 2, score: 3 }] }];
    const prepared = prepareFactorResourceBudgetUpperBound(valid);
    expect(prepared?.query(-1)).toBeUndefined();
    expect(prepared?.query(Number.NaN)).toBeUndefined();
    expect(prepared?.query(0)).toBeGreaterThanOrEqual(1n);
    expect(prepareFactorResourceBudgetUpperBound([{ classes: [] }])).toBeUndefined();
    expect(prepareFactorResourceBudgetUpperBound([{ classes: [{ min: -1, score: 1 }] }])).toBeUndefined();
    expect(prepareFactorResourceBudgetUpperBound([{ classes: [{ min: 0, score: Number.NaN }] }])).toBeUndefined();
    expect(prepareFactorResourceBudgetUpperBound(valid, { maxWork: 0 })).toBeUndefined();
  });
});
