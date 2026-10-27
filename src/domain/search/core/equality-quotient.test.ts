import { expect, test } from "vitest";
import { prepareEqualityQuotient } from "./equality-quotient.ts";
import type { LinearMipRequest } from "../linear-mip.ts";
import { validateMipSolution } from "./solution-validation.ts";

const equality = (left: string, right: string, coefficient = 1) => ({
  name: `${left}_equals_${right}`,
  terms: new Map([[left, coefficient], [right, -coefficient]]),
  sense: "=" as const,
  rhs: 0,
});
function request(patch: Partial<LinearMipRequest> = {}): LinearMipRequest {
  return {
    name: "equality quotient",
    objective: new Map([["x", 1 / 65536], ["y", 2 / 65536], ["z", -1 / 65536]]),
    rows: [equality("x", "y", 2), equality("y", "z", 0.5)],
    variables: ["x", "y", "z"].map((name) => ({ name, min: 0, max: 2 })),
    integerVariables: ["x", "y", "z"],
    binaryVariables: [],
    ...patch,
  };
}
const feasible = (model: LinearMipRequest, values: Record<string, number>) => {
  if (model.variables.some(({ name, min, max }) => values[name]! < min || values[name]! > max)) return false;
  if (model.integerVariables.some((name) => !Number.isInteger(values[name]))) return false;
  if (model.binaryVariables.some((name) => values[name] !== 0 && values[name] !== 1)) return false;
  return model.rows.every(({ terms, rhs, sense }) => {
    const value = [...terms].reduce((sum, [name, coefficient]) => sum + values[name]! * coefficient, 0);
    return sense === "=" ? value === rhs : sense === "<=" ? value <= rhs : value >= rhs;
  });
};

test("integer feasible points and dyadic objectives have an exact one-to-one correspondence", () => {
  const original = request({ rows: [
    ...request().rows,
    { name: "limit", terms: new Map([["x", 2], ["z", 1]]), sense: "<=", rhs: 4 },
  ] });
  const before = structuredClone(original);
  const quotient = prepareEqualityQuotient(original)!;
  expect(quotient.variablesRemoved).toBe(2);
  expect(quotient.rowsRemoved).toBe(2);
  expect(quotient.request.variables).toEqual([{ name: "x", min: 0, max: 2 }]);
  expect(quotient.request.objective).toEqual(new Map([["x", 2 / 65536]]));
  for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) for (let z = 0; z <= 2; z++) {
    const sourceFeasible = feasible(original, { x, y, z });
    expect(sourceFeasible).toBe(x === y && y === z && feasible(quotient.request, { x }));
    if (sourceFeasible) {
      const oldObjective = [...original.objective].reduce((sum, [name, value]) =>
        sum + BigInt(value * 65536) * BigInt(({ x, y, z })[name as "x" | "y" | "z"]), 0n);
      expect(oldObjective).toBe(BigInt(quotient.request.objective.get("x")! * 65536) * BigInt(x));
    }
  }
  expect(original).toEqual(before);
});

test("continuous coordinates retain the entire equality segment, not only its integer points", () => {
  const original = request({ integerVariables: [], rows: [equality("x", "y")],
    variables: [{ name: "x", min: -1, max: 2 }, { name: "y", min: 0.25, max: 1.75 },
      { name: "z", min: 0, max: 2 }] });
  const quotient = prepareEqualityQuotient(original)!;
  expect(quotient.request.variables[0]).toEqual({ name: "x", min: 0.25, max: 1.75 });
  expect(quotient.request.integerVariables).toEqual([]);
  for (let x = -1; x <= 2; x += 0.25) for (let y = -1; y <= 2; y += 0.25) {
    expect(feasible(original, { x, y, z: 0.5 })).toBe(x === y && feasible(quotient.request, { x, z: 0.5 }));
  }
});

test("bound intersections and integer/binary declarations inherit every member", () => {
  const quotient = prepareEqualityQuotient(request({
    variables: [{ name: "x", min: 0.2, max: 3 }, { name: "y", min: -1, max: 2 }, { name: "z", min: 0, max: 1 }],
    integerVariables: ["y"], binaryVariables: ["z"],
  }))!;
  expect(quotient.request.variables).toEqual([{ name: "x", min: 0.2, max: 1 }]);
  expect(quotient.request.binaryVariables).toEqual(["x"]);
  expect(quotient.request.integerVariables).toEqual([]);
  const integerOnly = prepareEqualityQuotient(request({ integerVariables: ["y"] }))!;
  expect(integerOnly.request.integerVariables).toEqual(["x"]);
});

test("BigInt merging retains a unit lost by ordinary floating addition", () => {
  const quotient = prepareEqualityQuotient(request({ objective: new Map([
    ["x", Number.MAX_SAFE_INTEGER], ["y", 1], ["z", -Number.MAX_SAFE_INTEGER],
  ]) }))!;
  expect(quotient.request.objective).toEqual(new Map([["x", 1]]));
  const subnormal = prepareEqualityQuotient(request({ objective: new Map([
    ["x", Number.MIN_VALUE], ["y", Number.MIN_VALUE],
  ]) }))!;
  expect(subnormal.request.objective.get("x")).toBe(2 * Number.MIN_VALUE);
});

