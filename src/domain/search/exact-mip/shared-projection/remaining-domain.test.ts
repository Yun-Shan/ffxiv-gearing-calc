import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LinearMipRow } from "../../linear-mip.ts";
import {
  SEARCH_STRATEGY_IDS,
  type SearchStrategies,
  type SearchStrategyId,
} from "../../strategies.ts";
import type { JointModel } from "../joint-model.ts";
import type { JointIncumbent } from "../joint-results.ts";
import type { JointPreparedJob, JointSearchOptions } from "../joint-types.ts";
import { prepareProjectionModel } from "./model.ts";
import {
  canProjectSharedDomain,
  projectRemainingDomain,
} from "./remaining-domain.ts";
import {
  PROJECTION_AXES,
  ProjectionLimit,
  type ProjectionModel,
} from "./types.ts";

// Replace model preparation here to exercise the solver with controlled domains.
// model.test.ts owns extraction, physical identity and unsupported-input tests.
vi.mock("./model.ts", () => ({ prepareProjectionModel: vi.fn() }));
const prepare = vi.mocked(prepareProjectionModel);
const noop = () => {};
const originalRow = (name: string, rhs = 0): LinearMipRow => ({
  name,
  terms: new Map(),
  sense: ">=",
  rhs,
});

function domain(): ProjectionModel {
  return {
    blocks: [
      {
        name: "body",
        keys: ["a", "b"].map((key) => ({ key, selectors: [`shared_${key}`] })),
      },
    ],
    jobs: [0, 1].map((j) => ({
      slots: [
        {
          name: "body",
          choices: ["a", "b"].map((key, value) => ({
            key,
            values: [0, value, 0, 0, 0, 0, 0],
          })),
        },
        {
          name: "private",
          choices: [0, 1].map((value) => ({
            key: `j${j}_equipment_${value}`,
            values: [0, value, 0, 0, 0, 0, 0],
          })),
        },
      ],
      foods: [
        {
          key: `j${j}_food`,
          sharedKey: "food",
          bonuses: PROJECTION_AXES.map(() => null),
        },
      ],
      axes: PROJECTION_AXES.map((name, axis) => ({
        name,
        rawMin: 0,
        rawMax: axis === 1 ? 2 : 0,
        classes: Array.from({ length: axis === 1 ? 3 : 1 }, (_, value) => ({
          min: value,
          max: value,
          value: 100 + value,
          q: -value,
          selector: `j${j}_${name}_${value}`,
        })),
      })),
      rhs: -2,
    })),
  };
}

function fixture(count = 2) {
  // These opaque prepared inputs are passed by identity into the replaced
  // extraction boundary; the orchestrator only reads their count on this path.
  const jobs = Array.from({ length: count }, () => ({}) as JointPreparedJob);
  const options: JointSearchOptions = {
    jobs: jobs.map((job) => job.job),
    commonSlots: ["body"],
    sharedFood: false,
    objective: "damage",
    equipmentIdentity: (equipment) => equipment.key,
    foodIdentity: (food) => food.key,
  };
  const model = { sharedEquipmentDomains: [{}] } as unknown as JointModel;
  const lowerBounds = jobs.map((_, j) =>
    originalRow(`joint_necessary_job_${j}`, -2),
  );
  const best: JointIncumbent = { numerator: 1n, denominator: 1n, results: [] };
  const run = (
    restrictions: readonly LinearMipRow[] = [],
    budget = 1_000,
    check = noop,
  ) =>
    projectRemainingDomain(
      options,
      jobs,
      model,
      lowerBounds,
      restrictions,
      best,
      budget,
      check,
    );
  return { options, jobs, model, lowerBounds, best, run };
}

