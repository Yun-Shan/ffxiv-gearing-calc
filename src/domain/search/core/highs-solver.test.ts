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
  names.map((name, index) => [name, name === "mipUserSolution" ? 9 : index]),
);
const modelStatus = { optimal: 7, infeasible: 8, interrupted: 17 };
const solutionStatus = { none: 0, infeasible: 1, feasible: 2 };
const event = (data: Record<string, unknown> = {}, status = 0): FakeEvent => ({
  type: 0,
  message: "native callback",
  data,
  interrupt: vi.fn(),
  setSolution: vi.fn(() => ({ status })),
  repairSolution: vi.fn(() => ({ status: 0 })),
});
type RuntimeFixture = {
  columnOrder?: readonly string[];
  values?: ReadonlyMap<string, number>;
  retainOptions?: boolean;
};
// This is an API contract mock, not a native solver. Discover the imported
// columns from the actual LP, then use explicit fixture values for its primal.
function runtime(
  status = modelStatus.optimal,
  run: (callbacks: Callbacks) => void = () => {},
  fixture: RuntimeFixture = {},
) {
  let columnNames: string[] = [];
  let rows: string[] = [];
  let objective = "";
  const values = fixture.values ?? new Map([["x", 2], ["y", 3]]);
  const metadata = () => ({ status: 0, warnings: [] as string[] });
  const optionValues = new Map<string, string | number | boolean>();
  const resetOptions = () => {
    optionValues.clear();
    optionValues.set("small_matrix_value", 1e-9);
    optionValues.set("time_limit", Infinity);
  };
  resetOptions();
  // Only evaluate serialized scalar expressions; no optimization or feasibility
  // decision is performed here. Production validation checks fixture feasibility.
  const terms = (expression: string) => [...expression.matchAll(
    /([+-]?)\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
  )];
  const activity = (expression: string) => terms(expression).reduce((sum, term) => {
    const value = values.get(term[3]!);
    if (value === undefined) throw new Error(`Missing explicit fixture value: ${term[3]}`);
    return sum + (term[1] === "-" ? -1 : 1) * Number(term[2]) * value;
  }, 0);
  const native = {
    options: {
      set: vi.fn((nameOrValues: string | Readonly<Record<string, string | number | boolean>>, value?: string | number | boolean) => {
        const entries = typeof nameOrValues === "string" ? [[nameOrValues, value] as const] : Object.entries(nameOrValues);
        for (const [name, setting] of entries) {
          if (setting === undefined || (typeof setting === "number" && !Number.isFinite(setting))) {
            throw new Error(`Invalid mock option: ${name}`);
          }
          optionValues.set(name, setting);
        }
        return metadata();
      }),
      get: vi.fn((name: string) => {
        if (!optionValues.has(name)) throw new Error(`Unknown mock option: ${name}`);
        return optionValues.get(name)!;
      }),
      read: vi.fn((text: string) => {
        if (text !== "time_limit = inf\n") throw new Error("Unexpected mock option-file text");
        optionValues.set("time_limit", Infinity);
        return metadata();
      }),
    },
    readModel: vi.fn((input: { format: string; data: string }) => {
      if (input.format !== "lp" || optionValues.get("small_matrix_value") !== 1e-12) {
        throw new Error("Mock LP import requires small_matrix_value = 1e-12 first");
      }
      const importedNames = [...input.data.matchAll(/^\s*\S+ <= (\S+) <= \S+$/gm)].map((match) => match[1]!);
      const preferred = fixture.columnOrder ?? ["y", "x"];
      columnNames = [...preferred.filter((name) => importedNames.includes(name)),
        ...importedNames.filter((name) => !preferred.includes(name))];
      objective = input.data.split("Subject To")[0]!.replace(/^Maximize\s+obj:\s*/, "");
      const rowText = input.data.slice(input.data.indexOf("Subject To\n") + "Subject To\n".length,
        input.data.indexOf("Bounds\n"));
      rows = rowText.split(/\n(?=\s*\S+:)/).filter((row) => row.trim() !== "");
      return metadata();
    }),
    info: { get: vi.fn((name: string) => {
      if (name !== "primal_solution_status") throw new Error(`Unknown mock info: ${name}`);
      return status === modelStatus.optimal ? solutionStatus.feasible : solutionStatus.none;
    }) },
    getDimensions: () => ({ numCols: columnNames.length, numRows: rows.length,
      numNonzeros: rows.reduce((sum, row) => sum + terms(row).length, 0), hessianNonzeros: 0 }),
    getColByName: (name: string): number => columnNames.indexOf(name),
    getColName: (index: number): string => columnNames[index]!,
    setSolution: vi.fn((solution: { indices: number[]; values: number[] }) => {
      if (solution.indices.length !== solution.values.length || new Set(solution.indices).size !== solution.indices.length ||
          solution.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= columnNames.length) ||
          solution.values.some((value) => !Number.isFinite(value))) {
        throw new Error("Invalid mock sparse solution");
      }
      return metadata();
    }),
    run: vi.fn((callbacks: Callbacks) => { run(callbacks); return { ...metadata(), modelStatus: status }; }),
    getModelStatus: vi.fn(() => status),
    getSolution: () => ({
      colValue: Float64Array.from(columnNames, (name) => {
        const value = values.get(name);
        if (value === undefined) throw new Error(`Missing explicit fixture value: ${name}`);
        return value;
      }),
      rowValue: Float64Array.from(rows, activity),
      colDual: new Float64Array(columnNames.length),
      rowDual: new Float64Array(rows.length),
    }),
    getObjectiveValue: () => status === modelStatus.optimal ? activity(objective) : 0,
  };
  const withModel = vi.fn((use: (model: typeof native) => unknown) => {
    if (!fixture.retainOptions) resetOptions();
    columnNames = [];
    rows = [];
    return use(native);
  });
  return {
    native,
    withModel,
    constants: {
      callbackType,
      status: { error: -1, ok: 0, warning: 1 },
      modelStatus,
      solutionStatus,
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
  const columnNames = ["r0", "r1", ...(!accepted ? ["alias"] : []), "t54_x_0", "t54_y_0_0", "t54_y_0_1"];
  const values = new Map([["r0", 12], ["r1", 26], ["alias", 12], ["t54_x_0", 1], ["t54_y_0_0", 1], ["t54_y_0_1", 2]]);
  const native = runtime(modelStatus.optimal, undefined, { columnOrder: columnNames, values });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel({ ...model, onProgress: progress });
  expect(native.native.getDimensions().numCols).toBe(columnNames.length);
  expect(columnNames.map((_, index) => native.native.getColName(index))).toEqual(columnNames);
  expect(result.Columns).toMatchObject({ e0: { Primal: 0 }, e1: { Primal: 1 }, e2: { Primal: 0 }, e3: { Primal: 0 }, alias: { Primal: 12 } });
  expect(Object.keys(result.Columns).some((name) => name.startsWith("t54_"))).toBe(false);
  const lp = native.native.readModel.mock.calls[0]![0].data;
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
  expect(native.native.options.read).toHaveBeenCalledTimes(2);
  expect(native.native.options.read).toHaveBeenNthCalledWith(1, "time_limit = inf\n");
  expect(native.native.options.read).toHaveBeenNthCalledWith(2, "time_limit = inf\n");
});

