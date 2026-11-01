import { describe, expect, test } from "vitest";
import type { LinearMipRow } from "../../linear-mip.ts";
import { projectFixedRanks } from "./fixed-ranks.ts";
import {
  PROJECTION_AXES,
  ProjectionLimit,
  type ProjectionFood,
  type ProjectionJob,
  type ProjectionModel,
  type ProjectionSlot,
} from "./types.ts";

// The oracle enumerates physical choices and evaluates the original rows directly.
const noop = () => {};
const zero = () => Array<number>(7).fill(0);
const vector = (main: number) => [0, main, 0, 0, 0, 0, 0];
const row = (
  name: string,
  terms: [string, number][],
  sense: LinearMipRow["sense"],
  rhs: number,
): LinearMipRow => ({ name, terms: new Map(terms), sense, rhs });

function product<T>(domains: readonly (readonly T[])[]): T[][] {
  let tuples: T[][] = [[]];
  for (const domain of domains)
    tuples = tuples.flatMap((tuple) =>
      domain.map((value) => [...tuple, value]),
    );
  return tuples;
}

function plainFood(index: number): ProjectionFood {
  return {
    key: `j${index}_plain`,
    sharedKey: "plain",
    bonuses: PROJECTION_AXES.map(() => null),
  };
}

function makeJob(
  index: number,
  slots: ProjectionSlot[],
  rhs = 0,
  foods = [plainFood(index)],
  coefficient: (axis: number, value: number) => number = () => 0,
  present: (axis: number, value: number) => boolean = () => true,
): ProjectionJob {
  return {
    slots,
    rhs,
    foods,
    axes: PROJECTION_AXES.map((name, axis) => {
      const rawMin = slots.reduce(
        (sum, slot) =>
          sum + Math.min(...slot.choices.map((choice) => choice.values[axis]!)),
        0,
      );
      const rawMax = slots.reduce(
        (sum, slot) =>
          sum + Math.max(...slot.choices.map((choice) => choice.values[axis]!)),
        0,
      );
      const cap = Math.max(
        0,
        ...foods.map((food) => food.bonuses[axis]?.cap ?? 0),
      );
      return {
        name,
        rawMin,
        rawMax,
        classes: Array.from({ length: rawMax + cap + 1 }, (_, value) => value)
          .filter((value) => present(axis, value))
          .map((value) => ({
            min: value,
            max: value,
            value: 100 + value,
            q: coefficient(axis, value),
            selector: `j${index}_${name}_${value}`,
          })),
      };
    }),
  };
}

type Leaf = { selectors: string[]; physical: string[] };
type Rank = { keys: string[]; leaves: Leaf[][] };

/** Enumerate physical keys, local equipment and physical foods before factors.
 * Small nonnegative food arithmetic uses Number floor independently of the
 * production BigInt classifier; Q and original-row evaluation remain BigInt.
 */
function referenceRanks(model: ProjectionModel): Rank[] {
  const ranks: Rank[] = [];
  for (const shared of product(model.blocks.map((block) => block.keys))) {
    const leaves = model.jobs.map((job) => {
      const domains = job.slots.map((slot, depth) =>
        depth < shared.length
          ? slot.choices.filter((choice) => choice.key === shared[depth]!.key)
          : slot.choices,
      );
      const accepted: Leaf[] = [];
      for (const equipment of product(domains))
        for (const food of job.foods) {
          const raw = PROJECTION_AXES.map((_, axis) =>
            equipment.reduce((sum, choice) => sum + choice.values[axis]!, 0),
          );
          const selected = job.axes.map((axis, a) => {
            const bonus = food.bonuses[a];
            const value =
              raw[a]! +
              (bonus === null || bonus === undefined
                ? 0
                : Math.min(
                    bonus.cap,
                    Math.floor(
                      (raw[a]! * bonus.numerator + bonus.offset) /
                        bonus.denominator,
                    ),
                  ));
            return axis.classes.find(
              (entry) => entry.min <= value && value <= entry.max,
            );
          });
          if (selected.some((entry) => entry === undefined)) continue;
          const q = selected.reduce((sum, entry) => sum + BigInt(entry!.q), 0n);
          if (q < BigInt(job.rhs)) continue;
          accepted.push({
            selectors: selected.map((entry) => entry!.selector),
            physical: [
              ...equipment.slice(shared.length).map((choice) => choice.key),
              food.key,
            ],
          });
        }
      return accepted;
    });
    if (leaves.every((domain) => domain.length > 0))
      ranks.push({ keys: shared.map((key) => key.key), leaves });
  }
  return ranks;
}

