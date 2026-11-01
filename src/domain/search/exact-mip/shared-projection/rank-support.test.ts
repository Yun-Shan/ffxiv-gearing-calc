import { expect, test, vi } from "vitest";
import {
  refineRankBits,
  type RankCell,
  type RankGraph,
} from "./rank-bitset.ts";
import { prepareRankCapacity } from "./rank-capacity.ts";
import { makeRankGraph, prepareRankCodec } from "./rank-graph.ts";
import { prepareRankSupport } from "./rank-support.ts";
import {
  PROJECTION_AXES,
  ProjectionLimit,
  type ProjectionJob,
  type ProjectionSlot,
} from "./types.ts";

const noop = () => {};
const zero = () => Array<number>(7).fill(0);
const plus = (left: readonly number[], right: readonly number[]) =>
  left.map((value, axis) => value + right[axis]);

function sums(slots: readonly ProjectionSlot[]): number[][] {
  let values = [zero()];
  for (const slot of slots)
    values = values.flatMap((raw) =>
      slot.choices.map((choice) => plus(raw, choice.values)),
    );
  return values;
}

function fixture(
  vectors: readonly (readonly (readonly number[])[])[],
  rhs: number,
): ProjectionJob {
  const slots = vectors.map((choices, s) => ({
    name: `slot_${s}`,
    choices: choices.map((values, c) => ({ key: `${s}_${c}`, values })),
  }));
  const caps = [0, 0, 2, 0, 3, 0, 0];
  return {
    slots,
    rhs,
    axes: PROJECTION_AXES.map((name, a) => {
      const rawMin = slots.reduce(
        (sum, slot) =>
          sum + Math.min(...slot.choices.map((choice) => choice.values[a])),
        0,
      );
      const rawMax = slots.reduce(
        (sum, slot) =>
          sum + Math.max(...slot.choices.map((choice) => choice.values[a])),
        0,
      );
      return {
        name,
        rawMin,
        rawMax,
        classes: Array.from({ length: rawMax + caps[a] + 1 }, (_, value) => ({
          min: value,
          max: value,
          value,
          q: (value % 7) * [2, 1, 2, 1, 3, 1, 0][a],
          selector: `${name}_${value}`,
        })),
      };
    }),
    foods: [2, 4].map((axis, f) => ({
      key: `food_${f}`,
      sharedKey: `food_${f}`,
      bonuses: PROJECTION_AXES.map((_, a) =>
        a === axis
          ? { numerator: 1, denominator: 2, offset: 1, cap: caps[a] }
          : null,
      ),
    })),
  };
}

/** Independent original-row evaluation, with one food across every factor. */
function accepted(job: ProjectionJob, raw: readonly number[]): boolean {
  return job.foods.some((food) => {
    let total = 0n;
    for (let a = 0; a < job.axes.length; a++) {
      let value = BigInt(raw[a]);
      const bonus = food.bonuses[a];
      if (bonus) {
        const amount =
          (value * BigInt(bonus.numerator) + BigInt(bonus.offset)) /
          BigInt(bonus.denominator);
        value += amount < BigInt(bonus.cap) ? amount : BigInt(bonus.cap);
      }
      const entry = job.axes[a].classes.find(
        (entry) => BigInt(entry.min) <= value && value <= BigInt(entry.max),
      );
      if (!entry) return false;
      total += BigInt(entry.q);
    }
    return total >= BigInt(job.rhs);
  });
}

test("both refinements equal complete suffix enumeration, including repeated physical choices and same-food factors", () => {
  const vectors = [
    [
      [1, 2, 0, 2, 0, 33, 1],
      [2, 1, 1, 2, 32, 0, 2],
      [1, 2, 0, 2, 0, 33, 1],
    ],
    [
      [0, 1, 31, 1, 0, 1, 0],
      [1, 0, 0, 1, 33, 0, 1],
      [0, 1, 16, 1, 16, 0, 0],
    ],
    [
      [1, 1, 0, 0, 1, 0, 1],
      [1, 2, 1, 0, 0, 1, 1],
      [2, 0, 0, 0, 0, 0, 2],
    ],
  ];
  for (const rhs of [0, 22, 39, 1_000]) {
    const job = fixture(vectors, rhs),
      before = structuredClone(job);
    const support = prepareRankSupport(
      job,
      prepareRankCapacity(job, noop),
      noop,
    );
    for (let depth = 0; depth <= job.slots.length; depth++) {
      const suffixes = sums(job.slots.slice(depth));
      for (const prefix of sums(job.slots.slice(0, depth))) {
        expect(support.has(depth, prefix)).toBe(
          suffixes.some((suffix) => accepted(job, plus(prefix, suffix))),
        );
      }
    }
    expect(support.bytes).toBeGreaterThan(0);
    expect(support.wordWork).toBeGreaterThan(0);
    expect(job).toEqual(before);
  }
});

