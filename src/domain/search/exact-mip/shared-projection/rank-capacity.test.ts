import { describe, expect, test } from "vitest";
import { prepareRankCapacity } from "./rank-capacity.ts";
import {
  ProjectionLimit,
  type ProjectionAxis,
  type ProjectionJob,
} from "./types.ts";

function fixture(): ProjectionJob {
  const names = ["weapon", "main", "det", "ten", "crt", "dht", "gcd"] as const;
  const coefficients = [
    [0, 2, 4, 6, 8, 10],
    [0, 1, 2, 3, 4, 5],
    [0, 1, 3, 2, 4, 5],
    [0],
    [0, 2, 1, 4, 3, 6],
    [0, 1, 2, 0, 4, 5],
    [0, -1, 2, 0, 1, 3],
  ];
  const axes: ProjectionAxis[] = names.map((name, a) => ({
    name,
    rawMin: 0,
    rawMax: a === 3 ? 0 : 4,
    classes: coefficients[a].map((q, value) => ({
      min: value,
      max: value,
      q,
      value: value + 1,
      selector: `${name}${value}`,
    })),
  }));
  return {
    axes,
    rhs: 10,
    slots: [
      {
        name: "a",
        choices: [
          { key: "a0", values: [1, 1, 0, 0, 2, 1, 0] },
          { key: "a1", values: [1, 0, 1, 0, 0, 2, 1] },
        ],
      },
      {
        name: "b",
        choices: [
          { key: "b0", values: [0, 1, 1, 0, 1, 0, 1] },
          { key: "b1", values: [0, 2, 2, 0, 0, 1, 0] },
        ],
      },
    ],
    foods: [
      {
        key: "c",
        sharedKey: "c",
        bonuses: [
          null,
          null,
          null,
          null,
          { numerator: 1, denominator: 2, offset: 1, cap: 1 },
          null,
          null,
        ],
      },
      {
        key: "d",
        sharedKey: "d",
        bonuses: [
          null,
          null,
          { numerator: 1, denominator: 1, offset: 0, cap: 1 },
          null,
          null,
          null,
          null,
        ],
      },
    ],
  };
}

/** Direct enumeration of the supplied row; independent of envelope tables. */
function possible(job: ProjectionJob, raw: readonly number[]): boolean {
  return job.foods.some((food) => {
    let sum = 0;
    for (let a = 0; a < job.axes.length; a++) {
      const axis = job.axes[a],
        value = raw[a],
        rule = food.bonuses[a];
      if (
        !Number.isInteger(value) ||
        value < axis.rawMin ||
        value > axis.rawMax
      )
        return false;
      const final =
        value +
        (rule === null
          ? 0
          : Math.min(
              rule.cap,
              Math.floor(
                (value * rule.numerator + rule.offset) / rule.denominator,
              ),
            ));
      const group = axis.classes.find((c) => c.min <= final && final <= c.max);
      if (!group) return false;
      sum += group.q;
    }
    return sum >= job.rhs;
  });
}