function satisfies(
  original: LinearMipRow,
  assignment: ReadonlySet<string>,
): boolean {
  // Iterate original terms, rather than summing the production selected list.
  let lhs = 0n;
  for (const [name, coefficient] of original.terms)
    if (assignment.has(name)) lhs += BigInt(coefficient);
  const rhs = BigInt(original.rhs);
  return original.sense === "="
    ? lhs === rhs
    : original.sense === ">="
      ? lhs >= rhs
      : lhs <= rhs;
}

function originalAssignments(
  model: ProjectionModel,
  ranks: Rank[],
  restrictions: readonly LinearMipRow[],
): Set<string>[] {
  const assignments: Set<string>[] = [];
  for (const rank of ranks) {
    const shared = model.blocks.flatMap(
      (block, b) =>
        block.keys.find((key) => key.key === rank.keys[b])!.selectors,
    );
    for (const tuple of product(rank.leaves)) {
      const assignment = new Set([
        ...shared,
        ...tuple.flatMap((leaf) => [...leaf.selectors, ...leaf.physical]),
      ]);
      if (restrictions.every((original) => satisfies(original, assignment)))
        assignments.push(assignment);
    }
  }
  return assignments;
}

function verify(
  model: ProjectionModel,
  restrictions: readonly LinearMipRow[] = [],
  exactClosure = true,
) {
  const before = structuredClone(model);
  const ranks = referenceRanks(model);
  const feasible = originalAssignments(model, ranks, restrictions);
  const actual = projectFixedRanks(model, restrictions, noop);
  expect(actual.ranks).toBe(ranks.length);
  if (exactClosure) expect(actual.closed).toBe(feasible.length === 0);
  if (actual.closed) expect(feasible).toHaveLength(0);
  for (const emitted of actual.rows) {
    expect(emitted.sense).toBe("<=");
    expect(emitted.rhs).toBe(0);
    expect([...emitted.terms.values()].every((value) => value === 1)).toBe(
      true,
    );
    for (const assignment of feasible)
      expect(satisfies(emitted, assignment), emitted.name).toBe(true);
  }
  // Independently identify every locally unsupported physical selector. This
  // catches missing private/food zero rows even when closure happens to agree.
  if (ranks.length) {
    const all = new Set(
      model.blocks.flatMap((block) =>
        block.keys.flatMap((key) => key.selectors),
      ),
    );
    model.jobs.forEach((job) => {
      job.slots
        .slice(model.blocks.length)
        .forEach((slot) =>
          slot.choices.forEach((choice) => all.add(choice.key)),
        );
      job.foods.forEach((food) => all.add(food.key));
    });
    const supported = new Set<string>();
    for (const rank of ranks) {
      model.blocks.forEach((block, b) =>
        block.keys
          .find((key) => key.key === rank.keys[b])!
          .selectors.forEach((name) => supported.add(name)),
      );
      rank.leaves
        .flat()
        .forEach((leaf) =>
          leaf.physical.forEach((name) => supported.add(name)),
        );
    }
    expect(
      [
        ...new Set(actual.rows.flatMap((emitted) => [...emitted.terms.keys()])),
      ].sort(),
    ).toEqual([...all].filter((name) => !supported.has(name)).sort());
  }
  expect(model).toEqual(before);
  return { actual, ranks, feasible };
}