test.each([
  [8, "Infeasible"],
  [9, "状态代码 9"],
])(
  "status %s never returns a fabricated incumbent",
  async (status, expected) => {
    loader.mockResolvedValue(runtime(Number(status), undefined, { values: new Map([["x", 0], ["y", 0]]) }));
    const { solveIntegerModel } = await import("./highs-solver.ts");
    const progress = vi.fn();
    const result = await solveIntegerModel(request({ onProgress: progress, rows: [
      { name: "positive", terms: new Map([["x", 1]]), sense: ">=", rhs: 1 },
      { name: "negative", terms: new Map([["x", 1]]), sense: "<=", rhs: 0 },
    ] }));
    expect(result.Status).toBe(expected);
    expect(result.Columns).toEqual({});
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: false, status: expected }),
    );
  },
);

test("LP serialization wraps both variable sections without losing names or signs", async () => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const native = runtime(9);
  // Account for a deterministic quarter-millisecond spent importing the LP.
  const importModel = native.native.readModel.getMockImplementation()!;
  native.native.readModel.mockImplementation((input) => { now += 0.25; return importModel(input); });
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
  const text = native.native.readModel.mock.calls[0]![0].data;
  expect(text.split("\n").every((line) => line.length <= 1000)).toBe(true);
  expect(text).toContain(`obj: - 1 ${variables[0]!.name}`);
  expect(text).toContain("Generals\n");
  expect(text).toContain("Binaries\n");
  for (const { name } of variables)
    expect(text.match(new RegExp(name, "g"))).toHaveLength(3);
  const runOptions = native.native.options.set.mock.calls.map(([options]) => options)
    .find((options) => typeof options === "object" && "time_limit" in options) as Record<string, number>;
  expect(runOptions).toMatchObject({ mip_rel_gap: 0, mip_abs_gap: 0 });
  expect(runOptions.time_limit).toBeGreaterThan(0);
  expect(runOptions.time_limit).toBeLessThanOrEqual((1 - 0.25) / 1000);
  expect(runOptions.time_limit).toBe(0.00075);
  expect(native.native.options.read).not.toHaveBeenCalled();
  expect(native.native.options.set).toHaveBeenCalledWith("small_matrix_value", 1e-12);
  expect(native.native.options.set.mock.invocationCallOrder[0]).toBeLessThan(
    native.native.readModel.mock.invocationCallOrder[0]!,
  );
});

