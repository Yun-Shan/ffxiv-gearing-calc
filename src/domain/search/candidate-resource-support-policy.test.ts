import assert from "node:assert/strict";
import { test } from "vitest";
import {
  candidateResourceSupportProfile,
  candidateResourceSupportProfileForSearch,
  resourceBudgetCandidateProfileForSearch,
  shouldUseMainStatResourceSupportForBaseline,
  shouldUseMainStatResourceSupportForBaselineJob,
  shouldUsePrimaryResourceSupportsForBaseline,
  shouldUseSharedMateriaCompensation,
} from "./candidate-resource-support-policy.ts";

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

test("adds primary resource supports only for the historical VPR+MCH shared DPS baseline", () => {
  const slots = ["earrings", "necklace", "bracelet", "rings"];
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(["VPR", "MCH"], slots, "dps", "shared"), true);
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(["MCH", "VPR"], slots, "dps", "shared"), true);
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(
    ["VPR", "MCH"], ["earrings", "necklace", "bracelet", "ring", "ring2"], "dps", "shared"), true);
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(["RPR", "SAM"], slots, "dps", "shared"), false);
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(["VPR", "MCH", "DNC"], slots, "dps", "shared"), false);
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(["VPR", "MCH"], slots, "damage", "shared"), false);
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(["VPR", "MCH"], slots, "dps", "independent"), false);
  assert.equal(shouldUsePrimaryResourceSupportsForBaseline(["VPR", "MCH"], ["head", "body"], "dps", "shared"), false);
});

