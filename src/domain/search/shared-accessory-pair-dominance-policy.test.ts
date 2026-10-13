import assert from "node:assert/strict";
import { test } from "vitest";
import {
  canUseSharedAccessoryPairDominance,
  hasSharedAccessoryPairDominancePath,
  markSharedAccessoryPairDominancePath,
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

test("完整且受信的五职业共享 DPS 场景可启用严格支配", () => {
  assert.equal(canUseSharedAccessoryPairDominance(gateInput()), true);
});

test("完整且受信的四职业共享 DPS 场景可启用严格支配", () => {
  assert.equal(canUseSharedAccessoryPairDominance(gateInput(["BRD", "DNC", "MCH", "VPR"])), true);
  assert.equal(canUseSharedAccessoryPairDominance(gateInput(["VPR", "MCH", "DNC", "BRD"])), true);
});

test("直接调用设置布尔选项不足以启用严格支配", () => {
  assert.equal(canUseSharedAccessoryPairDominance({
    ...gateInput(),
    trustedPolicyPath: false,
  }), false);
});

test("不支持的职业组、目标、槽位投影或属性提取器都会关闭严格支配", () => {
  assert.equal(canUseSharedAccessoryPairDominance(gateInput(["MCH", "RDM"])), false);
  assert.equal(canUseSharedAccessoryPairDominance(gateInput(["VPR", "MCH"])), false);
  assert.equal(canUseSharedAccessoryPairDominance(gateInput(["BRD", "DNC", "MCH", "NIN"])), false);
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