test.each([0, -1])(
  "hints are sorted, attempted once, and repaired only after native acceptance (%s)",
  async (hintStatus) => {
    const emitted = event({}, hintStatus);
    const native = runtime(modelStatus.optimal, (callbacks) => {
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

test.each(["raw", "wrapper"])("a known initial hint rejection (%s) still solves the model", async mode => {
  const native = runtime();
  if (mode === "raw") native.native.setSolution.mockReturnValue({ status: -1, warnings: [] });
  else native.native.setSolution.mockImplementation(() => {
    throw Object.assign(new Error("native rejected hint"), { status: -1, operation: "setSparseSolution" });
  });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel(request({ solutionHint: new Map([["x", 2], ["y", 3]]) }));
  expect(native.native.setSolution).toHaveBeenCalledTimes(1);
  expect(native.native.run).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ Status: "Optimal", Columns: { x: { Primal: 2 }, y: { Primal: 3 } } });
});

test("an unknown initial hint status still fails before the native run", async () => {
  const native = runtime();
  native.native.setSolution.mockReturnValue({ status: 99, warnings: [] });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request({ solutionHint: new Map([["x", 2]]) }))).rejects.toThrow("setSolution");
  expect(native.native.run).not.toHaveBeenCalled();
});

const bitRequest = (patch: Partial<LinearMipRequest> = {}) => request({
  objective: new Map([["x", 1]]), variables: [{ name: "x", min: 0, max: 1 }],
  integerVariables: [], binaryVariables: ["x"], equalityQuotient: false,
  rows: [{ name: "required", terms: new Map([["x", 1]]), sense: ">=", rhs: 1 }], ...patch,
});

test.each([solutionStatus.none, solutionStatus.infeasible])("Infeasible rejects an exact native point at x=1 despite primal status %s", async (primalStatus) => {
  const native = runtime(modelStatus.infeasible, undefined, { values: new Map([["x", 1]]) });
  native.native.info.get.mockReturnValue(primalStatus);
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(bitRequest())).rejects.toThrow("可行列值矛盾");
  expect(native.native.run).toHaveBeenCalledTimes(1);
});

test("Infeasible rejects a feasible primal status even when its buffer cannot supply a witness", async () => {
  const native = runtime(modelStatus.infeasible, undefined, { values: new Map([["x", 0]]) });
  native.native.info.get.mockReturnValue(solutionStatus.feasible);
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(bitRequest())).rejects.toThrow("可行原生 primal 矛盾");
});

test.each([{ values: [0] }, { values: [] }, { values: [NaN] }, { values: [Infinity] }, { values: [0.5] }, { values: [2] }])("a truly infeasible integer model accepts an unusable native buffer $values without inventing a witness", async ({ values }) => {
  const native = runtime(modelStatus.infeasible, undefined, { values: new Map([["x", 0]]) });
  vi.spyOn(native.native, "getSolution").mockReturnValue({ colValue: Float64Array.from(values),
    rowValue: new Float64Array(), colDual: new Float64Array(), rowDual: new Float64Array() });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const model = bitRequest();
  model.rows = [...model.rows, { name: "forbidden", terms: new Map([["x", 1]]), sense: "<=", rhs: 0 }];
  expect(await solveIntegerModel(model)).toMatchObject({ Status: "Infeasible", Columns: {} });
});

test("a native feasibility witness is checked after equality reduction", async () => {
  const native = runtime(modelStatus.infeasible, undefined, { values: new Map([["x", 1], ["y", 1]]) });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request({ rows: [
    { name: "equal", terms: new Map([["x", 1], ["y", -1]]), sense: "=", rhs: 0 },
    { name: "positive", terms: new Map([["x", 1]]), sense: ">=", rhs: 1 },
  ] }))).rejects.toThrow("可行列值矛盾");
  expect(native.native.getDimensions().numCols).toBe(1);
});

test("an explicitly complete original hint refutes Infeasible even when the native buffer is zero", async () => {
  const native = runtime(modelStatus.infeasible, undefined, { values: new Map([["x", 0], ["y", 0]]) });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const model = request({ solutionHint: new Map([["x", 1], ["y", 1]]), rows: [
    { name: "equal", terms: new Map([["x", 1], ["y", -1]]), sense: "=", rhs: 0 },
    { name: "positive", terms: new Map([["x", 1]]), sense: ">=", rhs: 1 },
  ] });
  await expect(solveIntegerModel(model)).rejects.toThrow("可行提示矛盾");
  expect(await solveIntegerModel({ ...model, solutionHint: new Map([["x", 1]]) })).toMatchObject({ Status: "Infeasible", Columns: {} });
});

test("one-shot cancellation during Infeasible buffer inspection propagates before any witness decision", async () => {
  let pendingCancellation = false;
  const native = runtime(modelStatus.infeasible, undefined, { values: new Map([["x", 1]]) });
  const getSolution = native.native.getSolution;
  vi.spyOn(native.native, "getSolution").mockImplementation(() => {
    pendingCancellation = true;
    return getSolution();
  });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(bitRequest({ isCancelled: () => {
    const cancelled = pendingCancellation;
    pendingCancellation = false;
    return cancelled;
  } }))).rejects.toMatchObject({ name: "AbortError", message: "搜索已取消" });
});