test("adds the single main-stat support for measured shared DPS baselines", () => {
  const slots = ["head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "rings"];
  const splitRingSlots = [...slots.slice(0, -1), "ring", "ring2"];
  assert.equal(shouldUseMainStatResourceSupportForBaseline(["BRD", "DNC", "MCH"], slots, "dps", "shared"), true);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(
    ["BRD", "DNC", "MCH"], splitRingSlots, "dps", "shared"), true);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(["MCH", "BRD", "DNC"], slots, "dps", "shared"), true);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(["RDM", "BLM", "PCT"], slots, "dps", "shared"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(["BRD", "DNC", "MCH"], slots, "damage", "shared"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(["BRD", "DNC", "MCH"], slots, "dps", "independent"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(["BRD", "DNC", "MCH"], slots.slice(1), "dps", "shared"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(
    ["RPR", "SAM"], ["earrings", "necklace", "bracelet", "rings"], "dps", "shared"), true);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(
    ["SAM", "RPR"], ["earrings", "necklace", "bracelet", "ring", "ring2"], "dps", "shared"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(
    ["SAM", "RPR"], ["earrings", "necklace", "bracelet", "ring", "ring2"], "dps", "shared", true), true);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(
    ["RPR", "SAM"], ["head", "earrings", "necklace", "bracelet", "rings"], "dps", "shared"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaseline(
    ["RPR", "SAM"], ["earrings", "necklace", "bracelet", "rings"], "damage", "shared"), false);
});

test("limits shared materia compensation to RPR+SAM shared accessory DPS searches", () => {
  assert.equal(shouldUseSharedMateriaCompensation(
    ["RPR", "SAM"], ["earrings", "necklace", "bracelet", "rings"], "dps", "shared"), true);
  assert.equal(shouldUseSharedMateriaCompensation(
    ["SAM", "RPR"], ["earrings", "necklace", "bracelet", "ring", "ring2"], "dps", "shared"), false);
  assert.equal(shouldUseSharedMateriaCompensation(
    ["SAM", "RPR"], ["earrings", "necklace", "bracelet", "ring", "ring2"], "dps", "shared", true), true);
  assert.equal(shouldUseSharedMateriaCompensation(
    ["VPR", "MCH"], ["earrings", "necklace", "bracelet", "rings"], "dps", "shared"), false);
  assert.equal(shouldUseSharedMateriaCompensation(
    ["RPR", "SAM"], ["earrings", "necklace", "bracelet", "rings"], "damage", "shared"), false);
  assert.equal(shouldUseSharedMateriaCompensation(
    ["RPR", "SAM"], ["earrings", "necklace", "bracelet", "rings"], "dps", "independent"), false);
  assert.equal(shouldUseSharedMateriaCompensation(
    ["RPR", "SAM"], ["head", "earrings", "necklace", "bracelet", "rings"], "dps", "shared"), false);
});

test("adds a main-stat support row only to the slower PCT baseline for the measured RDM+PCT case", () => {
  const jobs = ["RDM", "PCT"];
  const slots = ["head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet"];
  assert.equal(shouldUseMainStatResourceSupportForBaseline(jobs, slots, "dps", "shared"), true);
  assert.equal(shouldUseMainStatResourceSupportForBaselineJob(jobs, "PCT", slots, "dps", "shared"), true);
  assert.equal(shouldUseMainStatResourceSupportForBaselineJob(jobs, "RDM", slots, "dps", "shared"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaselineJob(jobs, "PCT", slots, "damage", "shared"), false);
  assert.equal(shouldUseMainStatResourceSupportForBaselineJob(jobs, "PCT", slots, "dps", "independent"), false);
});

test("selects the recorded resource-bound profile from job count, sync, range, and sharing topology", () => {
  const vprMchWide = resourceBudgetCandidateProfileForSearch({
    jobs: ["VPR", "MCH"].map((jobId) => ({
      jobId, minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    })),
    commonSlots: ["earrings", "necklace", "bracelet", "rings"],
    objective: "dps",
    foodStrategy: "shared",
  });
  assert.equal(vprMchWide, "weighted");

  const fiveJobIndependent = resourceBudgetCandidateProfileForSearch({
    jobs: ["BRD", "DNC", "MCH", "NIN", "VPR"].map((jobId) => ({
      jobId, minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    })),
    commonSlots: [],
    objective: "dps",
    foodStrategy: "independent",
  });
  assert.equal(fiveJobIndependent, "uniform-only");

  const fourJobUnsynced = resourceBudgetCandidateProfileForSearch({
    jobs: ["BRD", "DNC", "MCH", "VPR"].map((jobId) => ({
      jobId, minItemLevel: 770, maxItemLevel: 795,
    })),
    commonSlots: [],
    objective: "dps",
    foodStrategy: "independent",
  });
  assert.equal(fourJobUnsynced, "disabled");

  const splitRings = resourceBudgetCandidateProfileForSearch({
    jobs: ["RPR", "SAM"].map((jobId) => ({
      jobId, minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    })),
    commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"],
    objective: "dps",
    foodStrategy: "shared",
  });
  assert.equal(splitRings, "disabled");

  const sharedWideFourJob = resourceBudgetCandidateProfileForSearch({
    jobs: ["BRD", "DNC", "MCH", "VPR"].map((jobId) => ({
      jobId, minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    })),
    commonSlots: ["earrings", "necklace", "bracelet", "rings"],
    objective: "dps",
    foodStrategy: "shared",
  });
  assert.equal(sharedWideFourJob, "default");
});

test("restores weighted compact candidate-support rows only for the recorded four-job unsynced domain", () => {
  assert.equal(candidateResourceSupportProfileForSearch({
    jobs: ["BRD", "DNC", "MCH", "VPR"].map((jobId) => ({
      jobId, minItemLevel: 770, maxItemLevel: 795,
    })),
    candidateCount: 2_981,
    commonSlots: [],
    objective: "dps",
    foodStrategy: "independent",
  }), "compact-weighted");
  assert.equal(candidateResourceSupportProfileForSearch({
    jobs: ["BRD", "DNC", "MCH", "VPR"].map((jobId) => ({
      jobId, minItemLevel: 715, maxItemLevel: 795, syncLevel: 735,
    })),
    candidateCount: 2_981,
    commonSlots: ["earrings", "necklace", "bracelet", "rings"],
    objective: "dps",
    foodStrategy: "shared",
  }), "compact");
});

