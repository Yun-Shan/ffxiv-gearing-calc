import assert from "node:assert/strict";
import { test } from "vitest";
import {
  canUseSharedAccessoryPairDominance,
  hasSharedAccessoryPairDominancePath,
  markSharedAccessoryPairDominancePath,
  sharedAccessoryPairDominanceLimitsFor,
  type SharedAccessoryPairDominanceGateInput,
} from "./shared-accessory-pair-dominance-policy.js";

const jobIds = ["BRD", "DNC", "MCH", "NIN", "VPR"] as const;

function gateInput(ids: readonly string[] = jobIds): SharedAccessoryPairDominanceGateInput {
  return {
    trustedPolicyPath: true,
    requested: true,
    jobs: ids.map((id) => ({
      id,
      job: id,
      objective: "dps",
      hasCanonicalEvaluator: true,
      hasCustomAttributeExtractor: false,
      hasConstraints: false,
    })),
    commonSlots: ["bracelet", "earrings", "necklace", "ring", "ring2"],
    hasCommonSlotProjections: false,
    sharedFood: true,
    objective: "dps",
    canonicalSharedRingPair: true,
  };
}

test("受信的二至五职业共享饰品 DPS 场景都可启用严格支配", () => {
  for (const ids of [
    ["VPR", "MCH"],
    ["BRD", "DNC", "MCH"],
    ["BRD", "DNC", "MCH", "VPR"],
    jobIds,
  ]) {
    assert.equal(canUseSharedAccessoryPairDominance(gateInput(ids)), true);
  }
  assert.equal(canUseSharedAccessoryPairDominance(gateInput(["MCH", "VPR"])), true);
});

test("门控覆盖五职业以上输入；性能评估范围由基准套件单独控制", () => {
  assert.equal(canUseSharedAccessoryPairDominance(gateInput([
    "BRD", "DNC", "MCH", "NIN", "VPR", "DRG",
  ])), true);
});

test("二/三职业按共享 pair 域大小使用较小的受限 cut 预算", () => {
  assert.deepEqual(sharedAccessoryPairDominanceLimitsFor(2, 1_323n), {
    maxCandidates: 50_000,
    maxComparisons: 75_000,
    maxCuts: 64,
    maxPreprocessingMs: 100,
  });
  assert.deepEqual(sharedAccessoryPairDominanceLimitsFor(3, 2_187n), {
    maxCandidates: 50_000,
    maxComparisons: 150_000,
    maxCuts: 128,
    maxPreprocessingMs: 100,
  });
  assert.deepEqual(sharedAccessoryPairDominanceLimitsFor(6, 2_187n), {
    maxCandidates: 50_000,
    maxComparisons: 300_000,
    maxCuts: 512,
    maxPreprocessingMs: 250,
  });
});

test("完整共享饰品对以外的额外共享槽不妨碍安全严格支配", () => {
  const input = gateInput(["BRD", "DNC", "MCH"]);
  input.commonSlots = [...input.commonSlots, "head", "body"];
  assert.equal(canUseSharedAccessoryPairDominance(input), true);
});

test("直接调用设置布尔选项不足以启用严格支配", () => {
  assert.equal(canUseSharedAccessoryPairDominance({
    ...gateInput(),
    trustedPolicyPath: false,
  }), false);
});

test("少于两个职业、目标不符、槽位不完整、投影或属性提取器都会关闭严格支配", () => {
  assert.equal(canUseSharedAccessoryPairDominance(gateInput(["MCH"])), false);
  assert.equal(canUseSharedAccessoryPairDominance({ ...gateInput(), objective: "damage" }), false);
  assert.equal(canUseSharedAccessoryPairDominance({ ...gateInput(), hasCommonSlotProjections: true }), false);
  assert.equal(canUseSharedAccessoryPairDominance({
    ...gateInput(),
    commonSlots: ["earrings", "necklace", "bracelet", "ring"],
  }), false);
  assert.equal(canUseSharedAccessoryPairDominance({ ...gateInput(), sharedFood: false }), false);

  const customExtractor = gateInput();
  customExtractor.jobs = customExtractor.jobs.map((job) => job.id === "VPR"
    ? { ...job, hasCustomAttributeExtractor: true }
    : job);
  assert.equal(canUseSharedAccessoryPairDominance(customExtractor), false);

  const nonDpsJob = gateInput();
  nonDpsJob.jobs = nonDpsJob.jobs.map((job) => job.id === "MCH"
    ? { ...job, objective: "damage" }
    : job);
  assert.equal(canUseSharedAccessoryPairDominance(nonDpsJob), false);
});

test("任何职业存在硬约束时都关闭严格支配", () => {
  const input = gateInput();
  input.jobs = input.jobs.map((job) => job.id === "MCH" ? { ...job, hasConstraints: true } : job);
  assert.equal(canUseSharedAccessoryPairDominance(input), false);

});

test("标记只认可被内部策略发放 capability 的对象", () => {
  const untrusted = {};
  assert.equal(hasSharedAccessoryPairDominancePath(untrusted), false);
  const trusted = markSharedAccessoryPairDominancePath({});
  assert.equal(hasSharedAccessoryPairDominancePath(trusted), true);
});