test("only finite dual bounds trigger the proof check, and a proven stop is distinguished from optimal status", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const emitted = event({ mip_dual_bound: Infinity });
  const check = vi.fn((bound: number) => bound <= 7);
  loader.mockResolvedValue(
    runtime(modelStatus.interrupted, (callbacks) => {
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

test.each([4, 9, 13, 99])("a proof-triggered interrupt cannot override native termination %i", async status => {
  const emitted = event({ mip_dual_bound: 7 });
  loader.mockResolvedValue(runtime(status, callbacks => callbacks[callbackType.mipInterrupt!]!(emitted)));
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel(request({ stopWhenDualBoundProvesOptimal: () => true }));
  expect(emitted.interrupt).toHaveBeenCalledOnce();
  expect(result.Status).toBe(`状态代码 ${status}`);
  expect(result.Columns).toEqual({});
});

test("the run result and persistent model must report the same termination", async () => {
  const native = runtime();
  native.native.getModelStatus.mockReturnValue(modelStatus.infeasible);
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request())).rejects.toThrow("终止状态不一致");
});

test("callback telemetry normalizes large counts and omits malformed numeric fields", async () => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "0");
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const events: LinearMipProgress[] = [];
  const trace = vi.fn();
  const values: unknown[] = [3n, -1n, 4, -1, 1.2, "0005n", "-2", undefined];
  loader.mockResolvedValue(
    runtime(modelStatus.optimal, (callbacks) => {
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
  expect(native.native.readModel.mock.calls[0]![0].data).toContain("obj: 3 x");
  expect(native.native.readModel.mock.calls[0]![0].data).not.toMatch(/\by\b/);
  expect(native.native.setSolution).toHaveBeenCalledWith({ indices: [0], values: [2] });
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
  const native = runtime(modelStatus.optimal, undefined, { values: new Map([["x", 2], ["y", 2]]) });
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
  const lp = native.native.readModel.mock.calls[0]![0].data;
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
  loader.mockResolvedValue(runtime(modelStatus.interrupted, (callbacks) => {
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
function densityRuntime(status = modelStatus.optimal, run: (callbacks: Callbacks) => void = () => {}) {
  const names = densityRequest(0).variables.map(({ name }) => name);
  return runtime(status, run, { columnOrder: names,
    values: new Map(names.map((name) => [name, name === "z0" ? 1 : 2])) });
}

test.each(["auto", "on", "off"] as const)("T57 unified %s overrides performance routing without removing original solution validation", async (mode) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const native = densityRuntime();
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel({ ...densityRequest(7), strategies: { equalityQuotient: mode, feasibleSeeds: "off" }, onProgress: progress });
  expect(native.native.getDimensions().numCols).toBe(mode === "on" ? 9 : 10);
  expect(result.Columns.x).toEqual({ Primal: 2 });
  expect(result.Columns.y).toEqual({ Primal: 2 });
  const lp = native.native.readModel.mock.calls[0]![0].data;
  expect(/\by\b/.test(lp)).toBe(mode !== "on");
  expect(native.native.setSolution).not.toHaveBeenCalled();
  const line = progress.mock.calls.map(([value]) => value as LinearMipProgress).find((value) => value.message?.includes('"phase":"highs-call-start"'))!.message!;
  expect(JSON.parse(line.slice(8)).equalityQuotientDecision).toBe(mode === "on" ? "accepted" : mode === "off" ? "disabled" : "density-rejected");
});

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
    const lp = native.native.readModel.mock.calls[0]![0].data;
    if (accepted) {
      expect(lp).not.toMatch(/\by\b/);
      expect(lp).toContain(`obj: ${3 / 65536} x`);
    } else {
      await solveIntegerModel({ ...model, equalityQuotient: false });
      expect(lp).toBe(native.native.readModel.mock.calls[1]![0].data);
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
  expect(native.native.readModel.mock.calls[0]![0].data).toBe(native.native.readModel.mock.calls[1]![0].data);
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
  expect(native.native.readModel.mock.calls[0]![0].data).toBe(native.native.readModel.mock.calls[1]![0].data);
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
  expect(native.native.readModel.mock.calls[0]![0].data).toBe(native.native.readModel.mock.calls[1]![0].data);
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
  let densityStarted = false;
  const model = { ...densityRequest(6), equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 },
    isCancelled: () => stage === "after-candidate" ? prepared : densityStarted };
  // Trigger at the actual density traversal, independently of additional
  // cancellation/deadline checkpoints introduced before preparation.
  const terms = model.rows[0]!.terms;
  const rowValues = terms.values.bind(terms);
  vi.spyOn(terms, "values").mockImplementation(() => { densityStarted = true; return rowValues(); });
  await expect(solveIntegerModel(model)).rejects.toMatchObject({ name: "AbortError" });
  expect(prepared).toBe(true);
  if (stage === "during-density") expect(densityStarted).toBe(true);
  expect(loader).not.toHaveBeenCalled();
});

test.each([[5, 0], [5, 25], [7, 25]])("non-Optimal decision with %i equalities and p=%i preserves callback scale and no columns", async (count, minVariableReductionPercent) => {
  const emitted = event({ mip_dual_bound: 7 / 65536 });
  const check = vi.fn(() => true);
  loader.mockResolvedValue(densityRuntime(modelStatus.interrupted, (callbacks) => callbacks[callbackType.mipInterrupt!]!(emitted)));
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel({ ...densityRequest(count), equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent },
    stopWhenDualBoundProvesOptimal: check });
  expect(result.Status).toBe("DualBound"); expect(result.Columns).toEqual({});
  expect(check).toHaveBeenCalledWith(7 / 65536);
});

test.each([0, 100])("zero remaining nonzero rows still require p=%i variable reduction", async (minVariableReductionPercent) => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const native = runtime(modelStatus.optimal, undefined, { values: new Map([["x", 2], ["y", 2]]) });
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
  expect(native.native.readModel.mock.calls[0]![0].data).toBe(native.native.readModel.mock.calls[1]![0].data);
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
  const lp = native.native.readModel.mock.calls[0]![0].data;
  if (accepted) expect(lp).not.toMatch(/\by\b/);
  else {
    await solveIntegerModel({ ...model, equalityQuotient: false });
    expect(lp).toBe(native.native.readModel.mock.calls[1]![0].data);
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
  expect(native.native.readModel.mock.calls[0]![0].data).toBe(native.native.readModel.mock.calls[1]![0].data);
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
  expect(native.native.readModel.mock.calls[0]![0].data).toBe(native.native.readModel.mock.calls[1]![0].data);
  expect(expand).not.toHaveBeenCalled();
  const profile = JSON.parse(progress.mock.calls.map(([event]) => event as LinearMipProgress)
    .find(({ message }) => message?.includes('"phase":"highs-call-start"'))!.message!.slice(8));
  expect(profile).toMatchObject({ equalityQuotientDecision: "unmeasurable", equalityVariablesRemoved: 0 });
  expect(profile).not.toHaveProperty("equalityCandidateBaseVariables");
});

test.each(["signature", "feasibility"] as const)("%s visits return validated points without objective completion", async (kind) => {
  const native = runtime();
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const { hasMipPoint } = await import("../linear-mip.ts");
  const progress = vi.fn();
  const result = await solveIntegerModel(request({ jointObjective: { kind }, onProgress: progress,
    ...(kind === "feasibility" ? { objective: new Map([["x", 0], ["y", -0]]) } : {}) }));
  expect(result.Status).toBe("FeasibleSignature");
  expect(hasMipPoint(result)).toBe(true);
  expect(result.Columns).toEqual({ y: { Primal: 3 }, x: { Primal: 2 } });
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: "FeasibleSignature", completed: false }));
  expect(native.native.options.get("mip_abs_gap")).toBe(kind === "signature" ? 1024 : 0);
  expect(native.native.options.get("mip_rel_gap")).toBe(0);
});

test("consecutive signature, feasibility, ratio and legacy requests reset native proof options", async () => {
  const native = runtime(modelStatus.optimal, undefined, { retainOptions: true });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const purposes: LinearMipRequest["jointObjective"][] = [{ kind: "signature" }, { kind: "feasibility" },
    { kind: "signature" }, { kind: "ratio-bound", variables: ["x", "y"], scale: 3 }, { kind: "signature" }, undefined];
  const gaps: number[] = [];
  for (const purpose of purposes) {
    const result = await solveIntegerModel(request({ jointObjective: purpose,
      objective: purpose?.kind === "feasibility" ? new Map() : new Map([["x", 1], ["y", 1]]),
      ...(gaps.length === 0 ? { timeLimitMs: 100_000 } : {}) }));
    expect(result.Status).toBe(purpose?.kind === "signature" || purpose?.kind === "feasibility" ? "FeasibleSignature" : "Optimal");
    gaps.push(native.native.options.get("mip_abs_gap") as number);
    expect(native.native.options.get("mip_rel_gap")).toBe(0);
    expect(native.native.options.get("mip_max_improving_sols")).toBe(2_147_483_647);
    expect(native.native.options.get("small_matrix_value")).toBe(1e-12);
    if (gaps.length > 1) expect(native.native.options.get("time_limit")).toBe(Infinity);
  }
  expect(gaps).toEqual([1024, 0, 1024, 0, 1024, 0]);
});

test.each(["signature", "feasibility"] as const)("%s visits reject ratio dual callbacks before native loading", async (kind) => {
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request({ jointObjective: { kind }, objective: new Map(),
    stopWhenDualBoundProvesOptimal: () => true }))).rejects.toThrow("比例对偶界");
  expect(loader).not.toHaveBeenCalled();
});

