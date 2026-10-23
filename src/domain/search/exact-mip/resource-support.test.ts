import { expect, test } from "vitest";
import { buildLinearAttributeModel } from "./attribute-model.ts";
import {
  addCandidateLevelConditionalResourceSupports,
  factorResourceWeightVectors,
} from "./resource-support.ts";
import type { ExactMipOptions, FactorGroup } from "./types.ts";
import type { EquipInfo } from "../types.ts";

const gear = (
  id: number,
  level: number,
  main: number,
  det: number,
): EquipInfo => ({
  itemId: id,
  key: String(id),
  itemLevel: level,
  PDMG: 0,
  MDMG: 0,
  DLY: 0,
  baseParams: [
    { baseParamId: 1, value: main },
    { baseParamId: 2, value: det },
  ],
});
function fixture() {
  const options: ExactMipOptions = {
    job: "RDM",
    jobLevel: 100,
    attributeIds: [1, 2],
    statIndexes: new Map([
      ["INT", 0],
      ["DET", 1],
    ]),
    slots: [[gear(1, 795, 20, 10), gear(2, 715, 10, 5)]],
    foods: [],
    candidateItemLevelRanges: [{ min: 790, max: 795 }],
    evaluationFunction: () => undefined,
  };
  const model = buildLinearAttributeModel(options)!;
  const groups: FactorGroup[] = ["main", "det"].map((name, index) => ({
    name,
    classes: [
      { variable: `${name}_low`, min: 1, max: 5, value: 1, q: 0 },
      {
        variable: `${name}_high`,
        min: 6,
        max: 10,
        value: 2,
        q: index ? 10 : 2560,
      },
    ],
  }));
  const axes = new Map<string, number | undefined>([
    ["main", 0],
    ["det", 1],
  ]);
  const food: number[][] = [[1, 1]];
  return { options, model, groups, axes, food };
}
type Fixture = ReturnType<typeof fixture>;
const run = ({ options, model, groups, axes, food }: Fixture) =>
  addCandidateLevelConditionalResourceSupports(
    options,
    model,
    groups,
    food,
    axes,
  );

test.each<[string, (f: Fixture) => void]>([
  ["no resource axes", (f) => f.axes.clear()],
  ["wrong slot variable count", (f) => f.model.slotVariables.push([])],
  ["missing slot vectors", (f) => (f.model.equipmentAttributes.length = 0)],
  [
    "mismatched candidate vectors",
    (f) => f.model.equipmentAttributes[0]!.pop(),
  ],
  ["mismatched candidate variables", (f) => f.model.slotVariables[0]!.pop()],
  ["negative item level", (f) => (f.options.slots[0]![0]!.itemLevel = -1)],
  ["missing variable", (f) => delete f.model.slotVariables[0]![0]],
  ["negative attribute", (f) => (f.model.equipmentAttributes[0]![0]![0] = -1)],
  [
    "missing attribute",
    (f) => (f.model.equipmentAttributes[0]![0]!.length = 1),
  ],
  [
    "unsafe vector sum",
    (f) => (f.model.equipmentAttributes[0]![0]![0] = Number.MAX_SAFE_INTEGER),
  ],
  ["negative food bonus", (f) => (f.food[0]![0] = -1)],
  ["missing food bonus", (f) => f.food[0]!.pop()],
  ["unsafe food sum", (f) => (f.food[0]![0] = Number.MAX_SAFE_INTEGER)],
  [
    "unsafe global budget",
    (f) => (f.food[0] = [Number.MAX_SAFE_INTEGER - 2, 1]),
  ],
  ["negative factor minimum", (f) => (f.groups[0]!.classes[0]!.min = -1)],
  ["noninteger factor minimum", (f) => (f.groups[0]!.classes[0]!.min = 0.5)],
])(
  "invalid %s abandons cuts without mutating existing rows",
  (_name, mutate) => {
    const f = fixture();
    mutate(f);
    const before = structuredClone(f.model.rows);
    expect(run(f)).toBeUndefined();
    expect(f.model.rows).toEqual(before);
  },
);

test("band budget is checked before building rows", () => {
  const f = fixture();
  f.options.slots = [
    Array.from({ length: 13 }, (_, i) => gear(i, 20 * i, i + 1, 0)),
  ];
  f.model = buildLinearAttributeModel(f.options)!;
  const before = structuredClone(f.model.rows);
  expect(run(f)).toMatchObject({ skipReason: "model-budget", rowsAdded: 0 });
  expect(f.model.rows).toEqual(before);
});

test("zero factor minima add no artificial constraints", () => {
  const f = fixture();
  f.groups.forEach((group) =>
    group.classes.forEach((entry) => (entry.min = 0)),
  );
  const before = structuredClone(f.model.rows);
  expect(run(f)).toMatchObject({ rowsAdded: 0, nonzerosAdded: 0 });
  expect(f.model.rows).toEqual(before);
});

test("weighted overflow retains valid unweighted cuts and never emits an unsafe coefficient", () => {
  for (const location of ["equipment", "food", "factor"] as const) {
    const f = fixture();
    f.options.candidateResourceSupportProfile = "compact-weighted";
    if (location === "equipment")
      f.model.equipmentAttributes[0]![0]![0] = Math.floor(
        Number.MAX_SAFE_INTEGER / 4,
      );
    if (location === "food")
      f.food[0]![0] = Math.floor(Number.MAX_SAFE_INTEGER / 4);
    if (location === "factor")
      f.groups[0]!.classes[1]!.min = Math.floor(Number.MAX_SAFE_INTEGER / 4);
    const before = f.model.rows.length;
    expect(run(f)).toMatchObject({ rowsAdded: 1, weightedRowsAdded: 0 });
    for (const row of f.model.rows.slice(before)) {
      expect(Number.isSafeInteger(row.rhs)).toBe(true);
      expect([...row.terms.values()].every(Number.isSafeInteger)).toBe(true);
    }
  }
});

test("BLU weapon resources subtract the largest possible main-stat weapon addition", () => {
  const f = fixture();
  f.options.job = "BLU";
  f.options.candidateResourceSupportProfile = "compact-weighted";
  f.groups[0]!.classes[0]!.auxiliary = 3;
  f.groups[0]!.classes[1]!.auxiliary = 5;
  f.groups[1]!.name = "weapon";
  f.axes = new Map([
    ["main", 0],
    ["weapon", 1],
  ]);
  const before = f.model.rows.length;
  expect(run(f)).toMatchObject({ rowsAdded: 1, weightedRowsAdded: 1 });
  for (const row of f.model.rows.slice(before)) {
    expect(row.terms.has("det_low")).toBe(false);
    expect(row.terms.get("det_high")).toBe(1);
  }
});

test("resource slopes ignore flat, missing, and single-class axes", () => {
  const { groups } = fixture();
  expect(factorResourceWeightVectors(groups, ["unknown"])).toEqual([]);
  expect(factorResourceWeightVectors(groups, ["main"])).toEqual([]);
  groups[0]!.classes = groups[0]!.classes.slice(0, 1);
  groups[1]!.classes[1]!.q = 0;
  expect(
    factorResourceWeightVectors(groups, ["main", "det", "missing"]),
  ).toEqual([]);
});
