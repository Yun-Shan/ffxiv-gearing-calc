import { describe, expect, it } from "vitest";
import { makeConfig } from "@/ui/services/app-config";
import { jobConditionDraftFromConfig } from "../draft";
import { conditionRows } from "../summary";
import type { TankConditionDraft } from "../types";

describe("tank condition summary", () => {
  it.each<[Partial<TankConditionDraft>, string]>([
    [{}, "未设置"],
    [{ minimumTenacity: 2300 }, "最低坚韧值2300"],
    [{ minimumDamageReductionPercent: 5.5 }, "最低减伤5.5%"],
    [{ maximizeTenacity: true }, "最大化减伤百分比"],
    [
      {
        minimumTenacity: 2300,
        minimumDamageReductionPercent: 5,
        maximizeTenacity: true,
      },
      "最低坚韧值2300、最低减伤5%、最大化减伤百分比",
    ],
  ])("summarizes the actual active constraints %j", (tank, expected) => {
    const draft = jobConditionDraftFromConfig(makeConfig("PLD"));
    draft.tank = { maximizeTenacity: false, ...tank };
    const rows = conditionRows(draft, "PLD");
    expect(rows.filter(({ label }) => label === "坚韧约束")).toEqual([
      { label: "坚韧约束", value: expected },
    ]);
    expect(
      rows.some(({ label }) =>
        ["最低坚韧", "最低减伤", "坚韧目标"].includes(label),
      ),
    ).toBe(false);
    expect(
      conditionRows(draft, "SAM").some(({ label }) => label === "坚韧约束"),
    ).toBe(false);
  });
});
