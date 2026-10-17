import { describe, expect, it } from "vitest";
import { makeConfig } from "@/ui/services/app-config";
import {
  effectiveConfigRows,
  jointJobSummaryRows,
  jointSharedSummaryRows,
} from "./joint-workbench-model";
import {
  jointWorkbenchDraftFromConfig,
  compileJointWorkbenchDraft,
  createJointWorkbenchRuntime,
} from "./joint-workbench-state";

describe("jointWorkbenchDraftFromConfig", () => {
  it("uses the same effective restrictions in draft and frozen summaries", () => {
    const first = {
      ...makeConfig("RDM"),
      excludedSources: ["测试来源"],
      excludedGearIds: [123],
      forcedGear: { head: 456, weapon: 789 },
    };
    const second = {
      ...makeConfig("BLM"),
      excludedSources: ["测试来源"],
      excludedGearIds: [123],
      forcedGear: { head: 456 },
    };
    const draft = jointWorkbenchDraftFromConfig({
      jobs: [first, second],
      commonSlots: ["head"],
      foodStrategy: "shared",
    });
    const config = compileJointWorkbenchDraft(
      draft,
      createJointWorkbenchRuntime(draft.jobs),
    );
    expect(jointJobSummaryRows(draft, config.jobs[0]!)).toEqual(
      effectiveConfigRows(config.jobs[0]!),
    );
    expect(jointJobSummaryRows(draft, config.jobs[0]!)).toEqual(
      expect.arrayContaining([{ label: "强制装备", value: "2 项" }]),
    );
    expect(
      jointJobSummaryRows(draft, config.jobs[0]!).map((row) => row.label),
    ).not.toContain("最低坚韧");
    expect(jointSharedSummaryRows(config)).toEqual(
      expect.arrayContaining([
        { label: "来源排除", value: "测试来源" },
        { label: "装备排除", value: "1 项" },
        { label: "强制装备", value: "1 项" },
      ]),
    );
    expect(effectiveConfigRows(config.jobs[0]!, 80)).toContainEqual({
      label: "公式等级",
      value: "80 级",
    });
    expect(
      effectiveConfigRows(makeConfig("PLD")).map((row) => row.label),
    ).toContain("最低坚韧");
  });

  it("keeps both shared ring markers and effective equipment restrictions", () => {
    const first = {
      ...makeConfig("PLD"),
      excludedSources: ["零式/重量级"],
      excludedGearIds: [123],
      forcedGear: { head: 456 },
    };
    const second = { ...makeConfig("WAR"), excludedSources: ["零式/重量级"] };
    const draft = jointWorkbenchDraftFromConfig({
      jobs: [first, second],
      commonSlots: ["rings"],
      foodStrategy: "shared",
    });
    const config = compileJointWorkbenchDraft(
      draft,
      createJointWorkbenchRuntime(draft.jobs),
    );
    for (const job of config.jobs)
      expect(job.sharedSlots).toEqual(["ring", "ring2"]);
    expect(effectiveConfigRows(config.jobs[0]!)).toEqual(
      expect.arrayContaining([
        { label: "来源排除", value: "零式/重量级" },
        { label: "装备排除", value: "1 项" },
        { label: "强制装备", value: "1 项" },
      ]),
    );
  });

  it("restores a shared-slot force when only one job stores the force", () => {
    const first = makeConfig("PLD");
    const second = makeConfig("WAR");
    first.forcedGear = { ...first.forcedGear, head: 12345 };

    const draft = jointWorkbenchDraftFromConfig({
      jobs: [first, second],
      commonSlots: ["head"],
      foodStrategy: "shared",
    });

    expect(draft.shared.equipment.shared.forcedGear.head).toBe(12345);
    expect(draft.shared.equipment.jobs.PLD?.forcedGear.head).toBeUndefined();
    expect(draft.shared.equipment.jobs.WAR?.forcedGear.head).toBeUndefined();
    expect(
      compileJointWorkbenchDraft(
        draft,
        createJointWorkbenchRuntime(draft.jobs),
      ).jobs.map((job) => job.forcedGear.head),
    ).toEqual([12345, 12345]);
  });

  it("restores a shared force from a single-job legacy snapshot", () => {
    const job = makeConfig("PLD");
    job.forcedGear = { ...job.forcedGear, head: 67890 };

    const draft = jointWorkbenchDraftFromConfig({
      jobs: [job],
      commonSlots: ["head"],
      foodStrategy: "shared",
    });

    expect(draft.shared.equipment.shared.forcedGear.head).toBe(67890);
    expect(draft.shared.equipment.jobs.PLD?.forcedGear.head).toBeUndefined();
  });

  it("rejects conflicting forces on a shared slot", () => {
    const first = makeConfig("PLD");
    const second = makeConfig("WAR");
    first.forcedGear = { ...first.forcedGear, head: 12345 };
    second.forcedGear = { ...second.forcedGear, head: 67890 };

    expect(() =>
      jointWorkbenchDraftFromConfig({
        jobs: [first, second],
        commonSlots: ["head"],
        foodStrategy: "shared",
      }),
    ).toThrow("多个不同强制装备");
  });
});