function irregularModel(rhs: number): ProjectionModel {
  const blocks = [
    {
      name: "body",
      keys: ["body-a", "body-b", "body-c"].map((key) => ({
        key,
        selectors: [`${key}_j0`, `${key}_j1`],
      })),
    },
    {
      name: "head",
      keys: ["head-a", "head-b"].map((key) => ({
        key,
        selectors: [`${key}_j0`, `${key}_j1`],
      })),
    },
  ];
  const jobs = [0, 1].map((j) => {
    const duplicate = [1, 1 + j, 0, 1, 1 + j, 0, 1];
    const slots = [
      {
        name: "body",
        choices: [duplicate, [...duplicate], [0, 2 + j, 2, 1, 0, 1, 2]].map(
          (values, i) => ({ key: blocks[0]!.keys[i]!.key, values }),
        ),
      },
      {
        name: "head",
        choices: [
          [0, 1, 1 + j, 0, 0, 2, 0],
          [1, 0, 0, 0, 2 + j, 0, 1],
        ].map((values, i) => ({ key: blocks[1]!.keys[i]!.key, values })),
      },
      {
        name: "weapon",
        choices: [
          [1, 1, 0, 0, 1, 0, 0],
          [2, 0, 1, 0, 0, 1, 1],
        ].map((values, i) => ({ key: `j${j}_equip_weapon_${i}`, values })),
      },
      {
        name: "private",
        choices: [
          [0, 1, 0, 0, 0, 1, 1],
          [0, 0, 2, 0, 1, 0, 0],
        ].map((values, i) => ({ key: `j${j}_private_${i}`, values })),
      },
    ];
    const foods: ProjectionFood[] = [
      plainFood(j),
      {
        key: `j${j}_bonus`,
        sharedKey: "bonus",
        bonuses: PROJECTION_AXES.map((_, axis) =>
          axis === 2
            ? { numerator: 1, denominator: 2, offset: j + 1, cap: 2 }
            : axis === 4
              ? { numerator: 2, denominator: 3, offset: 1, cap: 2 }
              : axis === 3
                ? { numerator: 1, denominator: 2, offset: j, cap: 1 }
                : null,
        ),
      },
    ];
    return makeJob(
      j,
      slots,
      rhs,
      foods,
      (axis, value) => -((value * (axis + 1) + 2 * j) % 5),
      (axis, value) => axis !== 2 || value !== 2,
    );
  });
  return { blocks, jobs };
}

