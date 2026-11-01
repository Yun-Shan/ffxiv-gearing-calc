import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXISTING_MIP_CASE_IDS, MIP_CASES } from "./mip-acceptance-cases.mjs";
import ACCEPTANCE_BASELINE from "./acceptance-baseline.json" with { type: "json" };

function listIds(...filters) {
  const runner = fileURLToPath(new URL("./run-acceptance.mjs", import.meta.url));
  return execFileSync(process.execPath, [runner, "--list", ...filters], { encoding: "utf8" })
    .trim().split(/\r?\n/).map((line) => line.split(" | ")[0]);
}

test("the full suite includes each MIP case once and the MIP filter selects exactly those cases", () => {
  const all = listIds();
  assert.equal(new Set(all).size, all.length);
  const expected = [...EXISTING_MIP_CASE_IDS, ...MIP_CASES.map((item) => item.id)];
  assert.equal(new Set(expected).size, 11);
  assert.ok(expected.every((id) => all.includes(id)));
  assert.deepEqual(listIds("--strategy", "mip").sort(), expected.sort());
  assert.deepEqual(listIds("--strategy", "tank-group").sort(), [
    "custom-c", "custom-d", "forced-a", "pld-war-drk-gnb-sync735-wide715-795-shared-all-dps",
  ]);
});

test("all MIP inputs match the current nine-round baseline, including GCD and excluded equipment", () => {
  for (const id of MIP_CASES.map((item) => item.id)) {
    const item = MIP_CASES.find((item) => item.id === id);
    const baseline = ACCEPTANCE_BASELINE.cases[id];
    const jobs = item.jobs.map((jobId) => ({
      jobId, objective: item.objective, clanIndex: 0,
      minItemLevel: item.minItemLevel, maxItemLevel: item.maxItemLevel,
      ...(item.syncLevel !== undefined && { sync: { kind: "itemLevel", value: item.syncLevel } }),
      maximizeTenacity: false, excludedSources: [], forcedGear: {}, foodId: 0,
      ...item.jobConstraints?.[jobId],
    }));
    assert.deepEqual({ jobs, commonSlots: item.commonSlots, foodStrategy: item.foodStrategy, objective: item.objective }, baseline.configuration);
    assert.deepEqual(item.requiredStrategies ?? {}, id === "forced-a" ? { sharedStateSearch: "off" } : {});
  }
  const holdout = MIP_CASES.find((item) => item.id === "holdout-food-independent");
  assert.equal(holdout.foodStrategy, "independent");
  assert.deepEqual(holdout.jobs, ["VPR", "MCH"]);
  assert.deepEqual(holdout.commonSlots, ["earrings", "necklace", "bracelet", "ring", "ring2"]);
});
