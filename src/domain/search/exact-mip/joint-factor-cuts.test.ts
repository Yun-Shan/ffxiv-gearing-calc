import { describe, expect, test } from "vitest";
import type { ModelRow } from "../core/model-types.ts";
import { createJointFactorCuts } from "./joint-factor-cuts.ts";
import {
  factorDomain,
  factorAssignments,
  rowSatisfied,
} from "./joint-factor-domain.helper.test.ts";

function fixture(
  jobCount = 2,
  names?: string[],
  config: {
    objective?: "damage" | "dps";
    values?: number[];
    cancelled?: () => boolean;
    timedOut?: () => boolean;
  } = {},
) {
  const domain = factorDomain(jobCount, names, config.values);
  const scale = 1_000_000_000n;
  const cuts = createJointFactorCuts(
    { objective: config.objective ?? "dps" },
    domain.preparedJobs,
    { bounds: [], prefix: domain.prefix },
    domain.candidates,
    {
      ratioUpperBoundVariables: domain.preparedJobs.map(
        (_, index) => `ratio_${index}`,
      ),
      ratioUpperBoundScale: scale,
      ratioUpperCoefficientExact: ({ numerator, denominator }) =>
        (numerator * scale + denominator - 1n) / denominator,
    },
    {
      isCancelled: config.cancelled ?? (() => false),
      jointTimeLimitReached: config.timedOut ?? (() => false),
    },
  );
  return { domain, cuts };
}

