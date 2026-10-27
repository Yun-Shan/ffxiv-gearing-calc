import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LinearMipRequest, LinearMipProgress } from "../linear-mip.ts";

const loader = vi.hoisted(() => vi.fn());
vi.mock("highs", () => ({ default: loader }));
type FakeEvent = {
  type: number;
  message: string;
  data: Record<string, unknown>;
  interrupt: ReturnType<typeof vi.fn>;
  setSolution: ReturnType<typeof vi.fn>;
  repairSolution: ReturnType<typeof vi.fn>;
};
type Callbacks = Record<number, (event: FakeEvent) => void>;
const names = [
  "logging",
  "simplexInterrupt",
  "ipmInterrupt",
  "mipSolution",
  "mipImprovingSolution",
  "mipLogging",
  "mipInterrupt",
  "mipCutPool",
  "mipUserSolution",
];
const callbackType = Object.fromEntries(
  names.map((name, index) => [name, index]),
);
const event = (data: Record<string, unknown> = {}, status = 0): FakeEvent => ({
  type: 0,
  message: "native callback",
  data,
  interrupt: vi.fn(),
  setSolution: vi.fn(() => ({ status })),
  repairSolution: vi.fn(),
});
function runtime(status = 1, run: (callbacks: Callbacks) => void = () => {}) {
  const native = {
    options: { set: vi.fn() },
    getColByName: (name: string): number => (name === "x" ? 1 : 0),
    setSolution: vi.fn(),
    run: vi.fn(run),
    getModelStatus: () => status,
    getSolution: () => ({ colValue: [3, 2] }),
    getObjectiveValue: () => 7,
  };
  const withModel = vi.fn(
    (
      _input: { format: string; data: string },
      use: (model: typeof native) => unknown,
    ) => use(native),
  );
  return {
    native,
    withModel,
    constants: {
      callbackType,
      status: { error: -1 },
      modelStatus: { optimal: 1, infeasible: 2 },
    },
  };
}
const request = (patch: Partial<LinearMipRequest> = {}): LinearMipRequest => ({
  name: "contract",
  objective: new Map([
    ["x", 2],
    ["y", 1],
  ]),
  rows: [
    {
      name: "limit",
      terms: new Map([
        ["x", 1],
        ["y", 1],
      ]),
      sense: "<=",
      rhs: 5,
    },
  ],
  variables: [
    { name: "x", min: 0, max: 3 },
    { name: "y", min: 0, max: 3 },
  ],
  binaryVariables: [],
  integerVariables: ["x", "y"],
  ...patch,
});

