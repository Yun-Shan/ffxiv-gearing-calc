import { describe, expect, it, vi } from "vitest";
import * as axisSupport from "./axis-support.ts";
import { prepareSharedSpeedDomain } from "./shared-speed-domain.ts";
import { projectVariableStates } from "./variable-states.ts";
import {
  PROJECTION_AXES,
  ProjectionLimit,
  type ProjectionJob,
  type ProjectionModel,
  type ProjectionSlot,
} from "./types.ts";

const baseline = (weaponDamage: number) => ({
  weaponDamage,
  mainStat: 1,
  determination: 1,
  tenacity: 1,
  critical: 1,
  directHit: 1,
});
const baselines = [baseline(2), baseline(3)];
function fixture(): ProjectionModel {
  const shared: ProjectionSlot[] = [
    {
      name: "body",
      choices: [
        { key: "body-b", values: [0, 1, 0, 1, 2, 0, 0] },
        { key: "body-a", values: [0, 1, 1, 2, 0, 0, 1] },
        { key: "too-fast", values: [0, 1, 2, 0, 1, 0, 6] },
      ],
    },
    {
      name: "ring",
      choices: [
        { key: "ring-b", values: [0, 0, 1, 0, 0, 1, 0] },
        { key: "ring-a", values: [0, 1, 0, 1, 1, 0, 1] },
      ],
    },
  ];
  const jobs: ProjectionJob[] = [0, 1].map((j) => ({
    axes: PROJECTION_AXES.map((name, a) => ({
      name,
      rawMin: 0,
      rawMax: 20,
      classes: Array.from({ length: 25 }, (_, value) => ({
        min: value,
        max: value,
        q: 0,
        value: a === 6 ? 1 : value + a + 1,
        selector: `${j}_${a}_${value}`,
      })),
    })),
    slots: [
      ...shared.map((slot) => ({
        ...slot,
        choices: slot.choices.map((choice) => ({
          ...choice,
          values: [...choice.values],
        })),
      })),
      {
        name: "weapon",
        choices:
          j === 0
            ? [
                { key: "w0-a", values: [1, 0, 1, 0, 0, 0, 0] },
                { key: "w0-b", values: [2, 1, 0, 1, 0, 0, 1] },
              ]
            : [
                { key: "w1-a", values: [1, 1, 0, 0, 1, 0, 0] },
                { key: "w1-b", values: [3, 0, 0, 0, 0, 1, 1] },
              ],
      },
    ],
    foods: [
      { key: `${j}_none`, sharedKey: "none", bonuses: Array(7).fill(null) },
      {
        key: `${j}_fancy`,
        sharedKey: "fancy",
        bonuses: [
          null,
          null,
          null,
          null,
          { numerator: 1, denominator: 2, offset: 0, cap: 2 },
          null,
          { numerator: 1, denominator: 2, offset: 0, cap: 1 },
        ],
      },
    ],
    rhs: 0,
    speedRanges: [
      { min: 1, max: 1 },
      { min: 3, max: 3 },
    ],
  }));
  return {
    jobs,
    blocks: shared.map((slot) => ({
      name: slot.name,
      keys: slot.choices.map((choice) => ({
        key: choice.key,
        selectors: [choice.key],
      })),
    })),
  };
}