describe("dynamic factor cuts", () => {
  test("within-job pair and triple cuts preserve every improving point of a 729-point integer domain", () => {
    const { domain, cuts } = fixture();
    const rows: ModelRow[] = [];
    cuts.addTwoJobWithinJobFactorPairCuts(rows, 8n, 5n);
    cuts.addTwoJobWithinJobFactorTripleCuts(rows, 8n, 5n);
    expect(cuts.factorClassJointPairConflictRows.size).toBeGreaterThan(0);
    expect(cuts.factorClassJointTripleConflictRows.size).toBeGreaterThan(0);
    const points = factorAssignments(domain);
    expect(points).toHaveLength(729);
    const improving = points.filter(
      ({ scores }) => (scores[0]! + scores[1]!) * 5n > 8n * 100n ** 3n,
    );
    expect(improving.length).toBeGreaterThan(0);
    for (const { selected } of improving)
      expect(rows.every((row) => rowSatisfied(row, selected))).toBe(true);
    expect(
      points.some(({ selected }) =>
        rows.some((row) => !rowSatisfied(row, selected)),
      ),
    ).toBe(true);
    const replayed: ModelRow[] = [];
    cuts.addTwoJobWithinJobFactorPairCuts(replayed, 8n, 5n);
    cuts.addTwoJobWithinJobFactorTripleCuts(replayed, 8n, 5n);
    expect(replayed).toEqual(rows);
  });

  test("cross-job pair and triple rows preserve all strictly improving ratio sums", () => {
    const { domain, cuts } = fixture(3, ["crt"]);
    const rows: ModelRow[] = [];
    cuts.addCrossJobFactorClassGroupPairCuts(rows, 5n, 2n);
    cuts.addCrossJobFactorClassGroupTripleCuts(rows, 5n, 2n);
    expect(cuts.factorClassPairConflictRows.size).toBeGreaterThan(0);
    expect(cuts.factorClassTripleConflictRows.size).toBeGreaterThan(0);
    expect(cuts.factorClassTriplePreprocessingWork).toBeGreaterThan(0);
    expect(cuts.factorClassTriplePreprocessingSkipped).toBe(false);
    const points = factorAssignments(domain);
    expect(points).toHaveLength(27);
    for (const { selected, scores } of points) {
      if (scores.reduce((sum, score) => sum + score, 0n) * 2n > 500n) {
        expect(rows.every((row) => rowSatisfied(row, selected))).toBe(true);
      }
    }
    expect(
      points.some(({ selected }) =>
        rows.some((row) => !rowSatisfied(row, selected)),
      ),
    ).toBe(true);
    const replayed: ModelRow[] = [];
    cuts.addCrossJobFactorClassGroupTripleCuts(replayed, 5n, 2n);
    expect(replayed).toEqual(
      rows.filter(({ name }) => name.includes("triple")),
    );
  });

  test("necessary ratio rows retain every improving grid point, including strict integer boundaries", () => {
    const { cuts } = fixture(3, ["crt"]);
    const rows: ModelRow[] = [];
    cuts.addRatioUpperNecessaryCuts(rows, 23n, 10n);
    expect(rows).toHaveLength(7);
    expect(
      rows.find(({ name }) => name === "joint_necessary_ratio_sum_0")!.rhs,
    ).toBe(300_000_001);
    expect(
      rows.find(({ name }) => name === "joint_necessary_ratio_sum_0_1_2")!.rhs,
    ).toBe(2_300_000_001);
    for (let first = 0; first <= 10; first++)
      for (let second = 0; second <= 10; second++)
        for (let third = 0; third <= 10; third++) {
          if (first + second + third <= 23) continue;
          const point = new Map([
            ["ratio_0", first * 100_000_000],
            ["ratio_1", second * 100_000_000],
            ["ratio_2", third * 100_000_000],
          ]);
          expect(rows.every((row) => rowSatisfied(row, point))).toBe(true);
        }
    expect(cuts.ratioUpperNecessaryRows.size).toBe(7);
    const skipped: ModelRow[] = [];
    cuts.addRatioUpperNecessaryCuts(skipped, 0n, 1n);
    cuts.addRatioUpperNecessaryCuts(
      skipped,
      BigInt(Number.MAX_SAFE_INTEGER),
      1n,
    );
    expect(skipped).toEqual([]);
  });

  test.each(["incomplete", "unequal-envelopes", "zero-envelope"] as const)(
    "leaves within-job factors available when a product-envelope premise is missing: %s",
    (reason) => {
      const { domain, cuts } = fixture();
      for (const groups of domain.candidates
        .factorClassUpperBoundsByJobAndGroup) {
        if (reason === "incomplete") groups.get("crt")!.pop();
        if (reason === "unequal-envelopes")
          groups.get("crt")![2]!.ratio.numerator = 110n;
        if (reason === "zero-envelope")
          for (const group of groups.values())
            for (const bound of group) bound.ratio.numerator = 0n;
      }
      const rows: ModelRow[] = [];
      cuts.addTwoJobWithinJobFactorPairCuts(rows, 8n, 5n);
      cuts.addTwoJobWithinJobFactorTripleCuts(rows, 8n, 5n);
      expect(rows).toEqual([]);
    },
  );

  test("nonpositive thresholds and unsupported job counts add no exclusion", () => {
    const rows: ModelRow[] = [];
    const solo = fixture(1).cuts;
    solo.addCrossJobFactorClassGroupPairCuts(rows, 1n, 1n);
    solo.addCrossJobFactorClassGroupTripleCuts(rows, 1n, 1n);
    solo.addTwoJobWithinJobFactorPairCuts(rows, 1n, 1n);
    solo.addTwoJobWithinJobFactorTripleCuts(rows, 1n, 1n);
    const duo = fixture().cuts;
    duo.addTwoJobWithinJobFactorPairCuts(rows, 1n, 1n);
    duo.addTwoJobWithinJobFactorTripleCuts(rows, 1n, 1n);
    duo.addCrossJobFactorClassGroupPairCuts(rows, 0n, 1n);
    fixture(3).cuts.addCrossJobFactorClassGroupTripleCuts(rows, 0n, 1n);
    expect(rows).toEqual([]);
  });

  test.each(["damage", "dps"] as const)(
    "uses the GCD group only for the %s objective when deriving product cuts",
    (objective) => {
      const { cuts } = fixture(2, ["crt", "det", "gcd"], { objective });
      const rows: ModelRow[] = [];
      cuts.addTwoJobWithinJobFactorPairCuts(rows, 8n, 5n);
      cuts.addTwoJobWithinJobFactorTripleCuts(rows, 8n, 5n);
      const includesGcd = rows.some(({ terms }) =>
        [...terms.keys()].some((key) => key.includes("gcd")),
      );
      expect(includesGcd).toBe(objective === "dps");
    },
  );

  test("cross-job preprocessing respects cancellation and preserves the budget stop state", () => {
    // A single group crosses the periodic 256-work cancellation boundary before any row can be emitted.
    const values = Array.from({ length: 256 }, () => 70);
    const cancelled = fixture(3, ["crt"], { values, cancelled: () => true });
    expect(() =>
      cancelled.cuts.addCrossJobFactorClassGroupTripleCuts([], 5n, 2n),
    ).toThrow(/取消/);
    const timedOut = fixture(3, ["crt"], { values, timedOut: () => true });
    const rows: ModelRow[] = [];
    timedOut.cuts.addCrossJobFactorClassGroupTripleCuts(rows, 5n, 2n);
    expect(timedOut.cuts.factorClassTriplePreprocessingSkipped).toBe(true);
    expect(rows).toEqual([]);
    const work = timedOut.cuts.factorClassTriplePreprocessingWork;
    timedOut.cuts.addCrossJobFactorClassGroupTripleCuts(rows, 13n, 5n);
    expect(timedOut.cuts.factorClassTriplePreprocessingWork).toBe(work);
    expect(rows).toEqual([]);
  });
});