test.each([
  { policy: undefined, accepted: true, decision: "accepted" },
  { policy: { maxRowDensityGrowth: 1 }, accepted: false, decision: "density-rejected" },
  { policy: { maxRowDensityGrowth: 3, minVariableReductionPercent: 15 }, accepted: true, decision: "accepted" },
  { policy: { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 }, accepted: false, decision: "variable-reduction-rejected" },
])("T54 restoration remains valid with T57 policy $policy", async ({ policy: equalityQuotient, accepted, decision }) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const members = ["e0", "e1", "e2", "e3"];
  const counts = [[0, 3], [1, 2], [2, 1], [3, 0]];
  const oneHotRow = { name: "slot", sense: "=" as const, rhs: 1, terms: new Map(members.map((name) => [name, 1])) };
  const rawRows = [0, 1].map((axis) => ({ name: `raw_${axis}`, sense: "=" as const, rhs: 0,
    terms: new Map([[`r${axis}`, 1] as [string, number], ...members.map((name, member): [string, number] =>
      [name, -(axis === 0 ? 10 : 20) - counts[member]![axis]! * (axis === 0 ? 2 : 3)])]) }));
  const model: LinearMipRequest = { name: "T54-T57", equalityQuotient, objective: new Map([["alias", 0.5]]),
    variables: [...members.map((name) => ({ name, min: 0, max: 1 })), ...["r0", "r1", "alias"].map((name) => ({ name, min: 0, max: 100 }))],
    rows: [oneHotRow, ...rawRows, { name: "equality", terms: new Map([["alias", 1], ["r0", -1]]), sense: "=", rhs: 0 }],
    binaryVariables: members, integerVariables: ["r0", "r1", "alias"],
    materiaFamilies: [{ grade: 12, coordinates: [0, 1], units: [2, 3], fixedAttributes: [10, 20], remaining: 3,
      capacities: [3, 3], counts, members, slotVariables: members, oneHotRow, rawRows }] };
  const native = runtime();
  const columnNames = ["r0", "r1", ...(!accepted ? ["alias"] : []), "t54_x_0", "t54_y_0_0", "t54_y_0_1"];
  const values = new Map([["r0", 12], ["r1", 26], ["alias", 12], ["t54_x_0", 1], ["t54_y_0_0", 1], ["t54_y_0_1", 2]]);
  const index = new Map(columnNames.map((name, coordinate) => [name, coordinate]));
  native.native.getColByName = (name) => index.get(name)!;
  native.native.getSolution = () => ({ colValue: columnNames.map((name) => values.get(name)!) });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel({ ...model, onProgress: progress });
  expect(result.Columns).toMatchObject({ e0: { Primal: 0 }, e1: { Primal: 1 }, e2: { Primal: 0 }, e3: { Primal: 0 }, alias: { Primal: 12 } });
  expect(Object.keys(result.Columns).some((name) => name.startsWith("t54_"))).toBe(false);
  const lp = native.withModel.mock.calls[0]![0].data;
  expect(lp).toContain(accepted ? "obj: 0.5 r0" : "obj: 0.5 alias");
  expect(lp).not.toMatch(/\be[0-3]\b/);
  if (!accepted) expect(lp).toContain("alias");
  else expect(lp).not.toMatch(/\balias\b/);
  const profile = progress.mock.calls.map(([event]) => event as LinearMipProgress).find(({ message }) => message?.includes('"phase":"highs-call-start"'))!;
  expect(JSON.parse(profile.message!.slice(8))).toMatchObject({ equalityQuotientDecision: decision,
    equalityOriginalVariables: 7, materiaVariablesRemoved: 1, equalityCandidateBaseVariables: 6,
    equalityCandidateVariables: 5, equalityCandidateVariablesRemoved: 1, equalityVariablesRemoved: accepted ? 1 : 0,
    variables: accepted ? 5 : 6 });
});
beforeEach(() => {
  vi.resetModules();
  loader.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("failed initialization can retry and a successful runtime is reused", async () => {
  const native = runtime();
  loader
    .mockRejectedValueOnce(new Error("load failed"))
    .mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request())).rejects.toThrow("load failed");
  expect(await solveIntegerModel(request())).toMatchObject({
    Status: "Optimal",
    Columns: { x: { Primal: 2 }, y: { Primal: 3 } },
  });
  await solveIntegerModel(request());
  expect(loader).toHaveBeenCalledTimes(2);
});

test.each([
  [2, "Infeasible"],
  [9, "状态代码 9"],
])(
  "status %s never returns a fabricated incumbent",
  async (status, expected) => {
    loader.mockResolvedValue(runtime(Number(status)));
    const { solveIntegerModel } = await import("./highs-solver.ts");
    const progress = vi.fn();
    const result = await solveIntegerModel(request({ onProgress: progress }));
    expect(result.Status).toBe(expected);
    expect(result.Columns).toEqual({});
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: false, status: expected }),
    );
  },
);

test("LP serialization wraps both variable sections without losing names or signs", async () => {
  const native = runtime(2);
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const variables = Array.from({ length: 40 }, (_, i) => ({
    name: `v${i}_${"a".repeat(65)}`,
    min: 0,
    max: 1,
  }));
  await solveIntegerModel(
    request({
      objective: new Map(variables.map((v, i) => [v.name, i % 2 ? 2 : -1])),
      rows: [],
      variables,
      integerVariables: variables.slice(0, 20).map((v) => v.name),
      binaryVariables: variables.slice(20).map((v) => v.name),
      timeLimitMs: 1,
    }),
  );
  const text = native.withModel.mock.calls[0]![0].data;
  expect(text.split("\n").every((line) => line.length <= 1000)).toBe(true);
  expect(text).toContain(`obj: - 1 ${variables[0]!.name}`);
  expect(text).toContain("Generals\n");
  expect(text).toContain("Binaries\n");
  for (const { name } of variables)
    expect(text.match(new RegExp(name, "g"))).toHaveLength(3);
  expect(native.native.options.set).toHaveBeenCalledWith(
    expect.objectContaining({
      time_limit: 0.05,
      mip_rel_gap: 0,
      mip_abs_gap: 0,
    }),
  );
});

