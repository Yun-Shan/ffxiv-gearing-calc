import { throwIfCancelled } from "../cancellation.ts";

import type {
  JointPreparedJob,
  JointSearchOptions,
  ExactRatio,
} from "./joint-types.ts";
import type { JointModel } from "./joint-model.ts";
import type {
  JointCandidateBounds,
  FixedSharedChoice,
} from "./joint-candidate-bounds.ts";
import type { createJointCandidateProofs } from "./joint-candidate-proofs.ts";
import {
  cannotBeatThreshold,
  ratioSumAtOrBelowThreshold,
  sumCappedRatios,
  compareCappedRatioSums,
} from "./joint-arithmetic.ts";

export function createJointSharedBounds(
  options: Pick<JointSearchOptions, "jobs">,
  preparedJobs: readonly JointPreparedJob[],
  model: Pick<
    JointModel,
    | "sharedEquipmentDomains"
    | "sharedEquipmentSelectors"
    | "sharedFoodSelectors"
  >,
  candidates: Pick<
    JointCandidateBounds,
    | "sharedKeyDomains"
    | "sharedBoundPreprocessingStartedAt"
    | "coordinateUpperAttributes"
    | "exactUpperRatio"
    | "resourceBudgetScoreUpperForAttributes"
    | "useResourceBudgetSharedPrefixBounds"
  >,
  proofs: Pick<
    ReturnType<typeof createJointCandidateProofs>,
    "factorScoreUpperCannotBeatThreshold"
  >,
  timing: {
    jointPreprocessingBudgetBaseMs: number;
    isCancelled: () => boolean;
    jointTimeLimitReached: () => boolean;
  },
) {
  const {
    sharedEquipmentDomains,
    sharedEquipmentSelectors,
    sharedFoodSelectors,
  } = model;
  const {
    sharedKeyDomains,
    sharedBoundPreprocessingStartedAt,
    coordinateUpperAttributes,
    exactUpperRatio,
    resourceBudgetScoreUpperForAttributes,
    useResourceBudgetSharedPrefixBounds,
  } = candidates;
  const { factorScoreUpperCannotBeatThreshold } = proofs;
  const { jointPreprocessingBudgetBaseMs, isCancelled, jointTimeLimitReached } =
    timing;
  const sharedPairConflictRows = new Set<string>();
  const sharedAssignmentConflictRows = new Set<string>();
  const sharedAssignmentResourceScoreConflictRows = new Set<string>();
  const sharedEquipmentUpperBounds = sharedEquipmentDomains.flatMap(
    (domain, domainIndex) => {
      const selectors = sharedEquipmentSelectors.get(domain.slot)!;
      return [...selectors].map(([key, selector], choiceIndex) => ({
        selector,
        key,
        fixedChoice: {
          kind: "equipment" as const,
          commonSlot: domain.slot,
          key,
        },
        rowName: `joint_shared_equipment_bound_${domainIndex}_${choiceIndex}`,
        jobRatios: preparedJobs.map((_, jobIndex) => {
          const attributes = coordinateUpperAttributes(jobIndex, [
            { kind: "equipment", commonSlot: domain.slot, key },
          ]);
          return attributes === undefined
            ? undefined
            : exactUpperRatio(jobIndex, attributes);
        }),
      }));
    },
  );
  const sharedFoodUpperBounds =
    sharedFoodSelectors === undefined
      ? []
      : [...sharedFoodSelectors].map(([key, selector], choiceIndex) => ({
          selector,
          key,
          fixedChoice: { kind: "food" as const, key },
          rowName: `joint_shared_food_bound_${choiceIndex}`,
          jobRatios: preparedJobs.map((_, jobIndex) => {
            const attributes = coordinateUpperAttributes(jobIndex, [
              { kind: "food", key },
            ]);
            return attributes === undefined
              ? undefined
              : exactUpperRatio(jobIndex, attributes);
          }),
        }));
  type SharedPairUpperBound = {
    selectorA: string;
    selectorB: string;
    rowName: string;
    jobRatios: readonly ExactRatio[];
  };
  type SharedAssignmentUpperBound = {
    selectors: readonly string[];
    rowName: string;
    jobRatios: readonly ExactRatio[];
    jobScoreUppers?: readonly (bigint | undefined)[];
  };
  const sharedPairCandidateUpperBound = sharedKeyDomains.reduce(
    (total, domain, index) => {
      for (let other = index + 1; other < sharedKeyDomains.length; other++) {
        total +=
          BigInt(domain.selectors.size) *
          BigInt(sharedKeyDomains[other]!.selectors.size);
      }
      return total;
    },
    0n,
  );
  const sharedPairCandidateLimit = 50_000n;
  let sharedPairCandidateCount = 0;
  let sharedPairCandidatesEvaluated = 0;
  let sharedPairPreprocessingMs =
    performance.now() - sharedBoundPreprocessingStartedAt;
  let sharedPairPreprocessingSkipped = false;
  let sharedPairUpperBounds: SharedPairUpperBound[] | undefined;
  const sharedAssignmentCandidateUpperBound = sharedKeyDomains.reduce(
    (product, domain) => product * BigInt(domain.selectors.size),
    1n,
  );
  const sharedAssignmentCompleteEnumerationCandidateLimit = 20_000n;
  const sharedAssignmentTwoJobPrefixCutSkipThreshold = 1_000_000n;
  const useLargeJointSharedAssignmentPolicy =
    preparedJobs.length >= 4 &&
    sharedAssignmentCandidateUpperBound >
      sharedAssignmentCompleteEnumerationCandidateLimit;
  const useRatioOrderedSharedAssignmentPrefixChoices =
    preparedJobs.length >= 4 &&
    sharedAssignmentCandidateUpperBound >
      sharedAssignmentCompleteEnumerationCandidateLimit;
  const sharedAssignmentPrefixChoiceOrder =
    useRatioOrderedSharedAssignmentPrefixChoices
      ? "ascending-exact-capped-single-key-ratio-sum-stable"
      : "input-map-order";
  const sharedAssignmentDomainOrder = sharedKeyDomains
    .map((domain) => `${domain.kind}:${domain.name}`)
    .join("> ");
  const sharedAssignmentPrefixEvaluationLimit =
    useLargeJointSharedAssignmentPolicy ? 100_000 : 20_000;
  const sharedAssignmentUpperBoundLimit = useLargeJointSharedAssignmentPolicy
    ? 2_000
    : Number.MAX_SAFE_INTEGER;
  let sharedAssignmentCandidateCount =
    sharedAssignmentCandidateUpperBound > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(sharedAssignmentCandidateUpperBound);
  let sharedAssignmentCandidatesEvaluated = 0;
  let sharedAssignmentPrefixesEvaluated = 0;
  let sharedAssignmentPreprocessingMs = 0;
  let sharedAssignmentPreprocessingSkipped = false;
  let sharedAssignmentPrefixSearchUsed = false;
  let sharedAssignmentUpperBounds: SharedAssignmentUpperBound[] | undefined;
  const sharedAssignmentCutPrefixDepthCounts: Record<string, number> = {};
  const sharedAssignmentUpperBoundKeys = new Set<string>();
  let sharedAssignmentCompleteEnumerationDone = false;
  let sharedAssignmentProcessedIncumbentKey: string | undefined;
  // 大型共享域的单进程吞吐较低，需要足够的墙钟预算来构造同样的安全前缀剪枝；
  // 该预算仍限制在搜索总时间的 2% 以内。
  const sharedAssignmentPreprocessingBudgetMs = Math.min(
    useLargeJointSharedAssignmentPolicy ? 1_500 : 250,
    jointPreprocessingBudgetBaseMs * 0.02,
  );
  const prepareSharedPairUpperBounds = (
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    if (sharedPairUpperBounds !== undefined || incumbentNumerator <= 0n) return;
    const preprocessingStartedAt = performance.now();
    // 共享配对候选与完整的当前最优总和比较。即使单职业阈值不为正，
    // 配对剪枝仍可能有效。
    const individualThresholdNumerator =
      incumbentNumerator -
      BigInt(options.jobs.length - 1) * incumbentDenominator;
    const singleKeyBoundsBySelector = new Map(
      [...sharedEquipmentUpperBounds, ...sharedFoodUpperBounds].map((bound) => [
        bound.selector,
        bound,
      ]),
    );
    const choicesByDomain = sharedKeyDomains.map((domain) =>
      [...domain.selectors].flatMap(([key, selector]) => {
        const singleKeyBound = singleKeyBoundsBySelector.get(selector);
        if (
          singleKeyBound !== undefined &&
          ((individualThresholdNumerator > 0n &&
            cannotBeatThreshold(
              singleKeyBound.jobRatios,
              individualThresholdNumerator,
              incumbentDenominator,
            )) ||
            ratioSumAtOrBelowThreshold(
              singleKeyBound.jobRatios,
              incumbentNumerator,
              incumbentDenominator,
            ))
        )
          return [];
        const fixedChoice: FixedSharedChoice =
          domain.kind === "equipment"
            ? { kind: "equipment", commonSlot: domain.name, key }
            : { kind: "food", key };
        return [{ key, selector, fixedChoice }];
      }),
    );
    let candidateCount = 0n;
    for (
      let domainIndex = 0;
      domainIndex < choicesByDomain.length;
      domainIndex++
    ) {
      for (
        let other = domainIndex + 1;
        other < choicesByDomain.length;
        other++
      ) {
        candidateCount +=
          BigInt(choicesByDomain[domainIndex]!.length) *
          BigInt(choicesByDomain[other]!.length);
      }
    }
    sharedPairCandidateCount =
      candidateCount > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(candidateCount);
    sharedPairPreprocessingSkipped = candidateCount > sharedPairCandidateLimit;
    const pairBounds: SharedPairUpperBound[] = [];
    if (!sharedPairPreprocessingSkipped) {
      for (
        let domainIndex = 0;
        domainIndex < choicesByDomain.length;
        domainIndex++
      ) {
        for (
          let other = domainIndex + 1;
          other < choicesByDomain.length;
          other++
        ) {
          for (const choiceA of choicesByDomain[domainIndex]!) {
            for (const choiceB of choicesByDomain[other]!) {
              sharedPairCandidatesEvaluated++;
              const jobRatios = preparedJobs.map((_, jobIndex) => {
                const attributes = coordinateUpperAttributes(jobIndex, [
                  choiceA.fixedChoice,
                  choiceB.fixedChoice,
                ]);
                return attributes === undefined
                  ? undefined
                  : exactUpperRatio(jobIndex, attributes);
              });
              if (jobRatios.some((ratio) => ratio === undefined)) continue;
              pairBounds.push({
                selectorA: choiceA.selector,
                selectorB: choiceB.selector,
                rowName: `joint_shared_pair_bound_${domainIndex}_${other}_${sharedPairCandidatesEvaluated - 1}`,
                jobRatios: jobRatios as ExactRatio[],
              });
            }
          }
        }
      }
    }
    sharedPairUpperBounds = pairBounds;
    sharedPairPreprocessingMs += performance.now() - preprocessingStartedAt;
  };
  const prepareSharedAssignmentUpperBounds = (best: ExactRatio | undefined) => {
    if (best === undefined) return;
    const incumbentKey = `${best.numerator}/${best.denominator}`;
    const isCompleteDomain =
      sharedAssignmentCandidateUpperBound <=
      sharedAssignmentCompleteEnumerationCandidateLimit;
    // 对特别大的双职业候选域，反复测量发现两万条浅层前缀剪枝会让严格不可行性证明
    // 比求解未裁剪的小模型慢得多。因此仅在较小的候选域或更大的职业组中保留前缀剪枝。
    if (
      preparedJobs.length === 2 &&
      sharedAssignmentCandidateUpperBound >
        sharedAssignmentTwoJobPrefixCutSkipThreshold
    ) {
      sharedAssignmentPreprocessingSkipped = true;
      return;
    }
    if (isCompleteDomain && sharedAssignmentCompleteEnumerationDone) return;
    if (
      !isCompleteDomain &&
      sharedAssignmentProcessedIncumbentKey === incumbentKey
    )
      return;
    sharedAssignmentProcessedIncumbentKey = incumbentKey;
    sharedAssignmentUpperBounds ??= [];
    sharedAssignmentPreprocessingSkipped = !isCompleteDomain;
    if (!isCompleteDomain) sharedAssignmentPrefixSearchUsed = true;

    const preprocessingStartedAt = performance.now();
    const remainingBudgetMs =
      sharedAssignmentPreprocessingBudgetMs - sharedAssignmentPreprocessingMs;
    if (remainingBudgetMs <= 0) {
      sharedAssignmentPreprocessingSkipped = true;
      return;
    }
    const preprocessingDeadline = preprocessingStartedAt + remainingBudgetMs;
    let workSinceDeadlineCheck = 0;
    let stoppedEarly = false;
    const shouldStop = () => {
      if (
        (sharedAssignmentUpperBounds?.length ?? 0) >=
        sharedAssignmentUpperBoundLimit
      ) {
        stoppedEarly = true;
        sharedAssignmentPreprocessingSkipped = true;
        return true;
      }
      if (
        sharedAssignmentPrefixesEvaluated >=
        sharedAssignmentPrefixEvaluationLimit
      ) {
        stoppedEarly = true;
        sharedAssignmentPreprocessingSkipped = true;
        return true;
      }
      if ((++workSinceDeadlineCheck & 7) !== 0) return false;
      throwIfCancelled(isCancelled);
      if (
        performance.now() >= preprocessingDeadline ||
        jointTimeLimitReached()
      ) {
        stoppedEarly = true;
        sharedAssignmentPreprocessingSkipped = true;
        return true;
      }
      return false;
    };
    const recordUpperBound = (
      selectors: readonly string[],
      jobRatios: readonly ExactRatio[],
      jobScoreUppers?: readonly (bigint | undefined)[],
    ) => {
      const key = JSON.stringify(selectors);
      if (sharedAssignmentUpperBoundKeys.has(key)) return;
      sharedAssignmentUpperBoundKeys.add(key);
      sharedAssignmentUpperBounds!.push({
        selectors,
        rowName: `joint_shared_assignment_bound_${sharedAssignmentUpperBounds!.length}`,
        jobRatios,
        ...(jobScoreUppers === undefined ? {} : { jobScoreUppers }),
      });
      const depth = String(selectors.length);
      sharedAssignmentCutPrefixDepthCounts[depth] =
        (sharedAssignmentCutPrefixDepthCounts[depth] ?? 0) + 1;
    };
    try {
      const chosen: { selector: string; fixedChoice: FixedSharedChoice }[] = [];
      const singleKeyBoundsBySelector = new Map(
        [...sharedEquipmentUpperBounds, ...sharedFoodUpperBounds].map(
          (bound) => [bound.selector, bound],
        ),
      );
      const orderedSelectorsByDomain = sharedKeyDomains.map((domain) => {
        const selectors = [...domain.selectors];
        if (!useRatioOrderedSharedAssignmentPrefixChoices) return selectors;
        return selectors
          .map(([key, selector], originalIndex) => ({
            key,
            selector,
            originalIndex,
            ratioSum: sumCappedRatios(
              singleKeyBoundsBySelector.get(selector)?.jobRatios ?? [undefined],
            ),
          }))
          .sort(
            (left, right) =>
              compareCappedRatioSums(left.ratioSum, right.ratioSum) ||
              left.originalIndex - right.originalIndex,
          )
          .map(({ key, selector }) => [key, selector] as const);
      });
      const visit = (domainIndex: number): void => {
        if (stoppedEarly || shouldStop()) return;
        if (domainIndex === sharedKeyDomains.length) {
          sharedAssignmentCandidatesEvaluated++;
          const jobRatios: ExactRatio[] = [];
          const jobScoreUppers: (bigint | undefined)[] | undefined =
            useResourceBudgetSharedPrefixBounds ? [] : undefined;
          for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
            if (shouldStop()) return;
            const attributes = coordinateUpperAttributes(
              jobIndex,
              chosen.map((entry) => entry.fixedChoice),
            );
            const ratio =
              attributes === undefined
                ? undefined
                : exactUpperRatio(jobIndex, attributes);
            if (ratio === undefined) return;
            jobRatios.push(ratio);
            if (jobScoreUppers !== undefined) {
              jobScoreUppers.push(
                resourceBudgetScoreUpperForAttributes(jobIndex, attributes!),
              );
            }
          }
          recordUpperBound(
            chosen.map((entry) => entry.selector),
            jobRatios,
            jobScoreUppers,
          );
          return;
        }
        const domain = sharedKeyDomains[domainIndex]!;
        for (const [key, selector] of orderedSelectorsByDomain[domainIndex]!) {
          if (stoppedEarly || shouldStop()) return;
          chosen.push({
            selector,
            fixedChoice:
              domain.kind === "equipment"
                ? { kind: "equipment", commonSlot: domain.name, key }
                : { kind: "food", key },
          });
          sharedAssignmentPrefixesEvaluated++;
          if (isCompleteDomain) {
            visit(domainIndex + 1);
          } else {
            const jobRatios: ExactRatio[] = [];
            const jobScoreUppers: (bigint | undefined)[] | undefined =
              useResourceBudgetSharedPrefixBounds ? [] : undefined;
            let hasUnknownBound = false;
            for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
              if (shouldStop()) return;
              const attributes = coordinateUpperAttributes(
                jobIndex,
                chosen.map((entry) => entry.fixedChoice),
              );
              const ratio =
                attributes === undefined
                  ? undefined
                  : exactUpperRatio(jobIndex, attributes);
              if (ratio === undefined) {
                hasUnknownBound = true;
                break;
              }
              jobRatios.push(ratio);
              if (jobScoreUppers !== undefined) {
                jobScoreUppers.push(
                  domainIndex + 1 === sharedKeyDomains.length
                    ? resourceBudgetScoreUpperForAttributes(
                        jobIndex,
                        attributes!,
                      )
                    : undefined,
                );
              }
            }
            // 每项属性分别取最大值会高估此此前缀下的所有补全方案，
            // 因此可用一条约束排除不可能改进的前缀，而不必遍历其余共享选择。
            if (
              !stoppedEarly &&
              !hasUnknownBound &&
              ((jobScoreUppers !== undefined &&
                factorScoreUpperCannotBeatThreshold(
                  jobScoreUppers,
                  best!.numerator -
                    BigInt(preparedJobs.length - 1) * best!.denominator,
                  best!.denominator,
                )) ||
                ratioSumAtOrBelowThreshold(
                  jobRatios,
                  best!.numerator,
                  best!.denominator,
                ))
            ) {
              recordUpperBound(
                chosen.map((entry) => entry.selector),
                jobRatios,
                jobScoreUppers,
              );
            } else if (
              !stoppedEarly &&
              domainIndex + 1 < sharedKeyDomains.length
            ) {
              visit(domainIndex + 1);
            } else if (
              !stoppedEarly &&
              !hasUnknownBound &&
              domainIndex + 1 === sharedKeyDomains.length
            ) {
              sharedAssignmentCandidatesEvaluated++;
            } else if (
              !stoppedEarly &&
              hasUnknownBound &&
              domainIndex + 1 === sharedKeyDomains.length
            ) {
              sharedAssignmentCandidatesEvaluated++;
            }
          }
          chosen.pop();
          if (stoppedEarly) return;
        }
      };
      visit(0);
      if (isCompleteDomain && !stoppedEarly)
        sharedAssignmentCompleteEnumerationDone = true;
    } finally {
      sharedAssignmentPreprocessingMs +=
        performance.now() - preprocessingStartedAt;
    }
  };
  return {
    get sharedPairConflictRows() {
      return sharedPairConflictRows;
    },
    get sharedAssignmentConflictRows() {
      return sharedAssignmentConflictRows;
    },
    get sharedAssignmentResourceScoreConflictRows() {
      return sharedAssignmentResourceScoreConflictRows;
    },
    get sharedEquipmentUpperBounds() {
      return sharedEquipmentUpperBounds;
    },
    get sharedFoodUpperBounds() {
      return sharedFoodUpperBounds;
    },
    get sharedPairCandidateUpperBound() {
      return sharedPairCandidateUpperBound;
    },
    get sharedPairCandidateCount() {
      return sharedPairCandidateCount;
    },
    get sharedPairCandidatesEvaluated() {
      return sharedPairCandidatesEvaluated;
    },
    get sharedPairPreprocessingMs() {
      return sharedPairPreprocessingMs;
    },
    get sharedPairPreprocessingSkipped() {
      return sharedPairPreprocessingSkipped;
    },
    get sharedPairUpperBounds() {
      return sharedPairUpperBounds;
    },
    get sharedAssignmentCandidateUpperBound() {
      return sharedAssignmentCandidateUpperBound;
    },
    get sharedAssignmentPrefixChoiceOrder() {
      return sharedAssignmentPrefixChoiceOrder;
    },
    get sharedAssignmentDomainOrder() {
      return sharedAssignmentDomainOrder;
    },
    get sharedAssignmentPrefixEvaluationLimit() {
      return sharedAssignmentPrefixEvaluationLimit;
    },
    get sharedAssignmentUpperBoundLimit() {
      return sharedAssignmentUpperBoundLimit;
    },
    get sharedAssignmentCandidateCount() {
      return sharedAssignmentCandidateCount;
    },
    get sharedAssignmentCandidatesEvaluated() {
      return sharedAssignmentCandidatesEvaluated;
    },
    get sharedAssignmentPrefixesEvaluated() {
      return sharedAssignmentPrefixesEvaluated;
    },
    get sharedAssignmentPreprocessingMs() {
      return sharedAssignmentPreprocessingMs;
    },
    get sharedAssignmentPreprocessingSkipped() {
      return sharedAssignmentPreprocessingSkipped;
    },
    get sharedAssignmentPrefixSearchUsed() {
      return sharedAssignmentPrefixSearchUsed;
    },
    get sharedAssignmentUpperBounds() {
      return sharedAssignmentUpperBounds;
    },
    get sharedAssignmentCutPrefixDepthCounts() {
      return sharedAssignmentCutPrefixDepthCounts;
    },
    get sharedAssignmentPreprocessingBudgetMs() {
      return sharedAssignmentPreprocessingBudgetMs;
    },
    get prepareSharedPairUpperBounds() {
      return prepareSharedPairUpperBounds;
    },
    get prepareSharedAssignmentUpperBounds() {
      return prepareSharedAssignmentUpperBounds;
    },
  };
}
