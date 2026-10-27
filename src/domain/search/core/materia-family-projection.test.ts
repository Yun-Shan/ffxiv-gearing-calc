import { expect, test } from "vitest";
import { boundedMateriaCounts, validMateriaCountFamily, restoreMateriaCounts, prepareMateriaFamilyProjection } from "./materia-family-projection.ts";
import type { MateriaCountFamily, MateriaModelFamily } from "./materia-family-projection.ts";
import type { LinearMipRequest, LinearMipRow, LinearMipSolution } from "../linear-mip.ts";
import { prepareEqualityQuotient } from "./equality-quotient.ts";
import { validateMipSolution } from "./solution-validation.ts";

function model(separateRawBlocks = false, alternatives = false) {
  const variables: LinearMipRequest["variables"][number][] = [];
  const rows: LinearMipRow[] = [];
  const binaryVariables: string[] = [];
  const integerVariables: string[] = [];
  const families: MateriaModelFamily[] = [];
  const rawBlocks = Array.from({ length: separateRawBlocks ? 2 : 1 }, (_, block) => Array.from({ length: 3 }, (_, axis): LinearMipRow => {
    const name = `raw_${block}_${axis}`;
    variables.push({ name, min: 0, max: 1000 }); integerVariables.push(name);
    return { name: `sum_${name}`, terms: new Map([[name, 1]]), sense: "=", rhs: 0 };
  }));
  for (let slot = 0; slot < 2; slot++) {
    const rawRows = rawBlocks[separateRawBlocks ? slot : 0]!;
    const counts = boundedMateriaCounts([2, 2, 2], 2);
    const members = counts.map((_, index) => `e_${slot}_${index}`);
    const slotVariables = [...members, ...(alternatives ? [`alternative_${slot}`] : [])];
    for (const name of slotVariables) { variables.push({ name, min: 0, max: 1 }); binaryVariables.push(name); }
    const oneHotRow: LinearMipRow = { name: `slot_${slot}`, terms: new Map(slotVariables.map((name) => [name, 1])), sense: "=", rhs: 1 };
    rows.push(oneHotRow);
    const family: MateriaModelFamily = { grade: 12, coordinates: [0, 1, 2], units: [2, 3, 5], fixedAttributes: [10 + slot, 20, 30],
      capacities: [2, 2, 2], remaining: 2, counts, members, slotVariables, oneHotRow, rawRows };
    families.push(family);
    rawRows.forEach((row, axis) => {
      counts.forEach((count, member) => (row.terms as Map<string, number>).set(members[member]!, -family.fixedAttributes[axis]! - count[axis]! * family.units[axis]!));
      if (alternatives) (row.terms as Map<string, number>).set(`alternative_${slot}`, -100);
    });
  }
  rows.push(...rawBlocks.flat());
  const request: LinearMipRequest = { name: "materia-test", rows, variables, binaryVariables, integerVariables,
    objective: new Map([["raw_0_0", 0.5]]), materiaFamilies: families };
  const solution = (selected: readonly number[] = [0, 1]): LinearMipSolution => {
    const values = new Map(variables.map(({ name }) => [name, 0]));
    families.forEach((family, slot) => {
      const member = selected[slot]!;
      values.set(member < 0 ? `alternative_${slot}` : family.members[member]!, 1);
      family.rawRows.forEach((row) => {
        const name = [...row.terms.keys()][0]!;
        values.set(name, values.get(name)! - row.terms.get(member < 0 ? `alternative_${slot}` : family.members[member]!)!);
      });
    });
    return { Status: "Optimal", Columns: Object.fromEntries([...values].map(([name, Primal]) => [name, { Primal }])) };
  };
  return { request, families, solution };
}

