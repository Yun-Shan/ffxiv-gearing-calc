import { describe, expect, test } from "vitest";
import type { ModelRow } from "../core/model-types.ts";
import type { JointPreparedJob } from "./joint-types.ts";
import type {
  CandidateSpecificUpperBound,
  ResourceBudgetCandidateUpperBound,
} from "./joint-candidate-bounds.ts";
import { createJointCandidateProofs } from "./joint-candidate-proofs.ts";

function fixture() {
  const preparedJobs = [0, 1].map(
    () =>
      ({
        job: {
          baseline: {
            weaponDamage: 1,
            mainStat: 1,
            determination: 1,
            tenacity: 1,
            critical: 1,
            directHit: 1,
            gcdCentiseconds: 1,
          },
        },
        prepared: {
          useDps: false,
          groups: [{ name: "main" }, { name: "crt" }],
        },
      }) as unknown as JointPreparedJob,
  );
  const candidates = {
    candidateSpecificUpperBounds: [50, 60, 70].map(
      (value): CandidateSpecificUpperBound => ({
        variable: `candidate_${value}`,
        rowName: `proof_${value}`,
        ratio: { numerator: BigInt(value), denominator: 100n },
      }),
    ),
    resourceBudgetCandidateUpperBounds:
      [] as ResourceBudgetCandidateUpperBound[],
    resourceBudgetCandidateUpperBoundProofRows: new Map<string, ModelRow>(),
  };
  return {
    candidates,
    proofs: createJointCandidateProofs(preparedJobs, candidates),
  };
}

describe("joint candidate proof rows", () => {
  test("exact equality is sufficient to exclude a candidate from strict improvement, with cached proof rows", () => {
    const { proofs } = fixture();
    const rows: ModelRow[] = [];
    proofs.addCandidateSpecificUpperBoundProofRows(rows, 8n, 5n);
    expect(rows.map(({ name }) => name)).toEqual(["proof_50", "proof_60"]);
    expect(
      rows.every(
        ({ sense, rhs, terms }) =>
          sense === "=" &&
          rhs === 0 &&
          [...terms.values()].every((value) => value === 1),
      ),
    ).toBe(true);
    expect([...proofs.candidateSpecificUpperBoundEqualityRows]).toEqual([
      "proof_60",
    ]);
    const repeated: ModelRow[] = [];
    proofs.addCandidateSpecificUpperBoundProofRows(repeated, 8n, 5n);
    expect(repeated).toEqual(rows);
    expect(proofs.candidateSpecificUpperBoundProofRows.size).toBe(2);
  });

  test.each([
    [0n, 1n],
    [2n, 1n],
    [1n, 1n],
  ] as const)(
    "invalid or unknown factor-score evidence never prunes at threshold %s/%s",
    (numerator, denominator) => {
      const { proofs } = fixture();
      expect(
        proofs.factorScoreUpperCannotBeatThreshold(
          [undefined, undefined],
          numerator,
          denominator,
        ),
      ).toBe(false);
      expect(
        proofs.factorScoreUpperCannotBeatThreshold(
          [-10n],
          numerator,
          denominator,
        ),
      ).toBe(false);
    },
  );

  test("factor-score proof keeps the exact rounding-slack boundary and accepts a strictly smaller upper bound", () => {
    const { proofs } = fixture();
    // Unit baseline scores are zero. Two rounded groups permit two slack units;
    // strict improvement over ratio one adds one, so score -1 remains possible.
    expect(
      proofs.factorScoreUpperCannotBeatThreshold([undefined, -1n], 1n, 1n),
    ).toBe(false);
    expect(
      proofs.factorScoreUpperCannotBeatThreshold([undefined, -2n], 1n, 1n),
    ).toBe(true);
  });

  test("resource proof rows require a strictly insufficient score, and replay without duplicates", () => {
    const { candidates, proofs } = fixture();
    candidates.resourceBudgetCandidateUpperBounds.push(
      ...[98n, 99n].map((scoreUpper) => ({
        jobIndex: 0,
        variable: `resource_${scoreUpper}`,
        rowName: `resource_proof_${scoreUpper}`,
        scoreUpper,
        baselineScore: 100n,
        roundingSlack: 2n,
      })),
    );
    const rows: ModelRow[] = [];
    proofs.addCandidateSpecificUpperBoundProofRows(rows, 2n, 1n);
    expect([
      ...candidates.resourceBudgetCandidateUpperBoundProofRows.keys(),
    ]).toEqual(["resource_proof_98"]);
    const repeated: ModelRow[] = [];
    proofs.addCandidateSpecificUpperBoundProofRows(repeated, 2n, 1n);
    expect(repeated).toEqual(rows);
    expect(rows.some(({ name }) => name === "resource_proof_99")).toBe(false);
  });

  test("a nonpositive necessary individual threshold creates no candidate exclusions", () => {
    const { proofs } = fixture();
    const rows: ModelRow[] = [];
    proofs.addCandidateSpecificUpperBoundProofRows(rows, 1n, 1n);
    expect(rows).toEqual([]);
  });
});
