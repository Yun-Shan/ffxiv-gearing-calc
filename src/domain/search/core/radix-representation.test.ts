import { expect, test } from "vitest";
import type { LinearMipRequest, LinearMipRow } from "../linear-mip.ts";
import { prepareRadixRepresentation } from "./radix-representation.ts";

const BASE = 65_536;
const LARGE = 2 ** 32;
function model(sense: LinearMipRow["sense"] = "<=", patch: Partial<LinearMipRequest> = {}): LinearMipRequest {
  return {
    name: "signed integer row",
    objective: new Map([["x", 1], ["y", -1]]),
    variables: ["x", "y", "z", "u", "v", "w"].map(name => ({ name, min: -1, max: 1 })),
    integerVariables: ["x", "y", "z", "u", "v", "w"], binaryVariables: [],
    rows: [
      { name: "large", terms: new Map([["x", LARGE + BASE - 1], ["y", -LARGE - 1], ["z", -BASE - 1]]), sense, rhs: -BASE - 1 },
      { name: "untouched", terms: new Map([["u", 1]]), sense: "=", rhs: 0 },
      { name: "also-untouched", terms: new Map([["v", 1], ["w", 1]]), sense: "=", rhs: 0 },
    ],
    ...patch,
  };
}
function feasible(request: LinearMipRequest, point: ReadonlyMap<string, number>): boolean {
  if (request.variables.some(({ name, min, max }) => !Number.isSafeInteger(point.get(name)) || point.get(name)! < min || point.get(name)! > max)) return false;
  return request.rows.every(({ terms, sense, rhs }) => {
    const lhs = [...terms].reduce((sum, [name, coefficient]) => sum + BigInt(coefficient) * BigInt(point.get(name)!), 0n);
    return sense === "=" ? lhs === BigInt(rhs) : sense === "<=" ? lhs <= BigInt(rhs) : lhs >= BigInt(rhs);
  });
}

test.each(["=", "<=", ">="] as const)("signed %s row has exactly the original integer domain in both directions", sense => {
  const original = model(sense);
  const before = structuredClone(original);
  const prepared = prepareRadixRepresentation(original)!;
  expect(prepared).toBeDefined();
  expect(prepared.request.objective).toEqual(original.objective);
  const digitRows = prepared.request.rows.filter(row => row.name.startsWith("__radix_"));
  const carries = prepared.request.variables.filter(variable => variable.name.includes("_carry_"));
  expect(digitRows).toHaveLength(3);
  expect(carries).toHaveLength(2);
  expect(digitRows.at(-1)!.terms.has("__radix_0_carry_2")).toBe(false);
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const point = new Map(Object.entries({ x, y, z, u: 0, v: 0, w: 0 }));
    let lifts = 0;
    const enumerate = (index: number): void => {
      if (index < carries.length) {
        const carry = carries[index]!;
        for (let value = carry.min; value <= carry.max; value++) { point.set(carry.name, value); enumerate(index + 1); }
        point.delete(carry.name);
        return;
      }
      // Every slack digit is determined by its own equality once the bounded
      // carries and original point are fixed. Enumerate every such extension.
      for (const row of digitRows) {
        const slack = [...row.terms].find(([name]) => name.includes("_slack_"));
        if (slack === undefined) continue;
        const subtotal = [...row.terms].reduce((sum, [name, coefficient]) => name === slack[0]
          ? sum : sum + BigInt(coefficient) * BigInt(point.get(name)!), 0n);
        point.set(slack[0], Number((BigInt(row.rhs) - subtotal) / BigInt(slack[1])));
      }
      if (feasible(prepared.request, point)) {
        lifts++;
        expect(feasible(original, point)).toBe(true);
        const Columns = Object.fromEntries([...point].map(([name, Primal]) => [name, { Primal }]));
        const restored = prepared.expandSolution({ Status: "Optimal", Columns, ObjectiveValue: x - y });
        expect(Object.keys(restored.Columns).sort()).toEqual(["u", "v", "w", "x", "y", "z"]);
        expect(restored.ObjectiveValue).toBe(x - y);
      }
    };
    enumerate(0);
    expect(lifts).toBe(feasible(original, point) ? 1 : 0);
    const hinted = prepareRadixRepresentation({ ...original, solutionHint: new Map(Object.entries({ x, y, z, u: 0, v: 0, w: 0 })) })!;
    if (lifts === 1) expect(feasible(hinted.request, hinted.request.solutionHint!)).toBe(true);
    else expect([...hinted.request.solutionHint!.keys()].some(name => name.startsWith("__radix_"))).toBe(false);
  }
  expect(original).toEqual(before);
});

