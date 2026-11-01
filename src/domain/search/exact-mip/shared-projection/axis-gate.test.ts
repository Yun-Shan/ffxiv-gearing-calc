import { describe, expect, test } from "vitest";
import { prepareSharedAxisGate } from "./axis-gate.ts";
import type { AxisState, SupportAxis } from "./axis-support.ts";
import { ProjectionLimit, type ProjectionJob } from "./types.ts";

const names = ["weapon", "main", "det", "ten", "crt", "dht", "gcd"] as const;
const resourceIndex: Readonly<Record<SupportAxis, number>> = {
  crt: 4,
  det: 2,
  dht: 5,
  ten: 3,
};
const resourceNames: readonly SupportAxis[] = ["crt", "det", "dht", "ten"];

function fixture(): ProjectionJob[] {
  const q = [
    [0, 1, 2, 3, 4, 5, 6],
    [0, 1, 2, 3, 4, 5, 6],
    [-2, 1, 2, -1, 3, 4, 5],
    [-1, 0, 2, 1, 3, 4, 5],
    [0, 1, 3, 2, 4, 5, 6],
    [-1, 1, 0, 2, 3, 4, 5],
    [0, 1, -1, 2, 3, 4, 5],
  ];
  return [0, 1].map((j) => ({
    rhs: 3,
    axes: names.map((name, a) => ({
      name,
      rawMin: 0,
      rawMax: 5,
      classes: q[a].map((value, raw) => ({
        min: raw,
        max: raw,
        q: value - (j === 1 && a === 4 ? 1 : 0),
        value: raw + 1,
        selector: `${name}${raw}`,
      })),
    })),
    slots: [
      {
        name: "shared",
        choices: [{ key: "shared", values: [0, 0, 0, 0, 0, 0, 0] }],
      },
      {
        name: "weapon",
        choices: [
          { key: "w0", values: [1, 0, 0, 1, 0, 1, 0] },
          { key: "w1", values: [2, 1, 0, 0, 1, 0, 1] },
        ],
      },
    ],
    foods: [
      {
        key: "crt",
        sharedKey: "crt",
        bonuses: [
          null,
          null,
          null,
          null,
          { numerator: 1, denominator: 2, offset: 0, cap: 1 },
          null,
          null,
        ],
      },
      {
        key: "ten",
        sharedKey: "ten",
        bonuses: [
          null,
          null,
          null,
          { numerator: 1, denominator: 1, offset: 0, cap: 1 },
          null,
          null,
          null,
        ],
      },
    ],
    speedRanges: [{ min: 1, max: 2 }],
  }));
}

function coefficient(
  job: ProjectionJob,
  food: number,
  axis: number,
  raw: number,
): number {
  const range = job.axes[axis];
  if (raw < range.rawMin || raw > range.rawMax) return -Infinity;
  const rule = job.foods[food].bonuses[axis];
  const final =
    raw +
    (rule
      ? Math.min(
          rule.cap,
          Math.floor((raw * rule.numerator + rule.offset) / rule.denominator),
        )
      : 0);
  if (
    axis === 6 &&
    job.speedRanges &&
    !job.speedRanges.some((r) => r.min <= final && final <= r.max)
  )
    return -Infinity;
  return (
    range.classes.find((c) => c.min <= final && final <= c.max)?.q ?? -Infinity
  );
}

/** Enumerates every integer point of the same relaxed domain without tables. */
function upper(
  job: ProjectionJob,
  food: number,
  speed: number,
  main: number,
  z: number,
  held: Readonly<Partial<Record<SupportAxis, number>>>,
): number {
  let best = -Infinity;
  for (const weapon of job.slots[1].choices) {
    const w = weapon.values;
    const core =
      coefficient(job, food, 0, w[0]) +
      coefficient(job, food, 1, main + w[1]) +
      coefficient(job, food, 6, speed + w[6]);
    if (core === -Infinity) continue;
    const remaining = resourceNames.filter((name) => held[name] === undefined);
    let fixedQ = core,
      sharedLeft = z,
      capacity = 0;
    for (const name of resourceNames) {
      const raw = held[name],
        a = resourceIndex[name];
      if (raw === undefined) capacity += w[a];
      else {
        sharedLeft -= raw;
        fixedQ += coefficient(job, food, a, raw + w[a]);
      }
    }
    if (fixedQ === -Infinity || sharedLeft < 0) continue;
    capacity += sharedLeft;
    const visit = (depth: number, left: number, q: number): void => {
      if (depth === remaining.length) {
        best = Math.max(best, q);
        return;
      }
      const a = resourceIndex[remaining[depth]],
        axis = job.axes[a];
      for (let raw = axis.rawMin; raw <= Math.min(axis.rawMax, left); raw++) {
        const value = coefficient(job, food, a, raw);
        if (value !== -Infinity) visit(depth + 1, left - raw, q + value);
      }
    };
    visit(0, capacity, fixedQ);
  }
  return best;
}

function passes(
  jobs: readonly ProjectionJob[],
  speed: number,
  main: number,
  z: number,
  held: Readonly<Partial<Record<SupportAxis, number>>>,
  jointRhs: number,
): boolean {
  return [0, 1].some((food) => {
    const qs = jobs.map((job) => upper(job, food, speed, main, z, held));
    return (
      qs.every((q, j) => q !== -Infinity && q >= jobs[j].rhs) &&
      qs.reduce((sum, q) => sum + q, 0) >= jointRhs
    );
  });
}