test.each([0, -1])(
  "hints are sorted, attempted once, and repaired only after native acceptance (%s)",
  async (hintStatus) => {
    const emitted = event({}, hintStatus);
    const native = runtime(1, (callbacks) => {
      callbacks[callbackType.mipUserSolution!]!(emitted);
      callbacks[callbackType.mipUserSolution!]!(emitted);
    });
    loader.mockResolvedValue(native);
    const { solveIntegerModel } = await import("./highs-solver.ts");
    await solveIntegerModel(
      request({
        solutionHint: new Map([
          ["x", 2],
          ["y", 3],
        ]),
      }),
    );
    expect(native.native.setSolution).toHaveBeenCalledWith({
      indices: [0, 1],
      values: [3, 2],
    });
    expect(emitted.setSolution).toHaveBeenCalledTimes(1);
    expect(emitted.repairSolution).toHaveBeenCalledTimes(
      hintStatus === 0 ? 1 : 0,
    );
  },
);

test("only finite dual bounds trigger the proof check, and a proven stop is distinguished from optimal status", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const emitted = event({ mip_dual_bound: Infinity });
  const check = vi.fn((bound: number) => bound <= 7);
  loader.mockResolvedValue(
    runtime(9, (callbacks) => {
      const interrupt = callbacks[callbackType.mipInterrupt!]!;
      interrupt(emitted);
      emitted.data.mip_dual_bound = 8;
      interrupt(emitted);
      emitted.data.mip_dual_bound = 7;
      interrupt(emitted); // throttled
      now = 101;
      interrupt(emitted);
      now = 202;
      interrupt(emitted); // already proven
    }),
  );
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel(
    request({ stopWhenDualBoundProvesOptimal: check }),
  );
  expect(result.Status).toBe("DualBound");
  expect(result.Columns).toEqual({});
  expect(check.mock.calls).toEqual([[8], [7]]);
  expect(emitted.interrupt).toHaveBeenCalledTimes(1);
});

test("callback telemetry normalizes large counts and omits malformed numeric fields", async () => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "0");
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const events: LinearMipProgress[] = [];
  const trace = vi.fn();
  const values: unknown[] = [3n, -1n, 4, -1, 1.2, "0005n", "-2", undefined];
  loader.mockResolvedValue(
    runtime(1, (callbacks) => {
      for (const value of values) {
        callbacks[callbackType.mipLogging!]!(
          event({
            mip_node_count: value,
            mip_total_lp_iterations: value,
            running_time: NaN,
            mip_primal_bound: Infinity,
            objective_function_value: 7,
            mip_dual_bound: "bad",
            mip_gap: undefined,
          }),
        );
      }
      now = 1200;
      for (const [name, id] of Object.entries(callbackType)) {
        const data = event({
          running_time: 0.5,
          mip_primal_bound: 6,
          mip_dual_bound: 8,
          mip_gap: 0.25,
        });
        data.type = id;
        callbacks[id]!(data);
        expect(trace).toHaveBeenCalledWith(
          expect.objectContaining({ callbackName: name, callbackType: id }),
        );
      }
    }),
  );
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await solveIntegerModel(
    request({ onProgress: (value) => events.push(value), onCallback: trace }),
  );
  expect(events.slice(0, 8).map((value) => value.nodes)).toEqual([
    "3",
    undefined,
    "4",
    undefined,
    undefined,
    "5",
    undefined,
    undefined,
  ]);
  for (const value of events.slice(0, 8)) {
    expect(value.objectiveValue).toBe(7);
    expect(value).not.toHaveProperty("bestBound");
    expect(value).not.toHaveProperty("gap");
  }
  expect(events).toContainEqual(
    expect.objectContaining({
      elapsedMs: 1200,
      objectiveValue: 6,
      bestBound: 8,
      gap: 0.25,
    }),
  );
});

test.each([undefined, true])("equality quotient policy %s uses the native path, lifting original columns and sparse hints", async (equalityQuotient) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const native = runtime();
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel(request({
    equalityQuotient,
    rows: [{ name: "same", terms: new Map([["x", 2], ["y", -2]]), sense: "=", rhs: 0 }],
    solutionHint: new Map([["y", 2]]),
    onProgress: progress,
  }));
  expect(result.Columns).toEqual({ x: { Primal: 2 }, y: { Primal: 2 } });
  expect(native.withModel.mock.calls[0]![0].data).toContain("obj: 3 x");
  expect(native.withModel.mock.calls[0]![0].data).not.toMatch(/\by\b/);
  expect(native.native.setSolution).toHaveBeenCalledWith({ indices: [1], values: [2] });
  const profile = progress.mock.calls.map(([value]) => value as LinearMipProgress)
    .find((value) => value.message?.includes('"phase":"highs-call-start"'));
  expect(JSON.parse(profile!.message!.slice("PROFILE ".length))).toMatchObject({
    variables: 1, constraints: 0,
    equalityOriginalVariables: 2, equalityOriginalRows: 1,
    equalityVariablesRemoved: 1, equalityRowsRemoved: 1,
    equalityQuotientPolicy: "auto",
  });
});

