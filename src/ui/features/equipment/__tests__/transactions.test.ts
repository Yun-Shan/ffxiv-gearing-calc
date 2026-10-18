import { describe, expect, it } from "vitest";
import type { Gear, GearSlot, JobId } from "@/domain";
import type { JointEquipmentDraft, SingleEquipmentDraft } from "../types";
import {
  allowedForcedGearSlots,
  applyJointEquipmentAction,
  applySingleEquipmentAction,
  equipmentTypeForSlot,
  hasPrivatePositionForType,
  updateJointSharedSlots,
} from "../transactions";

function gear(id: number, slot: GearSlot, source = "raid/alpha"): Gear {
  return {
    id,
    name: `Gear ${id}`,
    slot,
    rawSlot: 0,
    level: 795,
    equipLevel: 100,
    roleId: 0,
    jobCategory: 0,
    stats: {},
    materiaSlots: 2,
    jobs: ["RDM", "GNB"],
    sourceFile: "test",
    source,
  };
}

const items = new Map([
  [1, gear(1, "head")],
  [2, gear(2, "head", "crafted/alpha")],
  [3, gear(3, "ring")],
  [4, { ...gear(4, "ring"), unique: true }],
]);
const lookup = (id: number) => items.get(id);
const jobSlots: Partial<Record<JobId, readonly GearSlot[]>> = {
  RDM: ["head", "ring", "ring2"],
  GNB: ["head", "ring", "ring2"],
};

function jointState(
  overrides: Partial<JointEquipmentDraft> = {},
): JointEquipmentDraft {
  return {
    commonSlots: ["head", "ring"],
    shared: { excludedSources: [], excludedGearIds: [], forcedGear: {} },
    jobs: {
      RDM: { excludedGearIds: [], forcedGear: {} },
      GNB: { excludedGearIds: [], forcedGear: {} },
    },
    ...overrides,
  };
}

const txOptions = {
  lookup,
  jobSlots,
  sharedSlots: ["head", "ring"] as GearSlot[],
};

