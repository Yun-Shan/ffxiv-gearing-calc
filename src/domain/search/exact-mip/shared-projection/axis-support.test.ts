import { describe, expect, it } from "vitest";
import {
  backtrackAxis,
  projectAxis,
  type AxisState,
  type AxisTerminalCell,
  type SupportAxis,
} from "./axis-support.ts";
import { ProjectionLimit, type ProjectionSlot } from "./types.ts";

const INDEX: Record<SupportAxis, number> = { det: 2, ten: 3, crt: 4, dht: 5 };
const slots: readonly ProjectionSlot[] = [
  {
    name: "first",
    choices: [
      { key: "first-b", values: [0, 1, 0, 1, 2, 0, 1] },
      { key: "first-a", values: [0, 1, 2, 0, 0, 1, 0] },
      { key: "first-copy", values: [0, 1, 0, 1, 2, 0, 1] },
      { key: "first-c", values: [0, 2, 1, 0, 1, 1, 1] },
    ],
  },
  {
    name: "second",
    choices: [
      { key: "second-a", values: [0, 1, 1, 2, 0, 0, 1] },
      { key: "second-b", values: [0, 1, 0, 0, 2, 1, 0] },
    ],
  },
  {
    name: "third",
    choices: [
      { key: "third-a", values: [0, 0, 1, 0, 0, 1, 0] },
      { key: "third-b", values: [0, 0, 0, 1, 1, 0, 1] },
    ],
  },
];
const cells: readonly AxisTerminalCell[] = [
  { speed: 1, main: 2, minZ: 7 },
  { speed: 2, main: 2, minZ: 8 },
  { speed: 3, main: 2, minZ: 8 },
  { speed: 2, main: 3, minZ: 8 },
  { speed: 3, main: 3, minZ: null },
];
function z(values: readonly number[]): number {
  return values[2] + values[3] + values[4] + values[5];
}
function enumerate(
  input: readonly ProjectionSlot[],
  terminals: readonly AxisTerminalCell[],
): number[][] {
  let totals = [Array<number>(7).fill(0)];
  for (const slot of input)
    totals = totals.flatMap((total) =>
      slot.choices.map((choice) =>
        total.map((value, a) => value + choice.values[a]),
      ),
    );
  return totals.filter((total) =>
    terminals.some(
      (cell) =>
        cell.minZ !== null &&
        cell.speed === total[6] &&
        cell.main === total[1] &&
        z(total) >= cell.minZ,
    ),
  );
}
function stateId(
  state: Pick<AxisState, "speed" | "main" | "z" | "basis">,
): string {
  return `${state.speed},${state.main},${state.z}|${state.basis.join(",")}`;
}
function expected(
  totals: readonly (readonly number[])[],
  axis: SupportAxis,
  basis: readonly SupportAxis[] = [],
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const values of totals) {
    const key = stateId({
      speed: values[6],
      main: values[1],
      z: z(values),
      basis: basis.map((name) => values[INDEX[name]]),
    });
    result.set(
      key,
      (result.get(key) ?? 0n) | (1n << BigInt(values[INDEX[axis]])),
    );
  }
  return result;
}
function actual(states: Iterable<AxisState>): Map<string, bigint> {
  return new Map([...states].map((state) => [stateId(state), state.bits]));
}