test("disabled equality quotient preserves the native LP and skips preparation and alias expansion", async () => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const equality = await import("./equality-quotient.ts");
  const prepare = vi.spyOn(equality, "prepareEqualityQuotient").mockImplementation(() => { throw new Error("disabled preparation must not run"); });
  const native = runtime();
  native.native.getSolution = () => ({ colValue: [2, 2] });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel(request({
    equalityQuotient: false,
    rows: [{ name: "same", terms: new Map([["x", 2], ["y", -2]]), sense: "=", rhs: 0 }],
    solutionHint: new Map([["x", 2], ["y", 2]]),
    onProgress: progress,
  }));
  expect(prepare).not.toHaveBeenCalled();
  expect(result.Columns).toEqual({ x: { Primal: 2 }, y: { Primal: 2 } });
  const lp = native.withModel.mock.calls[0]![0].data;
  expect(lp).toContain("obj: 2 x + 1 y");
  expect(lp).toContain("same: 2 x - 2 y = 0");
  expect(lp).toContain("0 <= x <= 3");
  expect(lp).toContain("0 <= y <= 3");
  expect(native.native.setSolution).toHaveBeenCalledWith({ indices: [0, 1], values: [2, 2] });
  const profile = progress.mock.calls.map(([value]) => value as LinearMipProgress)
    .find((value) => value.message?.includes('"phase":"highs-call-start"'));
  expect(JSON.parse(profile!.message!.slice("PROFILE ".length))).toMatchObject({
    variables: 2, constraints: 1, equalityOriginalVariables: 2, equalityOriginalRows: 1,
    equalityVariablesRemoved: 0, equalityRowsRemoved: 0, equalityPreparationMs: 0, equalityQuotientPolicy: "disabled",
  });
});

test("quotient dual-bound callbacks retain the original objective scale and do not fabricate columns", async () => {
  const emitted = event({ mip_dual_bound: 7 / 65536 });
  const check = vi.fn(() => true);
  loader.mockResolvedValue(runtime(9, (callbacks) => {
    callbacks[callbackType.mipInterrupt!]!(emitted);
  }));
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel(request({
    rows: [{ name: "same", terms: new Map([["x", 1], ["y", -1]]), sense: "=", rhs: 0 }],
    objective: new Map([["x", 2 / 65536], ["y", 1 / 65536]]),
    stopWhenDualBoundProvesOptimal: check,
  }));
  expect(result.Status).toBe("DualBound");
  expect(result.Columns).toEqual({});
  expect(check).toHaveBeenCalledWith(7 / 65536);
});

function densityRequest(equalities: number): LinearMipRequest {
  const names = ["x", "y", ...Array.from({ length: 8 }, (_, index) => `z${index}`)];
  return request({
    equalityQuotient: { maxRowDensityGrowth: 3 },
    objective: new Map([["x", 2 / 65536], ["y", 1 / 65536]]),
    variables: names.map((name) => ({ name, min: 0, max: name === "z0" ? 1 : 3 })),
    binaryVariables: ["z0"], integerVariables: names.filter((name) => name !== "z0"),
    rows: [...Array.from({ length: equalities }, (_, index) => ({ name: `same_${index}`, terms: new Map([["x", 1], ["y", -1]]), sense: "=" as const, rhs: 0 })),
      { name: "dense", terms: new Map(names.filter((name) => name !== "y").map((name) => [name, 1])), sense: "<=" as const, rhs: 40 },
      { name: "constant", terms: new Map<string, number>(), sense: "<=" as const, rhs: 7 },
      { name: "explicit_zeros", terms: new Map([["x", 0], ["y", -0]]), sense: "=" as const, rhs: 0 }],
    solutionHint: new Map(names.map((name) => [name, name === "z0" ? 1 : 2])),
  });
}
function densityRuntime(status = 1, run: (callbacks: Callbacks) => void = () => {}) {
  const native = runtime(status, run);
  const names = densityRequest(0).variables.map(({ name }) => name);
  native.native.getColByName = (name) => names.indexOf(name);
  native.native.getSolution = () => ({ colValue: names.map((name) => name === "z0" ? 1 : 2) });
  return native;
}