describe("rank capacity", () => {
  test("exact CRT and DET support equals a small full same-food row enumeration", () => {
    const job = fixture(),
      capacity = prepareRankCapacity(job, () => {});
    for (let w = 0; w <= 2; w++)
      for (let m = 0; m <= 3; m++)
        for (let s = 0; s <= 2; s++) {
          for (let t = 0; t <= 6; t++) {
            const crtSupport = capacity.forCell(w, m, s, t);
            for (let crt = 0; crt <= 4; crt++) {
              const detSupport = capacity.exactForCell(w, m, s, t, crt);
              let expectedCrt = false;
              for (let det = 0; det <= 4; det++) {
                const expected = possible(job, [
                  w,
                  m,
                  det,
                  0,
                  crt,
                  t - crt - det,
                  s,
                ]);
                expect(detSupport(det)).toBe(expected);
                expectedCrt ||= expected;
              }
              expect(crtSupport(crt)).toBe(expectedCrt);
            }
          }
        }
  });

  test("all feasible physical prefixes survive backward capacity needs", () => {
    const job = fixture(),
      capacity = prepareRankCapacity(job, () => {});
    let feasible = 0;
    for (const first of job.slots[0].choices)
      for (const second of job.slots[1].choices) {
        const total = first.values.map((v, a) => v + second.values[a]);
        if (!possible(job, total)) continue;
        feasible++;
        const prefix = Array<number>(7).fill(0);
        for (const [depth, choice] of [undefined, first, second].entries()) {
          if (choice)
            choice.values.forEach((v, a) => {
              prefix[a] += v;
            });
          const need = capacity.need[depth].get(
            capacity.pack(prefix[0], prefix[1], prefix[6]),
          );
          expect(need).toBeDefined();
          expect(prefix[2] + prefix[4] + prefix[5]).toBeGreaterThanOrEqual(
            need!,
          );
        }
      }
    expect(feasible).toBeGreaterThan(0);
    expect(capacity.span).toBeGreaterThan(0);
  });

  test("gaps and negative coefficients retain exact support", () => {
    const job = fixture();
    job.axes = job.axes.map((axis) => ({
      ...axis,
      classes: axis.classes.filter((c) => c.min !== 3),
    }));
    const capacity = prepareRankCapacity(job, () => {});
    for (let crt = 0; crt <= 4; crt++)
      for (let det = 0; det <= 4; det++) {
        expect(capacity.exactForCell(1, 2, 1, 5, crt)(det)).toBe(
          possible(job, [1, 2, det, 0, crt, 5 - crt - det, 1]),
        );
      }
  });

  test("wide W/M/S boxes use conservative coarse capacities", () => {
    const job = fixture();
    job.rhs = 0;
    job.axes = job.axes.map((axis, a) => ({
      ...axis,
      rawMin: 0,
      rawMax: a === 0 || a === 1 || a === 6 ? 200 : 0,
      classes: [{ min: 0, max: 200, q: 0, value: 1, selector: axis.name }],
    }));
    job.foods = [
      { key: "none", sharedKey: "none", bonuses: Array<null>(7).fill(null) },
    ];
    job.slots = [
      {
        name: "wide",
        choices: [
          { key: "low", values: [0, 0, 0, 0, 0, 0, 0] },
          { key: "high", values: [200, 200, 0, 0, 0, 0, 200] },
        ],
      },
    ];
    const capacity = prepareRankCapacity(job, () => {});
    expect(capacity.need[0].get(capacity.pack(0, 0, 0))).toBe(0);
    expect(capacity.need[1].get(capacity.pack(0, 0, 0))).toBe(0);
    expect(capacity.need[1].get(capacity.pack(200, 200, 200))).toBe(0);
    expect(capacity.span).toBe(3);
    job.rhs = 1;
    expect(prepareRankCapacity(job, () => {}).need[0].size).toBe(0);
  });

  test("capacity budgets decline the optional path and cancellation propagates unchanged", () => {
    const job = fixture();
    job.slots = [
      {
        name: "large",
        choices: [{ key: "x", values: [1, 1, 100_001, 0, 0, 0, 0] }],
      },
    ];
    expect(() => prepareRankCapacity(job, () => {})).toThrow(ProjectionLimit);
    const reason = new Error("cancel");
    expect(() =>
      prepareRankCapacity(fixture(), () => {
        throw reason;
      }),
    ).toThrow(reason);
  });

  test("unsafe packing and coefficient sums decline the optional path", () => {
    const job = fixture();
    job.slots = [
      {
        name: "wide",
        choices: [
          { key: "x", values: [Number.MAX_SAFE_INTEGER, 1, 0, 0, 0, 0, 1] },
        ],
      },
    ];
    expect(() => prepareRankCapacity(job, () => {})).toThrow(ProjectionLimit);
    const large = fixture();
    large.axes = large.axes.map((axis) => ({
      ...axis,
      classes: axis.classes.map((entry) => ({
        ...entry,
        q: Number.MAX_SAFE_INTEGER,
      })),
    }));
    expect(() => prepareRankCapacity(large, () => {})).toThrow(ProjectionLimit);
  });
});
