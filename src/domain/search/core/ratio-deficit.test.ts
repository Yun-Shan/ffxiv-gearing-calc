import { expect, test, vi } from "vitest";
import type { LinearMipProgress, LinearMipRequest } from "../linear-mip.ts";
import { prepareRatioDeficitRepresentation } from "./ratio-deficit.ts";

function model(patch: Partial<LinearMipRequest> = {}): LinearMipRequest {
  return {
    name: "certified ratios",
    variables: [
      { name: "q", min: 0, max: 3 }, { name: "r", min: 0, max: 3 },
      { name: "a", min: 0, max: 1 }, { name: "b", min: 0, max: 1 },
    ],
    binaryVariables: ["a", "b"], integerVariables: ["q", "r"],
    objective: new Map([["q", 1], ["r", 1]]),
    rows: [
      { name: "choose", terms: new Map([["a", 1], ["b", 1]]), sense: "=", rhs: 1 },
      { name: "q-envelope", terms: new Map([["q", 1], ["a", -2], ["b", -3]]), sense: "<=", rhs: 0 },
      { name: "r-envelope", terms: new Map([["r", 1], ["a", -3], ["b", -2]]), sense: "<=", rhs: 0 },
      { name: "remaining", terms: new Map([["q", 1], ["r", 1]]), sense: ">=", rhs: 4 },
    ],
    ...patch,
  };
}
const metadata = { variables: ["q", "r"], scale: 3 };
function feasible(request: LinearMipRequest, point: ReadonlyMap<string, number>): boolean {
  if (request.variables.some(({ name, min, max }) => !point.has(name) || point.get(name)! < min || point.get(name)! > max)) return false;
  return request.rows.every(({ terms, sense, rhs }) => {
    const lhs = [...terms].reduce((sum, [name, coefficient]) => sum + BigInt(coefficient) * BigInt(point.get(name)!), 0n);
    return sense === "=" ? lhs === BigInt(rhs) : sense === "<=" ? lhs <= BigInt(rhs) : lhs >= BigInt(rhs);
  });
}

test("exact affine points preserve both feasible domains, objective and original request", () => {
  const original = model();
  const before = structuredClone(original);
  const prepared = prepareRatioDeficitRepresentation(original, metadata)!;
  expect(prepared.centeredRows).toBe(2);
  expect(prepared.request.variables.slice(0, 2)).toEqual([
    { name: "__ratio_deficit_0", min: 0, max: 2 }, { name: "__ratio_deficit_1", min: 0, max: 2 },
  ]);
  expect(prepared.request.rows[1]!.terms).toEqual(new Map([["__ratio_deficit_0", -1], ["a", 1]]));
  for (let q = 0; q <= 3; q++) for (let r = 0; r <= 3; r++) {
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      const point = new Map(Object.entries({ q, r, a, b }));
      const transformed = new Map(Object.entries({ __ratio_deficit_0: 3 - q, __ratio_deficit_1: 3 - r, a, b }));
      expect(feasible(original, point)).toBe(feasible(prepared.request, transformed));
      const objective = [...prepared.request.objective].reduce((sum, [name, value]) => sum + BigInt(value) * BigInt(transformed.get(name)!), 0n);
      expect(BigInt(q + r)).toBe(6n + objective);
      if (feasible(original, point)) {
        const Columns = Object.fromEntries([...transformed].map(([name, Primal]) => [name, { Primal }]));
        expect(prepared.expandSolution({ Status: "Optimal", Columns, ObjectiveValue: Number(objective) })).toEqual({
          Status: "Optimal", Columns: Object.fromEntries([...point].map(([name, Primal]) => [name, { Primal }])), ObjectiveValue: q + r,
        });
      }
    }
  }
  expect(original).toEqual(before);
});

test("explicit alias names and sparse stale hints are handled without guessing ratio names", () => {
  const original = model({ solutionHint: new Map([["q", 2], ["r", 0], ["a", 0.5], ["b", 1], ["unknown", 2]]) });
  expect(prepareRatioDeficitRepresentation(original, metadata)!.request.solutionHint).toEqual(new Map([
    ["__ratio_deficit_0", 1], ["b", 1],
  ]));
  const aliased = model({ variables: [{ name: "representative", min: 0, max: 3 }], integerVariables: ["representative"],
    binaryVariables: [], objective: new Map([["representative", 1]]), rows: [], solutionHint: new Map([["representative", 2]]) });
  const prepared = prepareRatioDeficitRepresentation(aliased, { variables: ["representative"], scale: 3 })!;
  expect(prepared.centeredRows).toBe(0);
  expect(prepared.expandSolution({ Status: "FeasibleSignature", Columns: { __ratio_deficit_0: { Primal: 1.0000001 } } }).Columns)
    .toEqual({ representative: { Primal: 2 } });
});