// The gate intentionally depends on seven mathematical support policies.
// The other eleven retain their own candidate, representation, hint and reuse
// policies. In particular equalityQuotient off must not disable this projector.
const expectedDependency: Record<SearchStrategyId, boolean> = {
  candidateDominance: false,
  factorReachability: true,
  speedFoodProjection: true,
  foodProductBound: false,
  candidateUpperBound: false,
  resourceSupports: true,
  conditionalResourceSupports: true,
  resourceBudgetCandidateBounds: false,
  sharedStateSearch: true,
  utilityEquivalence: false,
  materiaFamilyProjection: false,
  equalityQuotient: false,
  jointRatioPairBounds: false,
  jointSharedBounds: true,
  jointFactorCuts: true,
  ringSymmetry: false,
  feasibleSeeds: false,
  restrictedResultReuse: false,
};

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(100);
  prepare
    .mockReset()
    .mockImplementation((_options, _jobs, _model, _rows, check) => {
      check();
      return domain();
    });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared physical-domain strategy selection", () => {
  test("the explicit policy table covers exactly the eighteen public strategies", () => {
    expect(SEARCH_STRATEGY_IDS).toHaveLength(18);
    expect(Object.keys(expectedDependency).sort()).toEqual(
      [...SEARCH_STRATEGY_IDS].sort(),
    );
    expect(canProjectSharedDomain()).toBe(true);
    expect(canProjectSharedDomain({})).toBe(true);
  });

  test.each(SEARCH_STRATEGY_IDS)(
    "%s: auto/on retain eligibility; off follows its actual shared-domain dependency",
    (id) => {
      const required = expectedDependency[id];
      for (const mode of ["auto", "on", "off"] as const) {
        const strategies: SearchStrategies = { [id]: mode };
        expect(canProjectSharedDomain(strategies)).toBe(
          mode !== "off" || !required,
        );
      }
      const f = fixture();
      f.options.strategies = { [id]: "off" };
      const result = f.run();
      if (required) {
        expect(result).toBeUndefined();
        expect(prepare).not.toHaveBeenCalled();
      } else {
        expect(result?.route).toBe("fixed-ten-ranks");
        expect(result?.closed).toBe(false);
        expect(prepare).toHaveBeenCalledTimes(1);
      }
    },
  );

  test.each(SEARCH_STRATEGY_IDS.filter((id) => expectedDependency[id]))(
    "%s off cannot be restarted by other strategies on",
    (parent) => {
      const strategies = Object.fromEntries(
        SEARCH_STRATEGY_IDS.map((id) => [id, "on"]),
      ) as Record<SearchStrategyId, "on" | "off">;
      strategies[parent] = "off";
      expect(canProjectSharedDomain(strategies)).toBe(false);
      const f = fixture();
      f.options.strategies = strategies;
      expect(f.run()).toBeUndefined();
      expect(prepare).not.toHaveBeenCalled();
    },
  );
});

