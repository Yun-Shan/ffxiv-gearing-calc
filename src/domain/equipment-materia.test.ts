import { describe, expect, it } from "vitest";
import { gears } from "./data.ts";
import {
  prepareEquipmentMateria,
  evaluateEquipmentMateria,
} from "./equipment-materia.ts";

function gearNamed(name: string) {
  const gear = gears.find((gear) => gear.name === name);
  if (!gear) throw new Error(`缺少真实装备夹具 ${name}`);
  return gear;
}
const crafted = gearNamed("宫廷爱人御敌发夹");
const weapon = gearNamed("狂奔长刀");

describe("equipment materia selection description", () => {
  it.each([['PLD', 'TEN'], ['WHM', 'PIE']] as const)("offers legal %s forced %s choices with matching totals", (jobId, stat) => {
    const equipment = gears.find((item) => item.jobs.includes(jobId) && item.level === 770 && item.materiaSlots === 2)!;
    const prepared = prepareEquipmentMateria(equipment, { jobId });
    const choice = prepared.slots[0]!.options.find((option) => option.stat === stat)!;
    expect(choice).toBeDefined();
    const baseline = evaluateEquipmentMateria(prepared).attributes.find((item) => item.stat === stat)!;
    const selected = evaluateEquipmentMateria(prepared, [stat]).attributes.find((item) => item.stat === stat)!;
    expect(selected.total).toBe(baseline.total + choice.value);
    expect(selected.current).toBe(Math.min(selected.cap, baseline.current + choice.value));
    expect(prepared.slots[0]!.options.some((option) => option.stat === (stat === 'TEN' ? 'PIE' : 'TEN'))).toBe(false);
  });

  it.each([['PLD', 'TEN'], ['WHM', 'PIE']] as const)("offers legal %s forced %s choices with matching totals", (jobId, stat) => {
    const equipment = gears.find((item) => item.jobs.includes(jobId) && item.level === 770 && item.materiaSlots === 2)!;
    const prepared = prepareEquipmentMateria(equipment, { jobId });
    const choice = prepared.slots[0]!.options.find((option) => option.stat === stat)!;
    expect(choice).toBeDefined();
    const baseline = evaluateEquipmentMateria(prepared).attributes.find((item) => item.stat === stat)!;
    const selected = evaluateEquipmentMateria(prepared, [stat]).attributes.find((item) => item.stat === stat)!;
    expect(selected.total).toBe(baseline.total + choice.value);
    expect(selected.current).toBe(Math.min(selected.cap, baseline.current + choice.value));
    expect(prepared.slots[0]!.options.some((option) => option.stat === (stat === 'TEN' ? 'PIE' : 'TEN'))).toBe(false);
  });

  it("uses XII for safe and first overmeld holes, XI for later overmelds", () => {
    const result = evaluateEquipmentMateria(prepareEquipmentMateria(crafted, { jobId: "PLD" }));
    expect(result.slots.map((slot) => slot.safe)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(result.slots.map((slot) => slot.options[0])).toEqual([
      { stat: "CRT", value: 54, grade: 12 },
      { stat: "CRT", value: 54, grade: 12 },
      { stat: "CRT", value: 54, grade: 12 },
      { stat: "CRT", value: 18, grade: 11 },
      { stat: "CRT", value: 18, grade: 11 },
    ]);
    expect(result.attributes).toEqual([
      { stat: "CRT", current: 257, total: 257, cap: 257 },
      { stat: "DET", current: 0, total: 0, cap: 257 },
      { stat: "DHT", current: 0, total: 0, cap: 257 },
      { stat: "SKS", current: 0, total: 0, cap: 257 },
      { stat: "TEN", current: crafted.stats.TEN ?? 0, total: crafted.stats.TEN ?? 0, cap: 257 },
    ]);
  });
  it("adds only manual choices and truncates their total at the gear cap", () => {
    const before = structuredClone(weapon);
    const prepared = prepareEquipmentMateria(weapon, { jobId: "PLD" });
    const attributes = (choices: ("auto" | "DET")[]) =>
      evaluateEquipmentMateria(prepared, choices).attributes;
    expect(attributes(["auto", "auto"]).find((a) => a.stat === "DET")).toEqual({
      stat: "DET",
      current: 214,
      total: 214,
      cap: 306,
    });
    expect(attributes(["DET", "auto"]).find((a) => a.stat === "DET")).toEqual({
      stat: "DET",
      current: 268,
      total: 268,
      cap: 306,
    });
    expect(attributes(["DET", "DET"]).find((a) => a.stat === "DET")).toEqual({
      stat: "DET",
      current: 306,
      total: 322,
      cap: 306,
    });
    expect(weapon).toEqual(before);
  });
  it("reuses prepared equipment facts and distinguishes exactly capped from overflowing totals", () => {
    const prepared = prepareEquipmentMateria(crafted, { jobId: "PLD" });
    const before = structuredClone(prepared);
    const atCap = evaluateEquipmentMateria(prepared);
    const overCap = evaluateEquipmentMateria(prepared, ["CRT"]);
    expect(atCap.slots).toBe(prepared.slots);
    expect(overCap.slots).toBe(prepared.slots);
    expect(atCap.attributes[0]).toEqual({
      stat: "CRT",
      current: 257,
      total: 257,
      cap: 257,
    });
    expect(overCap.attributes[0]).toEqual({
      stat: "CRT",
      current: 257,
      total: 311,
      cap: 257,
    });
    expect(prepared).toEqual(before);
  });
  it("returns only actual holes and picks spell speed for casters", () => {
    expect(
      prepareEquipmentMateria(weapon, { jobId: "PLD" }).slots,
    ).toHaveLength(2);
    expect(
      prepareEquipmentMateria(gearNamed("虚王盾"), { jobId: "PLD" }).slots,
    ).toEqual([]);
    const caster = gears.find(
      (gear) =>
        gear.jobs.includes("BLM") &&
        gear.level === 770 &&
        gear.materiaSlots === 2,
    )!;
    const result = prepareEquipmentMateria(caster, { jobId: "BLM" });
    expect(result.slots[0]!.options.map((o) => o.stat)).toEqual([
      "CRT",
      "DET",
      "DHT",
      "SPS",
    ]);
  });
  it("offers the highest permitted tier for older equipment too", () => {
    const older = gears.find(
      (gear) =>
        gear.jobs.includes("PLD") &&
        gear.level === 640 &&
        gear.materiaSlots === 2 &&
        gear.materiaAdvanced,
    )!;
    const result = prepareEquipmentMateria(older, { jobId: "PLD" });
    expect(result.slots.map((slot) => slot.options[0]!.value)).toEqual([
      36, 36, 36, 12, 12,
    ]);
    expect(result.slots.map((slot) => slot.options[0]!.grade)).toEqual([
      10, 10, 10, 9, 9,
    ]);
  });
  it("disables synced holes and ignores any prior selections", () => {
    const prepared = prepareEquipmentMateria(crafted, { jobId: "PLD", syncLevel: 660 });
    const result = evaluateEquipmentMateria(prepared, ["DET", "DET"]);
    expect(result.disabledReason).toBe("品级同步后魔晶石不生效");
    expect(result.slots).toHaveLength(5);
    expect(result.slots.every((slot) => slot.options.length === 0)).toBe(true);
    expect(result.attributes.find((a) => a.stat === "DET")!.current).toBe(0);
  });
  it("does not turn custom weapon parameter slots into regular materia holes", () => {
    const custom = gears.find((gear) => gear.customParameters !== undefined)!;
    const result = prepareEquipmentMateria(custom, { jobId: custom.jobs[0]! });
    expect(result.slots).toEqual([]);
    expect(result.disabledReason).toBe("自定义武器不使用普通魔晶石孔");
  });
});