test("partial and stale hints stay partial; full legal hints receive all carry/slack digits", () => {
  const partial = prepareRadixRepresentation(model("<=", { solutionHint: new Map([["x", -1], ["missing", 2], ["y", 0.5], ["u", NaN]]) }))!;
  expect(partial.request.solutionHint).toEqual(new Map([["x", -1]]));
  const legal = prepareRadixRepresentation(model("<=", { solutionHint: new Map(Object.entries({ x: -1, y: 1, z: 0, u: 0, v: 0, w: 0 })) }))!;
  expect(legal.request.solutionHint!.size).toBe(legal.request.variables.length);
  expect(feasible(legal.request, legal.request.solutionHint!)).toBe(true);
});

test("expansion preserves standard statuses, original primal values and objective callbacks", () => {
  const onProgress = () => {};
  const stopWhenDualBoundProvesOptimal = () => false;
  const prepared = prepareRadixRepresentation(model("<=", { onProgress, stopWhenDualBoundProvesOptimal }))!;
  expect(prepared.request.onProgress).toBe(onProgress);
  expect(prepared.request.stopWhenDualBoundProvesOptimal).toBe(stopWhenDualBoundProvesOptimal);
  for (const Status of ["Optimal", "FeasibleSignature"]) {
    const Columns = Object.fromEntries(prepared.request.variables.map(({ name }) => [name, { Primal: name === "x" ? 0.0000001 : 0 }]));
    const restored = prepared.expandSolution({ Status, Columns, ObjectiveValue: 0 });
    expect(restored.Status).toBe(Status);
    expect(restored.Columns.x!.Primal).toBe(0.0000001);
    expect(restored.ObjectiveValue).toBe(0);
    expect(Object.keys(restored.Columns)).toHaveLength(6);
  }
  for (const Status of ["DualBound", "Infeasible", "Time limit reached"]) {
    const result = { Status, Columns: {} };
    expect(prepared.expandSolution(result)).toBe(result);
  }
  expect(() => prepared.expandSolution({ Status: "Optimal", Columns: {} })).toThrow("missing finite original column");
  const Columns = Object.fromEntries(model().variables.map(({ name }) => [name, { Primal: 0 }]));
  Columns.x = { Primal: Infinity };
  expect(() => prepared.expandSolution({ Status: "Optimal", Columns })).toThrow("missing finite original column");
  const inherited = Object.create(Object.fromEntries(model().variables.map(({ name }) => [name, { Primal: 0 }])));
  expect(() => prepared.expandSolution({ Status: "Optimal", Columns: inherited })).toThrow("missing finite original column");
});