test.each([[5, "accepted"], [6, "accepted"], [7, "density-rejected"]] as const)(
  "density budget k=3 with %i equality rows makes decision %s (including exact threshold)", async (count, decision) => {
    vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
    const equality = await import("./equality-quotient.ts");
    const prepare = equality.prepareEqualityQuotient;
    const expand = vi.fn();
    vi.spyOn(equality, "prepareEqualityQuotient").mockImplementation((model) => {
      const candidate = prepare(model)!;
      return { ...candidate, expandSolution: (solution) => { expand(); return candidate.expandSolution(solution); } };
    });
    const native = densityRuntime();
    loader.mockResolvedValue(native);
    const { solveIntegerModel } = await import("./highs-solver.ts");
    const progress = vi.fn();
    const model = densityRequest(count);
    const before = structuredClone({ rows: model.rows, variables: model.variables, objective: model.objective, hint: model.solutionHint });
    const result = await solveIntegerModel({ ...model, onProgress: progress });
    const accepted = decision === "accepted";
    expect(expand).toHaveBeenCalledTimes(accepted ? 1 : 0);
    expect(result.Columns.x).toEqual({ Primal: 2 });
    expect(result.Columns.y).toEqual({ Primal: 2 });
    const lp = native.withModel.mock.calls[0]![0].data;
    if (accepted) {
      expect(lp).not.toMatch(/\by\b/);
      expect(lp).toContain(`obj: ${3 / 65536} x`);
    } else {
      await solveIntegerModel({ ...model, equalityQuotient: false });
      expect(lp).toBe(native.withModel.mock.calls[1]![0].data);
      expect(native.native.setSolution).toHaveBeenCalledWith({ indices: Array.from({ length: model.variables.length }, (_, index) => index),
        values: model.variables.map(({ name }) => model.solutionHint!.get(name)!) });
    }
    expect({ rows: model.rows, variables: model.variables, objective: model.objective, hint: model.solutionHint }).toEqual(before);
    const line = progress.mock.calls.map(([value]) => value as LinearMipProgress).find((value) => value.message?.includes('"phase":"highs-call-start"'))!.message!;
    const profile = JSON.parse(line.slice(8));
    expect(profile).toMatchObject({ equalityQuotientPolicy: "row-density", equalityQuotientDecision: decision,
      equalityDensityMaxGrowth: 3, equalityBaseNonzeros: String(2 * count + 9), equalityBaseNonzeroRows: String(count + 1),
      equalityCandidateNonzeros: "9", equalityCandidateNonzeroRows: "1", equalityVariablesRemoved: accepted ? 1 : 0,
      equalityRowsRemoved: accepted ? count + 2 : 0, nonzeros: accepted ? 9 : 2 * count + 9 });
    expect(() => JSON.stringify(profile)).not.toThrow();
  },
);

