import { test } from "vitest";
import assert from "node:assert/strict";
import { candidateResourceSupportProfile } from "./candidate-resource-support-policy.ts";

test("disables conditional rows for two- and three-job baselines", () => {
  assert.equal(candidateResourceSupportProfile(1, 10_000), "compact");
  assert.equal(candidateResourceSupportProfile(2, 10_000), "disabled");
  assert.equal(candidateResourceSupportProfile(3, 99_999), "disabled");
});

test("disables conditional rows for memory-heavy four-or-more job inputs", () => {
  assert.equal(candidateResourceSupportProfile(4, 1_999), "compact");
  assert.equal(candidateResourceSupportProfile(4, 2_000), "compact");
  assert.equal(candidateResourceSupportProfile(4, 99_999), "compact");
  assert.equal(candidateResourceSupportProfile(4, 100_000), "disabled");
  assert.equal(candidateResourceSupportProfile(5, 292_477), "disabled");
  assert.equal(candidateResourceSupportProfile(0, 1), "disabled");
});