test("zero rows are deleted only when they are exact tautologies", () => {
  const original = request({ rows: [
    ...request().rows,
    { ...equality("x", "y"), sense: "<=", rhs: 0 },
    { ...equality("x", "y"), sense: ">=", rhs: -2 },
  ] });
  expect(prepareEqualityQuotient(original)!.request.rows).toEqual([]);
  for (const [sense, rhs] of [["=", 1], ["<=", -1], [">=", 1]] as const) {
    expect(prepareEqualityQuotient({ ...original, rows: [
      ...original.rows, { ...equality("x", "y"), sense, rhs },
    ] })).toBeUndefined();
  }
});

test("similar columns, complementary binaries, offsets and approximate equality do not authorize merging", () => {
  for (const row of [
    { ...equality("x", "y"), rhs: 1 },
    { ...equality("x", "y"), terms: new Map([["x", 1], ["y", 1]]), rhs: 1 },
    { ...equality("x", "y"), terms: new Map([["x", 1], ["y", -0.9999999999999999]]) },
    { ...equality("x", "y"), sense: "<=" as const },
  ]) expect(prepareEqualityQuotient(request({ rows: [row] }))).toBeUndefined();
});

test.each<[string, (model: LinearMipRequest) => void]>([
  ["unknown equality variable", (model) => model.rows = [equality("x", "missing")]],
  ["unknown row variable", (model) => model.rows = [...model.rows, { name: "bad", terms: new Map([["missing", 1]]), sense: "=", rhs: 0 }]],
  ["unknown objective variable", (model) => model.objective = new Map([["missing", 1]])],
  ["unknown integer", (model) => model.integerVariables = ["missing"]],
  ["unknown binary", (model) => model.binaryVariables = ["missing"]],
  ["duplicate variable", (model) => model.variables = [...model.variables, model.variables[0]!]],
  ["nonfinite bound", (model) => model.variables = [{ name: "x", min: 0, max: Infinity }, ...model.variables.slice(1)]],
  ["contradictory member bounds", (model) => model.variables = [{ name: "x", min: 0, max: 1 }, { name: "y", min: 2, max: 3 }, model.variables[2]!]],
  ["invalid original bound", (model) => model.variables = [{ name: "x", min: 2, max: 1 }, ...model.variables.slice(1)]],
  ["nonfinite objective", (model) => model.objective = new Map([["x", NaN]])],
  ["unsafe coefficient", (model) => model.objective = new Map([["x", Number.MAX_VALUE]])],
  ["nonrepresentable exact dyadic sum", (model) => model.objective = new Map([["x", 0.1], ["y", 0.2]])],
  ["merged coefficient overflow", (model) => model.objective = new Map([["x", Number.MAX_SAFE_INTEGER], ["y", Number.MAX_SAFE_INTEGER]])],
  ["nonfinite right side", (model) => model.rows = [...model.rows, { name: "bad", terms: new Map([["x", 1]]), sense: "<=", rhs: Infinity }]],
  ["unknown hint variable", (model) => model.solutionHint = new Map([["missing", 1]])],
  ["nonfinite hint", (model) => model.solutionHint = new Map([["x", NaN]])],
  ["conflicting hints", (model) => model.solutionHint = new Map([["x", 0], ["y", 1]])],
])("%s atomically retains the original request", (_name, mutate) => {
  const original = request();
  mutate(original);
  const before = structuredClone(original);
  expect(prepareEqualityQuotient(original)).toBeUndefined();
  expect(original).toEqual(before);
});

test("sparse hints stay sparse, and only successful columns are expanded to original names", () => {
  const quotient = prepareEqualityQuotient(request({ solutionHint: new Map([["y", 1]]) }))!;
  expect(quotient.request.solutionHint).toEqual(new Map([["x", 1]]));
  const expanded = quotient.expandSolution({ Status: "Optimal", Columns: { x: { Primal: 1 } }, ObjectiveValue: 2 / 65536 });
  expect(expanded.Columns).toEqual({ x: { Primal: 1 }, y: { Primal: 1 }, z: { Primal: 1 } });
  const integerRows = [equality("x", "y"), equality("y", "z")];
  expect(() => validateMipSolution(integerRows, request().variables, expanded.Columns)).not.toThrow();
  expect(() => quotient.expandSolution({ Status: "Optimal", Columns: {} })).toThrow("缺少代表变量");
  for (const Status of ["DualBound", "Infeasible", "状态代码 9"]) {
    const stopped = { Status, Columns: {} };
    expect(quotient.expandSolution(stopped)).toBe(stopped);
  }
});

test("real HiGHS solves the quotient and reconstructs the original integer model", async () => {
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const original = request({ rows: [
    equality("x", "y", 2), equality("y", "z"),
    { name: "limit", terms: new Map([["x", 1], ["y", 1], ["z", 1]]), sense: "<=", rhs: 4 },
  ] });
  const result = await solveIntegerModel(original);
  expect(result.Status).toBe("Optimal");
  expect(result.Columns).toEqual({ x: { Primal: 1 }, y: { Primal: 1 }, z: { Primal: 1 } });
  expect(() => validateMipSolution(original.rows, original.variables, result.Columns)).not.toThrow();
});

test("real HiGHS imports a density-approved quotient with zero remaining rows", async () => {
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const original = request({ equalityQuotient: { maxRowDensityGrowth: 3 },
    rows: [equality("x", "y"), equality("y", "z")],
  });
  const result = await solveIntegerModel(original);
  expect(result.Status).toBe("Optimal");
  expect(result.Columns).toEqual({ x: { Primal: 2 }, y: { Primal: 2 }, z: { Primal: 2 } });
  expect(result.ObjectiveValue).toBeCloseTo(4 / 65536, 12);
  expect(() => validateMipSolution(original.rows, original.variables, result.Columns)).not.toThrow();
});
