import { afterEach, describe, expect, test, vi } from "vitest";
import type { JointPreparedJob, JointSearchOptions } from "./joint-types.ts";
import type { SharedKeyDomain } from "./joint-candidate-bounds.ts";
import { createJointSharedBounds } from "./joint-shared-bounds.ts";

function fixture(
  config: {
    domains?: SharedKeyDomain[];
    jobCount?: number;
    budgetMs?: number;
    resourceBounds?: boolean;
    unknown?: boolean;
    cancelled?: () => boolean;
    timedOut?: () => boolean;
  } = {},
) {
  const sharedKeyDomains = config.domains ?? [
    {
      kind: "equipment",
      name: "head",
      selectors: new Map([
        ["a", "head_a"],
        ["b", "head_b"],
      ]),
    },
    {
      kind: "food",
      name: "food",
      selectors: new Map([
        ["f", "food_f"],
        ["g", "food_g"],
      ]),
    },
  ];
  const jobCount = config.jobCount ?? 2;
  // A four-leaf oracle: rows are head a/b, columns are food f/g.
  const scores = [
    [
      [70, 80],
      [90, 100],
    ],
    [
      [80, 90],
      [70, 100],
    ],
  ];
  const coordinateUpperAttributes = vi.fn(
    (jobIndex: number, choices: readonly { key: string }[]) => {
      if (
        config.unknown &&
        config.domains !== undefined &&
        choices.some(({ key }) => key === "0")
      )
        return undefined;
      if (config.domains !== undefined) return [25];
      if (
        config.unknown &&
        jobIndex === 1 &&
        choices.some(({ key }) => key === "a")
      )
        return undefined;
      const heads = choices.some(({ key }) => key === "a")
        ? [0]
        : choices.some(({ key }) => key === "b")
          ? [1]
          : [0, 1];
      const foods = choices.some(({ key }) => key === "f")
        ? [0]
        : choices.some(({ key }) => key === "g")
          ? [1]
          : [0, 1];
      return [
        Math.max(
          ...heads.flatMap((head) =>
            foods.map((food) => scores[jobIndex]![head]![food]!),
          ),
        ),
      ];
    },
  );
  const resourceBudgetScoreUpperForAttributes = vi.fn(
    (_job: number, attributes: readonly number[]) => BigInt(attributes[0]!),
  );
  const factorScoreUpperCannotBeatThreshold = vi.fn(() => false);
  const preparedJobs = Array.from(
    { length: jobCount },
    () => ({}) as JointPreparedJob,
  );
  const bounds = createJointSharedBounds(
    {
      jobs: Array.from(
        { length: jobCount },
        () => ({}) as JointSearchOptions["jobs"][number],
      ),
    },
    preparedJobs,
    {
      sharedEquipmentDomains: sharedKeyDomains
        .filter(({ kind }) => kind === "equipment")
        .map(({ name, selectors }) => ({
          slot: name,
          keys: new Set(selectors.keys()),
          choices: [],
        })),
      sharedEquipmentSelectors: new Map(
        sharedKeyDomains
          .filter(({ kind }) => kind === "equipment")
          .map(({ name, selectors }) => [name, selectors]),
      ),
      sharedFoodSelectors: sharedKeyDomains.find(({ kind }) => kind === "food")
        ?.selectors,
    },
    {
      sharedKeyDomains,
      sharedBoundPreprocessingStartedAt: 0,
      coordinateUpperAttributes,
      exactUpperRatio: (_job, attributes) => ({
        numerator: BigInt(attributes[0]!),
        denominator: 100n,
      }),
      resourceBudgetScoreUpperForAttributes,
      useResourceBudgetSharedPrefixBounds: config.resourceBounds ?? false,
    },
    { factorScoreUpperCannotBeatThreshold },
    {
      jointPreprocessingBudgetBaseMs: config.budgetMs ?? 10_000,
      isCancelled: config.cancelled ?? (() => false),
      jointTimeLimitReached: config.timedOut ?? (() => false),
    },
  );
  return {
    bounds,
    coordinateUpperAttributes,
    resourceBudgetScoreUpperForAttributes,
    factorScoreUpperCannotBeatThreshold,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("shared assignment upper bounds", () => {
  test("enumerates the small complete domain exactly and caches it across incumbents", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const {
      bounds,
      coordinateUpperAttributes,
      resourceBudgetScoreUpperForAttributes,
    } = fixture({ resourceBounds: true });
    bounds.prepareSharedAssignmentUpperBounds(undefined);
    expect(bounds.sharedAssignmentUpperBounds).toBeUndefined();
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 18n,
      denominator: 10n,
    });
    expect(bounds.sharedAssignmentCandidateUpperBound).toBe(4n);
    expect(bounds.sharedAssignmentCandidateCount).toBe(4);
    expect(bounds.sharedAssignmentCandidatesEvaluated).toBe(4);
    expect(bounds.sharedAssignmentPrefixSearchUsed).toBe(false);
    expect(bounds.sharedAssignmentPreprocessingSkipped).toBe(false);
    expect(bounds.sharedAssignmentPrefixChoiceOrder).toBe("input-map-order");
    expect(bounds.sharedAssignmentDomainOrder).toBe(
      "equipment:head> food:food",
    );
    expect(bounds.sharedAssignmentCutPrefixDepthCounts).toEqual({ "2": 4 });
    expect(
      bounds.sharedAssignmentUpperBounds!.map(
        ({ selectors, jobRatios, jobScoreUppers }) => ({
          selectors,
          jobRatios,
          jobScoreUppers,
        }),
      ),
    ).toEqual([
      {
        selectors: ["head_a", "food_f"],
        jobRatios: [
          { numerator: 70n, denominator: 100n },
          { numerator: 80n, denominator: 100n },
        ],
        jobScoreUppers: [70n, 80n],
      },
      {
        selectors: ["head_a", "food_g"],
        jobRatios: [
          { numerator: 80n, denominator: 100n },
          { numerator: 90n, denominator: 100n },
        ],
        jobScoreUppers: [80n, 90n],
      },
      {
        selectors: ["head_b", "food_f"],
        jobRatios: [
          { numerator: 90n, denominator: 100n },
          { numerator: 70n, denominator: 100n },
        ],
        jobScoreUppers: [90n, 70n],
      },
      {
        selectors: ["head_b", "food_g"],
        jobRatios: [
          { numerator: 100n, denominator: 100n },
          { numerator: 100n, denominator: 100n },
        ],
        jobScoreUppers: [100n, 100n],
      },
    ]);
    expect(resourceBudgetScoreUpperForAttributes).toHaveBeenCalledTimes(8);
    const count = coordinateUpperAttributes.mock.calls.length;
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 19n,
      denominator: 10n,
    });
    expect(coordinateUpperAttributes).toHaveBeenCalledTimes(count);
    expect(bounds.sharedAssignmentUpperBounds).toHaveLength(4);
    expect(bounds.sharedAssignmentConflictRows.size).toBe(0);
    expect(bounds.sharedAssignmentResourceScoreConflictRows.size).toBe(0);
  });

  test("filters already non-improving single keys before preparing pair bounds", () => {
    const { bounds, coordinateUpperAttributes } = fixture();
    bounds.prepareSharedPairUpperBounds(0n, 1n);
    expect(bounds.sharedPairUpperBounds).toBeUndefined();
    bounds.prepareSharedPairUpperBounds(18n, 10n);
    expect(bounds.sharedPairCandidateUpperBound).toBe(4n);
    expect(bounds.sharedPairCandidateCount).toBe(1);
    expect(bounds.sharedPairCandidatesEvaluated).toBe(1);
    expect(bounds.sharedPairPreprocessingSkipped).toBe(false);
    expect(bounds.sharedPairUpperBounds).toEqual([
      {
        selectorA: "head_b",
        selectorB: "food_g",
        rowName: "joint_shared_pair_bound_0_1_0",
        jobRatios: [
          { numerator: 100n, denominator: 100n },
          { numerator: 100n, denominator: 100n },
        ],
      },
    ]);
    const count = coordinateUpperAttributes.mock.calls.length;
    bounds.prepareSharedPairUpperBounds(19n, 10n);
    expect(coordinateUpperAttributes).toHaveBeenCalledTimes(count);
    expect(bounds.sharedPairConflictRows.size).toBe(0);
  });

  test("unknown job bounds remain unproved and never become exclusion records", () => {
    const { bounds } = fixture({ unknown: true });
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 1n,
      denominator: 1n,
    });
    expect(
      bounds.sharedAssignmentUpperBounds!.map(({ selectors }) => selectors),
    ).toEqual([
      ["head_b", "food_f"],
      ["head_b", "food_g"],
    ]);
    bounds.prepareSharedPairUpperBounds(1n, 1n);
    expect(bounds.sharedPairCandidateCount).toBe(4);
    expect(bounds.sharedPairCandidatesEvaluated).toBe(4);
    expect(
      bounds.sharedPairUpperBounds!.map(({ selectorA }) => selectorA),
    ).toEqual(["head_b", "head_b"]);
  });

  test("zero preprocessing budget keeps all assignments available", () => {
    const { bounds } = fixture({ budgetMs: 0 });
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 18n,
      denominator: 10n,
    });
    expect(bounds.sharedAssignmentPreprocessingSkipped).toBe(true);
    expect(bounds.sharedAssignmentPrefixesEvaluated).toBe(0);
    expect(bounds.sharedAssignmentUpperBounds).toEqual([]);
  });

  test("cancellation throws and a time budget stops without claiming complete enumeration", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const cancelled = fixture({ cancelled: () => true });
    expect(() =>
      cancelled.bounds.prepareSharedAssignmentUpperBounds({
        numerator: 1n,
        denominator: 1n,
      }),
    ).toThrow(/取消/);
    const timedOut = fixture({ timedOut: () => true });
    timedOut.bounds.prepareSharedAssignmentUpperBounds({
      numerator: 1n,
      denominator: 1n,
    });
    expect(timedOut.bounds.sharedAssignmentPreprocessingSkipped).toBe(true);
    expect(timedOut.bounds.sharedAssignmentCandidatesEvaluated).toBeLessThan(4);
  });

  test("large multi-job domains record safe prefixes once per incumbent", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const domains: SharedKeyDomain[] = ["head", "body"].map((name) => ({
      kind: "equipment",
      name,
      selectors: new Map(
        Array.from({ length: 142 }, (_, i) => [`${i}`, `${name}_${i}`]),
      ),
    }));
    const { bounds, coordinateUpperAttributes } = fixture({
      domains,
      jobCount: 4,
      resourceBounds: true,
    });
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 3n,
      denominator: 1n,
    });
    expect(bounds.sharedAssignmentCandidateUpperBound).toBe(20_164n);
    expect(bounds.sharedAssignmentPrefixSearchUsed).toBe(true);
    expect(bounds.sharedAssignmentPreprocessingSkipped).toBe(true);
    expect(bounds.sharedAssignmentPrefixChoiceOrder).toBe(
      "ascending-exact-capped-single-key-ratio-sum-stable",
    );
    expect(bounds.sharedAssignmentUpperBounds).toHaveLength(142);
    expect(bounds.sharedAssignmentPrefixesEvaluated).toBe(142);
    expect(bounds.sharedAssignmentCandidatesEvaluated).toBe(0);
    expect(bounds.sharedAssignmentCutPrefixDepthCounts).toEqual({ "1": 142 });
    expect(bounds.sharedAssignmentUpperBounds![0]!.selectors).toEqual([
      "head_0",
    ]);
    expect(bounds.sharedAssignmentUpperBounds![0]!.jobScoreUppers).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // Every completion has four ratios 1/4, so these prefixes cannot beat 3.
    expect(
      bounds.sharedAssignmentUpperBounds!.every(({ jobRatios }) =>
        jobRatios.every(
          ({ numerator, denominator }) => numerator * 4n === denominator,
        ),
      ),
    ).toBe(true);
    const count = coordinateUpperAttributes.mock.calls.length;
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 3n,
      denominator: 1n,
    });
    expect(coordinateUpperAttributes).toHaveBeenCalledTimes(count);
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 7n,
      denominator: 2n,
    });
    expect(bounds.sharedAssignmentUpperBounds).toHaveLength(142);
  });

  test("oversized pair and two-job assignment domains skip optional preparation", () => {
    const domains: SharedKeyDomain[] = ["head", "body"].map((name) => ({
      kind: "equipment",
      name,
      selectors: new Map(
        Array.from({ length: 1001 }, (_, i) => [`${i}`, `${name}_${i}`]),
      ),
    }));
    const { bounds } = fixture({ domains });
    bounds.prepareSharedPairUpperBounds(1n, 10n);
    expect(bounds.sharedPairCandidateCount).toBe(1_002_001);
    expect(bounds.sharedPairPreprocessingSkipped).toBe(true);
    expect(bounds.sharedPairUpperBounds).toEqual([]);
    expect(bounds.sharedPairCandidatesEvaluated).toBe(0);
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 1n,
      denominator: 10n,
    });
    expect(bounds.sharedAssignmentPreprocessingSkipped).toBe(true);
    expect(bounds.sharedAssignmentUpperBounds).toBeUndefined();
  });

  test("unknown large-domain prefixes are explored without ever being marked non-improving", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const domains: SharedKeyDomain[] = ["head", "body"].map((name) => ({
      kind: "equipment",
      name,
      selectors: new Map(
        Array.from({ length: 142 }, (_, i) => [`${i}`, `${name}_${i}`]),
      ),
    }));
    const { bounds } = fixture({ domains, jobCount: 4, unknown: true });
    bounds.prepareSharedAssignmentUpperBounds({
      numerator: 3n,
      denominator: 1n,
    });
    expect(bounds.sharedAssignmentCandidatesEvaluated).toBe(142);
    expect(bounds.sharedAssignmentUpperBounds).toHaveLength(141);
    expect(bounds.sharedAssignmentUpperBounds![0]!.selectors).toEqual([
      "head_1",
    ]);
    expect(
      bounds.sharedAssignmentUpperBounds!.every(
        ({ selectors }) => !selectors.includes("head_0"),
      ),
    ).toBe(true);
  });
});