/** Tiny complete enumeration, independently of graph projection, capacity relaxation, or axis order. */
function exhaustiveUpper(
  model: ProjectionModel,
  jointRhs: number,
  divisors: readonly number[],
): { numerator: bigint; denominator: bigint } {
  let totals = [Array<number>(7).fill(0)];
  for (const slot of model.jobs[0].slots.slice(0, model.blocks.length)) {
    totals = totals.flatMap((total) =>
      slot.choices.map((choice) =>
        total.map((value, a) => value + choice.values[a]),
      ),
    );
  }
  const denominator = divisors.reduce(
    (product, value) => product * BigInt(value),
    1n,
  );
  let maximum = 0n;
  for (const shared of totals)
    for (const food of model.jobs[0].foods) {
      let score = 0n,
        sumQ = 0n,
        supported = true;
      for (let j = 0; j < model.jobs.length; j++) {
        const job = model.jobs[j],
          localFood = job.foods.find(
            (candidate) => candidate.sharedKey === food.sharedKey,
          );
        if (!localFood) {
          supported = false;
          break;
        }
        let highestScore: bigint | null = null,
          highestQ: bigint | null = null;
        for (const weapon of job.slots[model.blocks.length].choices) {
          const raw = shared.map((value, a) => value + weapon.values[a]);
          const final = raw.map((value, a) => {
            const rule = localFood.bonuses[a];
            return rule
              ? value +
                  Math.min(
                    rule.cap,
                    Math.floor(
                      (value * rule.numerator + rule.offset) / rule.denominator,
                    ),
                  )
              : value;
          });
          if (
            !job.speedRanges!.some(
              (range) => range.min <= final[6] && final[6] <= range.max,
            )
          )
            continue;
          const classes = raw.map((value, a) =>
            value < job.axes[a].rawMin || value > job.axes[a].rawMax
              ? undefined
              : job.axes[a].classes.find(
                  (cls) => cls.min <= final[a] && final[a] <= cls.max,
                ),
          );
          if (classes.some((cls) => cls === undefined)) continue;
          const q = classes.reduce((sum, cls) => sum + BigInt(cls!.q), 0n);
          if (q < BigInt(job.rhs)) continue;
          const product = classes
            .slice(0, 6)
            .reduce((value, cls) => value * BigInt(cls!.value), 1n);
          if (highestScore === null || product > highestScore)
            highestScore = product;
          if (highestQ === null || q > highestQ) highestQ = q;
        }
        if (highestScore === null || highestQ === null) {
          supported = false;
          break;
        }
        score += highestScore * (denominator / BigInt(divisors[j]));
        sumQ += highestQ;
      }
      if (supported && sumQ >= BigInt(jointRhs) && score > maximum)
        maximum = score;
    }
  return { numerator: maximum, denominator };
}