test("feasibility visits reject a nonzero objective before native loading", async () => {
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request({ jointObjective: { kind: "feasibility" } }))).rejects.toThrow("零目标");
  expect(loader).not.toHaveBeenCalled();
});

test.each(["signature", "feasibility"] as const)("%s visits cannot promote non-Optimal native states", async (kind) => {
  const native = runtime(9);
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const { hasMipPoint } = await import("../linear-mip.ts");
  const result = await solveIntegerModel(request({ jointObjective: { kind }, objective: new Map() }));
  expect(result.Status).toBe("状态代码 9");
  expect(result.Columns).toEqual({});
  expect(hasMipPoint(result)).toBe(false);
});

test.each(["signature", "feasibility"] as const)("%s native points still require feasible primal and every original integer row", async (kind) => {
  const native = runtime();
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  native.native.info.get.mockReturnValueOnce(solutionStatus.none);
  await expect(solveIntegerModel(request({ jointObjective: { kind }, objective: new Map() }))).rejects.toThrow("可行原生 primal");
  await expect(solveIntegerModel(request({ jointObjective: { kind }, objective: new Map(),
    rows: [{ name: "violated_original", terms: new Map([["x", 1], ["y", 1]]), sense: "<=", rhs: 4 }] }))).rejects.toThrow("violated_original");
  vi.spyOn(native.native, "getSolution").mockReturnValueOnce({ colValue: Float64Array.from([3]), rowValue: new Float64Array(),
    colDual: new Float64Array(), rowDual: new Float64Array() });
  await expect(solveIntegerModel(request({ jointObjective: { kind }, objective: new Map() }))).rejects.toThrow("不完整");
});