test.each([NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("invalid density multiplier %s preserves the request without preparing a quotient", async (maxRowDensityGrowth) => {
  const equality = await import("./equality-quotient.ts");
  const prepare = vi.spyOn(equality, "prepareEqualityQuotient").mockImplementation(() => { throw new Error("invalid policy cannot prepare"); });
  const native = densityRuntime();
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const model = { ...densityRequest(6), equalityQuotient: { maxRowDensityGrowth } };
  const result = await solveIntegerModel(model);
  expect(prepare).not.toHaveBeenCalled();
  expect(result.Columns.y).toEqual({ Primal: 2 });
  await solveIntegerModel({ ...model, equalityQuotient: false });
  expect(native.withModel.mock.calls[0]![0].data).toBe(native.withModel.mock.calls[1]![0].data);
});

test.each([null, "auto", {}, { maxRowDensityGrowth: "3" }])("unknown equality policy shape %j retains the complete request", async (policy) => {
  const equality = await import("./equality-quotient.ts");
  const prepare = vi.spyOn(equality, "prepareEqualityQuotient").mockImplementation(() => { throw new Error("unknown policy cannot prepare"); });
  const native = densityRuntime();
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const model = { ...densityRequest(6), equalityQuotient: policy as unknown as LinearMipRequest["equalityQuotient"] };
  await solveIntegerModel(model);
  await solveIntegerModel({ ...model, equalityQuotient: false });
  expect(prepare).not.toHaveBeenCalled();
  expect(native.withModel.mock.calls[0]![0].data).toBe(native.withModel.mock.calls[1]![0].data);
});

test.each(["no-equality", "conflicting-hint", "constant-base"] as const)("density policy retains the complete original representation without a certificate: %s", async (kind) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const model = densityRequest(0);
  model.equalityQuotient = { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 };
  if (kind === "conflicting-hint") {
    model.rows = densityRequest(6).rows;
    model.solutionHint = new Map([["x", 0], ["y", 1]]);
  }
  if (kind === "constant-base") model.rows = model.rows.filter(({ name }) => name !== "dense");
  const native = densityRuntime(); loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  await solveIntegerModel({ ...model, onProgress: progress });
  await solveIntegerModel({ ...model, equalityQuotient: false });
  expect(native.withModel.mock.calls[0]![0].data).toBe(native.withModel.mock.calls[1]![0].data);
  const profile = progress.mock.calls.map(([event]) => event as LinearMipProgress).find(({ message }) => message?.includes('"phase":"highs-call-start"'))!;
  expect(JSON.parse(profile.message!.slice(8)).equalityQuotientDecision).toBe("no-certificate");
});

test("density measurement ignores 0/-0 and constant rows and checks cancellation at entry, traversal and exit", async () => {
  const { measureNonzeroRowDensity } = await import("./highs-solver.ts");
  const rows = densityRequest(6).rows;
  const before = structuredClone(rows);
  expect(measureNonzeroRowDensity(rows)).toEqual({ nonzeros: 21n, nonzeroRows: 7n });
  expect(rows).toEqual(before);
  expect(measureNonzeroRowDensity(rows.slice(-2))).toEqual({ nonzeros: 0n, nonzeroRows: 0n });
  for (const coefficient of [NaN, Infinity, -Infinity]) expect(measureNonzeroRowDensity([
    { name: "invalid", terms: new Map([["x", coefficient]]), sense: "=", rhs: 0 },
  ])).toBeUndefined();
  expect(() => measureNonzeroRowDensity([], () => true)).toThrow("搜索已取消");
  let checks = 0;
  expect(() => measureNonzeroRowDensity(rows, () => ++checks === 10)).toThrow("搜索已取消");
  checks = 0;
  expect(() => measureNonzeroRowDensity([{ name: "one", terms: new Map([["x", 1]]), sense: "=", rhs: 0 }], () => ++checks === 4)).toThrow("搜索已取消");
});

test.each(["after-candidate", "during-density"] as const)("AbortError propagates %s before native loading", async (stage) => {
  const equality = await import("./equality-quotient.ts");
  const prepare = equality.prepareEqualityQuotient;
  let prepared = false;
  vi.spyOn(equality, "prepareEqualityQuotient").mockImplementation((model) => { const candidate = prepare(model); prepared = true; return candidate; });
  const { solveIntegerModel } = await import("./highs-solver.ts");
  let checks = 0;
  const model = { ...densityRequest(6), equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 },
    isCancelled: () => stage === "after-candidate" ? prepared : ++checks === 12 };
  await expect(solveIntegerModel(model)).rejects.toMatchObject({ name: "AbortError" });
  expect(prepared).toBe(true);
  expect(loader).not.toHaveBeenCalled();
});

test.each([[5, 0], [5, 25], [7, 25]])("non-Optimal decision with %i equalities and p=%i preserves callback scale and no columns", async (count, minVariableReductionPercent) => {
  const emitted = event({ mip_dual_bound: 7 / 65536 });
  const check = vi.fn(() => true);
  loader.mockResolvedValue(densityRuntime(9, (callbacks) => callbacks[callbackType.mipInterrupt!]!(emitted)));
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel({ ...densityRequest(count), equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent },
    stopWhenDualBoundProvesOptimal: check });
  expect(result.Status).toBe("DualBound"); expect(result.Columns).toEqual({});
  expect(check).toHaveBeenCalledWith(7 / 65536);
});

