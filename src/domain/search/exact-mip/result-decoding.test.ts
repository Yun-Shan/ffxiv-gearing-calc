import { expect, test } from "vitest";
import type { EquipInfo } from "../types.ts";
import type { ResistanceAllocationVariable } from "./attribute-model.ts";
import {
  foodForResult,
  slotsForResult,
  slotsForResultWithResistanceAllocations,
} from "./result-decoding.ts";
import { getAttributeVector } from "./attributes.ts";

const equipment = (): EquipInfo => ({
  itemId: 1,
  key: "weapon",
  itemLevel: 535,
  PDMG: 100,
  MDMG: 0,
  DLY: 0,
  baseParams: [],
  resistanceWeaponAdjust: {
    maxEachStat: 10,
    maxTotalStats: 12,
    stats: ["CRT", "DET"],
  },
});
const allocations: ResistanceAllocationVariable[] = ["CRT", "DET"].map(
  (stat, index) => ({
    slotIndex: 0,
    candidateIndex: 0,
    stat: stat as "CRT" | "DET",
    baseParamId: index + 1,
    attributeIndex: index,
    maxValue: 10,
    variable: stat,
    maxTotalStats: 12,
  }),
);

test("missing mandatory choices fail instead of assembling a partial result", () => {
  expect(() => slotsForResult([[equipment()]], [["x"]], {})).toThrow(
    /没有为槽位/,
  );
  const food = { itemId: 2, itemLevel: 10, key: "food", baseParams: [] };
  expect(() => foodForResult([food], ["f"], {})).toThrow(/没有选择食物/);
});

test.each([-1, 11, 0.1, Infinity, NaN])(
  "rejects nonintegral or out-of-range resistance allocation %s",
  (value) => {
    expect(() =>
      slotsForResultWithResistanceAllocations(
        [[equipment()]],
        [["x"]],
        allocations,
        { x: { Primal: 1 }, CRT: { Primal: value } },
      ),
    ).toThrow(/不是有效整数/);
  },
);

test("resistance result decoding checks aggregate allowance and owns the returned allocation", () => {
  const gear = equipment();
  const decode = (crt: number, det: number) =>
    slotsForResultWithResistanceAllocations([[gear]], [["x"]], allocations, {
      x: { Primal: 1 },
      CRT: { Primal: crt },
      DET: { Primal: det },
    });
  expect(() => decode(10, 10)).toThrow(/总分配属性/);
  expect(decode(0, 0)[0]).toBe(gear);
  const selected = decode(6, 6)[0]!;
  expect(selected).not.toBe(gear);
  expect(gear.resistanceAllocation).toBeUndefined();
  expect(
    getAttributeVector(
      [selected],
      undefined,
      [1, 2],
      undefined,
      new Map([
        ["CRT", 0],
        ["DET", 1],
      ]),
    ),
  ).toEqual([6, 6]);
  delete gear.resistanceWeaponAdjust;
  expect(() => decode(1, 0)).toThrow(/总分配属性/);
});

test("external allocations must have metadata, unique stats, mapped ids and a valid total", () => {
  const gear = equipment();
  gear.resistanceAllocation = [
    { stat: "CRT", baseParamId: 1, value: 7 },
    { stat: "DET", baseParamId: 2, value: 7 },
  ];
  const vector = () =>
    getAttributeVector(
      [gear],
      undefined,
      [1, 2],
      undefined,
      new Map([
        ["CRT", 0],
        ["DET", 1],
      ]),
    );
  expect(vector).toThrow(/总分配属性/);
  gear.resistanceAllocation = [
    { stat: "CRT", baseParamId: 1, value: 2 },
    { stat: "CRT", baseParamId: 1, value: 2 },
  ];
  expect(vector).toThrow(/属性分配无效/);
  gear.resistanceAllocation = [{ stat: "CRT", baseParamId: 2, value: 2 }];
  expect(vector).toThrow(/属性分配无效/);
  delete gear.resistanceWeaponAdjust;
  expect(vector).toThrow(/缺少 ResistanceWeaponAdjust/);
});
