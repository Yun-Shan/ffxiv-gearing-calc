import { afterEach, expect, test, vi } from "vitest";
import type { LinearMipRow, LinearMipVariable } from "../linear-mip.ts";
import type { FactorGroup } from "./types.ts";
import { addClassSelection } from "./model-preparation.ts";
import { prepareStrictImprovementCover } from "./strict-improvement-cover.ts";

type Options = Parameters<typeof prepareStrictImprovementCover>[0];
const names = ["weapon", "main", "det", "ten", "crt", "dht", "gcd"];
const targets = ["weapon_relative", "main_final", "det_final", "ten_final", "crt_final", "dht_final", "speed_final"];

function fixture(): Options {
  const groups: FactorGroup[] = names.map((name) => ({ name, classes: [{
    variable: `${name}_0`, min: 0, max: 0, q: 0, value: name === "gcd" ? 250 : 1,
  }] }));
  groups[0]!.classes.push({ variable: "weapon_1", min: 1, max: 1, q: 0, value: 2 });
  groups[1]!.classes = [
    { variable: "main_0", min: 0, max: 0, q: 0, value: 2 },
    { variable: "main_1", min: 1, max: 1, q: 0, value: 3 },
    { variable: "main_2", min: 2, max: 2, q: 1, value: 3 },
  ];
  const rows: LinearMipRow[] = [];
  const variables: LinearMipVariable[] = [];
  groups.forEach((group, index) => {
    const maximum = group.classes.at(-1)!.max;
    variables.push({ name: targets[index]!, min: 0, max: maximum });
    addClassSelection(rows, variables, [], group, targets[index], maximum);
  });
  rows.push({ name: "surrogate_band_cutoff", terms: new Map([["main_2", 1]]), sense: ">=", rhs: 0 });
  return {
    prepared: { groups, useDps: false, mainAttribute: 0, detAttribute: 1, tenAttribute: 2,
      crtAttribute: 3, dhtAttribute: 4, speedAttribute: 5,
      model: { finalVariables: targets.slice(1), gcdChoiceRanges: [], gcdChoiceVariables: [] } },
    rows, variables, qMinimum: 0, qMaximum: 1,
    incumbent: { weaponDamage: 1, mainStat: 2, determination: 1, tenacity: 1, critical: 1,
      directHit: 1, traitMultiplier: 100, gcdCentiseconds: 250 },
    checkActive: () => {},
  };
}

function rowPasses(row: LinearMipRow, values: ReadonlyMap<string, number>): boolean {
  let lhs = 0n;
  for (const [variable, coefficient] of row.terms) lhs += BigInt(coefficient) * BigInt(values.get(variable) ?? 0);
  const rhs = BigInt(row.rhs);
  return row.sense === "=" ? lhs === rhs : row.sense === "<=" ? lhs <= rhs : lhs >= rhs;
}

// Independent complete enumeration of the tiny original model, including its
// target variables, selector bounds and optional hard GCD choice rows.
function improvingAssignments(options: Options): Map<string, number>[] {
  const result: Map<string, number>[] = [];
  const groups = options.prepared.groups;
  const chosen: number[] = [];
  const incumbent = options.incumbent;
  const threshold = BigInt(incumbent.weaponDamage) * BigInt(incumbent.mainStat) *
    BigInt(incumbent.determination) * BigInt(incumbent.tenacity) * BigInt(incumbent.critical) * BigInt(incumbent.directHit);
  const visit = (depth: number) => {
    if (depth < groups.length) {
      groups[depth]!.classes.forEach((_, index) => { chosen[depth] = index; visit(depth + 1); });
      return;
    }
    const entries = groups.map((group, index) => group.classes[chosen[index]!]!);
    const q = entries.reduce((sum, entry) => sum + entry.q, 0);
    const product = entries.slice(0, 6).reduce((value, entry) => value * BigInt(entry.value), 1n);
    if (q < options.qMinimum || q > options.qMaximum || product <= threshold) return;
    const choices = options.prepared.model.gcdChoiceVariables;
    for (let choice = 0; choice < Math.max(1, choices.length); choice++) {
      const values = new Map<string, number>();
      groups.forEach((group, index) => {
        group.classes.forEach((entry) => values.set(entry.variable, entry === entries[index] ? 1 : 0));
        values.set(targets[index]!, entries[index]!.min);
      });
      choices.forEach((variable, index) => values.set(variable, index === choice ? 1 : 0));
      if (options.variables.some((bound) => (values.get(bound.name) ?? 0) < bound.min ||
          (values.get(bound.name) ?? 0) > bound.max)) continue;
      if (options.rows.every((row) => rowPasses(row, values))) result.push(values);
    }
  };
  visit(0);
  return result;
}

