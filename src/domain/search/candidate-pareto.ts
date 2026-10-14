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
  // 完整属性向量相同时保留先出现的候选。
  return strictlyBetter || left.every((value, index) => value === right[index]);
}

/**
 * 将候选插入增量最大化前沿。
 * 调用方只能将此函数用于不存在跨槽位身份约束的装备槽。
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
 * 对单侧戒指槽执行帕累托剪枝，同时保持其可与另一侧配对的候选集合不变。
 * 非唯一装备以及在另一侧没有冲突的唯一装备都能与任意另一侧候选配对，
 * 因此它们共用一个前沿，也可以支配存在唯一装备冲突的候选。
 * 会与另一侧冲突的唯一装备则按物品 ID 分别维护前沿。
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

      // 可与所有候选配对的候选若属性不差，就能替换存在冲突的唯一装备。
      // 反向替换则可能丢失另一侧携带相同唯一物品 ID 的戒指。
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
