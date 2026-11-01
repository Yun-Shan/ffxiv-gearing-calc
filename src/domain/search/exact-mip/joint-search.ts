import { prepareJointJobs } from "./joint-preparation.ts";
import { assertUniqueJobFoodAttributes } from "../food-parameters.ts";
import {
  validateJointInitialResults,
  decodeJointSolution,
} from "./joint-results.ts";
import { createJointSolutionHint } from "./joint-solution-hint.ts";
import { buildJointIterationRows } from "./joint-iteration-model.ts";
import { chooseJointGuide, type JointGuideFeedback } from "./joint-guide.ts";
import { projectRemainingDomain } from "./shared-projection/remaining-domain.ts";
import { SURROGATE_OBJECTIVE_SCALE } from "./model-preparation.ts";
import type { LinearMipRequest } from "../linear-mip.ts";
import type {
  JointPreparedJob,
  JointSearchOptions,
  ExactRatio,
  JointMipStatus,
  JointMipTermination,
} from "./joint-types.ts";
import { prepareJointIdentity } from "./joint-identity.ts";
import { assembleJointModel } from "./joint-model.ts";
import { prepareJointCandidateBounds } from "./joint-candidate-bounds.ts";
import { assembleJointRatioEnvelope } from "./joint-ratio-envelope.ts";
import { createJointCandidateProofs } from "./joint-candidate-proofs.ts";
import { createJointSharedBounds } from "./joint-shared-bounds.ts";
import { createJointFactorCuts } from "./joint-factor-cuts.ts";
import type { ExactMipResult } from "./types.ts";
import { throwIfCancelled } from "../cancellation.ts";
import { emitProfileEvent } from "../core/diagnostics.ts";
import { getMemoryUsageSnapshot } from "../memory-usage.ts";
import { solveIntegerModel } from "../core/highs-solver.ts";
import { validateMipSolution } from "../core/solution-validation.ts";
import { normalizeSearchStrategies } from "../strategies.ts";
import { inheritCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";

export type { JointPreparedJob } from "./joint-types.ts";

export async function findBestJointFactorMip(
  options: JointSearchOptions,
): Promise<
  | {
      results: ExactMipResult[];
      solverRuns: number;
      signatures: number;
      innerSolverStatus: JointMipStatus;
      termination: JointMipTermination;
    }
  | undefined
> {
  const startedAt = performance.now();
  const strategies = normalizeSearchStrategies(options.strategies);
  options = {
    ...options,
    strategies,
    jobs: options.jobs.map((job) => ({
      ...job,
      options: inheritCanonicalEvaluatorCandidateUpperBound(job.options, { ...job.options, strategies }),
    })),
  };
  const jointMaxSearchMs = options.maxSearchMs;
  if (jointMaxSearchMs !== undefined && (!Number.isFinite(jointMaxSearchMs) || jointMaxSearchMs <= 0)) {
    throw new RangeError("maxSearchMs 必须是正有限值");
  }
  const jointPreprocessingBudgetBaseMs = jointMaxSearchMs ?? 235_000;
  const jointTimeLimitReached = () =>
    jointMaxSearchMs !== undefined &&
    performance.now() - startedAt >= jointMaxSearchMs;
  const isCancelled = () => options.isCancelled?.() === true ||
    options.jobs.some((job) => job.options.isCancelled !== options.isCancelled && job.options.isCancelled?.() === true);
  const requireSearchActive = () => {
    throwIfCancelled(isCancelled);
    if (jointTimeLimitReached()) throw new Error("联合因子 MIP 达到时限，未完成最优性复核");
  };
  let nextMemoryCheck = 0;
  const checkProjection = () => {
    requireSearchActive();
    const now = performance.now();
    if (now >= nextMemoryCheck) {
      nextMemoryCheck = now + 100;
      if ((getMemoryUsageSnapshot().rssBytes ?? 0) > 3.5 * 1024 ** 3) throw new Error("联合因子 MIP 达到内存保护线");
    }
  };
  requireSearchActive();
  assertUniqueJobFoodAttributes(options.jobs);
  const identity = prepareJointIdentity(options);
  const { originalSelectionIdentity } = identity;
  const preparation = await prepareJointJobs(options, identity, isCancelled);
  requireSearchActive();
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
  requireSearchActive();
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
  // 延迟读取候选证明谓词，保留共享上界与证明缓存的初始化顺序。
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
  let innerSolverStatus: JointMipStatus = "Optimal";
  let termination: JointMipTermination = "ratio-envelope-bound";
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
  let previousGuide: JointGuideFeedback | undefined;
  let projectionMs = 0;
  const signatureObjective = new Map([...objective].map(([name, q]) => [name, q / SURROGATE_OBJECTIVE_SCALE]));
  while (true) {
    throwIfCancelled(isCancelled);
    if (best !== undefined) {
      sharedBounds.prepareSharedPairUpperBounds(
        best.numerator,
        best.denominator,
      );
      sharedBounds.prepareSharedAssignmentUpperBounds(best);
    }
    requireSearchActive();
    const memory = getMemoryUsageSnapshot();
    if (memory.rssBytes !== undefined && memory.rssBytes > 3.5 * 1024 ** 3) {
      throw new Error("联合因子 MIP 达到内存保护线");
    }
    const iterationModelBuildStartedAt = performance.now();
    const { solveRows, jobLowerBounds, signatureRestrictions } = buildJointIterationRows(
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
    // 固定模型是公共前缀，每个已解码签名在末尾恰好生成一行排除。
    const restrictions = solveRows.slice(rows.length, solveRows.length - excluded.length);
    const guide = chooseJointGuide(ratioUpperBoundObjectiveEnabled, restrictions, previousGuide);
    const optimizingRatioUpperBound = guide === "ratio-bound";
    if (guide === "signature" && best && excluded.length > 0 && projectionMs < 42_000) {
      const begin = performance.now();
      const available = jointMaxSearchMs === undefined ? Infinity : jointMaxSearchMs - (begin - startedAt);
      const projection = projectRemainingDomain(options, preparedJobs, assembled, jobLowerBounds, signatureRestrictions,
        best, Math.min(42_000 - projectionMs, available * 0.7), checkProjection);
      projectionMs += performance.now() - begin;
      nextMemoryCheck = 0;
      checkProjection();
      if (projection) {
        const { route, closed, details } = projection;
        if (closed) {
          const verified = validateJointInitialResults(options, preparedJobs, best.results, originalSelectionIdentity);
          requireSearchActive();
          if (!verified || verified.numerator * best.denominator !== best.numerator * verified.denominator)
            throw new Error("共享投影结束前，原候选与精确目标复核失败");
          innerSolverStatus = route === "fixed-ten-ranks" ? "ExactSignatureEnumeration" : "ExactStateEnumeration";
          termination = route === "fixed-ten-ranks" ? "exact-signatures" : "exact-attributes";
        } else {
          solveRows.push(...projection.rows);
        }
        emitProfileEvent(options.onSolverProgress, profileBackend, "joint_factor_product", "joint-shared-projection", {
          route, closed: Number(closed), excludedSignatures: excluded.length, rows: projection.rows.length, elapsedMs: performance.now() - begin, ...details,
        });
        requireSearchActive();
        if (closed) {
          iterationModelBuildMs += performance.now() - iterationModelBuildStartedAt;
          break;
        }
      }
    }
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
          guide,
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
    const solverCallStartedAt = performance.now();
    requireSearchActive();
    const jointObjective: NonNullable<LinearMipRequest["jointObjective"]> = guide === "ratio-bound"
      ? { kind: guide, variables: ratioUpperBoundVariables, scale: Number(ratioUpperBoundScale) }
      : { kind: guide };
    const output = await solveIntegerModel({
      strategies,
      jointObjective,
      // Equivalent representations can have different native MIP performance;
      // bound row-density growth and require substantial column reduction.
      equalityQuotient: { maxRowDensityGrowth: 3, minVariableReductionPercent: 25 },
      isCancelled,
      name: "joint_factor_product",
      objective: optimizingRatioUpperBound ? ratioUpperBoundObjective : guide === "signature" ? signatureObjective : new Map(),
      rows: solveRows,
      variables: bounds,
      binaryVariables: binaries,
      integerVariables: generals,
      timeLimitMs: jointMaxSearchMs === undefined ? undefined : jointMaxSearchMs - (performance.now() - startedAt),
      ...(solutionHint.size === 0 ? {} : { solutionHint }),
      ...(best === undefined || !optimizingRatioUpperBound
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
    requireSearchActive();
    solverRuns++;
    options.onProgress?.(
      `HiGHS 联合因子 MIP 状态=${output.Status}；已检查签名=${excluded.length}；耗时=${Math.round(performance.now() - startedAt)}ms`,
    );
    requireSearchActive();
    if (output.Status === "DualBound") {
      if (!optimizingRatioUpperBound || !best) throw new Error("联合 MIP 返回了无对应比例上界证明的 DualBound");
      innerSolverStatus = "DualBound";
      termination = "ratio-dual-bound";
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    if (output.Status === "Infeasible") {
      innerSolverStatus = "Infeasible";
      termination = "remaining-domain-infeasible";
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    if (output.Status !== (optimizingRatioUpperBound ? "Optimal" : "FeasibleSignature"))
      throw new Error(`联合因子 MIP 在 ${guide} 路线没有返回预期的可验证解：${output.Status}`);
    validateMipSolution(solveRows, bounds, output.Columns);
    const upperBoundScaled = optimizingRatioUpperBound
      ? ratioUpperBoundVariables.reduce(
          (sum, name) =>
            sum + BigInt(Math.round(output.Columns[name]!.Primal)),
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
    requireSearchActive();
    if (upperBoundScaled !== undefined && upperBoundScaled * denominator < numerator * ratioUpperBoundScale) {
      throw new Error("联合比例上界低于本次原配装的精确得分");
    }
    const improved = best === undefined || numerator * best.denominator > best.numerator * denominator;
    if (best === undefined || improved) {
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
    if (best.numerator === BigInt(options.jobs.length) * best.denominator) {
      innerSolverStatus = optimizingRatioUpperBound ? "Optimal" : "FeasibleSignature";
      termination = "theoretical-score";
      break;
    }
    excluded.push(signature);
    previousGuide = { guide, improved, restrictions, saturated: upperBoundScaled === BigInt(options.jobs.length) * ratioUpperBoundScale };
  }
  requireSearchActive();
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
  requireSearchActive();
  return {
    results: best.results,
    solverRuns,
    signatures: excluded.length,
    innerSolverStatus,
    termination,
  };
}
