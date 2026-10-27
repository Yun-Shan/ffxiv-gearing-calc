import { expect, test } from "vitest";
import {
  prepareFactorResourceBudgetUpperBound,
  preparePartitionedFactorResourceBudgetUpperBound,
  type ResourceBudgetFactorGroup,
} from "./factor-resource-budget-upper-bound.ts";

test("a disjunction retains non-hull classes and strictly tightens a convex factor", () => {
  const groups = [{ classes: [{ min: 0, score: 0 }, { min: 1, score: 1 }, { min: 2, score: 4 }] }];
  const base = prepareFactorResourceBudgetUpperBound(groups)!;
  const split = preparePartitionedFactorResourceBudgetUpperBound(groups, 0)!;
  expect(base.query(1)).toBe(2n);
  expect(split.query(1)).toBe(1n);
  expect(split.partitionCount).toBe(3);
  expect(split.minimumCost).toBe(base.minimumCost);
});

test("finite disjunctions cover all tuples, stay monotone and never weaken the original bound", () => {
  let seed = 0x71ba9823;
  const random = (maximum: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % maximum;
  };
  for (let trial = 0; trial < 500; trial++) {
    const groups: ResourceBudgetFactorGroup[] = Array.from({ length: 2 + random(3) }, () => ({
      classes: Array.from({ length: 1 + random(5) }, () => ({ min: random(9), score: random(61) - 40 })),
    }));
    const base = prepareFactorResourceBudgetUpperBound(groups)!;
    const split = preparePartitionedFactorResourceBudgetUpperBound(groups, random(groups.length), { maxPartitions: 1 + random(8) })!;
    expect(split.minimumCost).toBe(base.minimumCost);
    const tuples: { cost: number; score: bigint }[] = [];
    const visit = (group: number, cost: number, score: bigint) => {
      if (group === groups.length) { tuples.push({ cost, score }); return; }
      for (const entry of groups[group]!.classes) visit(group + 1, cost + entry.min, score + BigInt(entry.score));
    };
    visit(0, 0, 0n);
    let previous: bigint | undefined;
    for (let budget = 0; budget <= 40; budget++) {
      const feasible = tuples.filter((tuple) => tuple.cost <= budget);
      const upper = split.query(budget);
      if (feasible.length === 0) { expect(upper).toBeUndefined(); continue; }
      const exact = feasible.reduce((best, tuple) => tuple.score > best ? tuple.score : best, feasible[0]!.score);
      expect(upper).toBeGreaterThanOrEqual(exact);
      expect(upper).toBeLessThanOrEqual(base.query(budget)!);
      if (previous !== undefined) expect(upper).toBeGreaterThanOrEqual(previous);
      previous = upper;
      // Binary inversion of the monotone upper bound must match exhaustive scanning.
      const target = upper!;
      let low = split.minimumCost;
      let high = budget;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (split.query(middle)! >= target) high = middle; else low = middle + 1;
      }
      expect(low).toBe(Array.from({ length: budget - split.minimumCost + 1 }, (_, i) => i + split.minimumCost)
        .find((resource) => split.query(resource)! >= target));
    }
  }
});

test("an unaffordable block falls back as a whole; negative scores and DPS terms remain signed", () => {
  const groups = [
    { classes: [{ min: 0, score: -30 }, { min: 1, score: -29 }, { min: 2, score: -26 }] },
    { classes: [{ min: 0, score: -10 }, { min: 3, score: -9 }] },
  ];
  const original = prepareFactorResourceBudgetUpperBound(groups)!;
  const noBlockBudget = preparePartitionedFactorResourceBudgetUpperBound(groups, 0, { maxWork: 30, maxPartitions: 3 })!;
  expect(noBlockBudget.partitionCount).toBeUndefined();
  expect(noBlockBudget.query(1)).toBe(original.query(1));
  const split = preparePartitionedFactorResourceBudgetUpperBound(groups, 0)!;
  expect(split.query(1)).toBe(-39n);
  expect(split.query(0)).toBe(-40n);
  expect(split.query(-1)).toBeUndefined();
  expect(split.query(Number.NaN)).toBeUndefined();
});

test("invalid or unsafe metadata never creates a partial certificate", () => {
  const valid = [{ classes: [{ min: 0, score: 0 }, { min: 1, score: 1 }] }];
  for (const index of [-1, 1, Number.NaN, 0.5]) expect(preparePartitionedFactorResourceBudgetUpperBound(valid, index)).toBeUndefined();
  for (const maxPartitions of [0, -1, 0.5, Number.POSITIVE_INFINITY]) {
    expect(preparePartitionedFactorResourceBudgetUpperBound(valid, 0, { maxPartitions })).toBeUndefined();
  }
  for (const entry of [{ min: -1, score: 1 }, { min: 0, score: 0.5 }, { min: Number.NaN, score: 1 }]) {
    expect(preparePartitionedFactorResourceBudgetUpperBound([{ classes: [entry] }], 0)).toBeUndefined();
  }
  expect(preparePartitionedFactorResourceBudgetUpperBound(valid, 0, { maxWork: 0 })).toBeUndefined();
  expect(preparePartitionedFactorResourceBudgetUpperBound([
    { classes: [{ min: Number.MAX_SAFE_INTEGER, score: 1 }] },
    { classes: [{ min: 1, score: 1 }] },
  ], 0)).toBeUndefined();
});

test("a split preparation work limit can fail while the retained original certificate succeeds", () => {
  const groups = [{ classes: [{ min: 0, score: 0 }, { min: 1, score: 1 }] }];
  const original = prepareFactorResourceBudgetUpperBound(groups, { maxWork: 4 });
  expect(original?.query(1)).toBe(1n);
  expect(preparePartitionedFactorResourceBudgetUpperBound(groups, 0, { maxWork: 4 })).toBeUndefined();
  // Callers must keep this independently prepared certificate on that path.
  expect(original?.query(0)).toBe(0n);
});