afterEach(() => vi.restoreAllMocks());

test("every strictly improving assignment survives the cover, including equal-q class identities", () => {
  for (const minimum of [0, 1]) for (const maximum of [minimum, 1]) for (const main of [2, 3, 4, 5]) {
    const options = fixture();
    options.qMinimum = minimum;
    options.qMaximum = maximum;
    options.incumbent.mainStat = main;
    const expected = improvingAssignments(options);
    const cover = prepareStrictImprovementCover(options);
    expect(cover.status).toBe("covered");
    if (cover.status !== "covered") throw new Error(cover.reason);
    expect(cover.targetCount).toBe(expected.length);
    for (const values of expected) expect(cover.rows.every((row) => rowPasses(row, values))).toBe(true);
  }
  const cover = prepareStrictImprovementCover(fixture());
  expect(cover.status).toBe("covered");
  if (cover.status !== "covered") throw new Error(cover.reason);
  expect(cover.targetCount).toBe(5);
  expect([...cover.rows.find((row) => row.name.endsWith("_main"))!.terms.keys()])
    .toEqual(["main_0", "main_1", "main_2"]);
});

test("pure selector rows and original target/selector bounds reduce targets without dropping feasible improvements", () => {
  const options = fixture();
  (options.rows as LinearMipRow[]).push({ name: "original_resource", terms: new Map([["main_1", 1], ["weapon_1", 1]]), sense: "<=", rhs: 1 });
  options.variables.find((bound) => bound.name === "main_final")!.max = 1;
  options.variables.find((bound) => bound.name === "weapon_1")!.min = 1;
  const expected = improvingAssignments(options);
  const cover = prepareStrictImprovementCover(options);
  expect(cover.status).toBe("covered");
  if (cover.status !== "covered") throw new Error(cover.reason);
  expect(cover.targetCount).toBe(1);
  expect(expected).toHaveLength(1);
  expect(cover.rows.every((row) => rowPasses(row, expected[0]!))).toBe(true);
});

test("strictness uses BigInt even when products differ by one above Number precision", () => {
  const options = fixture();
  const large = 4_000_000_000;
  options.prepared.groups[0]!.classes[0]!.value = large;
  options.prepared.groups[0]!.classes[1]!.value = large + 1;
  options.prepared.groups[1]!.classes[0]!.value = large;
  options.prepared.groups[1]!.classes[1]!.value = large - 1;
  options.prepared.groups[1]!.classes[2]!.value = large - 1;
  options.incumbent.weaponDamage = large;
  options.incumbent.mainStat = large;
  const expected = improvingAssignments(options);
  const cover = prepareStrictImprovementCover(options);
  expect(cover.status).toBe("covered");
  if (cover.status !== "covered") throw new Error(cover.reason);
  expect(cover.targetCount).toBe(1);
  expect(expected).toHaveLength(1);
  expect(cover.rows.find((row) => row.name.endsWith("_main"))!.terms.has("main_1")).toBe(false);
  expect(cover.rows.every((row) => rowPasses(row, expected[0]!))).toBe(true);
});

