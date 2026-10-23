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
    getColByName: (name: string) => (name === "x" ? 1 : 0),
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
      elapsedMs: 500,
      objectiveValue: 6,
      bestBound: 8,
      gap: 0.25,
    }),
  );
});