test("sparse coordinates, 31/32/33-bit shifts and backward support do not fill unreachable holes", () => {
  const choices = [0, 1, 31, 32, 33, 64].map((det) => [
    0,
    0,
    det,
    0,
    0,
    64 - det,
    0,
  ]);
  const job = fixture([choices, choices, choices], 17);
  const support = prepareRankSupport(job, prepareRankCapacity(job, noop), noop);
  for (let depth = 0; depth <= job.slots.length; depth++) {
    const prefixes = new Set(
      sums(job.slots.slice(0, depth)).map((raw) => raw[2]),
    );
    const suffixes = sums(job.slots.slice(depth));
    for (let det = 0; det <= 64 * depth; det++) {
      const raw = [0, 0, det, 0, 0, 64 * depth - det, 0];
      expect(support.has(depth, raw)).toBe(
        prefixes.has(det) &&
          suffixes.some((suffix) => accepted(job, plus(raw, suffix))),
      );
    }
  }
  expect(support.has(-1, zero())).toBe(false);
  expect(support.has(0.5, zero())).toBe(false);
  expect(support.has(4, zero())).toBe(false);
  expect(support.has(0, [0, 0, 0, 1, 0, 0, 0])).toBe(false);
  expect(support.has(0, [0, 0, 0, 0, 0, 1, 0])).toBe(false);
  expect(support.has(0, [0, 0, NaN, 0, 0, 0, 0])).toBe(false);
});

test("only complete bitsets return, and budgets include both refinements and all replacement buffers", () => {
  const job = fixture(
    [
      [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 32, 0, 0, 0, 0],
      ],
    ],
    0,
  );
  const capacity = prepareRankCapacity(job, noop);
  const complete = prepareRankSupport(job, capacity, noop);
  expect(() =>
    prepareRankSupport(job, capacity, noop, {
      bytes: complete.bytes - 1,
      wordWork: complete.wordWork,
    }),
  ).toThrow(ProjectionLimit);
  expect(() =>
    prepareRankSupport(job, capacity, noop, {
      bytes: complete.bytes,
      wordWork: complete.wordWork - 1,
    }),
  ).toThrow(ProjectionLimit);
  const exact = prepareRankSupport(job, capacity, noop, {
    bytes: complete.bytes,
    wordWork: complete.wordWork,
  });
  expect(exact.has(0, zero())).toBe(true);
  expect(exact.bytes).toBe(complete.bytes);
  expect(exact.wordWork).toBe(complete.wordWork);
  const cancelled = new Error("external cancellation");
  let checks = 0;
  expect(() =>
    prepareRankSupport(job, capacity, () => {
      if (++checks === 5) throw cancelled;
    }),
  ).toThrow(cancelled);
});

test("packing checks each refinement extent and rejects variable tenacity", () => {
  // WMS/T is still safe here; including CRT crosses the safe integer extent.
  const job = fixture([[[0, 0, 0, 0, 0, 0, 0]]], 0);
  job.slots = [
    {
      name: "large",
      choices: [
        { key: "low", values: [0, 0, 0, 0, 0, 0, 0] },
        { key: "high", values: [1_000_000, 1_000_000, 0, 0, 1_000, 0, 0] },
      ],
    },
  ];
  const codec = prepareRankCodec(job, noop);
  expect(() => codec.stageExtent(1)).not.toThrow();
  expect(() => codec.stageExtent(2)).toThrow(ProjectionLimit);
  const variableTen = {
    ...job,
    slots: [
      {
        name: "ten",
        choices: [
          { key: "a", values: zero() },
          { key: "b", values: [0, 0, 0, 1, 0, 0, 0] },
        ],
      },
    ],
  };
  expect(() => prepareRankCodec(variableTen, noop)).toThrow(ProjectionLimit);
});

function cell(key: number, lo: number, hi: number): RankCell {
  return {
    key,
    w: 0,
    m: 0,
    s: 0,
    t: 0,
    c: 0,
    lo,
    hi,
    offset: 0,
    words: 0,
    lastMask: 0,
  };
}

