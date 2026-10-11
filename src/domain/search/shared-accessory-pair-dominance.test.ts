import assert from "node:assert/strict";
import { test } from "vitest";
import { findStrictlyDominatedSharedAccessoryPairs } from "./shared-accessory-pair-dominance.js";

function pair(
  keyA: string,
  keyB: string,
  values: readonly number[],
  canDominate = true,
) {
  return {
    keyA,
    keyB,
    selectorA: `a:${keyA}`,
    selectorB: `b:${keyB}`,
    values,
    canDominate,
  };
}

test("只剪除有严格跨属性支配证人的共享饰品对", () => {
  const result = findStrictlyDominatedSharedAccessoryPairs([
    pair("a", "a", [8, 8, 4]),
    pair("b", "a", [7, 8, 4]),
    pair("c", "a", [8, 6, 6]),
    pair("d", "a", [8, 8, 4]),
  ], { maxCuts: 10, maxComparisons: 100 });

  assert.equal(result.candidateCount, 4);
  assert.equal(result.cuts.length, 1);
  assert.equal(result.cuts[0]!.dominated.keyA, "b");
  assert.equal(result.cuts[0]!.dominator.keyA, "a");
});

test("具有复用风险的候选不能作为支配证人", () => {
  const result = findStrictlyDominatedSharedAccessoryPairs([
    pair("unsafe", "pair", [9, 9], false),
    pair("safe", "pair", [8, 8]),
  ], { maxCuts: 10, maxComparisons: 100 });

  assert.equal(result.cuts.length, 0);
});

test("达到比较预算时保留未检查组合且返回已证明的 cuts", () => {
  const result = findStrictlyDominatedSharedAccessoryPairs([
    pair("a", "a", [10, 10]),
    pair("b", "a", [9, 9]),
    pair("c", "a", [8, 8]),
  ], { maxCuts: 10, maxComparisons: 1 });

  assert.equal(result.cuts.length, 1);
  assert.equal(result.comparisons, 1);
  assert.equal(result.comparisonLimitReached, true);
});

test("预处理截止时间已到时不执行排序或支配剪枝", () => {
  const result = findStrictlyDominatedSharedAccessoryPairs([
    pair("a", "a", [10, 10]),
    pair("b", "a", [9, 9]),
  ], { maxCuts: 10, maxComparisons: 100, deadlineAt: performance.now() - 1 });

  assert.equal(result.cuts.length, 0);
  assert.equal(result.comparisons, 0);
  assert.equal(result.preprocessingLimitReached, true);
});

test("排序期间触及截止时间时放弃未完成排序", () => {
  const candidates = Array.from({ length: 1_024 }, (_, index) =>
    pair(`k${index}`, "a", [1_024 - index, 1_024 - index]));
  let stopChecks = 0;
  const result = findStrictlyDominatedSharedAccessoryPairs(candidates, {
    maxCuts: 10,
    maxComparisons: 100,
    shouldStop: () => ++stopChecks >= 1_035,
  });

  assert.equal(result.cuts.length, 0);
  assert.equal(result.preprocessingLimitReached, true);
  assert.equal(stopChecks, 1_035);
});

test("比较期间取消时仍保留此前已证明安全的 cut", () => {
  let stopChecks = 0;
  const result = findStrictlyDominatedSharedAccessoryPairs([
    pair("a", "a", [10, 10]),
    pair("b", "a", [9, 9]),
    pair("c", "a", [8, 8]),
  ], {
    maxCuts: 10,
    maxComparisons: 100,
    shouldStop: () => ++stopChecks >= 13,
  });

  assert.equal(result.cuts.length, 1);
  assert.equal(result.cuts[0]!.dominated.keyA, "b");
  assert.equal(result.preprocessingLimitReached, true);
});