describe("raw shared-axis support", () => {
  it("matches complete physical enumeration for every axis and zero, one, or two exact basis coordinates", () => {
    const totals = enumerate(slots, cells);
    for (const axis of ["crt", "det", "dht", "ten"] as const) {
      const rest = (["crt", "det", "dht", "ten"] as const).filter(
        (name) => name !== axis,
      );
      for (const basis of [[], rest.slice(0, 1), rest.slice(0, 2)]) {
        const projection = projectAxis(slots, cells, { axis, basis });
        expect(actual(projection.states)).toEqual(
          expected(totals, axis, basis),
        );
        expect(projection.graph.order).toEqual(["second", "third", "first"]);
      }
    }
  });

  it("backtracks every extendable prefix, then retains two previously selected coordinates", () => {
    const crt = projectAxis(slots, cells, { axis: "crt" });
    const crtFilter = crt.states.map((state) => ({
      ...state,
      bits: state.bits & 0b101010101010101n,
    }));
    const crtAllowed = backtrackAxis(crt.graph, crtFilter);
    const crtTotals = enumerate(slots, cells).filter(
      (values) => values[4] % 2 === 0,
    );
    expect(actual(crtAllowed.layers.at(-1)!.values())).toEqual(
      expected(crtTotals, "crt"),
    );
    // Compare every reverse layer to prefixes of actual complete retained physical paths.
    for (let depth = 0; depth <= crt.graph.order.length; depth++) {
      const ordered = crt.graph.order.map((name) =>
        slots.find((slot) => slot.name === name)!,
      );
      let paths: { total: number[]; prefix: number[] }[] = [
        { total: Array<number>(7).fill(0), prefix: Array<number>(7).fill(0) },
      ];
      for (let i = 0; i < ordered.length; i++)
        paths = paths.flatMap((path) =>
          ordered[i].choices.map((choice) => ({
            total: path.total.map((value, a) => value + choice.values[a]),
            prefix:
              i < depth
                ? path.prefix.map((value, a) => value + choice.values[a])
                : path.prefix,
          })),
        );
      const prefixes = paths
        .filter((path) =>
          crtTotals.some((total) =>
            total.every((value, a) => value === path.total[a]),
          ),
        )
        .map((path) => path.prefix);
      expect(actual(crtAllowed.layers[depth].values())).toEqual(
        expected(prefixes, "crt"),
      );
    }
    const det = projectAxis(slots, cells, {
      axis: "det",
      basis: ["crt"],
      allowed: crtAllowed,
    });
    expect(actual(det.states)).toEqual(expected(crtTotals, "det", ["crt"]));
    const detFilter = det.states.map((state) => ({
      ...state,
      bits: state.bits & ~3n,
    }));
    const detAllowed = backtrackAxis(det.graph, detFilter);
    const finalTotals = crtTotals.filter((values) => values[2] >= 2);
    // Basis order can change between projections; values must follow the new labels.
    const ten = projectAxis(slots, cells, {
      axis: "ten",
      basis: ["det", "crt"],
      allowed: detAllowed,
    });
    expect(actual(ten.states)).toEqual(
      expected(finalTotals, "ten", ["det", "crt"]),
    );
  });

  it("supports independent repeated terminal filters without mutating its source graph or physical inputs", () => {
    const snapshot = JSON.stringify(slots);
    const projection = projectAxis(slots, cells);
    const before = projection.graph.layers.map((layer) =>
      actual(layer.values()),
    );
    const empty = backtrackAxis(projection.graph, []);
    expect(empty.layers.every((layer) => layer.size === 0)).toBe(true);
    const full = backtrackAxis(projection.graph, projection.states);
    expect(actual(full.layers.at(-1)!.values())).toEqual(
      actual(projection.states),
    );
    expect(
      projection.graph.layers.map((layer) => actual(layer.values())),
    ).toEqual(before);
    expect(JSON.stringify(slots)).toBe(snapshot);
    expect(
      projection.graph.bindings.find((binding) => binding.name === "first")!
        .signature,
    ).toBe(
      JSON.stringify(
        slots[0].choices.map((choice) => [choice.key, choice.values]),
      ),
    );
  });

  it("uses the minimum enabled threshold for duplicate cells and handles empty products", () => {
    expect(
      projectAxis(
        [],
        [
          { speed: 0, main: 0, minZ: null },
          { speed: 0, main: 0, minZ: 1 },
          { speed: 0, main: 0, minZ: 0 },
        ],
      ).states,
    ).toMatchObject([{ speed: 0, main: 0, z: 0, basis: [], bits: 1n }]);
    expect(projectAxis([], []).states).toEqual([]);
    expect(
      projectAxis(
        [{ name: "empty", choices: [] }],
        [{ speed: 0, main: 0, minZ: 0 }],
      ).states,
    ).toEqual([]);
  });

  it("rejects physical drift, unbound basis axes, and fabricated terminal bits", () => {
    const original = projectAxis(slots, cells);
    const allowed = backtrackAxis(original.graph, original.states);
    const drift = slots.map((slot) => ({
      ...slot,
      choices: slot.choices.map((choice) => ({
        ...choice,
        values: [...choice.values],
      })),
    }));
    drift[0].choices[0].values[0] = 1;
    expect(() =>
      projectAxis(drift, cells, { axis: "det", basis: ["crt"], allowed }),
    ).toThrow(/source\/order drift/);
    expect(() =>
      projectAxis(slots, cells, { axis: "det", basis: ["ten"], allowed }),
    ).toThrow(/allowed axes/);
    expect(() =>
      backtrackAxis(original.graph, [
        { ...original.states[0], bits: 1n << 100n },
      ]),
    ).toThrow(/outside real/);
    expect(() =>
      projectAxis(slots, cells, { axis: "crt", basis: ["crt"] }),
    ).toThrow(/distinct axis/);
  });

  it("validates all seven upstream values and safe aggregate sums", () => {
    const invalid: ProjectionSlot[] = [
      {
        name: "bad",
        choices: [{ key: "bad", values: [-1, 0, 0, 0, 0, 0, 0] }],
      },
    ];
    expect(() => projectAxis(invalid, [])).toThrow(/physical value/);
    expect(() =>
      projectAxis(
        [{ name: "short", choices: [{ key: "short", values: [0] }] }],
        [],
      ),
    ).toThrow(/seven-axis/);
    const overflow = ["a", "b"].map((name) => ({
      name,
      choices: [
        { key: name, values: [0, 0, Number.MAX_SAFE_INTEGER, 0, 0, 0, 0] },
      ],
    }));
    expect(() => projectAxis(overflow, [])).toThrow(/overflow/);
    expect(() => projectAxis(slots, [{ speed: 0, main: 0, minZ: -1 }])).toThrow(
      /cell threshold/,
    );
  });

  it("propagates cancellation and throws local limits instead of returning partial proof", () => {
    const cancelled = new Error("outer cancellation");
    expect(() =>
      projectAxis(slots, cells, {
        check: () => {
          throw cancelled;
        },
      }),
    ).toThrow(cancelled);
    for (const limits of [
      { maxStates: 1 },
      { maxTransitions: 1 },
      { maxBitWidth: 1 },
      { maxBits: 1 },
    ]) {
      expect(() => projectAxis(slots, cells, { limits })).toThrow(
        ProjectionLimit,
      );
    }
    const graph = projectAxis(slots, cells).graph;
    expect(() =>
      backtrackAxis(graph, [], {
        check: () => {
          throw cancelled;
        },
      }),
    ).toThrow(cancelled);
    expect(() =>
      backtrackAxis(graph, [...graph.layers.at(-1)!.values()], {
        limits: { maxStates: 1 },
      }),
    ).toThrow(ProjectionLimit);
  });

  it("tests a held axis without applying the new axis bit-width budget to its coordinate", () => {
    const input: ProjectionSlot[] = [
      {
        name: "one",
        choices: [{ key: "one", values: [0, 0, 0, 0, 100, 0, 0] }],
      },
    ];
    const terminal = [{ speed: 0, main: 0, minZ: 100 }];
    const crt = projectAxis(input, terminal);
    const allowed = backtrackAxis(crt.graph, crt.states);
    expect(
      projectAxis(input, terminal, {
        axis: "det",
        basis: ["crt"],
        allowed,
        limits: { maxBitWidth: 1 },
      }).states,
    ).toMatchObject([{ basis: [100], bits: 1n }]);
  });
});
