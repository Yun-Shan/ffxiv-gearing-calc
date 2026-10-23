import { throwIfCancelled } from "../cancellation.ts";
import type { ModelRow } from "../core/model-types.ts";
import { addRows } from "../core/model-builder.ts";
import { gcd } from "../core/exact-arithmetic.ts";

import type {
  JointPreparedJob,
  JointSearchOptions,
  ExactRatio,
} from "./joint-types.ts";
import type { JointModel } from "./joint-model.ts";
import type {
  JointCandidateBounds,
  FactorClassUpperBound,
} from "./joint-candidate-bounds.ts";
import type { JointRatioEnvelope } from "./joint-ratio-envelope.ts";
import {
  ratioAtOrBelowThreshold,
  ratioSumAtOrBelowThreshold,
} from "./joint-arithmetic.ts";

export function createJointFactorCuts(
  options: Pick<JointSearchOptions, "objective">,
  preparedJobs: readonly JointPreparedJob[],
  model: Pick<JointModel, "bounds" | "prefix">,
  candidates: Pick<
    JointCandidateBounds,
    | "factorClassUpperBounds"
    | "factorClassUpperBoundsByJobAndGroup"
    | "compareExactRatios"
  >,
  envelope: Pick<
    JointRatioEnvelope,
    | "ratioUpperBoundVariables"
    | "ratioUpperBoundScale"
    | "ratioUpperCoefficientExact"
  >,
  timing: { isCancelled: () => boolean; jointTimeLimitReached: () => boolean },
) {
  const { bounds, prefix } = model;
  const {
    factorClassUpperBounds,
    factorClassUpperBoundsByJobAndGroup,
    compareExactRatios,
  } = candidates;
  const {
    ratioUpperBoundVariables,
    ratioUpperBoundScale,
    ratioUpperCoefficientExact,
  } = envelope;
  const { isCancelled, jointTimeLimitReached } = timing;
  const factorClassConflictRows = new Set<string>();
  const factorClassPairConflictRows = new Set<string>();
  const factorClassJointPairConflictRows = new Map<string, ModelRow>();
  let factorClassJointPairCutSequence = 0;
  const factorClassJointTripleConflictRows = new Map<string, ModelRow>();
  const factorClassJointTripleCutIncumbentKeys = new Set<string>();
  let factorClassJointTripleCutSequence = 0;
  let factorClassJointTripleCutNonzeros = 0;
  const factorClassTripleConflictRows = new Set<string>();
  const factorClassTripleCutRows = new Map<string, ModelRow>();
  const factorClassTripleCutIncumbentKeys = new Set<string>();
  let factorClassTriplePreprocessingWork = 0;
  let factorClassTriplePreprocessingSkipped = false;
  const factorClassTriplePreprocessingWorkLimit = 1_000_000;
  const ratioUpperNecessaryRows = new Set<string>();
  const addCrossJobFactorClassGroupPairCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    const jobCount = preparedJobs.length;
    if (jobCount < 2) return;
    const individualThreshold =
      incumbentNumerator - BigInt(jobCount - 1) * incumbentDenominator;
    const pairThreshold =
      incumbentNumerator - BigInt(jobCount - 2) * incumbentDenominator;
    if (pairThreshold <= 0n) return;

    // 若联合总和有所提升，任意两个职业的比值都必须超过 B-(n-2)，
    // 因为其余 n-2 个比值都至多为 1。
    const compareRatios = (left: ExactRatio, right: ExactRatio) => {
      const comparison =
        left.numerator * right.denominator - right.numerator * left.denominator;
      return comparison < 0n ? -1 : comparison > 0n ? 1 : 0;
    };
    const eligibleByJobAndGroup = preparedJobs.map(({ prepared }, jobIndex) =>
      prepared.groups.map((group) =>
        factorClassUpperBounds
          .filter(
            (bound) =>
              bound.jobIndex === jobIndex &&
              bound.groupName === group.name &&
              bound.ratio.numerator < bound.ratio.denominator &&
              !ratioAtOrBelowThreshold(
                bound.ratio,
                individualThreshold,
                incumbentDenominator,
              ),
          )
          .sort(
            (left, right) =>
              compareRatios(left.ratio, right.ratio) ||
              left.variable.localeCompare(right.variable),
          ),
      ),
    );

    const pendingByJobPair = new Map<
      string,
      {
        rowName: string;
        jobA: number;
        jobB: number;
        prefixA: readonly FactorClassUpperBound[];
        prefixB: readonly FactorClassUpperBound[];
        coverage: number;
      }[]
    >();
    for (let jobA = 0; jobA < jobCount; jobA++) {
      for (let jobB = jobA + 1; jobB < jobCount; jobB++) {
        for (
          let groupAIndex = 0;
          groupAIndex < eligibleByJobAndGroup[jobA]!.length;
          groupAIndex++
        ) {
          const groupA = eligibleByJobAndGroup[jobA]![groupAIndex]!;
          if (groupA.length === 0) continue;
          for (
            let groupBIndex = 0;
            groupBIndex < eligibleByJobAndGroup[jobB]!.length;
            groupBIndex++
          ) {
            const groupB = eligibleByJobAndGroup[jobB]![groupBIndex]!;
            if (groupB.length === 0) continue;
            let prefixBLength = groupB.length;
            let coverage = 0;
            let prefixALength = 0;
            for (
              let candidateA = 1;
              candidateA <= groupA.length;
              candidateA++
            ) {
              while (
                prefixBLength > 0 &&
                !ratioSumAtOrBelowThreshold(
                  [
                    groupA[candidateA - 1]!.ratio,
                    groupB[prefixBLength - 1]!.ratio,
                  ],
                  pairThreshold,
                  incumbentDenominator,
                )
              )
                prefixBLength--;
              const candidateCoverage = candidateA * prefixBLength;
              if (candidateCoverage > coverage) {
                coverage = candidateCoverage;
                prefixALength = candidateA;
              }
            }
            if (coverage === 0) continue;
            const groupAName =
              preparedJobs[jobA]!.prepared.groups[groupAIndex]!.name;
            const groupBName =
              preparedJobs[jobB]!.prepared.groups[groupBIndex]!.name;
            const key = `${jobA}:${jobB}`;
            const cuts = pendingByJobPair.get(key) ?? [];
            cuts.push({
              rowName: `joint_necessary_class_group_pair_${jobA}_${groupAName}_${jobB}_${groupBName}`,
              jobA,
              jobB,
              prefixA: groupA.slice(0, prefixALength),
              prefixB: groupB.slice(0, Math.floor(coverage / prefixALength)),
              coverage,
            });
            pendingByJobPair.set(key, cuts);
          }
        }
      }
    }

    const selectedCuts = [...pendingByJobPair.values()]
      .flatMap((cuts) =>
        cuts
          .sort(
            (left, right) =>
              right.coverage - left.coverage ||
              left.rowName.localeCompare(right.rowName),
          )
          .slice(0, 8),
      )
      .sort(
        (left, right) =>
          right.coverage - left.coverage ||
          left.rowName.localeCompare(right.rowName),
      )
      .slice(0, 32);
    for (const cut of selectedCuts) {
      addRows(
        solveRows,
        cut.rowName,
        [
          ...cut.prefixA.map(
            (bound) => [prefix(cut.jobA, bound.variable), 1] as const,
          ),
          ...cut.prefixB.map(
            (bound) => [prefix(cut.jobB, bound.variable), 1] as const,
          ),
        ],
        "<=",
        1,
      );
      factorClassPairConflictRows.add(cut.rowName);
    }
  };
  const addTwoJobWithinJobFactorPairCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    for (const row of factorClassJointPairConflictRows.values())
      solveRows.push(row);
    if (preparedJobs.length !== 2) return;
    const necessaryJobNumerator = incumbentNumerator - incumbentDenominator;
    if (necessaryJobNumerator <= 0n) return;

    const pendingCuts: {
      key: string;
      rowName: string;
      jobIndex: number;
      prefixA: readonly FactorClassUpperBound[];
      prefixB: readonly FactorClassUpperBound[];
      coverage: number;
    }[] = [];
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const groups = preparedJobs[jobIndex]!.prepared.groups.filter(
        (group) => group.name !== "gcd" || options.objective === "dps",
      ).map((group) => ({
        group,
        bounds:
          factorClassUpperBoundsByJobAndGroup[jobIndex]!.get(group.name) ?? [],
      }));
      if (
        groups.some(
          ({ group, bounds: groupBounds }) =>
            groupBounds.length !== group.classes.length ||
            groupBounds.length === 0,
        )
      )
        continue;
      const groupMaxima = groups.map(({ bounds: groupBounds }) =>
        groupBounds.reduce(
          (maximum, bound) =>
            compareExactRatios(bound.ratio, maximum) > 0
              ? bound.ratio
              : maximum,
          { numerator: 0n, denominator: 1n } as ExactRatio,
        ),
      );
      const envelope = groupMaxima[0]!;
      if (
        envelope.numerator <= 0n ||
        groupMaxima.some(
          (maximum) => compareExactRatios(maximum, envelope) !== 0,
        )
      )
        continue;

      for (let groupAIndex = 0; groupAIndex < groups.length; groupAIndex++) {
        const groupA = groups[groupAIndex]!;
        const eligibleA = groupA.bounds
          .filter(
            (bound) =>
              !ratioAtOrBelowThreshold(
                bound.ratio,
                necessaryJobNumerator,
                incumbentDenominator,
              ),
          )
          .sort(
            (left, right) =>
              compareExactRatios(left.ratio, right.ratio) ||
              left.variable.localeCompare(right.variable),
          );
        if (eligibleA.length === 0) continue;
        for (
          let groupBIndex = groupAIndex + 1;
          groupBIndex < groups.length;
          groupBIndex++
        ) {
          const groupB = groups[groupBIndex]!;
          const eligibleB = groupB.bounds
            .filter(
              (bound) =>
                !ratioAtOrBelowThreshold(
                  bound.ratio,
                  necessaryJobNumerator,
                  incumbentDenominator,
                ),
            )
            .sort(
              (left, right) =>
                compareExactRatios(left.ratio, right.ratio) ||
                left.variable.localeCompare(right.variable),
            );
          if (eligibleB.length === 0) continue;

          const pairRatioAtOrBelowThreshold = (
            left: FactorClassUpperBound,
            right: FactorClassUpperBound,
          ) => {
            const pairRatio = {
              numerator:
                left.ratio.numerator *
                right.ratio.numerator *
                envelope.denominator,
              denominator:
                left.ratio.denominator *
                right.ratio.denominator *
                envelope.numerator,
            };
            return ratioAtOrBelowThreshold(
              pairRatio,
              necessaryJobNumerator,
              incumbentDenominator,
            );
          };
          let prefixBLength = eligibleB.length;
          let bestCoverage = 0;
          let bestPrefixALength = 0;
          let bestPrefixBLength = 0;
          for (
            let prefixALength = 1;
            prefixALength <= eligibleA.length;
            prefixALength++
          ) {
            while (
              prefixBLength > 0 &&
              !pairRatioAtOrBelowThreshold(
                eligibleA[prefixALength - 1]!,
                eligibleB[prefixBLength - 1]!,
              )
            )
              prefixBLength--;
            const coverage = prefixALength * prefixBLength;
            if (coverage > bestCoverage) {
              bestCoverage = coverage;
              bestPrefixALength = prefixALength;
              bestPrefixBLength = prefixBLength;
            }
          }
          if (bestCoverage === 0) continue;
          const prefixA = eligibleA.slice(0, bestPrefixALength);
          const prefixB = eligibleB.slice(0, bestPrefixBLength);
          const key = JSON.stringify([
            jobIndex,
            groupA.group.name,
            groupB.group.name,
            prefixA.map((bound) => bound.variable),
            prefixB.map((bound) => bound.variable),
          ]);
          if (factorClassJointPairConflictRows.has(key)) continue;
          pendingCuts.push({
            key,
            rowName: `joint_necessary_factor_pair_candidate_${jobIndex}_${groupA.group.name}_${groupB.group.name}_${pendingCuts.length}`,
            jobIndex,
            prefixA,
            prefixB,
            coverage: bestCoverage,
          });
        }
      }
    }

    const selectedCuts = pendingCuts
      .sort(
        (left, right) =>
          right.coverage - left.coverage ||
          left.rowName.localeCompare(right.rowName),
      )
      .slice(0, 32);
    let addedNonzeros = 0;
    for (const cut of selectedCuts) {
      const nonzeros = cut.prefixA.length + cut.prefixB.length;
      if (addedNonzeros + nonzeros > 25_000) continue;
      addRows(
        solveRows,
        `joint_necessary_factor_pair_${factorClassJointPairCutSequence++}`,
        [
          ...cut.prefixA.map(
            (bound) => [prefix(cut.jobIndex, bound.variable), 1] as const,
          ),
          ...cut.prefixB.map(
            (bound) => [prefix(cut.jobIndex, bound.variable), 1] as const,
          ),
        ],
        "<=",
        1,
      );
      addedNonzeros += nonzeros;
      factorClassJointPairConflictRows.set(
        cut.key,
        solveRows[solveRows.length - 1]!,
      );
    }
  };
  const addTwoJobWithinJobFactorTripleCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    for (const row of factorClassJointTripleConflictRows.values())
      solveRows.push(row);
    if (preparedJobs.length !== 2) return;
    const incumbentKey = `${incumbentNumerator}/${incumbentDenominator}`;
    if (factorClassJointTripleCutIncumbentKeys.has(incumbentKey)) return;
    factorClassJointTripleCutIncumbentKeys.add(incumbentKey);
    const necessaryJobNumerator = incumbentNumerator - incumbentDenominator;
    if (necessaryJobNumerator <= 0n) return;

    const pendingCuts: {
      key: string;
      rowName: string;
      jobIndex: number;
      prefixes: readonly [
        readonly FactorClassUpperBound[],
        readonly FactorClassUpperBound[],
        readonly FactorClassUpperBound[],
      ];
      coverage: number;
    }[] = [];
    const ratioProductAtOrBelowThreshold = (
      ratios: readonly ExactRatio[],
      envelope: ExactRatio,
    ) => {
      if (
        ratios.some((ratio) => ratio.denominator <= 0n) ||
        envelope.numerator <= 0n
      )
        return false;
      const productNumerator =
        ratios.reduce((product, ratio) => product * ratio.numerator, 1n) *
        envelope.denominator ** BigInt(ratios.length - 1);
      const productDenominator =
        ratios.reduce((product, ratio) => product * ratio.denominator, 1n) *
        envelope.numerator ** BigInt(ratios.length - 1);
      return (
        productNumerator * incumbentDenominator <=
        necessaryJobNumerator * productDenominator
      );
    };
    const samplePrefixLengths = (length: number) => [
      ...new Set([
        1,
        Math.max(1, Math.floor(length / 4)),
        Math.max(1, Math.floor(length / 2)),
        length,
      ]),
    ];

    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const groups = preparedJobs[jobIndex]!.prepared.groups.filter(
        (group) => group.name !== "gcd" || options.objective === "dps",
      ).map((group) => ({
        group,
        bounds:
          factorClassUpperBoundsByJobAndGroup[jobIndex]!.get(group.name) ?? [],
      }));
      if (
        groups.some(
          ({ group, bounds: groupBounds }) =>
            groupBounds.length !== group.classes.length ||
            groupBounds.length === 0,
        )
      )
        continue;
      const groupMaxima = groups.map(({ bounds: groupBounds }) =>
        groupBounds.reduce(
          (maximum, bound) =>
            compareExactRatios(bound.ratio, maximum) > 0
              ? bound.ratio
              : maximum,
          { numerator: 0n, denominator: 1n } as ExactRatio,
        ),
      );
      const envelope = groupMaxima[0]!;
      if (
        envelope.numerator <= 0n ||
        groupMaxima.some(
          (maximum) => compareExactRatios(maximum, envelope) !== 0,
        )
      )
        continue;
      const eligibleByGroup = groups.map(({ group, bounds: groupBounds }) => ({
        group,
        bounds: groupBounds
          .filter(
            (bound) =>
              !ratioAtOrBelowThreshold(
                bound.ratio,
                necessaryJobNumerator,
                incumbentDenominator,
              ),
          )
          .sort(
            (left, right) =>
              compareExactRatios(left.ratio, right.ratio) ||
              left.variable.localeCompare(right.variable),
          ),
      }));

      for (
        let groupAIndex = 0;
        groupAIndex < eligibleByGroup.length;
        groupAIndex++
      ) {
        const groupA = eligibleByGroup[groupAIndex]!;
        if (groupA.bounds.length === 0) continue;
        for (
          let groupBIndex = groupAIndex + 1;
          groupBIndex < eligibleByGroup.length;
          groupBIndex++
        ) {
          const groupB = eligibleByGroup[groupBIndex]!;
          if (groupB.bounds.length === 0) continue;
          for (
            let groupCIndex = groupBIndex + 1;
            groupCIndex < eligibleByGroup.length;
            groupCIndex++
          ) {
            const groupC = eligibleByGroup[groupCIndex]!;
            if (groupC.bounds.length === 0) continue;
            let bestCoverage = 0;
            let bestLengths: readonly [number, number, number] | undefined;
            for (const prefixALength of samplePrefixLengths(
              groupA.bounds.length,
            )) {
              for (const prefixBLength of samplePrefixLengths(
                groupB.bounds.length,
              )) {
                let low = 0;
                let high = groupC.bounds.length;
                while (low < high) {
                  const middle = Math.ceil((low + high) / 2);
                  if (
                    ratioProductAtOrBelowThreshold(
                      [
                        groupA.bounds[prefixALength - 1]!.ratio,
                        groupB.bounds[prefixBLength - 1]!.ratio,
                        groupC.bounds[middle - 1]!.ratio,
                      ],
                      envelope,
                    )
                  )
                    low = middle;
                  else high = middle - 1;
                }
                const coverage = prefixALength * prefixBLength * low;
                if (coverage > bestCoverage) {
                  bestCoverage = coverage;
                  bestLengths = [prefixALength, prefixBLength, low];
                }
              }
            }
            if (bestLengths === undefined || bestCoverage === 0) continue;
            const prefixes = [
              groupA.bounds.slice(0, bestLengths[0]),
              groupB.bounds.slice(0, bestLengths[1]),
              groupC.bounds.slice(0, bestLengths[2]),
            ] as const;
            const key = JSON.stringify([
              jobIndex,
              groupA.group.name,
              groupB.group.name,
              groupC.group.name,
              ...prefixes.map((prefixBounds) =>
                prefixBounds.map((bound) => bound.variable),
              ),
            ]);
            if (factorClassJointTripleConflictRows.has(key)) continue;
            pendingCuts.push({
              key,
              rowName: `joint_necessary_factor_triple_${jobIndex}_${groupA.group.name}_${groupB.group.name}_${groupC.group.name}_${factorClassJointTripleConflictRows.size + pendingCuts.length}`,
              jobIndex,
              prefixes,
              coverage: bestCoverage,
            });
          }
        }
      }
    }

    const selectedCuts = pendingCuts
      .sort(
        (left, right) =>
          right.coverage - left.coverage ||
          left.rowName.localeCompare(right.rowName),
      )
      .slice(0, Math.max(0, 24 - factorClassJointTripleConflictRows.size));
    for (const cut of selectedCuts) {
      const nonzeros = cut.prefixes.reduce(
        (sum, prefixBounds) => sum + prefixBounds.length,
        0,
      );
      if (factorClassJointTripleCutNonzeros + nonzeros > 25_000) continue;
      addRows(
        solveRows,
        `joint_necessary_factor_triple_${factorClassJointTripleCutSequence++}`,
        cut.prefixes.flatMap((prefixBounds) =>
          prefixBounds.map(
            (bound) => [prefix(cut.jobIndex, bound.variable), 1] as const,
          ),
        ),
        "<=",
        2,
      );
      factorClassJointTripleCutNonzeros += nonzeros;
      factorClassJointTripleConflictRows.set(
        cut.key,
        solveRows[solveRows.length - 1]!,
      );
    }
  };
  const addCrossJobFactorClassGroupTripleCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    for (const row of factorClassTripleCutRows.values()) solveRows.push(row);
    const incumbentKey = `${incumbentNumerator}/${incumbentDenominator}`;
    if (factorClassTripleCutIncumbentKeys.has(incumbentKey)) return;
    factorClassTripleCutIncumbentKeys.add(incumbentKey);

    const jobCount = preparedJobs.length;
    if (jobCount < 3) return;
    const individualThreshold =
      incumbentNumerator - BigInt(jobCount - 1) * incumbentDenominator;
    const tripleThreshold =
      incumbentNumerator - BigInt(jobCount - 3) * incumbentDenominator;
    if (tripleThreshold <= 0n) return;
    if (
      factorClassTriplePreprocessingSkipped ||
      factorClassTriplePreprocessingWork >=
        factorClassTriplePreprocessingWorkLimit
    ) {
      factorClassTriplePreprocessingSkipped = true;
      return;
    }
    const consumeWork = (work: number): boolean => {
      const previousWork = factorClassTriplePreprocessingWork;
      factorClassTriplePreprocessingWork += work;
      if (
        factorClassTriplePreprocessingWork >
        factorClassTriplePreprocessingWorkLimit
      ) {
        factorClassTriplePreprocessingSkipped = true;
        return false;
      }
      if (
        Math.floor(factorClassTriplePreprocessingWork / 256) >
        Math.floor(previousWork / 256)
      ) {
        throwIfCancelled(isCancelled);
        if (jointTimeLimitReached()) {
          factorClassTriplePreprocessingSkipped = true;
          return false;
        }
      }
      return true;
    };
    const eligibleByJobAndGroup = [] as {
      groupName: string;
      bounds: FactorClassUpperBound[];
    }[][];
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const groups: { groupName: string; bounds: FactorClassUpperBound[] }[] =
        [];
      for (const [
        groupName,
        boundsForGroup,
      ] of factorClassUpperBoundsByJobAndGroup[jobIndex]!) {
        if (!consumeWork(boundsForGroup.length + 1)) return;
        groups.push({
          groupName,
          bounds: boundsForGroup.filter(
            (bound) =>
              bound.ratio.numerator < bound.ratio.denominator &&
              !ratioAtOrBelowThreshold(
                bound.ratio,
                individualThreshold,
                incumbentDenominator,
              ),
          ),
        });
      }
      eligibleByJobAndGroup.push(groups);
    }
    const pendingByJobTriple = new Map<
      string,
      {
        rowName: string;
        jobs: readonly [number, number, number];
        prefixes: readonly [
          readonly FactorClassUpperBound[],
          readonly FactorClassUpperBound[],
          readonly FactorClassUpperBound[],
        ];
        coverage: number;
      }[]
    >();

    tripleCandidates: for (let jobA = 0; jobA < jobCount; jobA++) {
      for (let jobB = jobA + 1; jobB < jobCount; jobB++) {
        for (let jobC = jobB + 1; jobC < jobCount; jobC++) {
          if (!consumeWork(1)) break tripleCandidates;
          const groupsA = eligibleByJobAndGroup[jobA]!;
          const groupsB = eligibleByJobAndGroup[jobB]!;
          const groupsC = eligibleByJobAndGroup[jobC]!;
          const groupTriples: {
            groupA: (typeof groupsA)[number];
            groupB: (typeof groupsB)[number];
            groupC: (typeof groupsC)[number];
            estimatedCoverage: number;
          }[] = [];
          for (const groupA of groupsA) {
            if (groupA.bounds.length === 0) continue;
            for (const groupB of groupsB) {
              if (groupB.bounds.length === 0) continue;
              for (const groupC of groupsC) {
                if (
                  groupC.bounds.length === 0 ||
                  !ratioSumAtOrBelowThreshold(
                    [
                      groupA.bounds[0]!.ratio,
                      groupB.bounds[0]!.ratio,
                      groupC.bounds[0]!.ratio,
                    ],
                    tripleThreshold,
                    incumbentDenominator,
                  )
                )
                  continue;
                const samplePrefixLengths = (length: number) => [
                  ...new Set([
                    1,
                    Math.max(1, Math.floor(length / 4)),
                    Math.max(1, Math.floor(length / 2)),
                    length,
                  ]),
                ];
                let estimatedCoverage = 0;
                const sampleA = samplePrefixLengths(groupA.bounds.length);
                const sampleB = samplePrefixLengths(groupB.bounds.length);
                for (const prefixALength of sampleA) {
                  for (const prefixBLength of sampleB) {
                    let low = 0;
                    let high = groupC.bounds.length;
                    while (low < high) {
                      const middle = Math.ceil((low + high) / 2);
                      if (
                        ratioSumAtOrBelowThreshold(
                          [
                            groupA.bounds[prefixALength - 1]!.ratio,
                            groupB.bounds[prefixBLength - 1]!.ratio,
                            groupC.bounds[middle - 1]!.ratio,
                          ],
                          tripleThreshold,
                          incumbentDenominator,
                        )
                      )
                        low = middle;
                      else high = middle - 1;
                    }
                    estimatedCoverage = Math.max(
                      estimatedCoverage,
                      prefixALength * prefixBLength * low,
                    );
                  }
                }
                if (estimatedCoverage > 0)
                  groupTriples.push({
                    groupA,
                    groupB,
                    groupC,
                    estimatedCoverage,
                  });
              }
            }
          }
          groupTriples.sort(
            (left, right) =>
              right.estimatedCoverage - left.estimatedCoverage ||
              `${left.groupA.groupName}|${left.groupB.groupName}|${left.groupC.groupName}`.localeCompare(
                `${right.groupA.groupName}|${right.groupB.groupName}|${right.groupC.groupName}`,
              ),
          );
          for (const {
            groupA: groupAEntry,
            groupB: groupBEntry,
            groupC: groupCEntry,
          } of groupTriples) {
            if (!consumeWork(1)) break tripleCandidates;
            const groupA = groupAEntry.bounds;
            const groupB = groupBEntry.bounds;
            const groupC = groupCEntry.bounds;

            let coverage = 0;
            let prefixALength = 0;
            let prefixBLength = 0;
            for (
              let candidateA = 1;
              candidateA <= groupA.length;
              candidateA++
            ) {
              if (!consumeWork(1)) break tripleCandidates;
              // 上一个 candidateA 可能为最后一个 B 缩小了 C 的范围；
              // 开始当前外层前缀遍历时，需重新使用完整的 C 范围。
              let prefixCLength = groupC.length;
              for (
                let candidateB = 1;
                candidateB <= groupB.length;
                candidateB++
              ) {
                if (!consumeWork(1)) break tripleCandidates;
                while (
                  prefixCLength > 0 &&
                  !ratioSumAtOrBelowThreshold(
                    [
                      groupA[candidateA - 1]!.ratio,
                      groupB[candidateB - 1]!.ratio,
                      groupC[prefixCLength - 1]!.ratio,
                    ],
                    tripleThreshold,
                    incumbentDenominator,
                  )
                ) {
                  prefixCLength--;
                  if (!consumeWork(1)) break tripleCandidates;
                }
                const candidateCoverage =
                  candidateA * candidateB * prefixCLength;
                if (candidateCoverage > coverage) {
                  coverage = candidateCoverage;
                  prefixALength = candidateA;
                  prefixBLength = candidateB;
                }
              }
            }
            if (coverage === 0) continue;
            const key = `${jobA}:${jobB}:${jobC}`;
            const cuts = pendingByJobTriple.get(key) ?? [];
            cuts.push({
              rowName: `joint_necessary_class_group_triple_${jobA}_${groupAEntry.groupName}_${jobB}_${groupBEntry.groupName}_${jobC}_${groupCEntry.groupName}`,
              jobs: [jobA, jobB, jobC],
              prefixes: [
                groupA.slice(0, prefixALength),
                groupB.slice(0, prefixBLength),
                groupC.slice(
                  0,
                  Math.floor(coverage / prefixALength / prefixBLength),
                ),
              ],
              coverage,
            });
            pendingByJobTriple.set(key, cuts);
          }
        }
      }
    }
    const selectedCuts = [...pendingByJobTriple.values()]
      .flatMap((cuts) =>
        cuts
          .sort(
            (left, right) =>
              right.coverage - left.coverage ||
              left.rowName.localeCompare(right.rowName),
          )
          .slice(0, 8),
      )
      .sort(
        (left, right) =>
          right.coverage - left.coverage ||
          left.rowName.localeCompare(right.rowName),
      )
      .slice(0, 32);
    for (const cut of selectedCuts) {
      const [jobA, jobB, jobC] = cut.jobs;
      const firstNewRowIndex = solveRows.length;
      addRows(
        solveRows,
        cut.rowName,
        [
          ...cut.prefixes[0].map(
            (bound) => [prefix(jobA, bound.variable), 1] as const,
          ),
          ...cut.prefixes[1].map(
            (bound) => [prefix(jobB, bound.variable), 1] as const,
          ),
          ...cut.prefixes[2].map(
            (bound) => [prefix(jobC, bound.variable), 1] as const,
          ),
        ],
        "<=",
        2,
      );
      for (const row of solveRows.slice(firstNewRowIndex))
        factorClassTripleCutRows.set(row.name, row);
      factorClassTripleConflictRows.add(cut.rowName);
    }
  };
  const addRatioUpperNecessaryCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    const jobCount = preparedJobs.length;
    const addSubsetCut = (jobIndexes: readonly number[]) => {
      const thresholdNumerator =
        incumbentNumerator -
        BigInt(jobCount - jobIndexes.length) * incumbentDenominator;
      if (thresholdNumerator <= 0n) return;
      // 要使总和有所提升，所选子集必须超过此界，因为所有未选职业的归一化比值都至多为 1。
      // 整数比值上界变量会向上取整每个精确比值，因此这个严格缩放下界既必要又安全。
      const minimumScaledSum =
        (thresholdNumerator * ratioUpperBoundScale) / incumbentDenominator + 1n;
      if (minimumScaledSum > BigInt(Number.MAX_SAFE_INTEGER)) return;
      const rowName = `joint_necessary_ratio_sum_${jobIndexes.join("_")}`;
      addRows(
        solveRows,
        rowName,
        jobIndexes.map(
          (jobIndex) => [ratioUpperBoundVariables[jobIndex]!, 1] as const,
        ),
        ">=",
        Number(minimumScaledSum),
      );
      ratioUpperNecessaryRows.add(rowName);
    };
    const visitSubsets = (size: number, start: number, selected: number[]) => {
      if (selected.length === size) {
        addSubsetCut(selected);
        return;
      }
      const needed = size - selected.length;
      for (let index = start; index <= jobCount - needed; index++) {
        selected.push(index);
        visitSubsets(size, index + 1, selected);
        selected.pop();
      }
    };
    for (let subsetSize = 1; subsetSize <= jobCount; subsetSize++) {
      if (subsetSize > 3 && subsetSize < jobCount) continue;
      visitSubsets(subsetSize, 0, []);
    }
  };
  return {
    get factorClassConflictRows() {
      return factorClassConflictRows;
    },
    get factorClassPairConflictRows() {
      return factorClassPairConflictRows;
    },
    get factorClassJointPairConflictRows() {
      return factorClassJointPairConflictRows;
    },
    get factorClassJointTripleConflictRows() {
      return factorClassJointTripleConflictRows;
    },
    get factorClassTripleConflictRows() {
      return factorClassTripleConflictRows;
    },
    get factorClassTriplePreprocessingWork() {
      return factorClassTriplePreprocessingWork;
    },
    get factorClassTriplePreprocessingSkipped() {
      return factorClassTriplePreprocessingSkipped;
    },
    get ratioUpperNecessaryRows() {
      return ratioUpperNecessaryRows;
    },
    get addCrossJobFactorClassGroupPairCuts() {
      return addCrossJobFactorClassGroupPairCuts;
    },
    get addTwoJobWithinJobFactorPairCuts() {
      return addTwoJobWithinJobFactorPairCuts;
    },
    get addTwoJobWithinJobFactorTripleCuts() {
      return addTwoJobWithinJobFactorTripleCuts;
    },
    get addCrossJobFactorClassGroupTripleCuts() {
      return addCrossJobFactorClassGroupTripleCuts;
    },
    get addRatioUpperNecessaryCuts() {
      return addRatioUpperNecessaryCuts;
    },
  };
}