describe("equipment scope transactions", () => {
  it.each(["ring", "ring2"] as const)(
    "rejects duplicate unique rings in %s atomically, but allows non-unique duplicates",
    (slot) => {
      const other = slot === "ring" ? "ring2" : "ring";
      for (const gearId of [3, 4]) {
        const draft: SingleEquipmentDraft = {
          excludedSources: ["raid/"],
          excludedGearIds: [gearId],
          forcedGear: { [other]: gearId },
        };
        const result = applySingleEquipmentAction(
          draft,
          { type: "set-force", slot, gearId },
          lookup,
        );
        expect(result.accepted).toBe(gearId === 3);
        if (gearId === 4) {
          expect(result.reason).toBe("unique-ring");
          expect(result.state).toBe(draft);
          expect(draft.excludedGearIds).toEqual([4]);
        }
      }
    },
  );

  it.each(["ring", "ring2"] as const)(
    "checks unique rings across shared and job scopes for %s",
    (sharedSlot) => {
      const privateSlot = sharedSlot === "ring" ? "ring2" : "ring";
      const state = jointState({ commonSlots: [sharedSlot] });
      state.shared.forcedGear[sharedSlot] = 4;
      const jobResult = applyJointEquipmentAction(
        state,
        { kind: "joint-job", jobId: "RDM" },
        { type: "set-force", slot: privateSlot, gearId: 4 },
        txOptions,
      );
      expect(jobResult).toEqual({
        state,
        accepted: false,
        reason: "unique-ring",
      });
      expect(jobResult.state).toBe(state);

      const reverse = jointState({ commonSlots: [sharedSlot] });
      reverse.jobs.GNB!.forcedGear[privateSlot] = 4;
      const sharedResult = applyJointEquipmentAction(
        reverse,
        { kind: "joint-shared" },
        { type: "set-force", slot: sharedSlot, gearId: 4 },
        txOptions,
      );
      expect(sharedResult).toEqual({
        state: reverse,
        accepted: false,
        reason: "unique-ring",
      });
      expect(sharedResult.state).toBe(reverse);
    },
  );

  it("checks both shared rings and both private rings without forbidding the same unique ring on different jobs", () => {
    const shared = jointState({ commonSlots: ["rings"] });
    shared.shared.forcedGear.ring = 4;
    expect(
      applyJointEquipmentAction(
        shared,
        { kind: "joint-shared" },
        { type: "set-force", slot: "ring2", gearId: 4 },
        txOptions,
      ).accepted,
    ).toBe(false);
    const privateState = jointState({ commonSlots: [] });
    privateState.jobs.RDM!.forcedGear.ring = 4;
    expect(
      applyJointEquipmentAction(
        privateState,
        { kind: "joint-job", jobId: "RDM" },
        { type: "set-force", slot: "ring2", gearId: 4 },
        txOptions,
      ).accepted,
    ).toBe(false);
    expect(
      applyJointEquipmentAction(
        privateState,
        { kind: "joint-job", jobId: "GNB" },
        { type: "set-force", slot: "ring2", gearId: 4 },
        txOptions,
      ).accepted,
    ).toBe(true);
  });

  it("clears same-scope force when excluding an item and clears same-scope item/source exclusions when forcing it", () => {
    const original: SingleEquipmentDraft = {
      excludedSources: ["raid/"],
      excludedGearIds: [1],
      forcedGear: { head: 1 },
    };
    const forced = applySingleEquipmentAction(
      original,
      { type: "set-force", slot: "head", gearId: 1 },
      lookup,
    );
    expect(forced.state).toMatchObject({
      excludedSources: [],
      excludedGearIds: [],
      forcedGear: { head: 1 },
    });
    const excluded = applySingleEquipmentAction(
      forced.state,
      { type: "add-gear-exclusion", gearId: 1 },
      lookup,
    );
    expect(excluded.state.forcedGear).toEqual({});
    expect(excluded.state.excludedGearIds).toEqual([1]);
  });

  it("shared exclusions clear conflicting shared and job forces, including source matches", () => {
    const state = jointState({
      shared: {
        excludedSources: [],
        excludedGearIds: [],
        forcedGear: { head: 1 },
      },
      jobs: {
        RDM: { excludedGearIds: [], forcedGear: { ring2: 1 } },
        GNB: { excludedGearIds: [], forcedGear: { head: 2 } },
      },
    });
    const byItem = applyJointEquipmentAction(
      state,
      { kind: "joint-shared" },
      { type: "add-gear-exclusion", gearId: 1 },
      txOptions,
    );
    expect(byItem.state.shared.forcedGear).toEqual({});
    expect(byItem.state.jobs.RDM?.forcedGear).toEqual({});
    expect(byItem.state.jobs.GNB?.forcedGear).toEqual({ head: 2 });

    const bySource = applyJointEquipmentAction(
      state,
      { kind: "joint-shared" },
      { type: "add-source-exclusion", source: "raid/" },
      txOptions,
    );
    expect(bySource.state.jobs.RDM?.forcedGear).toEqual({});
    expect(bySource.state.jobs.GNB?.forcedGear).toEqual({ head: 2 });
    expect(bySource.state.shared.excludedSources).toEqual(["raid/"]);
  });

  it("rejects a job exclusion that conflicts with shared force without changing state", () => {
    const state = jointState({
      shared: {
        excludedSources: [],
        excludedGearIds: [],
        forcedGear: { ring: 3 },
      },
    });
    const result = applyJointEquipmentAction(
      state,
      { kind: "joint-job", jobId: "RDM" },
      { type: "add-gear-exclusion", gearId: 3 },
      txOptions,
    );
    expect(result).toEqual({
      state,
      accepted: false,
      reason: "shared-restriction",
    });
  });

  it("rejects shared force when any job excludes the item, without deleting that job restriction", () => {
    const state = jointState({
      jobs: {
        RDM: { excludedGearIds: [1], forcedGear: {} },
        GNB: { excludedGearIds: [], forcedGear: {} },
      },
    });
    const result = applyJointEquipmentAction(
      state,
      { kind: "joint-shared" },
      { type: "set-force", slot: "head", gearId: 1 },
      txOptions,
    );
    expect(result).toEqual({
      state,
      accepted: false,
      reason: "job-restriction",
    });
  });

  it("rejects job force under shared source or item exclusions and preserves the shared restriction", () => {
    const state = jointState({
      shared: {
        excludedSources: ["raid/"],
        excludedGearIds: [],
        forcedGear: {},
      },
    });
    const result = applyJointEquipmentAction(
      state,
      { kind: "joint-job", jobId: "RDM" },
      { type: "set-force", slot: "ring2", gearId: 1 },
      txOptions,
    );
    expect(result).toEqual({
      state,
      accepted: false,
      reason: "shared-restriction",
    });
    expect(result.state.shared.excludedSources).toEqual(["raid/"]);
  });

  it("allows ring exclusion while one ring position remains private, then prunes it when both become shared", () => {
    const state = jointState({ commonSlots: ["ring"] });
    expect(equipmentTypeForSlot("ring2")).toBe("ring");
    expect(
      hasPrivatePositionForType("RDM", "ring", state.commonSlots, jobSlots),
    ).toBe(true);
    const excluded = applyJointEquipmentAction(
      state,
      { kind: "joint-job", jobId: "RDM" },
      { type: "add-gear-exclusion", gearId: 3 },
      txOptions,
    );
    expect(excluded.accepted).toBe(true);
    expect(excluded.state.jobs.RDM?.excludedGearIds).toEqual([3]);
    const privateless = updateJointSharedSlots(excluded.state, ["rings"], {
      lookup,
      jobSlots,
    });
    expect(privateless.jobs.RDM?.excludedGearIds).toEqual([]);
    expect(
      hasPrivatePositionForType(
        "RDM",
        "ring",
        privateless.commonSlots,
        jobSlots,
      ),
    ).toBe(false);
  });

  it("clears force in the narrower scope when a position changes ownership and does not migrate it", () => {
    const state = jointState({
      shared: {
        excludedSources: [],
        excludedGearIds: [],
        forcedGear: { head: 2 },
      },
      jobs: { RDM: { excludedGearIds: [], forcedGear: { ring2: 3 } } },
    });
    const allShared = updateJointSharedSlots(state, ["head", "rings"], {
      lookup,
      jobSlots,
    });
    expect(allShared.shared.forcedGear).toEqual({ head: 2 });
    expect(allShared.jobs.RDM?.forcedGear).toEqual({});
    const headPrivate = updateJointSharedSlots(allShared, ["rings"], {
      lookup,
      jobSlots,
    });
    expect(headPrivate.shared.forcedGear).toEqual({});
  });

  it("derives forced slots from scope ownership", () => {
    expect(
      allowedForcedGearSlots(
        { kind: "joint-shared" },
        ["head", "ring", "ring2"],
        ["head", "rings"],
      ),
    ).toEqual(["head", "ring", "ring2"]);
    expect(
      allowedForcedGearSlots(
        { kind: "joint-job", jobId: "RDM" },
        ["head", "ring", "ring2"],
        ["head", "ring"],
      ),
    ).toEqual(["ring2"]);
  });
  it("rejects a shared force when ownership has no shared positions", () => {
    const original = jointState({ commonSlots: [] });
    const result = applyJointEquipmentAction(
      original,
      { kind: "joint-shared" },
      { type: "set-force", slot: "head", gearId: 1 },
      { ...txOptions, sharedSlots: [] },
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("not-shared");
    expect(result.state).toBe(original);
  });
});

describe("bulk source exclusions", () => {
  it("updates all source leaves atomically and clears every conflicting single-job force", () => {
    const draft: SingleEquipmentDraft = {
      excludedSources: ["old"],
      excludedGearIds: [99],
      forcedGear: { head: 1, ring: 3 },
    };
    const result = applySingleEquipmentAction(
      draft,
      {
        type: "set-source-exclusions",
        sources: ["raid/alpha", "crafted/alpha"],
      },
      lookup,
    );
    expect(result.state.excludedSources).toEqual([
      "raid/alpha",
      "crafted/alpha",
    ]);
    expect(result.state.forcedGear).toEqual({});
    expect(result.state.excludedGearIds).toEqual([99]);
    expect(draft.forcedGear).toEqual({ head: 1, ring: 3 });
  });
  it("clears shared and private force conflicts in one shared-source update and rejects private-source changes", () => {
    const state = jointState({
      shared: {
        excludedSources: ["old"],
        excludedGearIds: [],
        forcedGear: { head: 1 },
      },
      jobs: {
        RDM: { excludedGearIds: [], forcedGear: { ring2: 3 } },
        GNB: { excludedGearIds: [], forcedGear: { ring2: 2 } },
      },
    });
    const action = {
      type: "set-source-exclusions" as const,
      sources: ["raid/alpha", "crafted/alpha"],
    };
    const result = applyJointEquipmentAction(
      state,
      { kind: "joint-shared" },
      action,
      txOptions,
    );
    expect(result.accepted).toBe(true);
    expect(result.state.shared.excludedSources).toEqual(action.sources);
    expect(result.state.shared.forcedGear).toEqual({});
    expect(result.state.jobs.RDM!.forcedGear).toEqual({});
    expect(result.state.jobs.GNB!.forcedGear).toEqual({});
    expect(
      applyJointEquipmentAction(
        state,
        { kind: "joint-job", jobId: "RDM" },
        action,
        txOptions,
      ).accepted,
    ).toBe(false);
  });
});
