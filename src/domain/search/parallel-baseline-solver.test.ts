import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { SerializedBaselineOptions } from "./parallel-baseline-executor.ts";
import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
import { solveSerializedBaseline } from "./parallel-baseline-solver.ts";
import { equippedEffects, equippedSpeedRangeForGcd, equippedToughnessForMitigationPercent } from "./equipped-effects.ts";
import { hasCanonicalEvaluatorCandidateUpperBound } from "./exact-mip-candidate-upper-bound.ts";

vi.mock("./loadout-finder-exact-mip.ts", () => ({
  findBestLoadoutExactMip: vi.fn(async () => undefined),
}));

function serializedTask(): SerializedBaselineOptions {
  return {
    clanIndex: 0,
    objective: "dps",
    job: "VPR",
    jobLevel: 100,
    attributeIds: [],
    statIndexes: [],
    slots: {
      slotOffsets: new Uint32Array([0, 2, 3]),
      itemIds: new Float64Array([1, 2, 3]),
      itemLevels: new Float64Array([770, 775, 795]),
      parameterOffsets: new Uint32Array([0, 0, 0, 0]),
      parameterIds: new Float64Array(),
      parameterValues: new Float64Array(),
      ringSlotKinds: new Uint8Array(3),
      ringSlotIndexes: new Float64Array(3),
      uniqueKinds: new Uint8Array(3),
    },
    foods: {
      offsets: new Uint32Array([0]),
      parameterIds: new Float64Array(),
      baseValues: new Float64Array(),
      hasBaseValues: new Uint8Array(),
      multipliers: new Float64Array(),
      maxValues: new Float64Array(),
    },
    candidateItemLevelRanges: [{ min: 775, max: 795 }],
    maxSearchMs: 5_000,
  };
}

test("worker restores item levels around the resource-prior boundary", async () => {
  const solver = vi.mocked(findBestLoadoutExactMip);
  solver.mockClear();
  await solveSerializedBaseline(structuredClone(serializedTask()), {});
  const options = solver.mock.calls[0]![0];
  assert.deepEqual(options.slots.map((slot) => slot.map((item) => item.itemLevel)),
    [[770, 775], [795]]);
  assert.deepEqual(options.candidateItemLevelRanges, [{ min: 775, max: 795 }]);
});

test("worker rejects a misaligned item-level column before solving", async () => {
  const solver = vi.mocked(findBestLoadoutExactMip);
  solver.mockClear();
  const task = serializedTask();
  task.slots.itemLevels = new Float64Array([770, 775]);
  await assert.rejects(solveSerializedBaseline(task, {}), /装备数值列长度不匹配/);
  assert.equal(solver.mock.calls.length, 0);
});

test.each([
  "parameterValues", "ringSlotKinds", "ringSlotIndexes", "uniqueKinds",
] as const)("worker rejects a misaligned %s column", async (column) => {
  const task = serializedTask();
  task.slots = { ...task.slots, [column]: new Float64Array(4) };
  await assert.rejects(solveSerializedBaseline(task, {}), /装备数值列长度不匹配/);
});

test.each([
  new Uint32Array([1, 2, 3]),
  new Uint32Array([0, 3, 2, 3]),
])("worker rejects invalid slot boundaries", async (offsets) => {
  const task = serializedTask();
  task.slots.slotOffsets = offsets;
  await assert.rejects(solveSerializedBaseline(task, {}), /槽位索引列无效/);
});

test("worker rejects food columns with different lengths", async () => {
  const task = serializedTask();
  task.foods.baseValues = new Float64Array(1);
  await assert.rejects(solveSerializedBaseline(task, {}), /食物数值列长度不匹配/);
});

test("worker preserves solver policies, constraints and callback context", async () => {
  const solver = vi.mocked(findBestLoadoutExactMip);
  solver.mockClear();
  const task: SerializedBaselineOptions = {
    ...serializedTask(),
    job: "PLD",
    clanIndex: 1,
    attributeIds: [0, 1, 2, 3],
    statIndexes: [["STR", 0], ["PDMG", 1], ["TEN", 2], ["SKS", 3]],
    constraints: { gcd: 1.92, toughnessMinPercent: 5 },
    speedAttributeId: 3,
    toughnessAttributeId: 2,
    objective: "dps",
    candidateResourceSupportProfile: "compact-weighted",
    resourceBudgetCandidateProfile: "weighted",
    primaryResourceSupports: true,
    mainStatResourceSupport: true,
    enableCanonicalEvaluatorCandidateUpperBound: true,
  };
  const callbacks = {
    onProgress: vi.fn(),
    onSolverProgress: vi.fn(),
    onSolverCallback: vi.fn(),
  };
  await solveSerializedBaseline(structuredClone(task), callbacks);
  const options = solver.mock.calls[0]![0];
  assert.deepEqual(options.constraints, task.constraints);
  assert.equal(options.clanIndex, 1);
  assert.equal(options.candidateResourceSupportProfile, "compact-weighted");
  assert.equal(options.resourceBudgetCandidateProfile, "weighted");
  assert.equal(options.primaryResourceSupports, true);
  assert.equal(options.mainStatResourceSupport, true);
  assert.equal(hasCanonicalEvaluatorCandidateUpperBound(options), true);
  assert.equal(options.onProgress, callbacks.onProgress);
  assert.equal(options.onSolverProgress, callbacks.onSolverProgress);
  assert.equal(options.onSolverCallback, callbacks.onSolverCallback);
  assert.deepEqual(options.gcdToSpeedRange!(1.92), equippedSpeedRangeForGcd("PLD", 100, 1.92, 1));
  assert.equal(options.toughnessPercentToMinimum!(5), equippedToughnessForMitigationPercent("PLD", 100, 5, 1));
  const effects = equippedEffects("PLD", 100, { STR: 6000, PDMG: 158, TEN: 1000, SKS: 2393 }, 1);
  assert.ok(effects);
  assert.deepEqual(options.evaluationFunction([6000, 158, 1000, 2393]),
    { damage: effects.damage, gcd: effects.gcd });
  const baseEffects = equippedEffects("PLD", 100, {}, 1);
  assert.ok(baseEffects);
  assert.deepEqual(options.evaluationFunction([]),
    { damage: baseEffects.damage, gcd: baseEffects.gcd });
});
