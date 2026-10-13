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

type EqualCoordinate = number | readonly number[];

function equalCoordinateSet(coordinates: EqualCoordinate | undefined): ReadonlySet<number> {
  if (coordinates === undefined) return new Set();
  return new Set(typeof coordinates === "number" ? [coordinates] : coordinates);
}

function dominates(
  left: readonly number[],
  right: readonly number[],
  equalCoordinates: ReadonlySet<number>,
): boolean {
  if (left.length !== right.length) {
    throw new RangeError("Pareto 候选属性向量长度不一致");
  }
  let strictlyBetter = false;
  for (let index = 0; index < left.length; index++) {
    if (equalCoordinates.has(index) && left[index] !== right[index]) return false;
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
  equalCoordinate?: EqualCoordinate,
): ParetoInsertion<T> {
  return insertParetoCandidateWithEqualCoordinates(
    frontier,
    candidate,
    equalCoordinateSet(equalCoordinate),
  );
}

function insertParetoCandidateWithEqualCoordinates<T>(
  frontier: ParetoCandidate<T>[],
  candidate: ParetoCandidate<T>,
  equalCoordinates: ReadonlySet<number>,
): ParetoInsertion<T> {
  for (const kept of frontier) {
    if (dominates(kept.attributes, candidate.attributes, equalCoordinates)) {
      return { accepted: false, removed: [] };
    }
  }

  const removed: ParetoCandidate<T>[] = [];
  for (let index = frontier.length - 1; index >= 0; index--) {
    const kept = frontier[index]!;
    if (dominates(candidate.attributes, kept.attributes, equalCoordinates)) {
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
  equalCoordinate?: EqualCoordinate,
): RingParetoCandidate<T>[] {
  const equalCoordinates = equalCoordinateSet(equalCoordinate);
  const oppositeUniqueIds = new Set(
    oppositeCandidates.filter(({ isUnique }) => isUnique).map(({ itemId }) => itemId),
  );
  const allCompatibleFrontier: RingParetoCandidate<T>[] = [];
  const uniqueConflictFrontiers = new Map<number, RingParetoCandidate<T>[]>();
  for (const candidate of candidates) {
    const hasOppositeConflict = candidate.isUnique && oppositeUniqueIds.has(candidate.itemId);
    if (!hasOppositeConflict) {
      const insertion = insertParetoCandidateWithEqualCoordinates(
        allCompatibleFrontier,
        candidate,
        equalCoordinates,
      );
      if (!insertion.accepted) continue;

      // An all-compatible candidate can replace a conflicting unique item
      // with no worse attributes. The reverse replacement could lose the
      // opposite ring carrying that unique item ID.
      for (const frontier of uniqueConflictFrontiers.values()) {
        for (let index = frontier.length - 1; index >= 0; index--) {
          if (dominates(candidate.attributes, frontier[index]!.attributes, equalCoordinates)) {
            frontier.splice(index, 1);
          }
        }
      }
      continue;
    }

    if (allCompatibleFrontier.some(({ attributes }) =>
      dominates(attributes, candidate.attributes, equalCoordinates))) continue;

    const frontier = uniqueConflictFrontiers.get(candidate.itemId) ?? [];
    if (!uniqueConflictFrontiers.has(candidate.itemId)) {
      uniqueConflictFrontiers.set(candidate.itemId, frontier);
    }
    insertParetoCandidateWithEqualCoordinates(frontier, candidate, equalCoordinates);
  }
  return [...allCompatibleFrontier, ...uniqueConflictFrontiers.values()].flat()
    .sort((left, right) => left.order - right.order);
}