test("rounds in deficit coordinates before subtracting a large scale, and requires explicit finite columns", () => {
  const scale = Number.MAX_SAFE_INTEGER;
  const prepared = prepareRatioDeficitRepresentation(model({ variables: [{ name: "q", min: 0, max: scale }],
    binaryVariables: [], integerVariables: ["q"], rows: [], objective: new Map([["q", 1]]) }), { variables: ["q"], scale })!;
  expect(prepared.expandSolution({ Status: "Optimal", Columns: { __ratio_deficit_0: { Primal: 1.0000001 } } }).Columns.q!.Primal).toBe(scale - 1);
  for (const Columns of [{}, { __ratio_deficit_0: { Primal: Infinity } }, Object.create({ __ratio_deficit_0: { Primal: 1 } })]) {
    expect(() => prepared.expandSolution({ Status: "Optimal", Columns })).toThrow("missing finite column");
  }
  expect(() => prepared.expandSolution({ Status: "Optimal", Columns: { __ratio_deficit_0: { Primal: 1.1 } } })).toThrow("unreliable integer");
});

test("callbacks see original objective and conservatively rounded dual, with no translated gap", () => {
  const progress: LinearMipProgress[] = [];
  const stop = vi.fn(() => true);
  const prepared = prepareRatioDeficitRepresentation(model({ onProgress: event => progress.push(event), stopWhenDualBoundProvesOptimal: stop }), metadata)!;
  expect(prepared.request.stopWhenDualBoundProvesOptimal!(-1.7)).toBe(true);
  expect(stop).toHaveBeenLastCalledWith(5);
  for (const invalid of [Infinity, NaN, 2 ** 53, Number.MAX_SAFE_INTEGER]) {
    expect(prepared.request.stopWhenDualBoundProvesOptimal!(invalid)).toBe(false);
  }
  expect(stop).toHaveBeenCalledTimes(1);
  prepared.request.onProgress!({ backend: "HiGHS", model: "x", kind: "bound", objectiveValue: -2, bestBound: -1.7, gap: 0.3 });
  expect(progress[0]).toEqual({ backend: "HiGHS", model: "x", kind: "bound", objectiveValue: 4, bestBound: 5 });
  prepared.request.onProgress!({ backend: "HiGHS", model: "x", kind: "bound", objectiveValue: -1.5, bestBound: Infinity });
  expect(progress[1]).toEqual({ backend: "HiGHS", model: "x", kind: "bound" });
  prepared.request.onProgress!({ backend: "HiGHS", model: "x", kind: "log" });
  expect(progress[2]).toEqual({ backend: "HiGHS", model: "x", kind: "log" });
  for (const Status of ["DualBound", "Infeasible", "Time limit reached"]) {
    const result = prepared.expandSolution({ Status, Columns: {}, ObjectiveValue: -2 });
    expect(result).toEqual({ Status, Columns: {}, ObjectiveValue: 4 });
  }
  expect(prepared.expandSolution({ Status: "DualBound", Columns: {}, ObjectiveValue: -1.5 }).ObjectiveValue).toBeUndefined();
});

