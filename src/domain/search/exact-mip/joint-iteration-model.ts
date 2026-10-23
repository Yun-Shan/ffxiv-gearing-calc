import type { JointSearchOptions } from "./joint-types.ts";
import type { createJointCandidateProofs } from "./joint-candidate-proofs.ts";
import type { createJointSharedBounds } from "./joint-shared-bounds.ts";
import type { createJointFactorCuts } from "./joint-factor-cuts.ts";
import {
  cannotBeatThreshold,
  ratioAtOrBelowThreshold,
  ratioSumAtOrBelowThreshold,
} from "./joint-arithmetic.ts";
import { addRows } from "../core/model-builder.ts";
import { strictLogThresholdLoss } from "../core/exact-arithmetic.ts";

import type { JointModel } from "./joint-model.ts";
import type { JointCandidateBounds } from "./joint-candidate-bounds.ts";
import type { JointIncumbent } from "./joint-results.ts";

export function buildJointIterationRows(
  options: Pick<JointSearchOptions, "jobs">,
  model: Pick<
    JointModel,
    | "rows"
    | "objective"
    | "jobSurrogates"
    | "baselineQ"
    | "maximumOffset"
    | "prefix"
  >,
  candidates: Pick<JointCandidateBounds, "factorClassUpperBounds">,
  proofs: ReturnType<typeof createJointCandidateProofs>,
  sharedBounds: ReturnType<typeof createJointSharedBounds>,
  factorCuts: ReturnType<typeof createJointFactorCuts>,
  groupCount: number,
  best: JointIncumbent | undefined,
  excluded: readonly (readonly string[])[],
) {
  const { rows, objective, jobSurrogates, baselineQ, maximumOffset, prefix } =
    model;
  const { factorClassUpperBounds } = candidates;
  const {
    addCandidateSpecificUpperBoundProofRows,
    factorScoreUpperCannotBeatThreshold,
  } = proofs;
  const solveRows = [...rows];
  if (best !== undefined) {
    const thresholdNumerator =
      best.numerator - BigInt(options.jobs.length - 1) * best.denominator;
    if (thresholdNumerator > 0n) {
      const loss = strictLogThresholdLoss(thresholdNumerator, best.denominator);
      const minimumQ = BigInt(baselineQ) - loss - BigInt(groupCount);
      const rhs = minimumQ - BigInt(maximumOffset);
      if (
        rhs >= BigInt(Number.MIN_SAFE_INTEGER) &&
        rhs <= BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        addRows(
          solveRows,
          "joint_necessary_product",
          objective,
          ">=",
          Number(rhs),
        );
      }
      for (let index = 0; index < jobSurrogates.length; index++) {
        const surrogate = jobSurrogates[index]!;
        // 要使总和超过当前最优值且其他比值均不超过 1，还要求每个比值都大于 t。
        const individualRhs =
          BigInt(surrogate.baseline - surrogate.offset - surrogate.error) -
          loss;
        if (
          individualRhs >= BigInt(Number.MIN_SAFE_INTEGER) &&
          individualRhs <= BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          addRows(
            solveRows,
            `joint_necessary_job_${index}`,
            surrogate.terms,
            ">=",
            Number(individualRhs),
          );
        }
      }
      for (const upperBound of factorClassUpperBounds) {
        if (
          ratioAtOrBelowThreshold(
            upperBound.ratio,
            thresholdNumerator,
            best.denominator,
          )
        ) {
          addRows(
            solveRows,
            upperBound.rowName,
            [[prefix(upperBound.jobIndex, upperBound.variable), 1]],
            "=",
            0,
          );
          factorCuts.factorClassConflictRows.add(upperBound.rowName);
        }
      }
      addCandidateSpecificUpperBoundProofRows(
        solveRows,
        best.numerator,
        best.denominator,
      );
    }
    for (const upperBound of [
      ...sharedBounds.sharedEquipmentUpperBounds,
      ...sharedBounds.sharedFoodUpperBounds,
    ]) {
      if (
        (thresholdNumerator > 0n &&
          cannotBeatThreshold(
            upperBound.jobRatios,
            thresholdNumerator,
            best.denominator,
          )) ||
        ratioSumAtOrBelowThreshold(
          upperBound.jobRatios,
          best.numerator,
          best.denominator,
        )
      ) {
        addRows(
          solveRows,
          upperBound.rowName,
          [[upperBound.selector, 1]],
          "=",
          0,
        );
      }
    }
    for (const upperBound of sharedBounds.sharedPairUpperBounds ?? []) {
      if (
        (thresholdNumerator > 0n &&
          cannotBeatThreshold(
            upperBound.jobRatios,
            thresholdNumerator,
            best.denominator,
          )) ||
        ratioSumAtOrBelowThreshold(
          upperBound.jobRatios,
          best.numerator,
          best.denominator,
        )
      ) {
        addRows(
          solveRows,
          upperBound.rowName,
          [
            [upperBound.selectorA, 1],
            [upperBound.selectorB, 1],
          ],
          "<=",
          1,
        );
        sharedBounds.sharedPairConflictRows.add(upperBound.rowName);
      }
    }
    factorCuts.addTwoJobWithinJobFactorPairCuts(
      solveRows,
      best.numerator,
      best.denominator,
    );
    factorCuts.addTwoJobWithinJobFactorTripleCuts(
      solveRows,
      best.numerator,
      best.denominator,
    );
    factorCuts.addCrossJobFactorClassGroupPairCuts(
      solveRows,
      best.numerator,
      best.denominator,
    );
    factorCuts.addCrossJobFactorClassGroupTripleCuts(
      solveRows,
      best.numerator,
      best.denominator,
    );
    factorCuts.addRatioUpperNecessaryCuts(
      solveRows,
      best.numerator,
      best.denominator,
    );
    for (const upperBound of sharedBounds.sharedAssignmentUpperBounds ?? []) {
      const resourceScoreCut =
        upperBound.jobScoreUppers !== undefined &&
        factorScoreUpperCannotBeatThreshold(
          upperBound.jobScoreUppers,
          thresholdNumerator,
          best.denominator,
        );
      if (
        resourceScoreCut ||
        ratioSumAtOrBelowThreshold(
          upperBound.jobRatios,
          best.numerator,
          best.denominator,
        )
      ) {
        addRows(
          solveRows,
          upperBound.rowName,
          upperBound.selectors.map((selector) => [selector, 1] as const),
          "<=",
          upperBound.selectors.length - 1,
        );
        sharedBounds.sharedAssignmentConflictRows.add(upperBound.rowName);
        if (resourceScoreCut)
          sharedBounds.sharedAssignmentResourceScoreConflictRows.add(
            upperBound.rowName,
          );
      }
    }
  }
  excluded.forEach((signature, index) =>
    addRows(
      solveRows,
      `joint_nogood_${index}`,
      signature.map((name) => [name, 1] as const),
      "<=",
      signature.length - 1,
    ),
  );
  return solveRows;
}