describe("remaining-domain fixed-rank orchestration", () => {
  test("uses only this iteration's exact rows and never carries closure across an incumbent change", () => {
    const f = fixture();
    const reject = [originalRow("reject_all", 1)];
    const allow = [originalRow("allow_all", 0)];
    const before = structuredClone({ rows: f.lowerBounds, best: f.best });
    const first = f.run(reject)!;
    expect(first.closed).toBe(true);
    expect(first.route).toBe("fixed-ten-ranks");
    expect(first.details.ranks).toBe(2);
    // The same physical domain now has surviving signatures under the new row.
    f.best.numerator = 2n;
    const second = f.run(allow)!;
    expect(second.closed).toBe(false);
    expect(f.run(reject)?.closed).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(3);
    for (const call of prepare.mock.calls) {
      expect(call[0]).toBe(f.options);
      expect(call[1]).toBe(f.jobs);
      expect(call[2]).toBe(f.model);
      expect(call[3]).toBe(f.lowerBounds);
    }
    expect(f.lowerBounds).toEqual(before.rows);
    expect(f.best).toEqual({ ...before.best, numerator: 2n });
    expect(Object.keys(second).sort()).toEqual(
      ["route", "closed", "rows", "details"].sort(),
    );
    expect(f.options.initialResults).toBeUndefined();
  });

  test("shared-domain absence, unsupported preparation and incomplete lower bounds decline without closure", () => {
    const absent = fixture();
    absent.model.sharedEquipmentDomains.splice(0);
    expect(absent.run()).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    const missing = fixture();
    missing.lowerBounds.pop();
    expect(missing.run()).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockReturnValueOnce(undefined);
    expect(fixture().run()).toBeUndefined();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  test("invalid job counts and sub-millisecond budgets skip projection", () => {
    for (const count of [0, 1, 17])
      expect(fixture(count).run()).toBeUndefined();
    for (const budget of [-1, 0, 0.999])
      expect(fixture().run([], budget)).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    expect(fixture().run([], 1)?.closed).toBe(false);
  });

  test("local budget expiration and ProjectionLimit return no partial proof or candidate rows", () => {
    vi.mocked(performance.now).mockReturnValueOnce(100).mockReturnValue(101);
    expect(fixture().run([], 1)).toBeUndefined();
    vi.mocked(performance.now).mockReturnValue(100);
    prepare.mockImplementationOnce(() => {
      throw new ProjectionLimit("model work budget");
    });
    expect(fixture().run()).toBeUndefined();
    // Even a much larger external allowance cannot extend the fixed-rank local cap.
    prepare.mockImplementationOnce(() => domain());
    vi.mocked(performance.now).mockReturnValueOnce(100).mockReturnValue(20_100);
    expect(fixture().run([], 1_000_000)).toBeUndefined();
  });

  test("external cancellation and deadlines propagate unchanged, including during local-limit recovery", () => {
    for (const message of ["caller cancellation", "caller search deadline"]) {
      const stopped = new Error(message);
      expect(() =>
        fixture().run([], 1_000, () => {
          throw stopped;
        }),
      ).toThrow(stopped);
      expect(prepare).not.toHaveBeenCalled();
      prepare.mockImplementationOnce(
        (_options, _jobs, _model, _rows, check) => {
          check();
          return domain();
        },
      );
      let checks = 0;
      expect(() =>
        fixture().run([], 1_000, () => {
          if (++checks >= 2) throw stopped;
        }),
      ).toThrow(stopped);
      prepare.mockClear();
      prepare.mockImplementationOnce(() => {
        throw new ProjectionLimit("local limit while cancellation arrives");
      });
      checks = 0;
      expect(() =>
        fixture().run([], 1_000, () => {
          if (++checks >= 2) throw stopped;
        }),
      ).toThrow(stopped);
      prepare.mockClear();
    }
  });

  test("unexpected preparation errors are never reclassified as completed or unsupported", () => {
    const error = new Error("invalid owning model");
    prepare.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => fixture().run()).toThrow(error);
  });

  test("variable tenacity requires its own certified route and cannot borrow a fixed-rank conclusion", () => {
    const variable = domain();
    variable.jobs = variable.jobs.map((job) => ({
      ...job,
      axes: job.axes.map((axis, a) =>
        a === 3 ? { ...axis, rawMax: 1 } : axis,
      ),
    }));
    prepare.mockReturnValue(variable);
    const independentFood = fixture();
    expect(independentFood.run([originalRow("aggregate", 0)])).toBeUndefined();
    const dps = fixture();
    dps.options.sharedFood = true;
    dps.options.objective = "dps";
    expect(dps.run([originalRow("aggregate", 0)])).toBeUndefined();
    const unmatched = fixture();
    unmatched.options.sharedFood = true;
    const wrong = {
      ...originalRow("different_coefficients", 0),
      terms: new Map([["unowned", 1]]),
    };
    expect(unmatched.run([wrong])).toBeUndefined();
  });

  test("a swallowed one-shot cancellation is sticky at the next projection checkpoint", () => {
    // Sol high upgrade: remaining-domain.ts:60 must replay the original failure,
    // rather than let an optional component swallow a single cancellation pulse.
    const stopped = new ProjectionLimit("one-shot caller cancellation");
    let checks = 0;
    prepare.mockImplementationOnce((_options, _jobs, _model, _rows, check) => {
      try { check(); } catch { /* Simulate an optional preparation fallback. */ }
      check();
      return domain();
    });
    expect(() => fixture().run([], 1_000, () => {
      if (++checks === 2) throw stopped;
    })).toThrow(stopped);
    expect(checks).toBe(2);
  });

  test("shared-food variable projection checks exact aggregate coefficients and the existence of an original product row", () => {
    const f = variableFixture();
    expect(f.run([])).toBeUndefined();
    const changed = { ...f.aggregate, terms: new Map(f.aggregate.terms) };
    const first = changed.terms.keys().next().value!;
    changed.terms.set(first, 1);
    expect(changed.terms.size).toBe(f.aggregate.terms.size);
    expect(f.run([changed])).toBeUndefined();
    expect(f.run([f.aggregate])?.route).toBe("shared-attributes");
  });

  test("a genuine variable-domain survivor remains open, equality closes, and an expiring final check discards closure", () => {
    const f = variableFixture();
    // Two jobs, each with all six integer factor values equal to one and an
    // independent denominator of one: every physical tuple has exact score 2.
    f.best.numerator = 1n;
    const surviving = f.run([f.aggregate])!;
    expect(surviving.route).toBe("shared-attributes");
    expect(surviving.closed).toBe(false);
    expect(surviving.rows).toEqual([]);
    expect(new Set(String(surviving.details.axes).split(",")).size).toBe(3);
    f.best.numerator = 2n;
    let completeChecks = 0;
    expect(f.run([f.aggregate], 1_000, () => { completeChecks++; })?.closed).toBe(true);
    expect(completeChecks).toBeGreaterThan(3);
    let checks = 0;
    expect(f.run([f.aggregate], 1_000, () => {
      if (++checks === completeChecks) vi.mocked(performance.now).mockReturnValue(1_100);
    })).toBeUndefined();
    expect(checks).toBeGreaterThanOrEqual(completeChecks);
  });
});

function variableFixture() {
  const f = fixture();
  f.options.sharedFood = true;
  const variable = domain();
  variable.jobs = variable.jobs.map((job, j) => ({
    ...job,
    slots: [
      { name: "body", choices: ["a", "b"].map((key, ten) => ({ key, values: [0, 0, 0, ten, 0, 0, 0] })) },
      { name: "weapon", choices: [{ key: `j${j}_weapon`, values: [1, 0, 0, 0, 0, 0, 0] }] },
    ],
    axes: PROJECTION_AXES.map((name, axis) => ({
      name, rawMin: axis === 0 ? 1 : 0, rawMax: axis === 0 || axis === 3 ? 1 : 0,
      classes: Array.from({ length: axis === 0 || axis === 3 ? 2 : 1 }, (_, value) => ({
        min: value, max: value, value: 1, q: 0, selector: `j${j}_${name}_${value}`,
      })),
    })),
    rhs: 0,
    speedRanges: [{ min: 0, max: 0 }],
  }));
  variable.jobs.forEach((job, j) => {
    f.jobs[j].job = { baseline: {
      weaponDamage: 1, mainStat: 1, determination: 1, tenacity: 1, critical: 1, directHit: 1,
      traitMultiplier: 1, gcdCentiseconds: 250,
    } } as JointPreparedJob["job"];
    f.lowerBounds[j] = {
      ...originalRow(`joint_necessary_job_${j}`),
      terms: new Map(job.axes.flatMap(axis => axis.classes.map(cls => [cls.selector, cls.q] as const))),
    };
  });
  prepare.mockReturnValue(variable);
  const aggregate = { ...originalRow("joint_necessary_product"), terms: new Map(f.lowerBounds.flatMap(row => [...row.terms])) };
  return { ...f, aggregate };
}