test("bit refinement checks present-edge ranges and propagates terminal cancellation unchanged", () => {
  const invalid: RankGraph = {
    layers: [
      { cells: [cell(0, 0, 0)], byKey: new Map([[0, 0]]) },
      { cells: [cell(1, 1, 1)], byKey: new Map([[1, 0]]) },
    ],
    moves: [[{ keyDelta: 1, delta: 2 }]],
  };
  expect(() =>
    refineRankBits(invalid, () => () => true, noop, { bytes: 0, work: 0 }),
  ).toThrow(ProjectionLimit);
  invalid.moves[0][0].delta = 1;
  const cancelled = new Error("terminal cancellation");
  expect(() =>
    refineRankBits(
      invalid,
      () => {
        throw cancelled;
      },
      noop,
      { bytes: 0, work: 0 },
    ),
  ).toThrow(cancelled);
});

// Sol high upgrade: coverage-final.json identifies the unvisited sparse-edge,
// full-word padding, query rejection and allocation-failure branches here.
test("sparse graph edges and unreachable cells retain only independently enumerable supported paths", () => {
  const graph: RankGraph = {
    layers: [
      { cells: [cell(0, 0, 0)], byKey: new Map([[0, 0]]) },
      { cells: [cell(0, 0, 63), cell(1, 0, 63)], byKey: new Map([[0, 0], [1, 1]]) },
      { cells: [cell(0, 0, 126), cell(1, 0, 126)], byKey: new Map([[0, 0], [1, 1]]) },
    ],
    moves: [
      [{ keyDelta: 0, delta: 0 }, { keyDelta: 0, delta: 63 }, { keyDelta: 2, delta: 0 }],
      [{ keyDelta: 0, delta: 0 }, { keyDelta: 0, delta: 63 }],
    ],
  };
  const support = refineRankBits(graph, () => value => value === 63, noop, { bytes: 0, work: 0 });
  // The only accepted paths are 0 -> 0 -> 63 and 0 -> 63 -> 63.
  expect(support.has(0, 0, 0)).toBe(true);
  for (let value = 0; value <= 63; value++)
    expect(support.has(1, 0, value)).toBe(value === 0 || value === 63);
  for (let value = 0; value <= 126; value++) {
    expect(support.has(2, 0, value)).toBe(value === 63);
    expect(support.has(2, 1, value)).toBe(false);
  }
  expect(graph.layers[1].cells[0].lastMask).toBe(0xffffffff);
  for (const [depth, key, value] of [
    [-1, 0, 0], [3, 0, 0], [1, NaN, 0], [1, -1, 0], [1, 0, 0.5],
    [1, 2, 0], [1, 0, -1], [1, 0, 64],
  ]) expect(support.has(depth, key, value)).toBe(false);
});

test("an allocation failure declines the entire bitset and preserves the original unexpected error", () => {
  const OriginalUint32Array = Uint32Array;
  const graph = (): RankGraph => ({
    layers: [{ cells: [cell(0, 0, 0)], byKey: new Map([[0, 0]]) }], moves: [],
  });
  for (const failure of [new RangeError("simulated buffer exhaustion"), new Error("unexpected allocator failure")]) {
    const budget = { bytes: 0, work: 0 };
    try {
      vi.stubGlobal("Uint32Array", class extends OriginalUint32Array {
        constructor(length: number) {
          if (length > 0) throw failure;
          super(length);
        }
      });
      if (failure instanceof RangeError)
        expect(() => refineRankBits(graph(), () => () => true, noop, budget)).toThrow("Rank bitset allocation limit");
      else expect(() => refineRankBits(graph(), () => () => true, noop, budget)).toThrow(failure);
      expect(budget.bytes).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  }
});

test("unsupported physical contributions and incomplete capacity layers fail before a usable graph can escape", () => {
  const job = fixture([[[0, 0, 0, 0, 0, 0, 0]]], 0);
  for (const values of [
    [0, 0, 0, 0, 0, 0], [-1, 0, 0, 0, 0, 0, 0],
    [0, 0, Number.MAX_SAFE_INTEGER, 0, 1, 0, 0],
  ]) {
    const invalid = { ...job, slots: [{ name: "invalid", choices: [{ key: "bad", values }] }] };
    expect(() => prepareRankCodec(invalid, noop)).toThrow(ProjectionLimit);
  }
  for (const choices of [[], Array.from({ length: 20_001 }, (_, i) => ({ key: String(i), values: zero() }))])
    expect(() => prepareRankCodec({ ...job, slots: [{ name: "unavailable", choices }] }, noop)).toThrow("Rank slot choice limit");
  const capacity = prepareRankCapacity(job, noop);
  expect(() => makeRankGraph(job, { ...capacity, need: [new Map()] }, prepareRankCodec(job, noop), 1, undefined, noop))
    .toThrow("Missing rank capacity layer");
  const complete = prepareRankSupport(job, capacity, noop);
  expect(complete.has(0, zero())).toBe(true);
  expect(complete.has(1, zero())).toBe(accepted(job, zero()));
});