test("random full count DP, every Hall inequality and integral flow describe the same totals", () => {
  let state = 0x54a11;
  const next = (maximum: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % maximum; };
  let checked = 0;
  for (let trial = 0; trial < 100; trial++) {
    const dimension = 2 + next(3);
    const families: MateriaCountFamily[] = Array.from({ length: 1 + next(3) }, () => {
      const capacities = Array.from({ length: dimension }, () => 1 + next(2));
      const remaining = 1 + next(3);
      return { grade: 12, coordinates: capacities.map((_, axis) => axis), units: capacities.map(() => 1),
        fixedAttributes: capacities.map(() => 0), remaining, capacities, counts: boundedMateriaCounts(capacities, remaining) };
    });
    let reachable = new Set([new Array(dimension).fill(0).join(",")]);
    for (const family of families) reachable = new Set([...reachable].flatMap((key) => family.counts.map((count) =>
      key.split(",").map((value, axis) => Number(value) + count[axis]!).join(","))));
    const total = families.reduce((sum, family) => sum + family.remaining, 0);
    for (const counts of boundedMateriaCounts(new Array(dimension).fill(total), total)) {
      const hall = Array.from({ length: 2 ** dimension - 2 }, (_, index) => index + 1).every((mask) => {
        const selected = counts.reduce((sum, value, axis) => sum + (mask & 2 ** axis ? value : 0), 0);
        const capacity = families.reduce((sum, family) => sum + Math.min(family.remaining,
          family.capacities.reduce((value, cap, axis) => value + (mask & 2 ** axis ? cap : 0), 0)), 0);
        return selected <= capacity;
      });
      expect(hall).toBe(reachable.has(counts.join(",")));
      if (hall) {
        const restored = restoreMateriaCounts(families, counts);
        restored.forEach((count, index) => expect(families[index]!.counts).toContainEqual(count));
        expect(counts.map((_, axis) => restored.reduce((sum, count) => sum + count[axis]!, 0))).toEqual(counts);
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(1000);
});

test("proper subset Hall constraints reject the false singleton-capacity witness", () => {
  const families = [[2, 2, 0], [0, 0, 2]].map((capacities): MateriaCountFamily => ({ grade: 12, remaining: 2,
    capacities, counts: boundedMateriaCounts(capacities, 2), coordinates: [0, 1, 2], units: [1, 1, 1], fixedAttributes: [0, 0, 0] }));
  expect(() => restoreMateriaCounts(families, [2, 2, 0])).toThrow("Hall flow");
  expect(() => restoreMateriaCounts(families, [0, 0, 1])).toThrow("total mismatch");
});

test("complete/partial hints, sparse output and inverse T57 -> T54 retain the most original rows", () => {
  const f = model();
  const original = f.solution();
  f.request.solutionHint = new Map(Object.entries(original.Columns).map(([name, { Primal }]) => [name, Primal]));
  const projection = prepareMateriaFamilyProjection(f.request, { maxMs: Infinity })!;
  expect(projection.statistics).toMatchObject({ eligibleFamilies: 2, pools: 1, hallRows: 6, variablesRemoved: 7 });
  const hinted = { Status: "Optimal", Columns: Object.fromEntries([...projection.request.solutionHint!].map(([name, Primal]) => [name, { Primal }])) };
  const restored = projection.expandSolution(hinted);
  validateMipSolution(f.request.rows, f.request.variables, restored.Columns);
  for (const row of f.families[0]!.rawRows) expect(restored.Columns[[...row.terms.keys()][0]!]).toEqual(original.Columns[[...row.terms.keys()][0]!]);
  const sparse = { ...hinted, Columns: Object.fromEntries(Object.entries(hinted.Columns).filter(([, { Primal }]) => Primal !== 0)) };
  expect(() => projection.expandSolution(sparse)).not.toThrow();
  const partial = prepareMateriaFamilyProjection({ ...f.request, solutionHint: new Map([[f.families[0]!.members[0]!, 1]]) }, { maxMs: Infinity })!;
  expect([...partial.request.solutionHint!.keys()].some((name) => name.startsWith("t54_y_"))).toBe(false);
  const stale = prepareMateriaFamilyProjection({ ...f.request, rows: [...f.request.rows,
    { name: "later-cut", terms: new Map([["raw_0_0", 1]]), sense: ">=", rhs: 999 }] }, { maxMs: Infinity })!;
  expect(stale.request.solutionHint).toBeUndefined();
  const quotientRequest = { ...projection.request, variables: [...projection.request.variables, { name: "alias", min: 0, max: 1000 }],
    integerVariables: [...projection.request.integerVariables, "alias"], rows: [...projection.request.rows,
      { name: "alias-equality", terms: new Map([["alias", 1], ["raw_0_0", -1]]), sense: "=" as const, rhs: 0 }],
    solutionHint: new Map([...projection.request.solutionHint!, ["alias", hinted.Columns.raw_0_0!.Primal]]) };
  const quotient = prepareEqualityQuotient(quotientRequest)!;
  const quotientSolution = { Status: "Optimal", Columns: Object.fromEntries([...quotient.request.solutionHint!].map(([name, Primal]) => [name, { Primal }])) };
  expect(() => projection.expandSolution(quotient.expandSolution(quotientSolution))).not.toThrow();
  const unfinished = { Status: "TimeLimit", Columns: { garbage: { Primal: 0.5 } } };
  expect(projection.expandSolution(unfinished)).toBe(unfinished);
});

test("fixed attributes are multiplied by the selected mode, including a retained alternative", () => {
  const f = model(false, true);
  const original = f.solution([-1, 0]);
  const projection = prepareMateriaFamilyProjection({ ...f.request,
    solutionHint: new Map(Object.entries(original.Columns).map(([name, { Primal }]) => [name, Primal])) }, { maxMs: Infinity })!;
  const restored = projection.expandSolution({ Status: "Optimal",
    Columns: Object.fromEntries([...projection.request.solutionHint!].map(([name, Primal]) => [name, { Primal }])) });
  expect(f.families[0]!.members.every((name) => restored.Columns[name]?.Primal === 0)).toBe(true);
  expect(restored.Columns.alternative_0!.Primal).toBe(1);
  validateMipSolution(f.request.rows, f.request.variables, restored.Columns);
});

test.each(["hidden-zero", "objective", "bounds", "no-onehot", "cross-slot", "raw-coefficient", "duplicate-count", "missing-count"] as const)(
  "a current-request incompatibility retains the whole affected family: %s", (kind) => {
    const f = model();
    const family = f.families[0]!;
    if (kind === "hidden-zero") f.request.rows = [...f.request.rows, { name: "variant-cut", terms: new Map([[family.members[0]!, 1]]), sense: "<=", rhs: 0 }];
    if (kind === "objective") f.request.objective = new Map([[family.members[0]!, 1]]);
    if (kind === "bounds") f.request.variables = f.request.variables.map((bound) => bound.name === family.members[0] ? { ...bound, max: 0 } : bound);
    if (kind === "no-onehot") f.request.rows = f.request.rows.filter((row) => row !== family.oneHotRow);
    if (kind === "cross-slot") family.members = [...family.members.slice(0, -1), f.families[1]!.members[0]!];
    if (kind === "raw-coefficient") (family.rawRows[0]!.terms as Map<string, number>).set(family.members[0]!, -99);
    if (kind === "duplicate-count") family.counts = family.counts.map((count, index) => index === 0 ? family.counts[1]! : count);
    if (kind === "missing-count") { family.counts = family.counts.slice(1); family.members = family.members.slice(1); }
    const projected = prepareMateriaFamilyProjection(f.request, { maxMs: Infinity })!;
    expect(projected.statistics.rejectedFamilies).toBe(1);
    expect(projected.request.variables.some(({ name }) => name === family.members[0])).toBe(true);
    expect(projected.statistics.eligibleFamilies).toBe(1);
  });

test("pool observation scopes include all actual raw row identities", () => {
  const f = model(true);
  const projection = prepareMateriaFamilyProjection(f.request, { maxMs: Infinity })!;
  expect(projection.statistics.pools).toBe(2);
  expect(projection.statistics.variablesRemoved).toBe(4);
});

test("budget/overflow fallback is atomic, cancellation propagates, malformed optimal output fails closed", () => {
  const f = model();
  const before = structuredClone({ rows: f.request.rows, variables: f.request.variables });
  for (const limits of [{ maxPoints: 1 }, { maxHallRows: 1 }, { maxMs: 0 }]) expect(prepareMateriaFamilyProjection(f.request, limits)).toBeUndefined();
  expect({ rows: f.request.rows, variables: f.request.variables }).toEqual(before);
  expect(() => prepareMateriaFamilyProjection({ ...f.request, isCancelled: () => true })).toThrowError("搜索已取消");
  const projection = prepareMateriaFamilyProjection(f.request, { maxMs: Infinity })!;
  expect(() => projection.expandSolution({ Status: "Optimal", Columns: {} })).toThrow();
  const invalid = model();
  invalid.families[0]!.units = [Number.MAX_SAFE_INTEGER, 3, 5];
  expect(prepareMateriaFamilyProjection(invalid.request, { maxMs: Infinity })!.statistics.rejectedFamilies).toBe(1);
  expect(validMateriaCountFamily({ ...f.families[0]!, remaining: 0 })).toBe(false);
  let visits = 0;
  expect(() => boundedMateriaCounts([2, 2, 2], 2, () => { if (++visits === 3) throw Object.assign(new Error("cancel"), { name: "AbortError" }); })).toThrow("cancel");
});
