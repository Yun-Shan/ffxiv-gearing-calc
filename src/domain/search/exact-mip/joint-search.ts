import { prepareJointJobs } from "./joint-preparation.ts";
import {
  validateJointInitialResults,
  decodeJointSolution,
} from "./joint-results.ts";
import { createJointSolutionHint } from "./joint-solution-hint.ts";
import { buildJointIterationRows } from "./joint-iteration-model.ts";
import type {
  JointPreparedJob,
  JointSearchOptions,
  ExactRatio,
} from "./joint-types.ts";
import { prepareJointIdentity } from "./joint-identity.ts";
import { assembleJointModel } from "./joint-model.ts";
import { prepareJointCandidateBounds } from "./joint-candidate-bounds.ts";
import { assembleJointRatioEnvelope } from "./joint-ratio-envelope.ts";
import { createJointCandidateProofs } from "./joint-candidate-proofs.ts";
import { createJointSharedBounds } from "./joint-shared-bounds.ts";
import { prepareJointAccessoryDominance } from "./joint-accessory-dominance.ts";
import { createJointFactorCuts } from "./joint-factor-cuts.ts";
import type { ExactMipResult } from "./types.ts";
import { canUseSharedAccessoryPairDominance } from "../shared-accessory-pair-dominance-policy.ts";
import { hasSharedAccessoryPairDominancePath } from "../shared-accessory-pair-dominance-policy.ts";
import { hasCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { throwIfCancelled } from "../cancellation.ts";
import { emitProfileEvent } from "../core/diagnostics.ts";
import { getMemoryUsageSnapshot } from "../memory-usage.ts";
import { solveIntegerModel } from "../core/highs-solver.ts";
import { validateMipSolution } from "../core/solution-validation.ts";

export type { JointPreparedJob } from "./joint-types.ts";

export async function findBestJointFactorMip(
  options: JointSearchOptions,
): Promise<
  | {
      results: ExactMipResult[];
      solverRuns: number;
      signatures: number;
      innerSolverStatus: "Optimal" | "DualBound";
    }
  | undefined
> {
  const startedAt = performance.now();
  const jointMaxSearchMs = options.maxSearchMs;
  const jointPreprocessingBudgetBaseMs = jointMaxSearchMs ?? 235_000;
  const jointTimeLimitReached = () =>
    jointMaxSearchMs !== undefined &&
    performance.now() - startedAt >= jointMaxSearchMs;
  const isCancelled =
    options.isCancelled ??
    (() => options.jobs.some((job) => job.options.isCancelled?.() === true));
  const sharedAccessoryPairDominanceEnabled =
    canUseSharedAccessoryPairDominance({
      trustedPolicyPath: hasSharedAccessoryPairDominancePath(options),
      requested: options.sharedAccessoryPairDominance === true,
      jobs: options.jobs.map(({ id, options: jobOptions }) => ({
        id,
        job: jobOptions.job,
        objective: jobOptions.objective,
        hasCanonicalEvaluator:
          hasCanonicalEvaluatorCandidateUpperBound(jobOptions),
        hasCustomAttributeExtractor:
          jobOptions.equipmentAttributeExtractor !== undefined,
        hasConstraints: Object.values(jobOptions.constraints ?? {}).some(
          (value) => value !== undefined,
        ),
      })),
      commonSlots: options.commonSlots,
      hasCommonSlotProjections:
        (options.commonSlotProjections?.length ?? 0) > 0,
      sharedFood: options.sharedFood,
      objective: options.objective,
      canonicalSharedRingPair: options.canonicalSharedRingPair === true,
    });
  const identity = prepareJointIdentity(options);
  const { projections, originalSelectionIdentity } = identity;
  const preparation = await prepareJointJobs(options, identity, isCancelled);
  if (preparation === undefined) return undefined;
  const {
    preparedJobs,
    canonicalRingRanks,
    canonicalRingSlotIndexes,
    jointInitialResults,
    modelPreparationMs,
  } = preparation;
  const modelAssemblyStartedAt = performance.now();
  const assembled = assembleJointModel(options, preparedJobs, identity, {
    canonicalRingRanks,
    canonicalRingSlotIndexes,
  });
  if (assembled === undefined) return undefined;
  const { rows, bounds, binaries, generals, objective } = assembled;
  const candidateBounds = prepareJointCandidateBounds(
    options,
    preparedJobs,
    assembled,
    identity,
    { jointPreprocessingBudgetBaseMs, isCancelled, jointTimeLimitReached },
  );
  const {
    candidateSpecificUpperBounds,
    candidateSpecificUpperBoundPreparationMs,
    candidateSpecificUpperBoundSkippedJobs,
    resourceBudgetCandidateUpperBounds,
    resourceBudgetCandidateUpperBoundSkippedJobs,
    resourceBudgetCandidateUpperBoundPreparationMs,
    resourceBudgetCandidateUpperBoundProofRows,
    factorClassUpperBounds,
    compareExactRatios,
    factorClassUpperBoundsByJobAndGroup,
  } = candidateBounds;
  const ratioEnvelope = assembleJointRatioEnvelope(
    options,
    preparedJobs,
    assembled,
    candidateBounds,
  );
  const {
    ratioUpperBoundScale,
    ratioUpperBoundVariables,
    ratioUpperBoundObjectiveEnabled,
    ratioUpperBoundObjective,
    ratioUpperBoundPairCutCount,
    ratioUpperBoundPairPreprocessingWork,
  } = ratioEnvelope;
  // 延迟读取候选证明谓词，保留共享上界、支配预处理和证明缓存的原初始化顺序。
  const sharedBounds = createJointSharedBounds(
    options,
    preparedJobs,
    assembled,
    candidateBounds,
    {
      factorScoreUpperCannotBeatThreshold: (...args) =>
        candidateProofs.factorScoreUpperCannotBeatThreshold(...args),
    },
    { jointPreprocessingBudgetBaseMs, isCancelled, jointTimeLimitReached },
  );
  const accessoryDominance = prepareJointAccessoryDominance(
    sharedAccessoryPairDominanceEnabled,
    preparedJobs,
    assembled,
    projections,
    jointPreprocessingBudgetBaseMs,
    isCancelled,
  );
  const {
    sharedAccessoryPairDominanceCandidateCount,
    sharedAccessoryPairDominanceComparisons,
    sharedAccessoryPairDominanceCuts,
    sharedAccessoryPairDominancePreprocessingMs,
    sharedAccessoryPairDominanceMaximumCuts,
    sharedAccessoryPairDominanceMaximumComparisons,
    sharedAccessoryPairDominancePreprocessingBudgetMs,
    sharedAccessoryPairDominanceLimitReached,
    sharedAccessoryPairDominanceCandidateUpperBound,
  } = accessoryDominance;
  const factorCuts = createJointFactorCuts(
    options,
    preparedJobs,
    assembled,
    candidateBounds,
    ratioEnvelope,
    { isCancelled, jointTimeLimitReached },
  );
  const candidateProofs = createJointCandidateProofs(
    preparedJobs,
    candidateBounds,
  );
  const {
    candidateSpecificUpperBoundProofRows,
    candidateSpecificUpperBoundEqualityRows,
  } = candidateProofs;
  throwIfCancelled(isCancelled);
  const excluded: string[][] = [];
  let solverRuns = 0;
  let innerSolverStatus: "Optimal" | "DualBound" = "Optimal";
  let best = validateJointInitialResults(
    options,
    preparedJobs,
    jointInitialResults,
    originalSelectionIdentity,
  );
  const groupCount = preparedJobs.reduce(
    (sum, { prepared }) => sum + prepared.groups.length,
    0,
  );
  if (best !== undefined) {
    sharedBounds.prepareSharedPairUpperBounds(best.numerator, best.denominator);
    sharedBounds.prepareSharedAssignmentUpperBounds(best);
  }
  const modelAssemblyMs = performance.now() - modelAssemblyStartedAt;
  const profileBackend = "HiGHS";
  if (options.onSolverProgress !== undefined)
    emitProfileEvent(
      options.onSolverProgress,
      profileBackend,
      "joint_factor_product",
      "joint-model-ready",
      {
        modelPreparationMs,
        modelAssemblyMs,
        variables: bounds.length,
        constraints: rows.length,
        nonzeros: rows.reduce((sum, row) => sum + row.terms.size, 0),
        objectiveTerms: objective.size,
        factorGroups: groupCount,
        factorClasses: preparedJobs.reduce(
          (sum, { prepared }) =>
            sum +
            prepared.groups.reduce(
              (groupSum, group) => groupSum + group.classes.length,
              0,
            ),
          0,
        ),
        reachableFactorClassesRemoved: preparedJobs.reduce(
          (sum, { prepared }) => sum + prepared.reachableFactorClassesRemoved,
          0,
        ),
        reachableAttributePruningSkipped: preparedJobs.reduce(
          (sum, { prepared }) =>
            sum + prepared.reachableAttributePruningSkipped,
          0,
        ),
        reachableWeaponFactorClassesRemoved: preparedJobs.reduce(
          (sum, { prepared }) =>
            sum + prepared.reachableWeaponFactorClassesRemoved,
          0,
        ),
        reachableWeaponPruningSkipped: preparedJobs.reduce(
          (sum, { prepared }) => sum + prepared.reachableWeaponPruningSkipped,
          0,
        ),
        factorClassGroupSummary: JSON.stringify(
          preparedJobs.map(({ job, prepared }, jobIndex) => ({
            job: job.id,
            groups: prepared.groups.map((group) => {
              const boundsForGroup =
                factorClassUpperBoundsByJobAndGroup[jobIndex]!.get(
                  group.name,
                ) ?? [];
              const maximum = boundsForGroup.reduce(
                (best, bound) =>
                  compareExactRatios(bound.ratio, best) > 0
                    ? bound.ratio
                    : best,
                { numerator: 0n, denominator: 1n } as ExactRatio,
              );
              return {
                name: group.name,
                classes: group.classes.length,
                maximumRatio: `${maximum.numerator}/${maximum.denominator}`,
              };
            }),
          })),
        ),
        ratioUpperBoundPairCuts: ratioUpperBoundPairCutCount,
        ratioUpperBoundPairPreprocessingWork,
        ratioUpperBoundPairPolicy: options.ratioUpperPairPolicy ?? "default",
        sharedAccessoryPairDominancePolicy: sharedAccessoryPairDominanceEnabled
          ? "strict-with-safe-replacement"
          : "disabled",
        sharedAccessoryPairDominanceCandidateUpperBound:
          sharedAccessoryPairDominanceCandidateUpperBound.toString(),
        sharedAccessoryPairDominanceCandidates:
          sharedAccessoryPairDominanceCandidateCount,
        sharedAccessoryPairDominanceComparisons,
        sharedAccessoryPairDominanceCuts,
        sharedAccessoryPairDominanceMaximumCuts,
        sharedAccessoryPairDominanceMaximumComparisons,
        sharedAccessoryPairDominancePreprocessingMs,
        sharedAccessoryPairDominancePreprocessingBudgetMs,
        sharedAccessoryPairDominanceLimitReached: Number(
          sharedAccessoryPairDominanceLimitReached,
        ),
        sharedPairCandidateUpperBound:
          sharedBounds.sharedPairCandidateUpperBound.toString(),
        sharedPairCandidateCount: sharedBounds.sharedPairCandidateCount,
        sharedPairCandidatesEvaluated:
          sharedBounds.sharedPairCandidatesEvaluated,
        sharedPairPreprocessingMs: sharedBounds.sharedPairPreprocessingMs,
        sharedPairPreprocessingSkipped: Number(
          sharedBounds.sharedPairPreprocessingSkipped,
        ),
        sharedAssignmentCandidateUpperBound:
          sharedBounds.sharedAssignmentCandidateUpperBound.toString(),
        sharedAssignmentCandidateCount:
          sharedBounds.sharedAssignmentCandidateCount,
        sharedAssignmentCandidatesEvaluated:
          sharedBounds.sharedAssignmentCandidatesEvaluated,
        sharedAssignmentPrefixChoiceOrder:
          sharedBounds.sharedAssignmentPrefixChoiceOrder,
        sharedAssignmentDomainOrder: sharedBounds.sharedAssignmentDomainOrder,
        sharedAssignmentUpperBoundCount:
          sharedBounds.sharedAssignmentUpperBounds?.length ?? 0,
        sharedAssignmentCutPrefixDepthCounts: JSON.stringify(
          sharedBounds.sharedAssignmentCutPrefixDepthCounts,
        ),
        sharedAssignmentPrefixEvaluationLimit:
          sharedBounds.sharedAssignmentPrefixEvaluationLimit,
        sharedAssignmentUpperBoundLimit:
          sharedBounds.sharedAssignmentUpperBoundLimit,
        sharedAssignmentPreprocessingBudgetMs:
          sharedBounds.sharedAssignmentPreprocessingBudgetMs,
        sharedAssignmentPreprocessingMs:
          sharedBounds.sharedAssignmentPreprocessingMs,
        sharedAssignmentPreprocessingSkipped: Number(
          sharedBounds.sharedAssignmentPreprocessingSkipped,
        ),
        factorClassUpperBoundCount: factorClassUpperBounds.length,
        resourceBudgetCandidateUpperBoundCandidates:
          resourceBudgetCandidateUpperBounds.length,
        resourceBudgetCandidateUpperBoundPreparationMs,
        resourceBudgetCandidateUpperBoundSkippedJobs,
      },
    );
  let solverWallMs = 0;
  let iterationModelBuildMs = 0;
  let postSolveMs = 0;
  while (true) {
    throwIfCancelled(isCancelled);
    if (best !== undefined) {
      sharedBounds.prepareSharedPairUpperBounds(
        best.numerator,
        best.denominator,
      );
      sharedBounds.prepareSharedAssignmentUpperBounds(best);
    }
    const remaining =
      options.maxSearchMs === undefined
        ? undefined
        : options.maxSearchMs - (performance.now() - startedAt);
    if (remaining !== undefined && remaining <= 0) {
      throw new Error("联合因子 MIP 达到时限，未完成最优性复核");
    }
    const memory = getMemoryUsageSnapshot();
    if (memory.rssBytes !== undefined && memory.rssBytes > 3.5 * 1024 ** 3) {
      throw new Error("联合因子 MIP 达到内存保护线");
    }
    const iterationModelBuildStartedAt = performance.now();
    const solveRows = buildJointIterationRows(
      options,
      assembled,
      candidateBounds,
      candidateProofs,
      sharedBounds,
      factorCuts,
      groupCount,
      best,
      excluded,
    );
    throwIfCancelled(isCancelled);
    const solutionHint = createJointSolutionHint(
      options,
      preparedJobs,
      assembled,
      originalSelectionIdentity,
      best,
      solverRuns,
    );
    iterationModelBuildMs += performance.now() - iterationModelBuildStartedAt;
    if (options.onSolverProgress !== undefined)
      emitProfileEvent(
        options.onSolverProgress,
        profileBackend,
        "joint_factor_product",
        "joint-model-iteration-ready",
        {
          solverRuns,
          variables: bounds.length,
          constraints: solveRows.length,
          nonzeros: solveRows.reduce((sum, row) => sum + row.terms.size, 0),
          sharedPairConflictCuts: sharedBounds.sharedPairConflictRows.size,
          sharedAssignmentConflictCuts:
            sharedBounds.sharedAssignmentConflictRows.size,
          sharedAssignmentResourceScoreCuts:
            sharedBounds.sharedAssignmentResourceScoreConflictRows.size,
          factorClassConflictCuts: factorCuts.factorClassConflictRows.size,
          factorClassPairConflictCuts:
            factorCuts.factorClassPairConflictRows.size,
          factorClassJointPairConflictCuts:
            factorCuts.factorClassJointPairConflictRows.size,
          factorClassJointTripleConflictCuts:
            factorCuts.factorClassJointTripleConflictRows.size,
          factorClassTripleConflictCuts:
            factorCuts.factorClassTripleConflictRows.size,
          ratioUpperNecessaryCuts: factorCuts.ratioUpperNecessaryRows.size,
          candidateSpecificUpperBoundCandidates:
            candidateSpecificUpperBounds.length,
          candidateSpecificUpperBoundCutRows:
            candidateSpecificUpperBoundProofRows.size,
          candidateSpecificUpperBoundEqualityCuts:
            candidateSpecificUpperBoundEqualityRows.size,
          resourceBudgetCandidateUpperBoundCandidates:
            resourceBudgetCandidateUpperBounds.length,
          resourceBudgetCandidateUpperBoundCutRows:
            resourceBudgetCandidateUpperBoundProofRows.size,
          candidateSpecificUpperBoundSkippedJobs,
        },
      );
    const optimizingRatioUpperBound = ratioUpperBoundObjectiveEnabled;
    const solverCallStartedAt = performance.now();
    const output = await solveIntegerModel({
      name: "joint_factor_product",
      objective: ratioUpperBoundObjectiveEnabled
        ? ratioUpperBoundObjective
        : new Map(),
      rows: solveRows,
      variables: bounds,
      binaryVariables: binaries,
      integerVariables: generals,
      timeLimitMs: remaining,
      ...(solutionHint.size === 0 ? {} : { solutionHint }),
      ...(best === undefined
        ? {}
        : {
            stopWhenDualBoundProvesOptimal: (dualBound: number) => {
              const conservativeIntegerUpperBound = Math.ceil(dualBound);
              if (!Number.isSafeInteger(conservativeIntegerUpperBound))
                return false;
              return (
                BigInt(conservativeIntegerUpperBound) * best!.denominator <=
                best!.numerator * ratioUpperBoundScale
              );
            },
          }),
      ...(options.onSolverProgress === undefined
        ? {}
        : { onProgress: options.onSolverProgress }),
      ...(options.onSolverCallback === undefined
        ? {}
        : { onCallback: options.onSolverCallback }),
    });
    solverWallMs += performance.now() - solverCallStartedAt;
    const postSolveStartedAt = performance.now();
    throwIfCancelled(isCancelled);
    solverRuns++;
    options.onProgress?.(
      `HiGHS 联合因子 MIP 状态=${output.Status}；已检查签名=${excluded.length}；耗时=${Math.round(performance.now() - startedAt)}ms`,
    );
    if (output.Status === "DualBound") {
      innerSolverStatus = "DualBound";
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    if (output.Status === "Infeasible") {
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    if (output.Status !== "Optimal")
      throw new Error(`联合因子 MIP 未证明最优：${output.Status}`);
    validateMipSolution(solveRows, bounds, output.Columns);
    const upperBoundScaled = optimizingRatioUpperBound
      ? ratioUpperBoundVariables.reduce(
          (sum, name) =>
            sum + BigInt(Math.round(output.Columns[name]?.Primal ?? 0)),
          0n,
        )
      : undefined;
    const { signature, results, numerator, denominator } = decodeJointSolution(
      options,
      preparedJobs,
      output.Columns,
      {
        startedAt,
        solverRuns,
        excludedSignatures: excluded.length,
        variables: bounds.length,
        constraints: solveRows.length,
      },
    );
    if (
      best === undefined ||
      numerator * best.denominator > best.numerator * denominator
    ) {
      best = { numerator, denominator, results };
      options.onProgress?.(
        `联合因子 MIP 当前最优归一化总和=${Number(numerator) / Number(denominator)}`,
      );
    }
    if (
      upperBoundScaled !== undefined &&
      upperBoundScaled * best.denominator <=
        best.numerator * ratioUpperBoundScale
    ) {
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    postSolveMs += performance.now() - postSolveStartedAt;
    if (best.numerator === BigInt(options.jobs.length) * best.denominator)
      break;
    excluded.push(signature);
  }
  if (best === undefined) return undefined;
  const elapsedMs = performance.now() - startedAt;
  const profile = {
    elapsedMs,
    modelPreparationMs,
    modelAssemblyMs,
    iterationModelBuildMs,
    solverWallMs,
    postSolveMs,
    otherMs: Math.max(
      0,
      elapsedMs -
        modelPreparationMs -
        modelAssemblyMs -
        iterationModelBuildMs -
        solverWallMs -
        postSolveMs,
    ),
    solverRuns,
    signatures: excluded.length,
    variables: bounds.length,
    constraints: rows.length + excluded.length,
    sharedPairCandidateUpperBound:
      sharedBounds.sharedPairCandidateUpperBound.toString(),
    sharedPairCandidateCount: sharedBounds.sharedPairCandidateCount,
    sharedPairCandidatesEvaluated: sharedBounds.sharedPairCandidatesEvaluated,
    sharedPairConflictCuts: sharedBounds.sharedPairConflictRows.size,
    sharedPairPreprocessingMs: sharedBounds.sharedPairPreprocessingMs,
    sharedPairPreprocessingSkipped: Number(
      sharedBounds.sharedPairPreprocessingSkipped,
    ),
    sharedAssignmentCandidateUpperBound:
      sharedBounds.sharedAssignmentCandidateUpperBound.toString(),
    sharedAssignmentCandidateCount: sharedBounds.sharedAssignmentCandidateCount,
    sharedAssignmentCandidatesEvaluated:
      sharedBounds.sharedAssignmentCandidatesEvaluated,
    sharedAssignmentPrefixChoiceOrder:
      sharedBounds.sharedAssignmentPrefixChoiceOrder,
    sharedAssignmentDomainOrder: sharedBounds.sharedAssignmentDomainOrder,
    sharedAssignmentConflictCuts:
      sharedBounds.sharedAssignmentConflictRows.size,
    sharedAssignmentResourceScoreCuts:
      sharedBounds.sharedAssignmentResourceScoreConflictRows.size,
    sharedAssignmentUpperBoundCount:
      sharedBounds.sharedAssignmentUpperBounds?.length ?? 0,
    sharedAssignmentCutPrefixDepthCounts: JSON.stringify(
      sharedBounds.sharedAssignmentCutPrefixDepthCounts,
    ),
    sharedAssignmentPrefixEvaluationLimit:
      sharedBounds.sharedAssignmentPrefixEvaluationLimit,
    sharedAssignmentUpperBoundLimit:
      sharedBounds.sharedAssignmentUpperBoundLimit,
    sharedAssignmentPreprocessingBudgetMs:
      sharedBounds.sharedAssignmentPreprocessingBudgetMs,
    sharedAssignmentPreprocessingMs:
      sharedBounds.sharedAssignmentPreprocessingMs,
    sharedAssignmentPreprocessingSkipped: Number(
      sharedBounds.sharedAssignmentPreprocessingSkipped,
    ),
    factorClassUpperBoundCount: factorClassUpperBounds.length,
    factorClassConflictCuts: factorCuts.factorClassConflictRows.size,
    factorClassPairConflictCuts: factorCuts.factorClassPairConflictRows.size,
    factorClassJointPairConflictCuts:
      factorCuts.factorClassJointPairConflictRows.size,
    factorClassJointTripleConflictCuts:
      factorCuts.factorClassJointTripleConflictRows.size,
    factorClassTripleConflictCuts:
      factorCuts.factorClassTripleConflictRows.size,
    factorClassTriplePreprocessingWork:
      factorCuts.factorClassTriplePreprocessingWork,
    factorClassTriplePreprocessingSkipped: Number(
      factorCuts.factorClassTriplePreprocessingSkipped,
    ),
    candidateSpecificUpperBoundPreparationMs,
    candidateSpecificUpperBoundSkippedJobs,
    candidateSpecificUpperBoundCandidates: candidateSpecificUpperBounds.length,
    candidateSpecificUpperBoundCutRows:
      candidateSpecificUpperBoundProofRows.size,
    candidateSpecificUpperBoundEqualityCuts:
      candidateSpecificUpperBoundEqualityRows.size,
    resourceBudgetCandidateUpperBoundCandidates:
      resourceBudgetCandidateUpperBounds.length,
    resourceBudgetCandidateUpperBoundPreparationMs,
    resourceBudgetCandidateUpperBoundSkippedJobs,
    resourceBudgetCandidateUpperBoundCutRows:
      resourceBudgetCandidateUpperBoundProofRows.size,
    ratioUpperBoundPairCuts: ratioUpperBoundPairCutCount,
    ratioUpperBoundPairPreprocessingWork,
    ratioUpperBoundPairPolicy: options.ratioUpperPairPolicy ?? "default",
    sharedAccessoryPairDominancePolicy: sharedAccessoryPairDominanceEnabled
      ? "strict-with-safe-replacement"
      : "disabled",
    sharedAccessoryPairDominanceCandidateUpperBound:
      sharedAccessoryPairDominanceCandidateUpperBound.toString(),
    sharedAccessoryPairDominanceCandidates:
      sharedAccessoryPairDominanceCandidateCount,
    sharedAccessoryPairDominanceComparisons,
    sharedAccessoryPairDominanceCuts,
    sharedAccessoryPairDominanceMaximumCuts,
    sharedAccessoryPairDominanceMaximumComparisons,
    sharedAccessoryPairDominancePreprocessingMs,
    sharedAccessoryPairDominancePreprocessingBudgetMs,
    sharedAccessoryPairDominanceLimitReached: Number(
      sharedAccessoryPairDominanceLimitReached,
    ),
    sharedAssignmentPrefixSearchUsed: Number(
      sharedBounds.sharedAssignmentPrefixSearchUsed,
    ),
    sharedAssignmentPrefixesEvaluated:
      sharedBounds.sharedAssignmentPrefixesEvaluated,
    ratioUpperNecessaryCuts: factorCuts.ratioUpperNecessaryRows.size,
  };
  if (options.onSolverProgress !== undefined)
    emitProfileEvent(
      options.onSolverProgress,
      profileBackend,
      "joint_factor_product",
      "joint-search-summary",
      profile,
    );
  return {
    results: best.results,
    solverRuns,
    signatures: excluded.length,
    innerSolverStatus,
  };
}