describe("shared axis necessary gate", () => {
  test("minimum equals full four-axis relaxed enumeration, including negative Q and hard speed", () => {
    const jobs = fixture(),
      rhs = 11;
    const gate = prepareSharedAxisGate(
      jobs,
      1,
      [
        [0, 0],
        [1, 1],
      ],
      6,
      rhs,
      () => {},
    );
    for (let speed = 0; speed <= 3; speed++)
      for (let main = 0; main <= 2; main++) {
        let expected: number | null = null;
        for (let z = 0; z <= 4; z++)
          if (passes(jobs, speed, main, z, {}, rhs)) {
            expected = z;
            break;
          }
        expect(gate.minimum(speed, main, 4)).toBe(expected);
      }
  });

  test("bit filtering equals enumeration after one or two fixed shared axes", () => {
    const jobs = fixture(),
      rhs = 11;
    const gate = prepareSharedAxisGate(
      jobs,
      1,
      [
        [0, 0],
        [1, 1],
      ],
      6,
      rhs,
      () => {},
    );
    const schemas: readonly {
      axis: SupportAxis;
      basis: readonly SupportAxis[];
      values: readonly number[];
    }[] = [
      { axis: "crt", basis: [], values: [] },
      { axis: "ten", basis: ["crt"], values: [1] },
      { axis: "det", basis: ["crt", "ten"], values: [1, 1] },
    ];
    for (const schema of schemas) {
      const states: AxisState[] = [];
      for (let speed = 0; speed <= 2; speed++)
        for (let main = 0; main <= 1; main++) {
          states.push({
            speed,
            main,
            z: 4,
            basis: schema.values,
            bits:
              (1n << BigInt(5 - schema.values.reduce((a, b) => a + b, 0))) - 1n,
          });
        }
      const expected: AxisState[] = [];
      for (const state of states) {
        let bits = 0n;
        for (let x = 0; x <= 4; x++) {
          if ((state.bits & (1n << BigInt(x))) === 0n) continue;
          const held: Partial<Record<SupportAxis, number>> = {
            [schema.axis]: x,
          };
          schema.basis.forEach((name, k) => {
            held[name] = schema.values[k];
          });
          if (passes(jobs, state.speed, state.main, state.z, held, rhs))
            bits |= 1n << BigInt(x);
        }
        if (bits !== 0n) expected.push({ ...state, bits });
      }
      expect(gate.filter(states, schema.basis, schema.axis)).toEqual(expected);
    }
  });

  test("foods cannot be mixed between jobs to satisfy the joint gate", () => {
    const jobs = fixture();
    for (const [j, job] of jobs.entries()) {
      job.rhs = 0;
      job.slots = [
        job.slots[0],
        {
          name: "weapon",
          choices: [{ key: "one", values: [2, 1, 0, 0, 1, 0, 1] }],
        },
      ];
      job.axes = job.axes.map((axis, a) => ({
        ...axis,
        classes: axis.classes.map((c) => ({
          ...c,
          q: a === 4 ? c.min * 10 : 0,
        })),
      }));
      const boost = { numerator: 1, denominator: 1, offset: 0, cap: 1 };
      job.foods = [0, 1].map((f) => ({
        key: `${f}`,
        sharedKey: `${f}`,
        bonuses: [null, null, null, null, f === j ? boost : null, null, null],
      }));
    }
    const gate = prepareSharedAxisGate(
      jobs,
      1,
      [
        [0, 0],
        [1, 1],
      ],
      6,
      35,
      () => {},
    );
    // At zero shared capacity, the relaxed best weapon provides one CRT.
    // Exactly one job receives the selected food's +1: total Q is 30, not 40.
    expect(gate.minimum(0, 0, 0)).toBeNull();
  });

  test("hard speed is checked after the selected food bonus", () => {
    const jobs = fixture();
    for (const job of jobs)
      job.foods = job.foods.map((food) => ({
        ...food,
        bonuses: food.bonuses.map((bonus, a) =>
          a === 6 ? { numerator: 1, denominator: 1, offset: 0, cap: 1 } : bonus,
        ),
      }));
    const gate = prepareSharedAxisGate(
      jobs,
      1,
      [
        [0, 0],
        [1, 1],
      ],
      6,
      0,
      () => {},
    );
    expect(gate.minimum(2, 0, 4)).toBeNull();
  });

  test("finite negative Q bounds are never replaced by zero", () => {
    const jobs = fixture();
    for (const job of jobs) {
      job.rhs = -7;
      job.axes = job.axes.map((axis) => ({
        ...axis,
        classes: axis.classes.map((c) => ({ ...c, q: -1 })),
      }));
    }
    const gate = prepareSharedAxisGate(
      jobs,
      1,
      [
        [0, 0],
        [1, 1],
      ],
      6,
      -13,
      () => {},
    );
    expect(gate.minimum(0, 0, 4)).toBeNull();
    expect(
      gate.filter(
        [{ speed: 0, main: 0, z: 4, basis: [], bits: 31n }],
        [],
        "crt",
      ),
    ).toEqual([]);
  });

  test("unsafe sums, capacity overflow and cancellation fail without a filtered result", () => {
    const jobs = fixture();
    expect(() =>
      prepareSharedAxisGate(jobs, 1, [[0, 0]], 20_001, 1, () => {}),
    ).toThrow(ProjectionLimit);
    const gate = prepareSharedAxisGate(jobs, 1, [[0, 0]], 6, 1, () => {});
    expect(() => gate.minimum(0, 0, 5)).toThrow(ProjectionLimit);
    expect(() =>
      gate.filter(
        [{ speed: 0, main: 0, z: 4, basis: [], bits: 1n << 5n }],
        [],
        "crt",
      ),
    ).toThrow(ProjectionLimit);
    const reason = new Error("cancelled");
    expect(() =>
      prepareSharedAxisGate(jobs, 1, [[0, 0]], 6, 1, () => {
        throw reason;
      }),
    ).toThrow(reason);
  });
});