test.each<[string, (request: LinearMipRequest) => void]>([
  ["duplicate bounds", request => request.variables = [...request.variables, request.variables[0]!]],
  ["unknown declaration", request => request.integerVariables = [...request.integerVariables, "missing"]],
  ["unknown objective", request => request.objective = new Map([["missing", 1]])],
  ["fractional objective", request => request.objective = new Map([["q", 0.5]])],
  ["unsafe row coefficient", request => request.rows = [{ name: "bad", terms: new Map([["q", 2 ** 53]]), sense: "=", rhs: 0 }]],
  ["unknown row coordinate", request => request.rows = [{ name: "bad", terms: new Map([["missing", 1]]), sense: "=", rhs: 0 }]],
  ["unsafe RHS", request => request.rows = [{ name: "bad", terms: new Map(), sense: "=", rhs: 2 ** 53 }]],
  ["unproven ratio range", request => request.variables = request.variables.map(v => v.name === "q" ? { ...v, max: 2 } : v)],
  ["binary ratio", request => request.binaryVariables = [...request.binaryVariables, "q"]],
  ["continuous ratio", request => request.integerVariables = ["r"]],
  ["variable name collision", request => request.variables = [...request.variables, { name: "__ratio_deficit_0", min: 0, max: 1 }]],
  ["row name collision", request => request.rows = [...request.rows, { name: "__ratio_deficit_0", terms: new Map(), sense: "=", rhs: 0 }]],
  ["contradictory necessary sum", request => request.rows = [{ name: "bad", terms: new Map([["q", 1], ["r", 1]]), sense: ">=", rhs: 7 }]],
  ["translated RHS overflow", request => request.rows = [{ name: "bad", terms: new Map([["q", -1]]), sense: "<=", rhs: Number.MAX_SAFE_INTEGER }]],
])("%s abandons preparation without mutating input", (_name, mutate) => {
  const request = model();
  mutate(request);
  const before = structuredClone(request);
  expect(prepareRatioDeficitRepresentation(request, metadata)).toBeUndefined();
  expect(request).toEqual(before);
});

test("rejects invalid metadata and uses only certified one-hot equalities", () => {
  for (const invalid of [{ variables: [], scale: 3 }, { variables: ["q", "q"], scale: 3 },
    { variables: ["missing"], scale: 3 }, { variables: ["q"], scale: 0 }, { variables: ["q"], scale: 2 ** 53 }]) {
    expect(prepareRatioDeficitRepresentation(model(), invalid)).toBeUndefined();
  }
  for (const choose of [
    { ...model().rows[0]!, sense: "<=" as const }, { ...model().rows[0]!, rhs: 2 },
    { ...model().rows[0]!, terms: new Map([["a", 2], ["b", 1]]) },
  ]) expect(prepareRatioDeficitRepresentation(model({ rows: [choose, ...model().rows.slice(1)] }), metadata)!.centeredRows).toBe(0);
});

test("centering work budget stops optional matches without changing any feasible point", () => {
  const names = Array.from({ length: 50 }, (_, index) => `b${index}`);
  const original = model({ variables: [{ name: "q", min: 0, max: 3 }, ...names.map(name => ({ name, min: 0, max: 1 }))],
    binaryVariables: names, integerVariables: ["q"], objective: new Map([["q", 1]]), rows: [
      ...names.map(name => ({ name, terms: new Map([[name, 1]]), sense: "=" as const, rhs: 1 })),
      ...Array.from({ length: 200 }, (_, index) => ({ name: `envelope${index}`, terms: new Map([["q", 1], ["b49", -1]]), sense: "<=" as const, rhs: 0 })),
    ] });
  const prepared = prepareRatioDeficitRepresentation(original, { variables: ["q"], scale: 3 })!;
  expect(prepared.centeredRows).toBeGreaterThan(0);
  expect(prepared.centeredRows).toBeLessThan(200);
  for (let q = 0; q <= 3; q++) {
    const point = new Map(names.map(name => [name, 1]));
    point.set("q", q);
    const transformed = new Map(point);
    transformed.delete("q"); transformed.set("__ratio_deficit_0", 3 - q);
    expect(feasible(original, point)).toBe(feasible(prepared.request, transformed));
  }
});

test("parent cancellation and deadline guards propagate through preparation, expansion and callbacks", () => {
  for (const stopAt of [1, 12, 45]) {
    let calls = 0;
    expect(() => prepareRatioDeficitRepresentation(model({ isCancelled: () => ++calls >= stopAt }), metadata)).toThrow("搜索已取消");
  }
  let cancelled = false;
  const prepared = prepareRatioDeficitRepresentation(model({ isCancelled: () => cancelled, onProgress: () => {}, stopWhenDualBoundProvesOptimal: () => false }), metadata)!;
  cancelled = true;
  expect(() => prepared.expandSolution({ Status: "Optimal", Columns: {} })).toThrow("搜索已取消");
  expect(() => prepared.request.stopWhenDualBoundProvesOptimal!(0)).toThrow("搜索已取消");
  expect(() => prepared.request.onProgress!({ backend: "HiGHS", model: "x", kind: "log" })).toThrow("搜索已取消");
  const deadline = new Error("parent deadline exhausted");
  expect(() => prepareRatioDeficitRepresentation(model({ isCancelled: () => { throw deadline; } }), metadata)).toThrow(deadline);
});
