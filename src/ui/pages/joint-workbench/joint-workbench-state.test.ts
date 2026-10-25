import { describe, expect, it } from "vitest";
import { foods, gameData } from "@/domain";
import { makeConfig } from "@/ui/services/app-config";
import {
  effectiveConfigRows,
  jointJobSummaryRows,
  jointSharedSummaryRows,
} from "./joint-workbench-model";
import {
  jobConditionForEffectiveFood,
  jointJobConditionFromEffectiveDraft,
  jointWorkbenchDraftFromConfig,
  compileJointWorkbenchDraft,
  createJointWorkbenchDraft,
  createJointWorkbenchRuntime,
} from "./joint-workbench-state";

describe("joint search range", () => {
  it("saves the selected duty for every job and restores it in the shared range and all summaries", () => {
    const duty = gameData.sync.groups.flatMap(({ options }) => options).find(({ target }) => target.kind === "itemLevel")!;
    const draft = createJointWorkbenchDraft(["PLD", "WAR"]);
    for (const condition of Object.values(draft.conditions)) condition.gcd = { mode: "any" };
    draft.shared.range = { ...draft.shared.range, sync: duty.target, syncDuty: duty.name };
    const config = compileJointWorkbenchDraft(draft, createJointWorkbenchRuntime(draft.jobs));
    expect(config.jobs.every((job) => job.syncDuty === duty.name)).toBe(true);
    const expectedRow = { label: "同步目标", value: `${duty.name}(品级${duty.target.value})` };
    expect(jointSharedSummaryRows(config)).toContainEqual(expectedRow);
    for (const job of config.jobs) {
      expect(jointJobSummaryRows(draft, job)).toContainEqual(expectedRow);
      expect(effectiveConfigRows(job)).toContainEqual(expectedRow);
    }
    expect(jointWorkbenchDraftFromConfig(config).shared.range).toMatchObject({ sync: duty.target, syncDuty: duty.name });
  });

  it("selects shared slots by job gear group", () => {
    const draft = createJointWorkbenchDraft(["RDM", "BLM"]);
    for (const condition of Object.values(draft.conditions)) condition.gcd = { mode: "any" };
    expect(draft.shared.equipment.commonSlots).not.toContain("weapon");
    expect(draft.shared.equipment.commonSlots).toContain("body");
    expect(draft.shared.equipment.commonSlots).toContain("ring");
    expect(draft.shared.equipment.commonSlots).toContain("ring2");
    const config = compileJointWorkbenchDraft(
      draft,
      createJointWorkbenchRuntime(draft.jobs),
    );
    config.commonSlots.push("weapon");
    expect(() => jointWorkbenchDraftFromConfig(config)).toThrow("共享槽位配置无效");
  });

  it("shares only accessories across armor subgroups", () => {
    const draft = createJointWorkbenchDraft(["DRG", "SAM"]);
    expect(draft.shared.equipment.commonSlots).toEqual([
      "earrings",
      "necklace",
      "bracelet",
      "ring",
      "ring2",
    ]);
    const sameGroup = createJointWorkbenchDraft(["DRG", "RPR"]);
    expect(sameGroup.shared.equipment.commonSlots).toContain("body");
    expect(sameGroup.shared.equipment.commonSlots).not.toContain("weapon");
    expect(
      createJointWorkbenchDraft(["PLD", "WAR"]).shared.equipment.commonSlots,
    ).not.toContain("offhand");
  });

  it("keeps the search range in shared conditions and compiles it to every job", () => {
    const draft = createJointWorkbenchDraft(["RDM", "BLM"]);
    expect(draft.conditions.RDM).not.toHaveProperty("range");
    expect(draft.conditions.BLM).not.toHaveProperty("range");
    expect(draft.shared.range).toEqual({
      minItemLevel: makeConfig("RDM").minItemLevel,
      maxItemLevel: makeConfig("RDM").maxItemLevel,
      sync: undefined,
      clanIndex: 0,
    });

    const next = {
      ...draft,
      shared: {
        ...draft.shared,
        range: {
          minItemLevel: 735,
          maxItemLevel: 750,
          sync: { kind: "itemLevel" as const, value: 735 },
          clanIndex: 2,
        },
      },
    };
    const config = compileJointWorkbenchDraft(
      next,
      createJointWorkbenchRuntime(next.jobs),
    );
    for (const job of config.jobs) {
      expect(job.minItemLevel).toBe(735);
      expect(job.maxItemLevel).toBe(750);
      expect(job.sync).toEqual({ kind: "itemLevel", value: 735 });
      expect(job.clanIndex).toBe(2);
    }
    expect(jointSharedSummaryRows(config)).toEqual(
      expect.arrayContaining([
        { label: "种族", value: "精灵族 · 森林之民" },
        { label: "装备品级", value: "735–750" },
        { label: "同步目标", value: "735" },
      ]),
    );
  });

  it("rejects restoring a snapshot whose jobs use different search ranges", () => {
    const first = {
      ...makeConfig("RDM"),
      minItemLevel: 700,
      maxItemLevel: 750,
    };
    const second = makeConfig("BLM");
    expect(() =>
      jointWorkbenchDraftFromConfig({
        objective: "damage",
        jobs: [first, second],
        commonSlots: [],
        foodStrategy: "shared",
      }),
    ).toThrow("装备品级范围、同步目标和族群必须一致");
  });
});

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
      objective: "damage",
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
    ).not.toContain("坚韧约束");
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
    ).toContain("坚韧约束");
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
      objective: "damage",
      jobs: [first, second],
      commonSlots: ["ring", "ring2"],
      foodStrategy: "shared",
    });
    const config = compileJointWorkbenchDraft(
      draft,
      createJointWorkbenchRuntime(draft.jobs),
    );
    expect(config.commonSlots).toEqual(["ring", "ring2"]);
    expect(effectiveConfigRows(config.jobs[0]!)).toEqual(
      expect.arrayContaining([
        { label: "来源排除", value: "零式/重量级" },
        { label: "装备排除", value: "1 项" },
        { label: "强制装备", value: "1 项" },
      ]),
    );
  });

  it("restores copied structured forces as shared only when their full values match", () => {
    const first = makeConfig("PLD");
    const second = makeConfig("WAR");
    const sharedValue = {
      id: 12345,
      melds: [{ stat: "CRT" as const, value: 54, grade: 12 }, null],
    };
    first.forcedGear = { ...first.forcedGear, head: sharedValue };
    second.forcedGear = {
      ...second.forcedGear,
      head: JSON.parse(JSON.stringify(sharedValue)),
    };

    const draft = jointWorkbenchDraftFromConfig({
      objective: "damage",
      jobs: [first, second],
      commonSlots: ["head"],
      foodStrategy: "shared",
    });
    expect(draft.shared.equipment.shared.forcedGear!.head).toEqual(sharedValue);
    expect(draft.shared.equipment.jobs.PLD?.forcedGear!.head).toBeUndefined();
    expect(draft.shared.equipment.jobs.WAR?.forcedGear!.head).toBeUndefined();
    expect(
      compileJointWorkbenchDraft(
        draft,
        createJointWorkbenchRuntime(draft.jobs),
      ).jobs.map((job) => job.forcedGear!.head),
    ).toEqual([sharedValue, sharedValue]);

    second.forcedGear!.head = { ...sharedValue, melds: [null, null] };
    expect(() =>
      jointWorkbenchDraftFromConfig({
        objective: "damage",
        jobs: [first, second],
        commonSlots: ["head"],
        foodStrategy: "shared",
      }),
    ).toThrow("强制配置必须在所有职业中一致");
  });

  it("rejects conflicting forces on a shared slot", () => {
    const first = makeConfig("PLD");
    const second = makeConfig("WAR");
    first.forcedGear = { ...first.forcedGear, head: 12345 };
    second.forcedGear = { ...second.forcedGear, head: 67890 };

    expect(() =>
      jointWorkbenchDraftFromConfig({
        objective: "damage",
        jobs: [first, second],
        commonSlots: ["head"],
        foodStrategy: "shared",
      }),
    ).toThrow("强制配置必须在所有职业中一致");
  });
});

describe("joint shared food edits", () => {
  it("keeps the job's independent food when editing non-food fields in shared mode", () => {
    const draft = createJointWorkbenchDraft(["RDM", "BLM"]);
    const independentFood = { mode: "specific" as const, foodId: foods[0]!.id };
    const sharedFood = { mode: "specific" as const, foodId: foods[1]!.id };
    const withFoods = {
      ...draft,
      conditions: {
        ...draft.conditions,
        RDM: { ...draft.conditions.RDM!, food: independentFood },
      },
      shared: {
        ...draft.shared,
        foodStrategy: "shared" as const,
        food: sharedFood,
      },
    };
    const effective = jobConditionForEffectiveFood(withFoods, "RDM");
    expect(effective.food).toEqual(sharedFood);

    const changed = { ...effective, gcd: { ...effective.gcd } };
    expect(
      jointJobConditionFromEffectiveDraft(withFoods, "RDM", changed).food,
    ).toEqual(independentFood);
  });
});
