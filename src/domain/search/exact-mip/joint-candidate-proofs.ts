import type { ModelRow } from "../core/model-types.ts";
import { factorObjectiveLogScore } from "./factor-model.ts";
import { strictLogThresholdLoss } from "../core/exact-arithmetic.ts";
import { candidateUpperBoundCannotImproveJointIncumbent } from "../joint-candidate-upper-bound.ts";

import type { JointPreparedJob } from "./joint-types.ts";
import type { JointCandidateBounds } from "./joint-candidate-bounds.ts";

export function createJointCandidateProofs(
  preparedJobs: readonly JointPreparedJob[],
  candidates: Pick<
    JointCandidateBounds,
    | "candidateSpecificUpperBounds"
    | "resourceBudgetCandidateUpperBounds"
    | "resourceBudgetCandidateUpperBoundProofRows"
  >,
) {
  const {
    candidateSpecificUpperBounds,
    resourceBudgetCandidateUpperBounds,
    resourceBudgetCandidateUpperBoundProofRows,
  } = candidates;
  const baselineFactorScores = preparedJobs.map(({ job, prepared }) =>
    BigInt(factorObjectiveLogScore(job.baseline, prepared.useDps)),
  );
  const factorScoreUpperCannotBeatThreshold = (
    scoreUppers: readonly (bigint | undefined)[],
    numerator: bigint,
    denominator: bigint,
  ): boolean => {
    if (
      numerator <= 0n ||
      numerator > denominator ||
      scoreUppers.length !== preparedJobs.length
    )
      return false;
    const loss = strictLogThresholdLoss(numerator, denominator);
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const scoreUpper = scoreUppers[jobIndex];
      if (scoreUpper === undefined) continue;
      const roundingSlack = BigInt(
        preparedJobs[jobIndex]!.prepared.groups.length,
      );
      // 比值严格高于阈值时，整数对数得分必须达到此值；
      // 每组因子的对数取最近整数后，候选与基线之间最多产生一个单位的松弛。
      const requiredScore =
        baselineFactorScores[jobIndex]! - roundingSlack - loss;
      if (scoreUpper < requiredScore) return true;
    }
    return false;
  };
  const candidateSpecificUpperBoundProofRows = new Map<string, ModelRow>();
  const candidateSpecificUpperBoundEqualityRows = new Set<string>();
  const addCandidateSpecificUpperBoundProofRows = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    const incumbent = {
      numerator: incumbentNumerator,
      denominator: incumbentDenominator,
    };
    const thresholdNumerator =
      incumbentNumerator -
      BigInt(preparedJobs.length - 1) * incumbentDenominator;
    for (const upperBound of candidateSpecificUpperBounds) {
      if (
        candidateSpecificUpperBoundProofRows.has(upperBound.rowName) ||
        !candidateUpperBoundCannotImproveJointIncumbent(
          upperBound.ratio,
          incumbent,
          preparedJobs.length,
        )
      )
        continue;
      candidateSpecificUpperBoundProofRows.set(upperBound.rowName, {
        name: upperBound.rowName,
        terms: new Map([[upperBound.variable, 1]]),
        sense: "=",
        rhs: 0,
      });
      if (
        thresholdNumerator > 0n &&
        upperBound.ratio.numerator * incumbentDenominator ===
          upperBound.ratio.denominator * thresholdNumerator
      ) {
        candidateSpecificUpperBoundEqualityRows.add(upperBound.rowName);
      }
    }
    solveRows.push(...candidateSpecificUpperBoundProofRows.values());
    if (thresholdNumerator > 0n) {
      const loss = strictLogThresholdLoss(
        thresholdNumerator,
        incumbentDenominator,
      );
      for (const upperBound of resourceBudgetCandidateUpperBounds) {
        const requiredScore =
          upperBound.baselineScore - upperBound.roundingSlack - loss;
        if (
          upperBound.scoreUpper >= requiredScore ||
          resourceBudgetCandidateUpperBoundProofRows.has(upperBound.rowName)
        )
          continue;
        resourceBudgetCandidateUpperBoundProofRows.set(upperBound.rowName, {
          name: upperBound.rowName,
          terms: new Map([[upperBound.variable, 1]]),
          sense: "=",
          rhs: 0,
        });
      }
    }
    solveRows.push(...resourceBudgetCandidateUpperBoundProofRows.values());
  };
  return {
    get factorScoreUpperCannotBeatThreshold() {
      return factorScoreUpperCannotBeatThreshold;
    },
    get candidateSpecificUpperBoundProofRows() {
      return candidateSpecificUpperBoundProofRows;
    },
    get candidateSpecificUpperBoundEqualityRows() {
      return candidateSpecificUpperBoundEqualityRows;
    },
    get addCandidateSpecificUpperBoundProofRows() {
      return addCandidateSpecificUpperBoundProofRows;
    },
  };
}
