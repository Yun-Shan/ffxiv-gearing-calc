import { expect, test } from "vitest";
import { findBestJointLoadoutV3 } from "./coordinator.ts";
import { contextFor, equip, optionsFor } from "./fixtures.helper.test.ts";
import { findBestLoadoutExactMip } from "../loadout-finder-exact-mip.ts";
import { prepareJointIdentity } from "../exact-mip/joint-identity.ts";
import type { JointSearchOptions } from "../exact-mip/joint-types.ts";
import type { RingPairCandidate } from "../exact-mip/ring-domain.ts";
import { prepareJointJobs } from "../exact-mip/joint-preparation.ts";
import { assembleJointModel } from "../exact-mip/joint-model.ts";

test.each(["auto", "on", "off"] as const)("candidate dominance %s controls the actual baseline candidate domain", async (mode) => {
  const context = contextFor([[equip(1), equip(2, [90, 2900, 300, 200, 100, 100, 0])]]);
  let candidateCount: number | undefined;
  const result = await findBestJointLoadoutV3({
    ...optionsFor([context]),
    commonSlots: [],
    strategies: { candidateDominance: mode },
    baselineExecutor: async (tasks) => {
      candidateCount = tasks[0]!.slots[0]!.length;
      expect(tasks[0]!.strategies?.candidateDominance).toBe(mode);
      return Promise.all(tasks.map((task) => findBestLoadoutExactMip(task)));
    },
  });
  expect(result?.proof.complete).toBe(true);
  expect(candidateCount).toBe(mode === "off" ? 2 : 1);
  expect(result!.jobResults.SAM!.selection[0]!.itemId).toBe(1);
});

test.each(["auto", "on", "off"] as const)("ring symmetry %s changes representation only with a full legal-domain certificate", (mode) => {
  const first = equip(1, [0, 0, 100, 0, 0, 0, 0], { isUnique: true });
  const second = equip(2, [0, 0, 0, 100, 0, 0, 0], { isUnique: false });
  const pair: RingPairCandidate = {
    ...equip(100, [0, 0, 100, 100, 0, 0, 0]),
    ringEquips: [first, second],
    ringUniqueByItemId: [[1, true], [2, false]],
  };
  const context = contextFor([[pair]], ["rings"]);
  const job = { ...context.job, baseline: context.factorEvaluator([100, 3000, 400, 300, 200, 100, 0])! };
  const options: JointSearchOptions = {
    jobs: [job], commonSlots: ["rings"], sharedFood: false, objective: "damage",
    equipmentIdentity: ({ key }) => key, foodIdentity: ({ key }) => key,
    strategies: { ringSymmetry: mode },
  };
  expect(prepareJointIdentity(options).activeRingSplits[0] !== undefined).toBe(mode !== "off");
  // `on` must retain the original representation when the complete unique
  // metadata cannot be checked.
  delete pair.ringUniqueByItemId;
  expect(prepareJointIdentity({ ...options, strategies: { ringSymmetry: "on" } }).activeRingSplits[0]).toBeUndefined();
});

test.each(["auto", "on", "off"] as const)("shared bounds %s preserve mandatory physical-identity links", async (mode) => {
  const contexts = [contextFor(), contextFor(undefined, undefined, "other")];
  const options: JointSearchOptions = {
    jobs: contexts.map((context) => ({ ...context.job,
      baseline: context.factorEvaluator([100, 3000, 400, 300, 200, 100, 0])!,
    })),
    commonSlots: ["body"], sharedFood: false, objective: "damage",
    equipmentIdentity: ({ key }) => key, foodIdentity: ({ key }) => key,
    strategies: { jointSharedBounds: mode },
  };
  const identity = prepareJointIdentity(options);
  const preparation = await prepareJointJobs(options, identity, () => false);
  expect(preparation).toBeDefined();
  const model = assembleJointModel(options, preparation!.preparedJobs, identity, preparation!);
  expect(model).toBeDefined();
  expect(model!.rows.some(({ name }) => name.startsWith("shared_profile_"))).toBe(mode !== "off");
  expect(model!.rows.some(({ name }) => name.startsWith("link_equipment_"))).toBe(true);
  expect(model!.sharedEquipmentSelectors.get("body")?.size).toBe(1);
});

test.each(["auto", "on", "off"] as const)("joint factor cuts %s control the optional individual surrogate bound", async (mode) => {
  const contexts = [contextFor(), contextFor(undefined, undefined, "other")];
  const options: JointSearchOptions = {
    jobs: contexts.map((context) => ({ ...context.job,
      baseline: context.factorEvaluator([100, 3000, 400, 300, 200, 100, 0])!,
    })),
    commonSlots: ["body"], sharedFood: false, objective: "damage",
    equipmentIdentity: ({ key }) => key, foodIdentity: ({ key }) => key,
    strategies: { jointFactorCuts: mode },
  };
  const identity = prepareJointIdentity(options);
  const preparation = await prepareJointJobs(options, identity, () => false);
  const model = assembleJointModel(options, preparation!.preparedJobs, identity, preparation!);
  expect(model!.rows.filter(({ name }) => name.startsWith("solo_bound_"))).toHaveLength(mode === "off" ? 0 : 2);
  expect(model!.jobSurrogates).toHaveLength(2);
  expect(model!.rows.some(({ name }) => name.startsWith("link_equipment_"))).toBe(true);
});