test.each(["signature", "feasibility"] as const)("%s points expand T57 aliases without claiming an optimum", async (kind) => {
  loader.mockResolvedValue(runtime());
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel(request({ jointObjective: { kind }, objective: new Map(),
    rows: [{ name: "same", terms: new Map([["x", 1], ["y", -1]]), sense: "=", rhs: 0 }] }));
  expect(result).toMatchObject({ Status: "FeasibleSignature", Columns: { x: { Primal: 2 }, y: { Primal: 2 } } });
});

test.each([
  { variables: ["x", "y"], objective: [["x", 2], ["y", 1]], scale: 3 },
  { variables: ["x", "y"], objective: [["x", 1]], scale: 3 },
  { variables: ["x"], objective: [["x", 1], ["y", 1]], scale: 3 },
  { variables: ["missing"], objective: [["missing", 1]], scale: 3 },
  { variables: ["x", "x"], objective: [["x", 1]], scale: 3 },
  { variables: [], objective: [], scale: 3 },
  { variables: ["x"], objective: [["x", 1]], scale: 0 },
  { variables: ["x"], objective: [["x", 1]], scale: Infinity },
])("ratio purpose rejects inconsistent original +1 declarations: %j", async ({ variables, objective, scale }) => {
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request({ jointObjective: { kind: "ratio-bound", variables, scale },
    objective: new Map(objective as [string, number][]) }))).rejects.toThrow("HiGHS 联合比例目标");
  expect(loader).not.toHaveBeenCalled();
});

test("ratio preparation uses real T57 aliases once and declines an uncentered representation", async () => {
  const deficit = await import("./ratio-deficit.ts");
  const prepare = vi.spyOn(deficit, "prepareRatioDeficitRepresentation");
  const native = runtime();
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel(request({ jointObjective: { kind: "ratio-bound", variables: ["x", "y"], scale: 3 },
    objective: new Map([["x", 1], ["y", 1]]),
    rows: [{ name: "same", terms: new Map([["x", 1], ["y", -1]]), sense: "=", rhs: 0 }] }));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls[0]![1]).toEqual({ variables: ["x"], scale: 3 });
  expect(prepare.mock.results[0]!.value).toMatchObject({ centeredRows: 0 });
  expect(native.native.readModel.mock.calls[0]![0].data).toContain("obj: 2 x");
  expect(native.native.readModel.mock.calls[0]![0].data).not.toContain("__ratio_deficit");
  expect(result).toMatchObject({ Status: "Optimal", ObjectiveValue: 4, Columns: { x: { Primal: 2 }, y: { Primal: 2 } } });
});

