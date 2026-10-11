export type SharedAccessoryPairCandidate = {
  keyA: string;
  keyB: string;
  selectorA: string;
  selectorB: string;
  values: readonly number[];
  canDominate: boolean;
};

export type SharedAccessoryPairDominanceCut = {
  dominated: SharedAccessoryPairCandidate;
  dominator: SharedAccessoryPairCandidate;
};

export type SharedAccessoryPairDominanceResult = {
  cuts: readonly SharedAccessoryPairDominanceCut[];
  candidateCount: number;
  comparisons: number;
  comparisonLimitReached: boolean;
  preprocessingLimitReached: boolean;
};

export function findStrictlyDominatedSharedAccessoryPairs(
  candidates: readonly SharedAccessoryPairCandidate[],
  limits: {
    maxCuts: number;
    maxComparisons: number;
    deadlineAt?: number;
    shouldStop?: () => boolean;
  },
): SharedAccessoryPairDominanceResult {
  if (!Number.isSafeInteger(limits.maxCuts) || limits.maxCuts < 0 ||
    !Number.isSafeInteger(limits.maxComparisons) || limits.maxComparisons < 0 ||
    (limits.deadlineAt !== undefined && !Number.isFinite(limits.deadlineAt))) {
    throw new RangeError("共享饰品对 Pareto 预算必须是非负安全整数");
  }
  const shouldStop = () =>
    (limits.deadlineAt !== undefined && performance.now() >= limits.deadlineAt) ||
    limits.shouldStop?.() === true;
  const stoppedResult = (
    cuts: readonly SharedAccessoryPairDominanceCut[],
    comparisons: number,
    comparisonLimitReached = false,
  ): SharedAccessoryPairDominanceResult => ({
    cuts,
    candidateCount: candidates.length,
    comparisons,
    comparisonLimitReached,
    preprocessingLimitReached: true,
  });
  if (shouldStop()) return stoppedResult([], 0);
  const dimensions = candidates[0]?.values.length ?? 0;
  if (dimensions === 0) {
    return {
      cuts: [],
      candidateCount: candidates.length,
      comparisons: 0,
      comparisonLimitReached: false,
      preprocessingLimitReached: false,
    };
  }
  const ordered: { candidate: SharedAccessoryPairCandidate; total: bigint }[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    if ((candidateIndex & 127) === 0 && shouldStop()) return stoppedResult([], 0);
    const candidate = candidates[candidateIndex]!;
    if (candidate.values.length !== dimensions) {
      return {
        cuts: [],
        candidateCount: candidates.length,
        comparisons: 0,
        comparisonLimitReached: false,
        preprocessingLimitReached: false,
      };
    }
    let total = 0n;
    for (let index = 0; index < dimensions; index++) {
      if ((index & 63) === 0 && shouldStop()) return stoppedResult([], 0);
      const value = candidate.values[index]!;
      if (!Number.isSafeInteger(value) || value < 0) {
        return {
          cuts: [],
          candidateCount: candidates.length,
          comparisons: 0,
          comparisonLimitReached: false,
          preprocessingLimitReached: false,
        };
      }
      total += BigInt(value);
    }
    ordered.push({ candidate, total });
  }

  let sortComparisons = 0;
  const sortBudgetExpired = {};
  try {
    ordered.sort((left, right) => {
      if (((++sortComparisons) & 127) === 0 && shouldStop()) throw sortBudgetExpired;
      if (left.total !== right.total) return left.total > right.total ? -1 : 1;
      return left.candidate.keyA.localeCompare(right.candidate.keyA) ||
        left.candidate.keyB.localeCompare(right.candidate.keyB);
    });
  } catch (error) {
    if (error !== sortBudgetExpired) throw error;
    return stoppedResult([], 0);
  }
  if (shouldStop()) return stoppedResult([], 0);
  const frontier: typeof ordered = [];
  const cuts: SharedAccessoryPairDominanceCut[] = [];
  let comparisons = 0;
  let comparisonLimitReached = false;
  let preprocessingLimitReached = false;

  outer: for (const current of ordered) {
    if (shouldStop()) {
      preprocessingLimitReached = true;
      break;
    }
    if (cuts.length >= limits.maxCuts) break;
    let dominatedBy: typeof ordered[number] | undefined;
    for (const possibleDominator of frontier) {
      if (possibleDominator.total <= current.total) continue;
      if ((comparisons & 127) === 0 && shouldStop()) {
        preprocessingLimitReached = true;
        break outer;
      }
      if (comparisons >= limits.maxComparisons) {
        comparisonLimitReached = true;
        break outer;
      }
      comparisons++;
      let dominates = true;
      for (let index = 0; index < dimensions; index++) {
        if ((index & 63) === 0 && shouldStop()) {
          preprocessingLimitReached = true;
          break outer;
        }
        if (possibleDominator.candidate.values[index]! < current.candidate.values[index]!) {
          dominates = false;
          break;
        }
      }
      if (dominates) {
        dominatedBy = possibleDominator;
        break;
      }
    }
    if (dominatedBy !== undefined) {
      if (shouldStop()) {
        preprocessingLimitReached = true;
        break;
      }
      cuts.push({ dominated: current.candidate, dominator: dominatedBy.candidate });
    } else if (current.candidate.canDominate) {
      frontier.push(current);
    }
  }

  return {
    cuts,
    candidateCount: candidates.length,
    comparisons,
    comparisonLimitReached,
    preprocessingLimitReached,
  };
}
