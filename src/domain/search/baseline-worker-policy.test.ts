import assert from "node:assert/strict";
import { test } from "vitest";
import { baselineWorkerLimit } from "./baseline-worker-policy.ts";

test("uses up to four baseline workers for ordinary candidate domains", () => {
  assert.equal(baselineWorkerLimit(5, 13_501), 4);
  assert.equal(baselineWorkerLimit(4, 12_106), 4);
  assert.equal(baselineWorkerLimit(3, 2_263), 3);
  assert.equal(baselineWorkerLimit(1, 200_000), 1);
});

test("starts all five baselines for bounded five-job candidate pools", () => {
  assert.equal(baselineWorkerLimit(5, 12_106), 5);
  assert.equal(baselineWorkerLimit(5, 13_500), 5);
  assert.equal(baselineWorkerLimit(6, 12_106), 5);
});

test("limits large candidate domains to three concurrent baselines", () => {
  assert.equal(baselineWorkerLimit(5, 292_477), 3);
  assert.equal(baselineWorkerLimit(5, 100_000), 3);
  assert.equal(baselineWorkerLimit(5, 406_153), 3);
  assert.equal(baselineWorkerLimit(2, 292_477), 2);
});