test("hard GCD choices retain their disjoint intervals and fixed original choice bounds", () => {
  const options = fixture();
  options.prepared.groups[0]!.classes.length = 1;
  options.prepared.groups[1]!.classes.length = 2;
  options.prepared.groups[6]!.classes = [0, 1, 2].map((speed) => ({
    variable: `gcd_${speed}`, min: speed, max: speed, q: 0, value: 250 - speed,
  }));
  // Rebuild all original class rows after changing this test's domain.
  const rows: LinearMipRow[] = [];
  const variables: LinearMipVariable[] = [];
  options.prepared.groups.forEach((group, index) => {
    const maximum = group.classes.at(-1)!.max;
    variables.push({ name: targets[index]!, min: 0, max: maximum });
    addClassSelection(rows, variables, [], group, targets[index], maximum);
  });
  options.prepared.model.gcdChoiceRanges = [{ min: 0, max: 0 }, { min: 2, max: 2 }];
  options.gcdChoiceAttribute = options.prepared.speedAttribute;
  options.prepared.model.gcdChoiceVariables = ["choice_0", "choice_2"];
  variables.push({ name: "choice_0", min: 0, max: 1 }, { name: "choice_2", min: 0, max: 1 });
  rows.push(
    { name: "choose_gcd_choice", terms: new Map([["choice_0", 1], ["choice_2", 1]]), sense: "=", rhs: 1 },
    { name: "gcd_choice_speed_min", terms: new Map([["speed_final", 1], ["choice_2", -2]]), sense: ">=", rhs: 0 },
    { name: "gcd_choice_speed_max", terms: new Map([["speed_final", 1], ["choice_2", -2]]), sense: "<=", rhs: 0 },
  );
  options.rows = rows;
  options.variables = variables;
  for (const fixed of [false, true]) {
    if (fixed) variables.find((bound) => bound.name === "choice_0")!.max = 0;
    const cover = prepareStrictImprovementCover(options);
    expect(cover.status).toBe("covered");
    if (cover.status !== "covered") throw new Error(cover.reason);
    const expected = improvingAssignments(options);
    expect(cover.targetCount).toBe(fixed ? 1 : 2);
    expect(cover.targetCount).toBe(expected.length);
    for (const values of expected) expect(cover.rows.every((row) => rowPasses(row, values))).toBe(true);
    expect(cover.rows.find((row) => row.name.endsWith("_gcd"))!.terms.has("gcd_1")).toBe(false);
  }
  // A generic caller can bind the hard speed constraint to DET while the
  // formula still reads SKS. In that model every formula GCD remains possible.
  options.gcdChoiceAttribute = options.prepared.detAttribute;
  variables.find(bound => bound.name === "choice_0")!.max = 1;
  for (const row of rows.filter(row => row.name.startsWith("gcd_choice_speed_"))) {
    const terms = new Map(row.terms);
    terms.delete("speed_final");
    terms.set("det_final", 1);
    row.terms = terms;
  }
  const otherColumnCover = prepareStrictImprovementCover(options);
  if (otherColumnCover.status !== "covered") throw new Error(otherColumnCover.reason);
  const actualImprovements = improvingAssignments(options);
  expect(actualImprovements).toHaveLength(3);
  for (const values of actualImprovements) expect(otherColumnCover.rows.every(row => rowPasses(row, values))).toBe(true);
});

test("empty targets add no rows; unsupported and incomplete plans fall back", () => {
  const empty = fixture();
  empty.incumbent.mainStat = 100;
  expect(prepareStrictImprovementCover(empty)).toEqual({ status: "covered", rows: [], targetCount: 0 });
  for (const mutate of [
    (options: Options) => { options.prepared.useDps = true; },
    (options: Options) => { options.prepared.groups[1]!.classes[0]!.auxiliary = 1; },
    (options: Options) => { options.prepared.groups[1]!.classes[0]!.q = Number.MAX_SAFE_INTEGER; },
    (options: Options) => { options.variables = options.variables.filter((bound) => bound.name !== "main_final"); },
    (options: Options) => { options.limits = { maxTargets: 1 }; },
    (options: Options) => { options.limits = { memoryBytes: 1 }; },
    (options: Options) => { options.limits = { halfCombinations: 1 }; },
    (options: Options) => { options.limits = { maxWork: 1 }; },
  ]) {
    const options = fixture();
    mutate(options);
    expect(prepareStrictImprovementCover(options).status).toBe("skipped");
  }
});

test("local time exhaustion discards the whole plan without mutating original rows or classes", () => {
  const options = fixture();
  const rows = [...options.rows];
  const classes = options.prepared.groups.map((group) => [...group.classes]);
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now++ * 10);
  options.limits = { localMs: 1 };
  expect(prepareStrictImprovementCover(options).status).toBe("skipped");
  expect(options.rows).toEqual(rows);
  expect(options.prepared.groups.map((group) => group.classes)).toEqual(classes);
});

test.each(["cancelled", "overall deadline"])("caller %s exceptions propagate unchanged during planning", (message) => {
  const options = fixture();
  const error = new Error(message);
  let checks = 0;
  options.checkActive = () => { if (++checks === 2) throw error; };
  expect(() => prepareStrictImprovementCover(options)).toThrow(error);
  expect(checks).toBe(2);
});