async function fourLayerFixture() {
  const scale = 2 ** 40;
  const members = ["e0", "e1", "e2", "e3"];
  const counts = [[0, 3], [1, 2], [2, 1], [3, 0]];
  const oneHotRow = { name: "slot", sense: "=" as const, rhs: 1, terms: new Map(members.map((name) => [name, 1])) };
  const rawRows = [0, 1].map((axis) => ({ name: `raw_${axis}`, sense: "=" as const, rhs: 0,
    terms: new Map([[`r${axis}`, 1] as [string, number], ...members.map((name, member): [string, number] =>
      [name, -(axis === 0 ? 10 : 20) - counts[member]![axis]! * (axis === 0 ? 2 : 3)])]) }));
  const originalPoint = new Map([["e0", 0], ["e1", 1], ["e2", 0], ["e3", 0], ["r0", 12], ["r1", 26],
    ["q", scale - 1], ["alias", scale - 1], ["u", 1], ["v", 1], ["w", 0]]);
  const model: LinearMipRequest = { name: "four-layer-certificate", objective: new Map([["q", 1], ["alias", 1], ["u", -0]]),
    jointObjective: { kind: "ratio-bound", variables: ["q", "alias"], scale },
    variables: [...members.map((name) => ({ name, min: 0, max: 1 })), ...["r0", "r1", "q", "alias"].map((name) => ({ name, min: 0, max: scale })),
      { name: "u", min: 1, max: 1 }, { name: "v", min: 1, max: 1 }, { name: "w", min: 0, max: 0 }],
    binaryVariables: members, integerVariables: ["r0", "r1", "q", "alias", "u", "v", "w"], solutionHint: originalPoint,
    rows: [oneHotRow, ...rawRows,
      { name: "ratio_alias", terms: new Map([["q", 1], ["alias", -1]]), sense: "=", rhs: 0 },
      { name: "ratio_cap", terms: new Map([["q", 1] as [string, number], ...members.map((name): [string, number] => [name, -(scale - 1)])]), sense: "<=", rhs: 0 },
      { name: "large_integer_row", terms: new Map([["u", scale], ["v", -scale], ["w", 1]]), sense: "=", rhs: 0 }],
    materiaFamilies: [{ grade: 12, coordinates: [0, 1], units: [2, 3], fixedAttributes: [10, 20], remaining: 3,
      capacities: [3, 3], counts, members, slotVariables: members, oneHotRow, rawRows }] };
  const materiaModule = await import("./materia-family-projection.ts");
  const equalityModule = await import("./equality-quotient.ts");
  const deficitModule = await import("./ratio-deficit.ts");
  const radixModule = await import("./radix-representation.ts");
  const materia = materiaModule.prepareMateriaFamilyProjection(model)!;
  const equality = equalityModule.prepareEqualityQuotient(materia.request)!;
  const deficit = deficitModule.prepareRatioDeficitRepresentation(equality.request, { variables: ["q"], scale })!;
  expect(deficit.centeredRows).toBeGreaterThan(0);
  const radix = radixModule.prepareRadixRepresentation(deficit.request)!;
  expect(radix).toBeDefined();
  expect(radix.request.variables.every(({ name }) => radix.request.solutionHint!.has(name))).toBe(true);
  return { model, scale, originalPoint, materiaModule, equalityModule, deficitModule, radixModule, values: radix.request.solutionHint! };
}

test("T54, T57, deficit and radix restore original columns, objective, hint and dual units", async () => {
  vi.stubEnv("FFXIV_PROFILE_TIMING", "1");
  const { model, scale, originalPoint, values } = await fourLayerFixture();
  const before = structuredClone({ rows: model.rows, variables: model.variables, objective: model.objective, hint: model.solutionHint });
  const stop = vi.fn(() => false);
  const progress = vi.fn();
  const trace = vi.fn();
  const emitted = event({ mip_dual_bound: -2.25 });
  const native = runtime(modelStatus.optimal, (callbacks) => {
    callbacks[callbackType.mipInterrupt!]!(emitted);
    callbacks[callbackType.mipLogging!]!(event({ mip_primal_bound: -2, mip_dual_bound: -1.25, mip_gap: 0.2 }));
  }, { values });
  loader.mockResolvedValue(native);
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel({ ...model, stopWhenDualBoundProvesOptimal: stop, onProgress: progress, onCallback: trace });
  expect(result.Status).toBe("Optimal");
  expect(result.ObjectiveValue).toBe(2 * (scale - 1));
  expect(result.Columns).toEqual(Object.fromEntries([...originalPoint].map(([name, Primal]) => [name, { Primal }])));
  expect(stop).toHaveBeenCalledWith(2 * scale - 2);
  expect(trace).toHaveBeenCalledWith(expect.objectContaining({ callbackName: "mipInterrupt",
    event: expect.objectContaining({ data: { mip_dual_bound: -2.25 } }) }));
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ kind: "bound", objectiveValue: 2 * scale - 2, bestBound: 2 * scale - 1 }));
  const translated = progress.mock.calls.map(([value]) => value as LinearMipProgress).find((value) => value.objectiveValue !== undefined)!;
  expect(translated).not.toHaveProperty("gap");
  const profile = progress.mock.calls.map(([value]) => value as LinearMipProgress)
    .find((value) => value.message?.includes('"phase":"highs-call-start"'))!;
  expect(JSON.parse(profile.message!.slice(8))).toMatchObject({ jointObjective: "ratio-bound", ratioDeficit: 1, radix: 1 });
  const lp = native.native.readModel.mock.calls[0]![0].data;
  expect(lp).toContain("__ratio_deficit_");
  expect(lp).toContain("__radix_");
  expect(lp).not.toMatch(/\be[0-3]\b|\balias\b/);
  expect(native.native.setSolution).toHaveBeenCalledWith({ indices: Array.from({ length: values.size }, (_, index) => index),
    values: Array.from({ length: values.size }, (_, index) => values.get(native.native.getColName(index))!) });
  expect({ rows: model.rows, variables: model.variables, objective: model.objective, hint: model.solutionHint }).toEqual(before);
});

