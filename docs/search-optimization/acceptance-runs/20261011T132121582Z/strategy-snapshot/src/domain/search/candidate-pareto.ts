export type ParetoCandidate<T> = {
  value: T;
  attributes: readonly number[];
  order: number;
};

export type ParetoInsertion<T> = {
  accepted: boolean;
  removed: ParetoCandidate<T>[];
};

export type RingParetoCandidate<T> = ParetoCandidate<T> & {
  itemId: number;
  isUnique: boolean;
};

function dominates(
  left: readonly number[],
  right: readonly number[],
  equalCoordinate?: number,
): boolean {
  if (left.length !== right.length) {
    throw new RangeError("Pareto 候选属性向量长度不一致");
  }
  let strictlyBetter = false;
  for (let index = 0; index < left.length; index++) {
    if (index === equalCoordinate && left[index] !== right[index]) return false;
    if (left[index]! < right[index]!) return false;
    if (left[index]! > right[index]!) strictlyBetter = true;
  }
  // Keep the first candidate when full attribute vectors are equivalent.
  return strictlyBetter || left.every((value, index) => value === right[index]);
}

/**
 * Insert a candidate into an incremental maximization frontier. The caller
 * must only use this for slots without cross-slot identity constraints.
 */
export function insertParetoCandidate<T>(
  frontier: ParetoCandidate<T>[],
  candidate: ParetoCandidate<T>,
  equalCoordinate?: number,
): ParetoInsertion<T> {
  for (const kept of frontier) {
    if (dominates(kept.attributes, candidate.attributes, equalCoordinate)) {
      return { accepted: false, removed: [] };
    }
  }

  const removed: ParetoCandidate<T>[] = [];
  for (let index = frontier.length - 1; index >= 0; index--) {
    const kept = frontier[index]!;
    if (dominates(candidate.attributes, kept.attributes, equalCoordinate)) {
      removed.push(...frontier.splice(index, 1));
    }
  }
  frontier.push(candidate);
  return { accepted: true, removed };
}

/**
 * Pareto-prune one ring slot without changing which candidates it can pair
 * with in the opposite slot. Non-unique candidates and unique candidates
 * without an opposite-slot conflict can pair with every opposite candidate,
 * so they share a frontier and may also dominate a conflicting unique item.
 * Unique candidates that conflict across slots get a frontier per item ID.
 */
export function paretoRingCandidates<T>(
  candidates: readonly RingParetoCandidate<T>[],
  oppositeCandidates: readonly Pick<RingParetoCandidate<T>, "itemId" | "isUnique">[],
  equalCoordinate?: number,
): RingParetoCandidate<T>[] {
  const oppositeUniqueIds = new Set(
    oppositeCandidates.filter(({ isUnique }) => isUnique).map(({ itemId }) => itemId),
  );
  const allCompatibleFrontier: RingParetoCandidate<T>[] = [];
  const uniqueConflictFrontiers = new Map<number, RingParetoCandidate<T>[]>();
  for (const candidate of candidates) {
    const hasOppositeConflict = candidate.isUnique && oppositeUniqueIds.has(candidate.itemId);
    if (!hasOppositeConflict) {
      const insertion = insertParetoCandidate(allCompatibleFrontier, candidate, equalCoordinate);
      if (!insertion.accepted) continue;

      // An all-compatible candidate can replace a conflicting unique item
      // with no worse attributes. The reverse replacement could lose the
      // opposite ring carrying that unique item ID.
      for (const frontier of uniqueConflictFrontiers.values()) {
        for (let index = frontier.length - 1; index >= 0; index--) {
          if (dominates(candidate.attributes, frontier[index]!.attributes, equalCoordinate)) {
            frontier.splice(index, 1);
          }
        }
      }
      continue;
    }

    if (allCompatibleFrontier.some(({ attributes }) =>
      dominates(attributes, candidate.attributes, equalCoordinate))) continue;

    const frontier = uniqueConflictFrontiers.get(candidate.itemId) ?? [];
    if (!uniqueConflictFrontiers.has(candidate.itemId)) {
      uniqueConflictFrontiers.set(candidate.itemId, frontier);
    }
    insertParetoCandidate(frontier, candidate, equalCoordinate);
  }
  return [...allCompatibleFrontier, ...uniqueConflictFrontiers.values()].flat()
    .sort((left, right) => left.order - right.order);
}