describe("fixed shared ranks against independent physical exhaustion", () => {
  test("duplicate vectors retain physical keys, negative nonmonotone Q, class holes and job-specific food contributions", () => {
    for (const rhs of [-40, -16, -10, 1]) {
      const model = irregularModel(rhs);
      const checked = verify(model);
      if (rhs === -40) {
        expect(checked.feasible.length).toBeGreaterThan(0);
        expect(checked.ranks.some((rank) => rank.keys[0] === "body-a")).toBe(
          true,
        );
        expect(checked.ranks.some((rank) => rank.keys[0] === "body-b")).toBe(
          true,
        );
        expect(model.jobs[0]!.slots[0]!.choices[0]!.values).not.toEqual(
          model.jobs[1]!.slots[0]!.choices[0]!.values,
        );
      }
    }
  });

  test("original >=, <=, equality and no-good rows are checked jointly on all seven selectors", () => {
    const model = irregularModel(-40);
    const source = originalAssignments(model, referenceRanks(model), []);
    expect(source.length).toBeGreaterThan(1);
    const first = [...source[0]!].filter((name) =>
      /^j[01]_(weapon|main|det|ten|crt|dht|gcd)_\d+$/.test(name),
    );
    expect(first).toHaveLength(14);
    const original: LinearMipRow[] = [
      row(
        "joint_necessary",
        first.map((name) => [name, -3]),
        ">=",
        -42,
      ),
      row(
        "joint_nogood",
        first.map((name) => [name, 1]),
        "<=",
        13,
      ),
      row(
        "original_equality",
        [
          [first[0]!, 1],
          [first[7]!, -1],
        ],
        "=",
        0,
      ),
    ];
    verify(model, original);
    // Enumerate each original signature and forbid it. This must close, while
    // omitting one no-good must preserve that exact original feasible tuple.
    const signatures = [
      ...new Map(
        source.map((assignment) => {
          const names = [...assignment]
            .filter((name) =>
              model.jobs.some((job) =>
                job.axes.some((axis) =>
                  axis.classes.some((cls) => cls.selector === name),
                ),
              ),
            )
            .sort();
          return [JSON.stringify(names), names] as const;
        }),
      ).values(),
    ];
    const forbids = signatures.map((names, i) =>
      row(
        `joint_nogood_${i}`,
        names.map((name) => [name, 1]),
        "<=",
        13,
      ),
    );
    expect(verify(model, forbids).actual.closed).toBe(true);
    const survivor = verify(model, forbids.slice(1));
    expect(survivor.actual.closed).toBe(false);
    expect(
      survivor.feasible.some((assignment) =>
        signatures[0]!.every((name) => assignment.has(name)),
      ),
    ).toBe(true);
  });

  test("a signature from another physical rank cannot satisfy the current rank", () => {
    const blocks = [
      {
        name: "body",
        keys: ["a", "b"].map((key) => ({
          key,
          selectors: [`physical_${key}`],
        })),
      },
    ];
    const jobs = [0, 1].map((j) =>
      makeJob(j, [
        {
          name: "body",
          choices: [0, 1].map((_, i) => ({
            key: blocks[0]!.keys[i]!.key,
            values: vector(j === 0 ? i : 1 - i),
          })),
        },
      ]),
    );
    const model = { blocks, jobs };
    const required = row(
      "joint_necessary_both_low",
      [
        ["j0_main_0", 1],
        ["j1_main_0", 1],
      ],
      "=",
      2,
    );
    expect(verify(model, [required]).actual.closed).toBe(true);
    // Negative control: merging ranks would invent the impossible low/low pair.
    const ranks = referenceRanks(model);
    const merged = jobs.map((_, j) => ranks.flatMap((rank) => rank.leaves[j]!));
    expect(
      product(merged).some((tuple) =>
        satisfies(required, new Set(tuple.flatMap((leaf) => leaf.selectors))),
      ),
    ).toBe(true);
  });

  test("original row sums stay exact above Number's consecutive-integer range", () => {
    const blocks = [
      { name: "body", keys: [{ key: "body", selectors: ["physical"] }] },
    ];
    const jobs = [0, 1].map((j) =>
      makeJob(j, [
        { name: "body", choices: [{ key: "body", values: zero() }] },
      ]),
    );
    const terms: [string, number][] = [
      ["j0_weapon_0", Number.MAX_SAFE_INTEGER],
      ["j0_main_0", 2],
      ["j0_det_0", -Number.MAX_SAFE_INTEGER],
    ];
    expect(
      verify({ blocks, jobs }, [row("exact_two", terms, "=", 2)]).actual.closed,
    ).toBe(false);
    expect(
      verify({ blocks, jobs }, [row("rounded_one_is_wrong", terms, "=", 1)])
        .actual.closed,
    ).toBe(true);
  });

  test("sparse nonconsecutive mixed-radix ranks survive compression with their original job contributions", () => {
    const blocks = ["body", "head"].map((name) => ({
      name,
      keys: [0, 1, 2].map((i) => ({
        key: `${name}_${i}`,
        selectors: [`${name}_${i}_physical`],
      })),
    }));
    const jobs = [0, 1].map((j) =>
      makeJob(
        j,
        [
          ...blocks.map((block, b) => ({
            name: block.name,
            choices: block.keys.map((key, i) => ({
              key: key.key,
              values: vector(i * (b === 0 ? 3 : 1) * (j === 0 ? 1 : 10)),
            })),
          })),
          {
            name: "private",
            choices: Array.from({ length: j === 0 ? 1 : 3 }, (_, i) => ({
              key: `j${j}_private_${i}`,
              values: zero(),
            })),
          },
        ],
        0,
        [plainFood(j)],
        () => 0,
        (axis, value) =>
          axis !== 1 || (j === 0 ? [1, 8] : [10, 80]).includes(value),
      ),
    );
    const checked = verify({ blocks, jobs }, [
      row("last_rank_survives", [["j1_main_80", 1]], "=", 1),
    ]);
    expect(checked.actual.firstJob).toBe(0);
    expect(checked.actual.ranks).toBe(2);
    expect(checked.ranks.map((rank) => rank.keys)).toEqual([
      ["body_0", "head_1"],
      ["body_2", "head_2"],
    ]);
    expect(checked.feasible).toHaveLength(3);
  });

  test("every shared, private and food zero is justified by the common remaining physical domain", () => {
    const blocks = [
      {
        name: "body",
        keys: ["a", "b", "c"].map((key) => ({
          key,
          selectors: [`shared_${key}`],
        })),
      },
    ];
    const jobs = [0, 1].map((j) =>
      makeJob(
        j,
        [
          {
            name: "body",
            choices: [0, 4, 4].map((value, i) => ({
              key: blocks[0]!.keys[i]!.key,
              values: vector(value),
            })),
          },
          {
            name: "private",
            choices: [0, 1].map((value) => ({
              key: `j${j}_equipment_${value}`,
              values: vector(value),
            })),
          },
        ],
        0,
        [
          plainFood(j),
          {
            key: `j${j}_boost`,
            sharedKey: "boost",
            bonuses: PROJECTION_AXES.map((_, axis) =>
              axis === 1
                ? { numerator: 0, denominator: 1, offset: 1, cap: 1 }
                : null,
            ),
          },
        ],
        (axis, value) =>
          axis === 1 && value !== 0 && !(j === 0 && value === 4) ? -2 : 0,
      ),
    );
    const checked = verify({ blocks, jobs });
    expect(checked.actual.ranks).toBe(1);
    expect(checked.feasible).toHaveLength(1);
    expect(checked.actual.rows.map((emitted) => emitted.name)).toEqual([
      "rank_shared_0",
      "rank_private_0_0",
      "rank_food_0",
      "rank_private_1_0",
      "rank_food_1",
    ]);
    expect(
      checked.actual.rows
        .flatMap((emitted) => [...emitted.terms.keys()])
        .sort(),
    ).toEqual(
      [
        "shared_b",
        "shared_c",
        "j0_equipment_1",
        "j1_equipment_1",
        "j0_boost",
        "j1_boost",
      ].sort(),
    );
  });

  test("a single physical food is used across axes, while foods are independent between jobs", () => {
    const blocks = [
      { name: "body", keys: [{ key: "body", selectors: ["physical_body"] }] },
    ];
    const jobs = [0, 1].map((j) =>
      makeJob(
        j,
        [
          {
            name: "body",
            choices: [{ key: "body", values: [0, 2, 2, 0, 0, 0, 0] }],
          },
        ],
        0,
        [1, 2].map((axis) => ({
          key: `j${j}_food_${axis}`,
          sharedKey: `food_${axis}`,
          bonuses: PROJECTION_AXES.map((_, a) =>
            a === axis
              ? { numerator: 1, denominator: 2, offset: 0, cap: 1 }
              : null,
          ),
        })),
        (axis, value) =>
          axis === 1 || axis === 2 ? (value === 3 ? 0 : -1) : 0,
      ),
    );
    // Combining the best bonus of two different foods would falsely pass rhs=0.
    expect(verify({ blocks, jobs }).actual.closed).toBe(true);
    const relaxed = { blocks, jobs: jobs.map((job) => ({ ...job, rhs: -1 })) };
    const restrictions = [
      row(
        "different_foods_are_allowed_in_relaxation",
        [
          ["j0_main_3", 1],
          ["j1_det_3", 1],
        ],
        "=",
        2,
      ),
    ];
    expect(verify(relaxed, restrictions).feasible).toHaveLength(1);
  });

  test("nonfactor original rows are relaxed, including nonzero physical coefficients", () => {
    const model = irregularModel(-40);
    const impossible = row("physical_impossible", [["body-a_j0", 1]], ">=", 2);
    expect(verify(model, [impossible], false).actual.closed).toBe(false);
    const zeroOutside = row(
      "factor_only_with_zero_outside",
      [["unowned", 0]],
      "<=",
      -1,
    );
    expect(verify(model, [zeroOutside]).actual.closed).toBe(true);
  });

  test("empty feasible domain closes, but an unavailable physical domain declines with ProjectionLimit", () => {
    expect(verify(irregularModel(1)).actual.closed).toBe(true);
    const unavailable = irregularModel(-40);
    unavailable.blocks = [{ name: "empty", keys: [] }];
    expect(referenceRanks(unavailable)).toEqual([]);
    expect(() => projectFixedRanks(unavailable, [], noop)).toThrow(
      ProjectionLimit,
    );
    const noPrivate = irregularModel(-40);
    noPrivate.jobs[0]!.slots = [
      ...noPrivate.jobs[0]!.slots,
      { name: "empty-private", choices: [] },
    ];
    expect(() => projectFixedRanks(noPrivate, [], noop)).toThrow(
      ProjectionLimit,
    );
    const noFood = irregularModel(-40);
    noFood.jobs = noFood.jobs.map((job) => ({ ...job, foods: [] }));
    expect(() => projectFixedRanks(noFood, [], noop)).toThrow(ProjectionLimit);
  });

  test("rank, leaf and Cartesian signature budgets never report truncated closure", () => {
    for (const kind of ["ranks", "leaves", "products"] as const) {
      const count = kind === "ranks" ? 129 : kind === "leaves" ? 6_001 : 142;
      const keys = Array.from(
        { length: kind === "ranks" ? count : 1 },
        (_, i) => ({ key: `body_${i}`, selectors: [`physical_${i}`] }),
      );
      const blocks = [{ name: "body", keys }];
      const jobs = [0, 1].map((j) =>
        makeJob(j, [
          {
            name: "body",
            choices: keys.map((key) => ({ key: key.key, values: zero() })),
          },
          {
            name: "private",
            choices: Array.from(
              { length: kind === "ranks" ? 1 : count },
              (_, i) => ({
                key: `j${j}_private_${i}`,
                values: kind === "products" ? vector(i) : zero(),
              }),
            ),
          },
        ]),
      );
      // Every signature is rejected, but the bounded proof collector must decline.
      const actual = projectFixedRanks(
        { blocks, jobs },
        [row("reject_all", [], "<=", -1)],
        noop,
      );
      expect(actual.closed, kind).toBe(false);
      expect(actual.combinations, kind).toBe(0);
      expect(actual.rows, kind).toEqual([]);
    }
  });

  test("external cancellation is propagated unchanged during preparation and private traversal", () => {
    const model: ProjectionModel = {
      blocks: [
        { name: "body", keys: [{ key: "body", selectors: ["physical_body"] }] },
      ],
      jobs: [0, 1].map((j) =>
        makeJob(j, [
          { name: "body", choices: [{ key: "body", values: zero() }] },
          {
            name: "private",
            choices: Array.from({ length: 130 }, (_, i) => ({
              key: `j${j}_equipment_${i}`,
              values: zero(),
            })),
          },
        ]),
      ),
    };
    let totalChecks = 0;
    projectFixedRanks(model, [], () => {
      totalChecks++;
    });
    expect(totalChecks).toBeGreaterThan(5);
    for (const stop of [1, 5, totalChecks - 2, totalChecks - 1, totalChecks]) {
      const cancellation = new Error(`cancel at check ${stop}`);
      let checks = 0;
      expect(() =>
        projectFixedRanks(model, [], () => {
          if (++checks === stop) throw cancellation;
        }),
      ).toThrow(cancellation);
      expect(checks).toBe(stop);
    }
  });
});