test.each(["radix", "deficit", "equality", "materia"] as const)("a missing column after %s certificate restoration fails closed", async (stage) => {
  const fixture = await fourLayerFixture();
  const removeColumn = <T extends { expandSolution: (solution: import("../linear-mip.ts").LinearMipSolution) => import("../linear-mip.ts").LinearMipSolution }>(certificate: T, name: string): T => ({
    ...certificate, expandSolution: (solution) => {
      const restored = certificate.expandSolution(solution);
      delete restored.Columns[name];
      return restored;
    },
  });
  if (stage === "radix") {
    const prepare = fixture.radixModule.prepareRadixRepresentation;
    vi.spyOn(fixture.radixModule, "prepareRadixRepresentation").mockImplementation((model) => removeColumn(prepare(model)!, "__ratio_deficit_0"));
  } else if (stage === "deficit") {
    const prepare = fixture.deficitModule.prepareRatioDeficitRepresentation;
    vi.spyOn(fixture.deficitModule, "prepareRatioDeficitRepresentation").mockImplementation((model, metadata) => removeColumn(prepare(model, metadata)!, "q"));
  } else if (stage === "equality") {
    const prepare = fixture.equalityModule.prepareEqualityQuotient;
    vi.spyOn(fixture.equalityModule, "prepareEqualityQuotient").mockImplementation((model) => removeColumn(prepare(model)!, "alias"));
  } else {
    const prepare = fixture.materiaModule.prepareMateriaFamilyProjection;
    vi.spyOn(fixture.materiaModule, "prepareMateriaFamilyProjection").mockImplementation((model) => removeColumn(prepare(model)!, "e0"));
  }
  loader.mockResolvedValue(runtime(modelStatus.optimal, undefined, { values: fixture.values }));
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(fixture.model)).rejects.toThrow("显式有限列");
});

test.each(["signature", "feasibility"] as const)("%s points restore T54 and T57 while skipping ratio representations", async (kind) => {
  const fixture = await fourLayerFixture();
  const deficit = vi.spyOn(fixture.deficitModule, "prepareRatioDeficitRepresentation").mockImplementation(() => { throw new Error("visit cannot prepare ratios"); });
  const radix = vi.spyOn(fixture.radixModule, "prepareRadixRepresentation").mockImplementation(() => { throw new Error("visit cannot prepare radix"); });
  const values = new Map([...fixture.originalPoint, ["t54_x_0", 1], ["t54_y_0_0", 1], ["t54_y_0_1", 2]]);
  loader.mockResolvedValue(runtime(modelStatus.optimal, undefined, { values }));
  const { solveIntegerModel } = await import("./highs-solver.ts");
  const result = await solveIntegerModel({ ...fixture.model, jointObjective: { kind },
    ...(kind === "feasibility" ? { objective: new Map() } : {}) });
  expect(result.Status).toBe("FeasibleSignature");
  expect(result.Columns).toEqual(Object.fromEntries([...fixture.originalPoint].map(([name, Primal]) => [name, { Primal }])));
  expect(deficit).not.toHaveBeenCalled();
  expect(radix).not.toHaveBeenCalled();
});

test.each(["cancel", "deadline"] as const)("ratio representation preparation obeys the original %s", async (stop) => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  let cancelled = false;
  const deficitModule = await import("./ratio-deficit.ts");
  const prepare = deficitModule.prepareRatioDeficitRepresentation;
  vi.spyOn(deficitModule, "prepareRatioDeficitRepresentation").mockImplementation((model, metadata) => {
    const candidate = prepare(model, metadata);
    cancelled = true;
    now = 2000;
    return candidate;
  });
  const { solveIntegerModel } = await import("./highs-solver.ts");
  await expect(solveIntegerModel(request({ jointObjective: { kind: "ratio-bound", variables: ["x", "y"], scale: 3 },
    objective: new Map([["x", 1], ["y", 1]]), isCancelled: () => stop === "cancel" && cancelled,
    ...(stop === "deadline" ? { timeLimitMs: 1000 } : {}) }))).rejects.toThrow(stop === "cancel" ? "搜索已取消" : "时间预算");
  expect(loader).not.toHaveBeenCalled();
});