test.each([0, 100])("zero remaining nonzero rows still require p=%i variable reduction", async (minVariableReductionPercent) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const native = runtime(); native.native.getSolution = () => ({ colValue: [2, 2] });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel(request({ equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent }, onProgress: progress,
    rows: [{ name: "same", terms: new Map([["x", 1], ["y", -1]]), sense: "=", rhs: 0 }] }));
  expect(result.Columns).toEqual({ x: { Primal: 2 }, y: { Primal: 2 } });
  const profile = progress.mock.calls.map(([event]) => event as LinearMipProgress).find(({ message }) => message?.includes('"phase":"highs-call-start"'))!;
  expect(JSON.parse(profile.message!.slice(8))).toMatchObject({ equalityQuotientDecision: minVariableReductionPercent === 0 ? "accepted" : "variable-reduction-rejected",
    equalityBaseNonzeros: "2", equalityBaseNonzeroRows: "1", equalityCandidateNonzeros: "0", equalityCandidateNonzeroRows: "0",
    equalityMinVariableReductionPercent: minVariableReductionPercent, equalityCandidateBaseVariables: 2, equalityCandidateVariables: 1,
    equalityCandidateVariablesRemoved: 1, equalityVariablesRemoved: minVariableReductionPercent === 0 ? 1 : 0 });
});

test.each(["empty-base", "unmeasurable"] as const)("a density candidate cannot bypass the %s safety fallback", async (condition) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const equality = await import("./equality-quotient.ts");
  const prepare = equality.prepareEqualityQuotient;
  const model = densityRequest(6);
  model.equalityQuotient = { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 };
  const candidate = prepare(model)!;
  const expand = vi.fn(() => { throw new Error("rejected candidate must not expand"); });
  if (condition === "empty-base") model.rows = model.rows.slice(-2);
  else candidate.request.rows = [{ name: "unmeasurable", terms: new Map([["x", Infinity]]), sense: "<=", rhs: 1 }];
  vi.spyOn(equality, "prepareEqualityQuotient").mockReturnValue({ ...candidate, expandSolution: expand });
  const native = densityRuntime(); loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  await solveIntegerModel({ ...model, onProgress: progress });
  await solveIntegerModel({ ...model, equalityQuotient: false });
  expect(native.withModel.mock.calls[0]![0].data).toBe(native.withModel.mock.calls[1]![0].data);
  expect(expand).not.toHaveBeenCalled();
  const profile = progress.mock.calls.map(([event]) => event as LinearMipProgress).find(({ message }) => message?.includes('"phase":"highs-call-start"'))!;
  expect(JSON.parse(profile.message!.slice(8))).toMatchObject({ equalityQuotientDecision: condition,
    equalityVariablesRemoved: 0, equalityRowsRemoved: 0 });
});

test.each([
  { baseVariables: 3, percent: 25, accepted: true },
  { baseVariables: 4, percent: 25, accepted: true },
  { baseVariables: 5, percent: 25, accepted: false },
  { baseVariables: 4, percent: undefined, accepted: true },
  { baseVariables: 4, percent: 0, accepted: true },
  { baseVariables: 4, percent: 100, accepted: false },
])("variable gate checks $baseVariables -> one fewer variables at p=$percent", async ({ baseVariables, percent, accepted }) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const model = densityRequest(1);
  const names = new Set(model.variables.slice(0, baseVariables).map(({ name }) => name));
  model.variables = model.variables.filter(({ name }) => names.has(name));
  model.integerVariables = model.integerVariables.filter((name) => names.has(name));
  model.binaryVariables = model.binaryVariables.filter((name) => names.has(name));
  model.rows = model.rows.map((row) => ({ ...row, terms: new Map([...row.terms].filter(([name]) => names.has(name))) }));
  model.solutionHint = new Map([...model.solutionHint!].filter(([name]) => names.has(name)));
  model.equalityQuotient = { maxRowDensityGrowth: 3, minVariableReductionPercent: percent };
  const equality = await import("./equality-quotient.ts");
  const prepare = equality.prepareEqualityQuotient;
  const expand = vi.fn();
  vi.spyOn(equality, "prepareEqualityQuotient").mockImplementation((request) => {
    const candidate = prepare(request)!;
    return { ...candidate, expandSolution: (solution) => { expand(); return candidate.expandSolution(solution); } };
  });
  const native = densityRuntime(); loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel({ ...model, onProgress: progress });
  expect(result.Columns.x).toEqual({ Primal: 2 }); expect(result.Columns.y).toEqual({ Primal: 2 });
  expect(expand).toHaveBeenCalledTimes(accepted ? 1 : 0);
  const lp = native.withModel.mock.calls[0]![0].data;
  if (accepted) expect(lp).not.toMatch(/\by\b/);
  else {
    await solveIntegerModel({ ...model, equalityQuotient: false });
    expect(lp).toBe(native.withModel.mock.calls[1]![0].data);
    expect(native.native.setSolution).toHaveBeenCalledWith({ indices: Array.from({ length: baseVariables }, (_, index) => index),
      values: model.variables.map(({ name }) => model.solutionHint!.get(name)!) });
  }
  const profile = JSON.parse(progress.mock.calls.map(([event]) => event as LinearMipProgress)
    .find(({ message }) => message?.includes('"phase":"highs-call-start"'))!.message!.slice(8));
  expect(profile).toMatchObject({ equalityQuotientDecision: accepted ? "accepted" : "variable-reduction-rejected",
    equalityCandidateBaseVariables: baseVariables, equalityCandidateVariables: baseVariables - 1,
    equalityCandidateVariablesRemoved: 1, equalityMinVariableReductionPercent: percent === undefined ? 0 : percent,
    equalityVariablesRemoved: accepted ? 1 : 0, equalityRowsRemoved: accepted ? 3 : 0 });
});

