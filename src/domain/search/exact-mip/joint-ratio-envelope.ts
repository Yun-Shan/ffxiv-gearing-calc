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

export function assembleJointRatioEnvelope(
  options: Pick<JointSearchOptions, "objective" | "ratioUpperPairPolicy">,
  preparedJobs: readonly JointPreparedJob[],
  model: Pick<JointModel, "rows" | "bounds" | "generals" | "prefix">,
  candidates: Pick<
    JointCandidateBounds,
    | "factorClassUpperBounds"
    | "factorClassUpperBoundsByJobAndGroup"
    | "compareExactRatios"
  >,
) {
  const { rows, bounds, generals, prefix } = model;
  const {
    factorClassUpperBounds,
    factorClassUpperBoundsByJobAndGroup,
    compareExactRatios,
  } = candidates;
  const ratioUpperBoundScale = 1_000_000_000n;
  const ratioUpperBoundVariables = preparedJobs.map(
    (_, jobIndex) => "joint_ratio_upper_" + jobIndex,
  );
  const ratioUpperBoundObjectiveEnabled = true;
  const ratioUpperBoundObjective = new Map<string, number>();
  let ratioUpperBoundPairCutCount = 0;
  let ratioUpperBoundPairPreprocessingWork = 0;
  const ratioUpperCoefficientExact = (ratio: ExactRatio): bigint => {
    const scaled =
      (ratio.numerator * ratioUpperBoundScale + ratio.denominator - 1n) /
      ratio.denominator;
    return scaled >= ratioUpperBoundScale ? ratioUpperBoundScale : scaled;
  };
  const ratioUpperCoefficient = (ratio: ExactRatio): number =>
    Number(ratioUpperCoefficientExact(ratio));
  for (
    let jobIndex = 0;
    jobIndex < ratioUpperBoundVariables.length;
    jobIndex++
  ) {
    const name = ratioUpperBoundVariables[jobIndex]!;
    bounds.push({ name, min: 0, max: Number(ratioUpperBoundScale) });
    generals.push(name);
    const groups = preparedJobs[jobIndex]!.prepared.groups.filter(
      (group) => group.name !== "gcd" || options.objective === "dps",
    );
    for (const group of groups) {
      const classBounds = factorClassUpperBounds.filter(
        (bound) =>
          bound.jobIndex === jobIndex && bound.groupName === group.name,
      );
      if (classBounds.length !== group.classes.length) {
        throw new Error(`联合因子上界缺少完整类别：${jobIndex}/${group.name}`);
      }
      const terms = new Map<string, number>([[name, 1]]);
      for (const bound of classBounds) {
        terms.set(
          prefix(jobIndex, bound.variable),
          -ratioUpperCoefficient(bound.ratio),
        );
      }
      addRows(
        rows,
        `joint_ratio_upper_${jobIndex}_${group.name}`,
        terms,
        "<=",
        0,
      );
    }
  }

  // 单因子上界可能会把其他组中彼此不兼容的最大值组合起来。
  // 同时约束两个不同组，可以收紧 q。单组原始最大值共用精确包络 U*：U_ab = U_a*U_b/U*。
  const pairCutCandidates: {
    jobIndex: number;
    rowName: string;
    anchorVariable: string;
    anchorCoefficient: number;
    otherVariables: readonly string[];
    otherCoefficients: readonly number[];
    rhs: number;
    tightening: number;
  }[] = [];
  const pairCutRowLimit = preparedJobs.length === 2 ? 512 : 256;
  const pairCutNonzeroLimit = preparedJobs.length === 2 ? 150_000 : 50_000;
  const pairPreprocessingWorkLimit =
    preparedJobs.length === 2 ? 300_000 : 50_000;
  const pairWorkLimitPerJob = Math.floor(
    pairPreprocessingWorkLimit / ratioUpperBoundVariables.length,
  );
  const preferredPairRanks = new Map([
    ["crt|dht", 0],
    ["det|gcd", 1],
    ["crt|gcd", 2],
  ]);
  for (
    let jobIndex = 0;
    jobIndex < ratioUpperBoundVariables.length;
    jobIndex++
  ) {
    if (options.ratioUpperPairPolicy === "disabled") continue;
    const groups = preparedJobs[jobIndex]!.prepared.groups.filter(
      (group) => group.name !== "gcd" || options.objective === "dps",
    );
    const upperBoundsByGroup = groups.map((group) => ({
      group,
      bounds: group.classes.map((factorClass) =>
        factorClassUpperBounds.find(
          (entry) =>
            entry.jobIndex === jobIndex &&
            entry.groupName === group.name &&
            entry.variable === factorClass.variable,
        ),
      ),
    }));
    const groupMaxima: FactorClassUpperBound[] = [];
    let completePairDomain = true;
    for (const { bounds: classBounds, group } of upperBoundsByGroup) {
      const validBounds = classBounds.filter(
        (entry): entry is FactorClassUpperBound => entry !== undefined,
      );
      if (
        validBounds.length !== group.classes.length ||
        validBounds.length === 0
      ) {
        completePairDomain = false;
        break;
      }
      groupMaxima.push(
        validBounds.reduce((maximum, entry) =>
          compareExactRatios(entry.ratio, maximum.ratio) > 0 ? entry : maximum,
        ),
      );
    }
    if (!completePairDomain) continue;
    const commonEnvelope = groupMaxima[0]?.ratio;
    if (
      commonEnvelope === undefined ||
      groupMaxima.some(
        (maximum) => compareExactRatios(maximum.ratio, commonEnvelope) !== 0,
      )
    )
      continue;

    const groupPairs: {
      left: (typeof upperBoundsByGroup)[number];
      right: (typeof upperBoundsByGroup)[number];
      combinations: number;
      priority: number;
    }[] = [];
    for (
      let leftIndex = 0;
      leftIndex < upperBoundsByGroup.length;
      leftIndex++
    ) {
      const left = upperBoundsByGroup[leftIndex]!;
      if (left.bounds.length < 2) continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < upperBoundsByGroup.length;
        rightIndex++
      ) {
        const right = upperBoundsByGroup[rightIndex]!;
        if (right.bounds.length < 2) continue;
        const combinations = left.bounds.length * right.bounds.length;
        const key = [left.group.name, right.group.name].sort().join("|");
        groupPairs.push({
          left,
          right,
          combinations,
          priority: preferredPairRanks.get(key) ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
    groupPairs.sort(
      (left, right) =>
        left.priority - right.priority ||
        left.combinations - right.combinations ||
        `${left.left.group.name}|${left.right.group.name}`.localeCompare(
          `${right.left.group.name}|${right.right.group.name}`,
        ),
    );

    let jobPairWork = 0;
    for (const pair of groupPairs) {
      if (
        pairWorkLimitPerJob <= 0 ||
        pair.combinations > pairWorkLimitPerJob - jobPairWork
      )
        continue;
      jobPairWork += pair.combinations;
      ratioUpperBoundPairPreprocessingWork += pair.combinations;
      const pairCoefficients: number[][] = [];
      for (const leftBound of pair.left.bounds) {
        const row: number[] = [];
        for (const rightBound of pair.right.bounds) {
          const numerator =
            leftBound!.ratio.numerator *
            rightBound!.ratio.numerator *
            commonEnvelope.denominator;
          const denominator =
            leftBound!.ratio.denominator *
            rightBound!.ratio.denominator *
            commonEnvelope.numerator;
          if (denominator <= 0n) {
            row.push(Number(ratioUpperBoundScale));
            continue;
          }
          let coefficient = ratioUpperCoefficientExact({
            numerator,
            denominator,
          });
          coefficient =
            coefficient < ratioUpperCoefficientExact(leftBound!.ratio)
              ? coefficient
              : ratioUpperCoefficientExact(leftBound!.ratio);
          const rightSingleCoefficient = ratioUpperCoefficientExact(
            rightBound!.ratio,
          );
          if (coefficient > rightSingleCoefficient)
            coefficient = rightSingleCoefficient;
          row.push(Number(coefficient));
        }
        pairCoefficients.push(row);
      }

      const addAnchoredRows = (
        anchor: typeof pair.left,
        other: typeof pair.right,
        coefficients: readonly (readonly number[])[],
        reverse: boolean,
      ) => {
        for (
          let anchorIndex = 0;
          anchorIndex < anchor.bounds.length;
          anchorIndex++
        ) {
          const anchorBound = anchor.bounds[anchorIndex]!;
          const classCoefficients = other.bounds.map((_, otherIndex) =>
            reverse
              ? coefficients[otherIndex]![anchorIndex]!
              : coefficients[anchorIndex]![otherIndex]!,
          );
          const minimumPairCoefficient = classCoefficients.reduce(
            (minimum, coefficient) => Math.min(minimum, coefficient),
            Number.MAX_SAFE_INTEGER,
          );
          const anchorSingleCoefficient = Number(
            ratioUpperCoefficientExact(anchorBound!.ratio),
          );
          if (minimumPairCoefficient >= anchorSingleCoefficient) continue;
          const activation =
            Number(ratioUpperBoundScale) - minimumPairCoefficient;
          if (activation <= 0) continue;
          const rowName = `joint_ratio_pair_upper_${jobIndex}_${anchor.group.name}_${anchorIndex}_${other.group.name}`;
          pairCutCandidates.push({
            jobIndex,
            rowName,
            anchorVariable: prefix(jobIndex, anchorBound!.variable),
            anchorCoefficient: activation,
            otherVariables: other.bounds.map((entry) =>
              prefix(jobIndex, entry!.variable),
            ),
            otherCoefficients: classCoefficients,
            rhs: activation,
            tightening: activation,
          });
        }
      };
      addAnchoredRows(pair.left, pair.right, pairCoefficients, false);
      addAnchoredRows(pair.right, pair.left, pairCoefficients, true);
    }
  }
  pairCutCandidates.sort(
    (left, right) =>
      right.tightening - left.tightening ||
      left.otherVariables.length - right.otherVariables.length ||
      left.rowName.localeCompare(right.rowName),
  );
  let selectedPairCutNonzeros = 0;
  for (const cut of pairCutCandidates) {
    const nonzeros = cut.otherVariables.length + 2;
    if (
      ratioUpperBoundPairCutCount >= pairCutRowLimit ||
      selectedPairCutNonzeros + nonzeros > pairCutNonzeroLimit
    )
      continue;
    addRows(
      rows,
      cut.rowName,
      [
        [ratioUpperBoundVariables[cut.jobIndex]!, 1],
        [cut.anchorVariable, cut.anchorCoefficient],
        ...cut.otherVariables.map(
          (variable, index) =>
            [variable, -cut.otherCoefficients[index]!] as const,
        ),
      ],
      "<=",
      cut.rhs,
    );
    ratioUpperBoundPairCutCount++;
    selectedPairCutNonzeros += nonzeros;
  }
  ratioUpperBoundVariables.forEach((name) =>
    ratioUpperBoundObjective.set(name, 1),
  );
  return {
    get ratioUpperBoundScale() {
      return ratioUpperBoundScale;
    },
    get ratioUpperBoundVariables() {
      return ratioUpperBoundVariables;
    },
    get ratioUpperBoundObjectiveEnabled() {
      return ratioUpperBoundObjectiveEnabled;
    },
    get ratioUpperBoundObjective() {
      return ratioUpperBoundObjective;
    },
    get ratioUpperBoundPairCutCount() {
      return ratioUpperBoundPairCutCount;
    },
    get ratioUpperBoundPairPreprocessingWork() {
      return ratioUpperBoundPairPreprocessingWork;
    },
    get ratioUpperCoefficientExact() {
      return ratioUpperCoefficientExact;
    },
  };
}

export type JointRatioEnvelope = ReturnType<typeof assembleJointRatioEnvelope>;