describe("typed variable-tenacity shared projection", () => {
  it("matches exhaustive strict-improvement closure with foods, discrete GCDs, and unequal independent denominators", () => {
    const model = fixture(),
      expected = exhaustiveUpper(model, 0, [2, 3]);
    expect(expected.numerator).toBeGreaterThan(0n);
    const atMaximum = projectVariableStates(
      model,
      0,
      baselines,
      expected,
      () => {},
    );
    expect(atMaximum.closed).toBe(true);
    expect(atMaximum.stages).toHaveLength(3);
    expect(new Set(atMaximum.stages).size).toBe(3);
    expect(
      projectVariableStates(
        model,
        0,
        baselines,
        { ...expected, numerator: expected.numerator - 1n },
        () => {},
      ).closed,
    ).toBe(false);
  });

  it("keeps every speed-supported original physical key in its original order", () => {
    const model = fixture(),
      before = JSON.stringify(model);
    const domain = prepareSharedSpeedDomain(model, () => {});
    expect(
      domain.slots.map((slot) => slot.choices.map((choice) => choice.key)),
    ).toEqual([
      ["body-b", "body-a"],
      ["ring-b", "ring-a"],
    ]);
    expect(domain.foods).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(domain.cells.length).toBeGreaterThan(0);
    const maxSharedZ = domain.cells.reduce(
      (maximum, cell) => Math.max(maximum, cell.maxZ),
      0,
    );
    expect(domain.maxCapacity).toBe(maxSharedZ + 1);
    expect(JSON.stringify(model)).toBe(before);
  });

  it("separates the highest-Q weapon from the highest true-factor-product weapon", () => {
    const model = fixture();
    for (const job of model.jobs) {
      job.foods = [job.foods[0]];
      job.speedRanges = [{ min: 0, max: 0 }];
      job.slots = [
        {
          name: "shared",
          choices: [
            { key: "a", values: [0, 0, 0, 1, 0, 0, 0] },
            { key: "b", values: [0, 0, 0, 2, 0, 0, 0] },
          ],
        },
        {
          name: "weapon",
          choices: [
            { key: "true", values: [1, 0, 0, 0, 0, 0, 0] },
            { key: "q", values: [2, 0, 0, 0, 0, 0, 0] },
          ],
        },
      ];
      job.axes = job.axes.map((axis, a) => ({
        ...axis,
        classes: axis.classes.map((cls) => ({
          ...cls,
          value: a === 0 && cls.min === 1 ? 100 : 1,
          q: a === 0 && cls.min === 1 ? -5 : 0,
        })),
      }));
      job.rhs = -5;
    }
    model.blocks = [
      {
        name: "shared",
        keys: [
          { key: "a", selectors: ["a"] },
          { key: "b", selectors: ["b"] },
        ],
      },
    ];
    const independent = [baseline(1), baseline(1)];
    expect(
      projectVariableStates(
        model,
        0,
        independent,
        { numerator: 100n, denominator: 1n },
        () => {},
      ).closed,
    ).toBe(false);
    expect(
      projectVariableStates(
        model,
        0,
        independent,
        { numerator: 200n, denominator: 1n },
        () => {},
      ).closed,
    ).toBe(true);
  });

  it("closes only when the complete necessary domain is empty", () => {
    const model = fixture();
    expect(
      projectVariableStates(
        model,
        1,
        baselines,
        { numerator: 0n, denominator: 1n },
        () => {},
      ),
    ).toEqual({ closed: true, stages: [] });
    model.jobs[1].foods = [];
    expect(
      projectVariableStates(
        model,
        0,
        baselines,
        { numerator: 0n, denominator: 1n },
        () => {},
      ).closed,
    ).toBe(true);
  });

  it("declines unsupported vector bindings, missing finite ranges, private layouts, and oversized capacity", () => {
    const attempts = [
      (model: ProjectionModel) => {
        model.jobs[1].slots[0].choices[0].values = [0, 2, 0, 1, 2, 0, 0];
      },
      (model: ProjectionModel) => {
        model.jobs[0].speedRanges = undefined;
      },
      (model: ProjectionModel) => {
        model.jobs[0].speedRanges = [{ min: 0, max: Number.MAX_SAFE_INTEGER }];
      },
      (model: ProjectionModel) => {
        model.jobs[0].slots = [
          ...model.jobs[0].slots,
          { name: "extra", choices: [] },
        ];
      },
      (model: ProjectionModel) => {
        for (const job of model.jobs)
          job.slots[0].choices[0].values = [0, 1, 0, 21_000, 2, 0, 0];
      },
    ];
    for (const change of attempts) {
      const model = fixture();
      change(model);
      expect(
        projectVariableStates(
          model,
          0,
          baselines,
          { numerator: 0n, denominator: 1n },
          () => {},
        ).closed,
      ).toBe(false);
    }
  });

  it("propagates caller cancellation, including a ProjectionLimit thrown by the caller", () => {
    for (const failure of [
      new Error("cancelled"),
      new ProjectionLimit("caller deadline"),
    ]) {
      expect(() =>
        projectVariableStates(
          fixture(),
          0,
          baselines,
          { numerator: 0n, denominator: 1n },
          () => {
            throw failure;
          },
        ),
      ).toThrow(failure);
    }
    let checks = 0;
    const failure = new Error("later cancellation");
    expect(() =>
      projectVariableStates(
        fixture(),
        0,
        baselines,
        { numerator: 0n, denominator: 1n },
        () => {
          if (++checks === 8) throw failure;
        },
      ),
    ).toThrow(failure);
  });

  it("local wall-budget exhaustion declines a nonempty domain without converting it into an empty-domain proof", () => {
    // Sol high upgrade: the unvisited variable-states.ts:273 boundary is local
    // exhaustion, not caller cancellation and not mathematical infeasibility.
    const model = fixture();
    expect(exhaustiveUpper(model, 0, [2, 3]).numerator).toBeGreaterThan(0n);
    let checks = 0;
    try {
      vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(160_000);
      expect(projectVariableStates(model, 0, baselines, { numerator: 0n, denominator: 1n }, () => { checks++; }))
        .toEqual({ closed: false, stages: [] });
      expect(checks).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("real per-axis transition budgets exhaust all pilots and retain the complete-domain fallback", () => {
    const model = fixture(), originalProjectAxis = axisSupport.projectAxis;
    expect(exhaustiveUpper(model, 0, [2, 3]).numerator).toBeGreaterThan(0n);
    try {
      // Exercise the real axis machinery with a deliberately tiny test budget.
      // No projection result is invented or truncated by this wrapper.
      const project = vi.spyOn(axisSupport, "projectAxis").mockImplementation((slots, cells, options) =>
        originalProjectAxis(slots, cells, {
          ...options, limits: { ...options?.limits, maxTransitions: 1 },
        }));
      const result = projectVariableStates(model, 0, baselines, { numerator: 0n, denominator: 1n }, () => {});
      expect(result).toEqual({ closed: false, stages: [] });
      expect(new Set(project.mock.calls.map(call => call[2]?.axis)))
        .toEqual(new Set(["ten", "crt", "det", "dht"]));
      expect(project).toHaveBeenCalledTimes(4);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("unexpected pilot failures propagate instead of being treated as optional resource exhaustion", () => {
    const failure = new Error("unexpected axis implementation failure");
    try {
      const project = vi.spyOn(axisSupport, "projectAxis").mockImplementation(() => { throw failure; });
      expect(() => projectVariableStates(fixture(), 0, baselines, { numerator: 0n, denominator: 1n }, () => {}))
        .toThrow(failure);
      expect(project).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("pilot sampling above 48 states keeps an unsampled high-bit shared candidate in the complete true-score bound", () => {
    const choices = Array.from({ length: 64 }, (_, value) => ({
      key: `physical_${value}`, values: [0, value, 0, value, 0, 0, 0],
    }));
    const model: ProjectionModel = {
      blocks: [{ name: "shared", keys: choices.map(choice => ({ key: choice.key, selectors: [choice.key] })) }],
      jobs: [0, 1].map(j => ({
        slots: [
          { name: "shared", choices },
          { name: "weapon", choices: [{ key: `weapon_${j}`, values: [1, 0, 0, 0, 0, 0, 0] }] },
        ],
        foods: [{ key: `food_${j}`, sharedKey: "plain", bonuses: Array(7).fill(null) }],
        axes: PROJECTION_AXES.map((name, axis) => ({
          name, rawMin: axis === 0 ? 1 : 0, rawMax: axis === 1 || axis === 3 ? 63 : axis === 0 ? 1 : 0,
          classes: Array.from({ length: axis === 1 || axis === 3 ? 64 : axis === 0 ? 2 : 1 }, (_, value) => ({
            min: value, max: value, q: 0, value: axis === 1 && value === 61 ? 2 : 1, selector: `${j}_${axis}_${value}`,
          })),
        })),
        rhs: 0,
        speedRanges: [{ min: 0, max: 0 }],
      })),
    };
    const independent = [baseline(1), baseline(1)], expected = exhaustiveUpper(model, 0, [1, 1]);
    expect(expected).toEqual({ numerator: 4n, denominator: 1n });
    const atMaximum = projectVariableStates(model, 0, independent, expected, () => {});
    expect(atMaximum.closed).toBe(true);
    expect(atMaximum.stages).toHaveLength(3);
    // Only physical_61 improves 3 (index 61 is absent from the 48 pilot samples):
    // sampling may choose an axis, never truncate
    // the original states or silently omit a high bit in the completed bound.
    expect(projectVariableStates(model, 0, independent, { numerator: 3n, denominator: 1n }, () => {}).closed).toBe(false);
  });

  it("a cancellation at the last completion check remains fatal even when the caller throws ProjectionLimit only once", () => {
    const model = fixture(), maximum = exhaustiveUpper(model, 0, [2, 3]);
    try {
      vi.spyOn(performance, "now").mockReturnValue(0);
      let total = 0;
      expect(projectVariableStates(model, 0, baselines, maximum, () => { total++; }).closed).toBe(true);
      expect(total).toBeGreaterThan(8);
      for (const failure of [new Error("late cancellation"), new ProjectionLimit("late caller deadline")]) {
        let checks = 0;
        expect(() => projectVariableStates(model, 0, baselines, maximum, () => {
          if (++checks === total) throw failure;
        })).toThrow(failure);
        expect(checks).toBe(total);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});