test.each([null, NaN, Infinity, -1, 101, 1.5, Number.MAX_SAFE_INTEGER + 1])("invalid variable-reduction percentage %s preserves the original policy representation", async (percent) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const equality = await import("./equality-quotient.ts");
  const prepare = vi.spyOn(equality, "prepareEqualityQuotient").mockImplementation(() => { throw new Error("invalid percentage cannot prepare"); });
  const native = densityRuntime(); loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const model = { ...densityRequest(6), equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent: percent as unknown as number } };
  const progress = vi.fn();
  await solveIntegerModel({ ...model, onProgress: progress });
  await solveIntegerModel({ ...model, equalityQuotient: false });
  expect(prepare).not.toHaveBeenCalled();
  expect(native.withModel.mock.calls[0]![0].data).toBe(native.withModel.mock.calls[1]![0].data);
  const profile = JSON.parse(progress.mock.calls.map(([event]) => event as LinearMipProgress)
    .find(({ message }) => message?.includes('"phase":"highs-call-start"'))!.message!.slice(8));
  expect(profile).toMatchObject({ equalityQuotientDecision: "invalid-policy", equalityVariablesRemoved: 0, equalityPreparationMs: 0 });
  expect(profile).not.toHaveProperty("equalityCandidateBaseVariables");
  expect(profile).not.toHaveProperty("equalityMinVariableReductionPercent");
});

test("density rejection takes precedence over the new percentage gate", async () => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const native = densityRuntime(); loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  await solveIntegerModel({ ...densityRequest(7), equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 }, onProgress: progress });
  const profile = JSON.parse(progress.mock.calls.map(([event]) => event as LinearMipProgress)
    .find(({ message }) => message?.includes('"phase":"highs-call-start"'))!.message!.slice(8));
  expect(profile).toMatchObject({ equalityQuotientDecision: "density-rejected", equalityCandidateBaseVariables: 10,
    equalityCandidateVariables: 9, equalityCandidateVariablesRemoved: 1, equalityMinVariableReductionPercent: 25,
    equalityVariablesRemoved: 0 });
});

test("unmeasurable candidate variable counts retain base instead of inventing a percentage", async () => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const equality = await import("./equality-quotient.ts");
  const model = { ...densityRequest(5), equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 } };
  const candidate = equality.prepareEqualityQuotient(model)!;
  candidate.request.variables = { length: Infinity } as unknown as LinearMipRequest["variables"];
  const expand = vi.fn();
  vi.spyOn(equality, "prepareEqualityQuotient").mockReturnValue({ ...candidate, expandSolution: expand });
  const native = densityRuntime(); loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  await solveIntegerModel({ ...model, onProgress: progress });
  await solveIntegerModel({ ...model, equalityQuotient: false });
  expect(native.withModel.mock.calls[0]![0].data).toBe(native.withModel.mock.calls[1]![0].data);
  expect(expand).not.toHaveBeenCalled();
  const profile = JSON.parse(progress.mock.calls.map(([event]) => event as LinearMipProgress)
    .find(({ message }) => message?.includes('"phase":"highs-call-start"'))!.message!.slice(8));
  expect(profile).toMatchObject({ equalityQuotientDecision: "unmeasurable", equalityVariablesRemoved: 0 });
  expect(profile).not.toHaveProperty("equalityCandidateBaseVariables");
});
