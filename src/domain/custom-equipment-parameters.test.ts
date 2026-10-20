import { describe, expect, it } from "vitest";
import { getGearById } from "./data.ts";
import {
  prepareCustomEquipmentParameters,
  initialCustomEquipmentParameters,
  customEquipmentParametersFromStats,
  evaluateCustomEquipmentParameters,
  type CustomEquipmentParameterDraft,
} from "./custom-equipment-parameters.ts";
import { validateCustomEquipmentStats } from "./fixed-gearset.ts";
import { customParameterMelds } from "./custom-gear-parameters.ts";

// Snapshot fixtures cross-checked with Lumina 2026.10.06 on 2026-10-20:
// MandervilleWeaponEnhance 39920/39939, Materia 1403/1405/1406/1408, ResistanceWeaponAdjust 33462/33479.
const sword = getGearById(39920)!;
const shield = getGearById(39939)!;
const resistanceSword = getGearById(33462)!;
const resistanceShield = getGearById(33479)!;
const choices: CustomEquipmentParameterDraft = {
  kind: "manderville",
  choices: ["CRT", "DET", "SKS"],
};

describe("custom equipment parameter drafts", () => {
  it("round-trips all legal Manderville weapon and shield allocations through the shared rules", () => {
    for (const gear of [sword, shield]) {
      const model = prepareCustomEquipmentParameters(gear, "PLD");
      for (const melds of customParameterMelds(gear)) {
        const stats = Object.fromEntries(model.attributes.map(({ stat, base }) => [stat, base]));
        for (const meld of melds) stats[meld.stat] = (stats[meld.stat] ?? 0) + meld.value;
        const before = structuredClone(stats);
        const draft = customEquipmentParametersFromStats(model, stats);
        expect(draft).toEqual({ kind: "manderville", choices: melds.map(({ stat }) => stat) });
        expect(evaluateCustomEquipmentParameters(model, draft).stats).toEqual(stats);
        expect(stats).toEqual(before);
      }
      expect(customEquipmentParametersFromStats(model, { CRT: 1 })).toEqual(initialCustomEquipmentParameters(model));
    }
  });

  it("restores Resistance values without sharing them and retains incomplete fields", () => {
    const model = prepareCustomEquipmentParameters(resistanceSword, "PLD");
    const stats = { TEN: 0, CRT: 150, DET: 150, SKS: 34 };
    const draft = customEquipmentParametersFromStats(model, stats);
    expect(draft).toEqual({ kind: "resistance", values: stats });
    expect(evaluateCustomEquipmentParameters(model, draft).stats).toEqual(stats);
    if (draft.kind !== "resistance") throw new Error("unexpected draft");
    draft.values.CRT = 0;
    expect(stats.CRT).toBe(150);
    expect(customEquipmentParametersFromStats(model, {})).toEqual({
      kind: "resistance", values: { TEN: null, CRT: null, DET: null, SKS: null },
    });
  });
  it("uses actual per-item Manderville values and preserves the fourth zero attribute", () => {
    const model = prepareCustomEquipmentParameters(sword, "PLD");
    expect(initialCustomEquipmentParameters(model)).toEqual({
      kind: "manderville",
      choices: ["", "", ""],
    });
    expect(evaluateCustomEquipmentParameters(model, choices).stats).toEqual({
      CRT: 209,
      DET: 209,
      SKS: 51,
      TEN: 0,
    });
    expect(
      evaluateCustomEquipmentParameters(
        prepareCustomEquipmentParameters(shield, "PLD"),
        choices,
      ).stats,
    ).toEqual({ CRT: 84, DET: 84, SKS: 21, TEN: 0 });
  });
  it("requires three distinct supported Manderville choices", () => {
    const model = prepareCustomEquipmentParameters(sword, "PLD");
    for (const choices of [
      ["CRT", "", ""],
      ["CRT", "DET"],
      ["CRT", "CRT", "SKS"],
      ["CRT", "DET", "DHT"],
    ] as const) {
      expect(
        evaluateCustomEquipmentParameters(model, {
          kind: "manderville",
          choices: [...choices],
        }).error,
      ).toBeDefined();
    }
  });
  it("uses separate weapon and shield Resistance budgets, including legal zero allocation", () => {
    const model = prepareCustomEquipmentParameters(resistanceSword, "PLD");
    expect(
      evaluateCustomEquipmentParameters(
        model,
        initialCustomEquipmentParameters(model),
      ),
    ).toEqual({ stats: { TEN: 0, CRT: 0, DET: 0, SKS: 0 }, total: 0 });
    expect(
      evaluateCustomEquipmentParameters(model, {
        kind: "resistance",
        values: { TEN: 0, CRT: 150, DET: 150, SKS: 34 },
      }),
    ).toEqual({ stats: { TEN: 0, CRT: 150, DET: 150, SKS: 34 }, total: 334 });
    expect(
      evaluateCustomEquipmentParameters(
        prepareCustomEquipmentParameters(resistanceShield, "PLD"),
        { kind: "resistance", values: { TEN: 0, CRT: 60, DET: 60, SKS: 14 } },
      ),
    ).toEqual({ stats: { TEN: 0, CRT: 60, DET: 60, SKS: 14 }, total: 134 });
  });
  it("rejects incomplete, fractional, out-of-range, unknown and over-budget values", () => {
    const model = prepareCustomEquipmentParameters(resistanceSword, "PLD");
    for (const values of [
      { TEN: 0, CRT: null, DET: 0, SKS: 0 },
      { CRT: 0, DET: 0, SKS: 0 },
      { TEN: 0, CRT: 151, DET: 0, SKS: 0 },
      { TEN: 0, CRT: -1, DET: 0, SKS: 0 },
      { TEN: 0, CRT: 1.5, DET: 0, SKS: 0 },
      { TEN: 0, CRT: 150, DET: 150, SKS: 35 },
      { TEN: 0, CRT: 0, DET: 0, SKS: 0, DHT: 1 },
    ]) {
      expect(
        evaluateCustomEquipmentParameters(model, { kind: "resistance", values })
          .error,
      ).toBeDefined();
    }
    expect(evaluateCustomEquipmentParameters(model, choices).error).toBe(
      "参数类型与装备不匹配。",
    );
  });
  it("retains absolute base parameters and never mutates the gear or the draft", () => {
    const gear = { ...sword, stats: { ...sword.stats, CRT: 10 } };
    const before = structuredClone(gear);
    const draft = structuredClone(choices);
    expect(
      evaluateCustomEquipmentParameters(
        prepareCustomEquipmentParameters(gear, "PLD"),
        draft,
      ).stats,
    ).toEqual({ CRT: 219, DET: 209, SKS: 51, TEN: 0 });
    expect(gear).toEqual(before);
    expect(draft).toEqual(choices);
  });
  it("fails explicitly on absent, ambiguous or malformed parameter metadata", () => {
    const ordinary = getGearById(49482)!;
    expect(() => prepareCustomEquipmentParameters(ordinary, "PLD")).toThrow(
      "不支持自定义参数",
    );
    expect(() => validateCustomEquipmentStats(ordinary, "PLD", {})).toThrow(
      "不支持自定义参数",
    );
    expect(customParameterMelds(ordinary)).toEqual([]);
    const mixed = {
      ...sword,
      resistanceWeaponAdjust: resistanceSword.resistanceWeaponAdjust,
    };
    expect(() => validateCustomEquipmentStats(mixed, "PLD", {})).toThrow(
      "同时包含两种",
    );
    expect(() => prepareCustomEquipmentParameters(mixed, "PLD")).toThrow(
      "同时包含两种",
    );
    expect(() =>
      prepareCustomEquipmentParameters(
        { ...sword, customParameters: sword.customParameters!.slice(0, 3) },
        "PLD",
      ),
    ).toThrow("不是 4");
  });
  it("rejects fixed custom values below the absolute base stats", () => {
    const gear = { ...sword, stats: { ...sword.stats, CRT: 10 } };
    expect(() => validateCustomEquipmentStats(gear, "PLD", { CRT: 9 })).toThrow(
      "低于装备基础属性",
    );
  });
});