test.each<[string, (request: LinearMipRequest) => void]>([
  ["duplicate variable", request => request.variables = [...request.variables, request.variables[0]!]],
  ["unknown integer", request => request.integerVariables = [...request.integerVariables, "missing"]],
  ["unsafe RHS", request => request.rows = [{ ...request.rows[0]!, rhs: 2 ** 53 }]],
  ["unsafe coefficient", request => request.rows = [{ ...request.rows[0]!, terms: new Map([["x", 2 ** 53]]) }]],
  ["continuous coordinate", request => request.integerVariables = request.integerVariables.filter(name => name !== "x")],
  ["unknown coordinate", request => request.rows = [{ ...request.rows[0]!, terms: new Map([["missing", LARGE]]) }]],
  ["unsafe coordinate bound", request => request.variables = request.variables.map(v => v.name === "x" ? { ...v, max: 2 ** 53 } : v)],
  ["fractional coordinate bound", request => request.variables = request.variables.map(v => v.name === "x" ? { ...v, min: 0.5 } : v)],
  ["contradictory coordinate bound", request => request.variables = request.variables.map(v => v.name === "x" ? { ...v, min: 2 } : v)],
  ["invalid binary bound", request => request.binaryVariables = ["x"]],
  ["digit row name collision", request => request.rows = [...request.rows, { name: "__radix_0_digit_0", terms: new Map(), sense: "=", rhs: 0 }]],
  ["slack name collision", request => request.variables = [...request.variables, { name: "__radix_0_slack_0", min: 0, max: 1 }]],
  ["carry name collision", request => request.variables = [...request.variables, { name: "__radix_0_carry_0", min: 0, max: 1 }]],
  ["box contradiction", request => request.rows = [{ ...request.rows[0]!, rhs: -Number.MAX_SAFE_INTEGER }]],
  ["preparation row budget", request => request.rows = [request.rows[0]!]],
  ["preparation variable budget", request => { request.variables = request.variables.slice(0, 3); request.integerVariables = ["x", "y", "z"]; }],
  ["small coefficients", request => request.rows = [{ name: "small", terms: new Map([["x", LARGE - 1]]), sense: "=", rhs: 0 }]],
])("%s safely retains the original model", (_name, mutate) => {
  const request = model();
  mutate(request);
  const before = structuredClone(request);
  expect(prepareRadixRepresentation(request)).toBeUndefined();
  expect(request).toEqual(before);
});

test("untransformable rows are retained alongside a separately certified row", () => {
  const original = model();
  original.rows = [...original.rows, { name: "fractional", terms: new Map([["x", LARGE + 0.5]]), sense: "<=", rhs: 1 }];
  const prepared = prepareRadixRepresentation(original)!;
  expect(prepared.request.rows.find(row => row.name === "fractional")).toEqual(original.rows.at(-1));
});

test("unsafe carry bounds and excessive sparse growth abandon only the proposed representation", () => {
  const unsafe = model("=", {
    variables: model().variables.map(v => v.name === "x" || v.name === "y" ? { ...v, min: 0, max: Number.MAX_SAFE_INTEGER } : v),
    rows: [{ name: "unsafe carry", terms: new Map([["x", LARGE + BASE - 1], ["y", LARGE + BASE - 1]]), sense: "=", rhs: 0 }, ...model().rows.slice(1)],
  });
  expect(prepareRadixRepresentation(unsafe)).toBeUndefined();
  const sparse = model("<=", {
    variables: Array.from({ length: 8 }, (_, i) => ({ name: `x${i}`, min: 0, max: 1 })),
    integerVariables: Array.from({ length: 8 }, (_, i) => `x${i}`), objective: new Map(),
    rows: [{ name: "sparse", terms: new Map([["x0", Number.MAX_SAFE_INTEGER]]), sense: "<=", rhs: 0 },
      ...Array.from({ length: 3 }, (_, i) => ({ name: `empty${i}`, terms: new Map<string, number>(), sense: "=" as const, rhs: 0 }))],
  });
  expect(prepareRadixRepresentation(sparse)).toBeUndefined();
  const noIntegerCarry = model("=", { variables: model().variables.map(v => ({ ...v, min: 0, max: 0 })) });
  expect(prepareRadixRepresentation(noIntegerCarry)).toBeUndefined();
});

test("parent cancellation and deadline guards propagate during preparation, lifting and expansion", () => {
  for (const stopAt of [1, 10, 30, 50]) {
    let calls = 0;
    expect(() => prepareRadixRepresentation(model("<=", {
      solutionHint: new Map(Object.entries({ x: -1, y: 1, z: 0, u: 0, v: 0, w: 0 })),
      isCancelled: () => ++calls >= stopAt,
    }))).toThrow("搜索已取消");
  }
  let cancelled = false;
  const prepared = prepareRadixRepresentation(model("<=", { isCancelled: () => cancelled }))!;
  cancelled = true;
  expect(() => prepared.expandSolution({ Status: "Infeasible", Columns: {} })).toThrow("搜索已取消");
  const deadline = new Error("parent deadline exhausted");
  expect(() => prepareRadixRepresentation(model("<=", { isCancelled: () => { throw deadline; } }))).toThrow(deadline);
});
