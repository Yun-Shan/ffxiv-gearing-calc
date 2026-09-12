import type { EquipInfo, FoodInfo, FoodParam, ParamInfo } from "./types.ts";

const MAX_DAMAGE_CACHE_ENTRIES = 500_000;
const DEFAULT_SUFFIX_FRONTIER_SLOT_COUNT = 5;
const DEFAULT_SUFFIX_FRONTIER_MAX_COMBINATIONS = 2_000_000;
const SUFFIX_FRONTIER_LEAF_SIZE = 16;

export type DamageFunction = (attributes: readonly number[]) => number;

export type EquipmentAttributeExtractor = (
  equipment: EquipInfo,
) => readonly ParamInfo[];

export type AttributeTierProjector = (value: number) => number;

export type FoodPriorityComparator = (
  first: FoodInfo | undefined,
  second: FoodInfo | undefined,
) => number;

export type LoadoutFinderV1Options = {
  attributeIds?: readonly number[];
  equipmentAttributeExtractor?: EquipmentAttributeExtractor;
  attributeTierProjectors?: ReadonlyMap<number, AttributeTierProjector>;
  greedyPriorityAttributeIds?: readonly number[];
  foodPriorityComparator?: FoodPriorityComparator;
  pairwiseLowerBound?: boolean;
  slotOrder?:
    | "candidate-count-descending"
    | "relaxation-gap"
    | "relaxation-gap-with-small-suffix";
  suffixFrontierSlotCount?: number;
  suffixFrontierMaxCombinations?: number;
  debug?: boolean;
  debugLabel?: string;
};

export type AttributeRangeConstraint = {
  attributeId: number;
  min?: number;
  max?: number;
};

export type LoadoutV1Result = {
  damage: number;
  selection: EquipInfo[];
  food: FoodInfo | undefined;
};

export type LoadoutV1Statistics = {
  elapsedMs: number;
  searched: number;
  leaves: number;
  initialGreedyDamage: number;
  localSearchDamage: number;
  singleSlotImprovements: number;
  pairwiseImprovements: number;
  suffixSlotCount: number;
  suffixRawCombinations: number;
  suffixFrontierSize: number;
  suffixBoundChecks: number;
  suffixBoundPruned: number;
  suffixVectorsEvaluated: number;
  constraintPruned: number;
  suffixConstraintPruned: number;
};

type Candidate = {
  equipment: EquipInfo;
  attributes: number[];
  attributeSum: number;
};

type SlotState = {
  inputIndex: number;
  originalCandidateCount: number;
  candidates: Candidate[];
  minimum: number[];
  maximum: number[];
};

type FoodPlan = {
  food: FoodInfo | undefined;
  key: string;
};

type SuffixFrontierState = {
  attributes: number[];
  attributeSum: number;
  candidates: Candidate[];
};

type SuffixFrontierNode = {
  minimum: number[];
  maximum: number[];
  left?: SuffixFrontierNode;
  right?: SuffixFrontierNode;
  states?: SuffixFrontierState[];
};

type NormalizedAttributeRange = {
  min: number;
  max: number;
};

type DepthDiagnostics = {
  depth: number;
  candidateCount: number;
  attemptedCount: number;
  dominancePassedCount: number;
  duplicatePrunedCount: number;
  upperPassedCount: number;
  upperGapBuckets: number[];
};

type DominanceTreeNode = {
  point: number[];
  maximum: number[];
  left: DominanceTreeNode | undefined;
  right: DominanceTreeNode | undefined;
};

type DominanceTree = {
  points: number[][];
  root: DominanceTreeNode;
};

/**
 * A logarithmic collection of balanced k-d trees. Dominated historical points
 * may stay indexed: any state they dominate is also dominated transitively by
 * the newer point, so deletion is unnecessary for correctness.
 */
export class DominanceIndex {
  readonly dimensionCount: number;
  readonly trees: (DominanceTree | undefined)[] = [];
  size = 0;

  constructor(dimensionCount: number) {
    this.dimensionCount = dimensionCount;
  }

  accept(point: number[]): {
    accepted: boolean;
    comparisons: number;
    equal: boolean;
  } {
    const counter = { comparisons: 0 };
    for (const tree of this.trees) {
      if (tree === undefined) continue;
      const dominator = this.#findDominator(tree.root, point, counter);
      if (dominator !== undefined)
        return {
          accepted: false,
          comparisons: counter.comparisons,
          equal: this.#equal(dominator, point),
        };
    }

    this.#insert(point);
    return { accepted: true, comparisons: counter.comparisons, equal: false };
  }

  #findDominator(
    node: DominanceTreeNode,
    target: readonly number[],
    counter: { comparisons: number },
  ): number[] | undefined {
    for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
      if (node.maximum[dimension] < target[dimension]) return undefined;
    }

    counter.comparisons++;
    let dominates = true;
    for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
      if (node.point[dimension] < target[dimension]) {
        dominates = false;
        break;
      }
    }
    if (dominates) return node.point;
    if (node.left !== undefined) {
      const left = this.#findDominator(node.left, target, counter);
      if (left !== undefined) return left;
    }
    if (node.right !== undefined) {
      return this.#findDominator(node.right, target, counter);
    }
    return undefined;
  }

  #equal(first: readonly number[], second: readonly number[]): boolean {
    for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
      if (first[dimension] !== second[dimension]) return false;
    }
    return true;
  }

  #insert(point: number[]): void {
    let mergedPoints = [point];
    let level = 0;
    while (this.trees[level] !== undefined) {
      mergedPoints = mergedPoints.concat(this.trees[level]!.points);
      this.trees[level] = undefined;
      level++;
    }
    this.trees[level] = {
      points: mergedPoints,
      root: this.#buildTree(mergedPoints, 0),
    };
    this.size++;
  }

  #buildTree(points: number[][], depth: number): DominanceTreeNode {
    const axis = depth % this.dimensionCount;
    points.sort((first, second) => first[axis] - second[axis]);
    const middle = Math.trunc(points.length / 2);
    const left =
      middle === 0
        ? undefined
        : this.#buildTree(points.slice(0, middle), depth + 1);
    const right =
      middle + 1 === points.length
        ? undefined
        : this.#buildTree(points.slice(middle + 1), depth + 1);
    const maximum = [...points[middle]];
    for (const child of [left, right]) {
      if (child === undefined) continue;
      for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
        maximum[dimension] = Math.max(
          maximum[dimension],
          child.maximum[dimension],
        );
      }
    }
    return { point: points[middle], maximum, left, right };
  }
}

/**
 * Finds the maximum damage loadout for one job without GCD or toughness
 * constraints. The damage function is expected to be monotonic by attribute.
 */
export class LoadoutFinderV1 {
  readonly damageFunction: DamageFunction;
  readonly attributeCount: number;
  readonly options: LoadoutFinderV1Options;
  readonly damageCache = new Map<string, number>();
  readonly statistics: LoadoutV1Statistics = {
    elapsedMs: 0,
    searched: 0,
    leaves: 0,
    initialGreedyDamage: Number.NEGATIVE_INFINITY,
    localSearchDamage: Number.NEGATIVE_INFINITY,
    singleSlotImprovements: 0,
    pairwiseImprovements: 0,
    suffixSlotCount: 0,
    suffixRawCombinations: 0,
    suffixFrontierSize: 0,
    suffixBoundChecks: 0,
    suffixBoundPruned: 0,
    suffixVectorsEvaluated: 0,
    constraintPruned: 0,
    suffixConstraintPruned: 0,
  };

  #attributeIds: number[] = [];
  #attributeIndex = new Map<number, number>();
  #greedyPriorityIndexes: number[] = [];
  #slots: SlotState[] = [];
  #suffixMinimums: number[][] = [];
  #suffixMaximums: number[][] = [];
  #prefixMaximums: number[][] = [];
  #suffixReachableValues: (number[] | undefined)[][] = [];
  #tierProjectors: (AttributeTierProjector | undefined)[] = [];
  #stateTierClasses: (Int32Array | undefined)[][] = [];
  #best: LoadoutV1Result | undefined;
  #searchedCount = 0;
  #stateDominanceIndexes: DominanceIndex[] = [];
  #acceptedStateCounts: number[] = [];
  #statePrunedCounts: number[] = [];
  #duplicatePrunedCounts: number[] = [];
  #upperPrunedCounts: number[] = [];
  #frontierPeakSizes: number[] = [];
  #dominanceComparisonCounts: number[] = [];
  #dominanceComparisonCount = 0;
  #leafCount = 0;
  #bestUpdateCount = 0;
  #damageCacheHitCount = 0;
  #damageCacheMissCount = 0;
  #damageCacheClearCount = 0;
  #searchStartedAt = 0;
  #activeFood = "";
  #activeDepth = 0;
  #depthDiagnostics: DepthDiagnostics[] = [];
  #suffixStart = 0;
  #suffixFrontierRoot: SuffixFrontierNode | undefined;
  #attributeRanges: (NormalizedAttributeRange | undefined)[] = [];
  #upperConstrainedIndexes: number[] = [];

  constructor(
    damageFunction: DamageFunction,
    attributeCount: number,
    options: LoadoutFinderV1Options | readonly number[] = {},
  ) {
    if (typeof damageFunction !== "function") {
      throw new TypeError("damageFunction 必须是函数");
    }
    if (!Number.isInteger(attributeCount) || attributeCount < 0) {
      throw new RangeError("attributeCount 必须是非负整数");
    }

    this.damageFunction = damageFunction;
    this.attributeCount = attributeCount;
    const normalizedOptions: LoadoutFinderV1Options = Array.isArray(options)
      ? { attributeIds: [...(options as readonly number[])] }
      : (options as LoadoutFinderV1Options);
    this.options = normalizedOptions;

    if (this.options.attributeIds !== undefined) {
      if (this.options.attributeIds.length !== attributeCount) {
        throw new RangeError("attributeIds 的长度必须等于 attributeCount");
      }
      if (new Set(this.options.attributeIds).size !== attributeCount) {
        throw new RangeError("attributeIds 不能包含重复属性 id");
      }
    }
    for (const [name, value] of [
      ["suffixFrontierSlotCount", this.options.suffixFrontierSlotCount],
      [
        "suffixFrontierMaxCombinations",
        this.options.suffixFrontierMaxCombinations,
      ],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
        throw new RangeError(`${name} 必须是非负整数`);
      }
    }
  }

  findBest(
    slots: readonly (readonly EquipInfo[])[],
    foods: readonly FoodInfo[],
    constraints: readonly AttributeRangeConstraint[] = [],
  ): LoadoutV1Result | undefined {
    this.damageCache.clear();
    this.#best = undefined;
    this.#searchedCount = 0;
    this.#dominanceComparisonCount = 0;
    this.#leafCount = 0;
    this.#bestUpdateCount = 0;
    this.#damageCacheHitCount = 0;
    this.#damageCacheMissCount = 0;
    this.#damageCacheClearCount = 0;
    this.#searchStartedAt = Date.now();
    this.#resetStatistics();

    for (let i = 0; i < slots.length; i++) {
      if (slots[i].length === 0) return undefined;
    }

    this.#attributeIds = this.#resolveAttributeIds(slots, foods);
    this.#attributeIndex = new Map(
      this.#attributeIds.map((attributeId, index) => [attributeId, index]),
    );
    for (const attributeId of this.options.attributeTierProjectors?.keys() ??
      []) {
      if (!this.#attributeIndex.has(attributeId)) {
        throw new RangeError(`阈值投影包含未配置的属性 id：${attributeId}`);
      }
    }
    this.#setAttributeRanges(constraints);
    this.#tierProjectors = this.#attributeIds.map((attributeId) =>
      this.#attributeRanges[this.#attributeIndex.get(attributeId)!] !==
      undefined
        ? undefined
        : this.options.attributeTierProjectors?.get(attributeId),
    );
    const greedyPriorityAttributeIds =
      this.options.greedyPriorityAttributeIds ?? this.#attributeIds;
    if (
      new Set(greedyPriorityAttributeIds).size !==
      greedyPriorityAttributeIds.length
    ) {
      throw new RangeError("贪心属性优先级不能包含重复属性 id");
    }
    this.#greedyPriorityIndexes = greedyPriorityAttributeIds.map(
      (attributeId) => {
        const index = this.#attributeIndex.get(attributeId);
        if (index === undefined) {
          throw new RangeError(
            `贪心属性优先级包含未配置的属性 id：${attributeId}`,
          );
        }
        return index;
      },
    );
    this.#slots = this.#buildSlots(slots);
    let foodPlans = this.#buildFoodPlans(foods);
    this.#debugLog(
      `[V1] 搜索配置：槽位候选=${this.#slots
        .map(
          (slot) =>
            `${slot.inputIndex}:${slot.originalCandidateCount}->${slot.candidates.length}`,
        )
        .join(
          ",",
        )}；食物=${foods.length}->${foodPlans.length}；阈值属性=${this.#attributeIds
        .filter((_, index) => this.#tierProjectors[index] !== undefined)
        .join(",")}`,
    );
    this.#logUpperBoundCompatibility();
    foodPlans = this.#createGreedyLowerBound(foodPlans);
    this.#orderSlotsForSearch(foodPlans);
    this.#orderCandidatesForSearch(foodPlans);
    this.#suffixMinimums = this.#buildSuffixMinimums(this.#slots);
    this.#suffixMaximums = this.#buildSuffixMaximums(this.#slots);
    this.#prefixMaximums = this.#buildPrefixMaximums(this.#slots);
    this.#suffixReachableValues = this.#buildSuffixReachableValues(this.#slots);
    this.#buildSuffixFrontier();
    this.#acceptedStateCounts = new Array(this.#slots.length + 1).fill(0);
    this.#statePrunedCounts = new Array(this.#slots.length + 1).fill(0);
    this.#duplicatePrunedCounts = new Array(this.#slots.length + 1).fill(0);
    this.#upperPrunedCounts = new Array(this.#slots.length + 1).fill(0);
    this.#frontierPeakSizes = new Array(this.#slots.length + 1).fill(0);
    this.#dominanceComparisonCounts = new Array(this.#slots.length + 1).fill(0);
    this.#activeDepth = 0;
    this.#depthDiagnostics = [];

    const zeroAttributes = this.#zeroAttributes();
    for (const foodPlan of foodPlans) {
      this.#activeFood = this.#foodLabel(foodPlan);
      if (
        !this.#canMeetConstraints(
          zeroAttributes,
          this.#suffixMinimums[0],
          this.#suffixMaximums[0],
          foodPlan,
        )
      ) {
        this.statistics.constraintPruned++;
        this.#debugLog(
          `[V1] 跳过食物分支：${this.#activeFood}；最终属性约束不可行`,
        );
        continue;
      }
      const globalUpperDamage = this.#upperDamageOfSum(
        zeroAttributes,
        this.#suffixMaximums[0],
        foodPlan,
      );
      if (this.#hasBest() && globalUpperDamage <= this.#bestDamage()) {
        this.#debugLog(
          `[V1] 跳过食物分支：${this.#activeFood}；上界=${globalUpperDamage}；当前最优=${this.#bestDamage()}`,
        );
        continue;
      }
      this.#stateDominanceIndexes = Array.from(
        { length: this.#slots.length + 1 },
        () => new DominanceIndex(this.#paretoDimensionCount()),
      );
      this.#stateTierClasses = this.#buildStateTierClasses(foodPlan);
      this.#logTierCompression();
      this.#depthDiagnostics = this.#slots.map((slot, index) => ({
        depth: index + 1,
        candidateCount: slot.candidates.length,
        attemptedCount: 0,
        dominancePassedCount: 0,
        duplicatePrunedCount: 0,
        upperPassedCount: 0,
        upperGapBuckets: new Array(5).fill(0),
      }));
      const searchedBefore = this.#searchedCount;
      const statePrunedBefore = this.#sumCounts(this.#statePrunedCounts);
      const upperPrunedBefore = this.#sumCounts(this.#upperPrunedCounts);
      const leafBefore = this.#leafCount;
      const branchStartedAt = Date.now();
      this.#searchFood(zeroAttributes, slots.length, foodPlan);
      this.#logDepthDiagnostics();
      this.#debugLog(
        `[V1] 完成食物分支：${this.#activeFood}；耗时=${Date.now() - branchStartedAt}ms；搜索=${this.#searchedCount - searchedBefore}；状态剪枝=${this.#sumCounts(this.#statePrunedCounts) - statePrunedBefore}；上界剪枝=${this.#sumCounts(this.#upperPrunedCounts) - upperPrunedBefore}；后缀上界剪枝=${this.statistics.suffixBoundPruned}；叶子=${this.#leafCount - leafBefore}`,
      );
    }

    this.#logProgress("搜索完成");
    this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
    this.statistics.searched = this.#searchedCount;
    this.statistics.leaves = this.#leafCount;
    return this.#best;
  }

  #resetStatistics(): void {
    this.statistics.elapsedMs = 0;
    this.statistics.searched = 0;
    this.statistics.leaves = 0;
    this.statistics.initialGreedyDamage = Number.NEGATIVE_INFINITY;
    this.statistics.localSearchDamage = Number.NEGATIVE_INFINITY;
    this.statistics.singleSlotImprovements = 0;
    this.statistics.pairwiseImprovements = 0;
    this.statistics.suffixSlotCount = 0;
    this.statistics.suffixRawCombinations = 0;
    this.statistics.suffixFrontierSize = 0;
    this.statistics.suffixBoundChecks = 0;
    this.statistics.suffixBoundPruned = 0;
    this.statistics.suffixVectorsEvaluated = 0;
    this.statistics.constraintPruned = 0;
    this.statistics.suffixConstraintPruned = 0;
    this.#suffixStart = this.#slots.length;
    this.#suffixFrontierRoot = undefined;
  }

  #resolveAttributeIds(
    slots: readonly (readonly EquipInfo[])[],
    foods: readonly FoodInfo[],
  ): number[] {
    if (this.options.attributeIds !== undefined) {
      return [...this.options.attributeIds];
    }

    const ids = new Set<number>();
    for (const slot of slots) {
      for (const equipment of slot) {
        for (const param of this.#equipmentParams(equipment)) {
          ids.add(param.baseParamId);
        }
      }
    }
    for (const food of foods) {
      for (const param of food.baseParams) ids.add(param.baseParamId);
    }

    if (ids.size > this.attributeCount) {
      throw new RangeError(
        `输入包含 ${ids.size} 个属性，但 attributeCount 只有 ${this.attributeCount}`,
      );
    }
    if (
      [...ids].every(
        (id) => Number.isInteger(id) && id >= 0 && id < this.attributeCount,
      )
    ) {
      return Array.from({ length: this.attributeCount }, (_, index) => index);
    }
    return [...ids].sort((a, b) => a - b);
  }

  #setAttributeRanges(constraints: readonly AttributeRangeConstraint[]): void {
    this.#attributeRanges = new Array(this.attributeCount);
    for (const constraint of constraints) {
      const attribute = this.#attributeIndex.get(constraint.attributeId);
      if (attribute === undefined) {
        throw new RangeError(
          `属性约束包含未配置的属性 id：${constraint.attributeId}`,
        );
      }
      const minimum = constraint.min ?? Number.NEGATIVE_INFINITY;
      const maximum = constraint.max ?? Number.POSITIVE_INFINITY;
      if (Number.isNaN(minimum) || Number.isNaN(maximum)) {
        throw new RangeError("属性约束不能是 NaN");
      }
      if (minimum > maximum) {
        throw new RangeError(
          `属性 ${constraint.attributeId} 的约束下限不能大于上限`,
        );
      }

      const existing = this.#attributeRanges[attribute];
      const merged = {
        min: Math.max(existing?.min ?? Number.NEGATIVE_INFINITY, minimum),
        max: Math.min(existing?.max ?? Number.POSITIVE_INFINITY, maximum),
      };
      if (merged.min > merged.max) {
        throw new RangeError(
          `属性 ${constraint.attributeId} 的合并约束下限不能大于上限`,
        );
      }
      this.#attributeRanges[attribute] = merged;
    }
    this.#upperConstrainedIndexes = this.#attributeRanges.flatMap(
      (range, attribute) =>
        range !== undefined && Number.isFinite(range.max) ? [attribute] : [],
    );
  }

  #buildSlots(slots: readonly (readonly EquipInfo[])[]): SlotState[] {
    const states = slots.map((equipments, inputIndex) => {
      const sortedCandidates = equipments
        .map((equipment) => {
          const attributes = this.#equipmentAttributes(equipment);
          return {
            equipment,
            attributes,
            attributeSum: attributes.reduce((sum, value) => sum + value, 0),
          };
        })
        .sort((a, b) => {
          if (b.attributeSum !== a.attributeSum) {
            return b.attributeSum - a.attributeSum;
          }
          if (b.equipment.itemLevel !== a.equipment.itemLevel) {
            return b.equipment.itemLevel - a.equipment.itemLevel;
          }
          return b.equipment.itemId - a.equipment.itemId;
        });
      const candidates = this.#pruneCandidates(sortedCandidates).sort((a, b) =>
        this.#compareGreedyCandidates(a, b),
      );

      const minimum = new Array<number>(this.attributeCount).fill(
        Number.POSITIVE_INFINITY,
      );
      const maximum = this.#zeroAttributes();
      for (const candidate of candidates) {
        for (let i = 0; i < this.attributeCount; i++) {
          minimum[i] = Math.min(minimum[i], candidate.attributes[i]);
          maximum[i] = Math.max(maximum[i], candidate.attributes[i]);
        }
      }
      for (const attribute of this.#upperConstrainedIndexes) {
        for (const candidate of candidates) {
          const value = candidate.attributes[attribute];
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new RangeError("有上限约束的装备属性必须是非负安全整数");
          }
        }
      }
      return {
        inputIndex,
        originalCandidateCount: sortedCandidates.length,
        candidates,
        minimum,
        maximum,
      };
    });

    states.sort((a, b) => {
      if (a.candidates.length !== b.candidates.length) {
        return a.candidates.length - b.candidates.length;
      }
      return a.inputIndex - b.inputIndex;
    });
    return states;
  }

  #pruneCandidates(candidates: readonly Candidate[]): Candidate[] {
    let paretoFront: Candidate[] = [];
    for (const candidate of candidates) {
      if (
        paretoFront.some((retained) =>
          this.#attributesNoWeaker(retained.attributes, candidate.attributes),
        )
      ) {
        continue;
      }
      paretoFront = paretoFront.filter(
        (retained) =>
          !this.#attributesNoWeaker(candidate.attributes, retained.attributes),
      );
      paretoFront.push(candidate);
    }
    return paretoFront;
  }

  #attributesNoWeaker(
    first: readonly number[],
    second: readonly number[],
  ): boolean {
    for (let i = 0; i < this.attributeCount; i++) {
      if (this.#hasUpperConstraint(i) && first[i] !== second[i]) return false;
      if (first[i] < second[i]) return false;
    }
    return true;
  }

  #hasUpperConstraint(attribute: number): boolean {
    const range = this.#attributeRanges[attribute];
    return range !== undefined && Number.isFinite(range.max);
  }

  #buildSuffixMinimums(slots: readonly SlotState[]): number[][] {
    const suffix = new Array<number[]>(slots.length + 1);
    suffix[slots.length] = this.#zeroAttributes();
    for (let i = slots.length - 1; i >= 0; i--) {
      suffix[i] = this.#sum(slots[i].minimum, suffix[i + 1]);
    }
    return suffix;
  }

  #compareGreedyCandidates(first: Candidate, second: Candidate): number {
    for (const attribute of this.#greedyPriorityIndexes) {
      const difference =
        second.attributes[attribute] - first.attributes[attribute];
      if (difference !== 0) return difference;
    }
    if (second.attributeSum !== first.attributeSum) {
      return second.attributeSum - first.attributeSum;
    }
    if (second.equipment.itemLevel !== first.equipment.itemLevel) {
      return second.equipment.itemLevel - first.equipment.itemLevel;
    }
    return second.equipment.itemId - first.equipment.itemId;
  }

  #buildSuffixMaximums(slots: readonly SlotState[]): number[][] {
    const suffix = new Array<number[]>(slots.length + 1);
    suffix[slots.length] = this.#zeroAttributes();
    for (let i = slots.length - 1; i >= 0; i--) {
      const next = suffix[i + 1];
      const total = this.#zeroAttributes();
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        total[attribute] = slots[i].maximum[attribute] + next[attribute];
      }
      suffix[i] = total;
    }
    return suffix;
  }

  #buildPrefixMaximums(slots: readonly SlotState[]): number[][] {
    const prefix = new Array<number[]>(slots.length + 1);
    prefix[0] = this.#zeroAttributes();
    for (let depth = 0; depth < slots.length; depth++) {
      prefix[depth + 1] = this.#sum(prefix[depth], slots[depth].maximum);
    }
    return prefix;
  }

  #buildSuffixReachableValues(
    slots: readonly SlotState[],
  ): (number[] | undefined)[][] {
    const suffix = Array.from(
      { length: slots.length + 1 },
      () => new Array<number[] | undefined>(this.attributeCount),
    );
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      if (this.#tierProjectors[attribute] !== undefined) {
        suffix[slots.length][attribute] = [0];
      }
    }

    for (let depth = slots.length - 1; depth >= 0; depth--) {
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        if (this.#tierProjectors[attribute] === undefined) continue;
        const nextValues = suffix[depth + 1][attribute]!;
        const values = new Set<number>();
        for (const candidate of slots[depth].candidates) {
          const candidateValue = candidate.attributes[attribute];
          if (!Number.isInteger(candidateValue) || candidateValue < 0) {
            throw new RangeError("阈值 Pareto 属性必须是非负整数");
          }
          for (const nextValue of nextValues) {
            values.add(candidateValue + nextValue);
          }
        }
        suffix[depth][attribute] = [...values].sort((a, b) => a - b);
      }
    }
    return suffix;
  }

  /**
   * Collapses only states that remain in identical tiers after every reachable
   * suffix value. Comparing the current tier alone is unsafe near a boundary.
   */
  #buildStateTierClasses(foodPlan: FoodPlan): (Int32Array | undefined)[][] {
    const classes = Array.from(
      { length: this.#slots.length + 1 },
      () => new Array<Int32Array | undefined>(this.attributeCount),
    );

    for (let depth = 0; depth <= this.#slots.length; depth++) {
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const projector = this.#tierProjectors[attribute];
        if (projector === undefined) continue;

        const maxCurrent = this.#prefixMaximums[depth][attribute];
        const maxTotal = maxCurrent + this.#suffixMaximums[depth][attribute];
        if (
          !Number.isSafeInteger(maxCurrent) ||
          !Number.isSafeInteger(maxTotal)
        ) {
          throw new RangeError("阈值 Pareto 属性总和必须是安全整数");
        }

        const boundaries = new Uint8Array(maxCurrent + 1);
        const suffixValues = this.#suffixReachableValues[depth][attribute]!;
        let previousTier = projector(
          this.#applyFoodValue(0, attribute, foodPlan.food),
        );
        if (!Number.isFinite(previousTier)) {
          throw new RangeError("属性阈值投影必须返回有限数字");
        }

        for (let total = 1; total <= maxTotal; total++) {
          const currentTier = projector(
            this.#applyFoodValue(total, attribute, foodPlan.food),
          );
          if (!Number.isFinite(currentTier) || currentTier < previousTier) {
            throw new RangeError("属性阈值投影必须单调非递减且返回有限数字");
          }
          if (currentTier !== previousTier) {
            for (const suffixValue of suffixValues) {
              const currentValue = total - suffixValue;
              if (currentValue >= 1 && currentValue <= maxCurrent) {
                boundaries[currentValue] = 1;
              }
            }
          }
          previousTier = currentTier;
        }

        const tierClasses = new Int32Array(maxCurrent + 1);
        for (let value = 1; value <= maxCurrent; value++) {
          tierClasses[value] = tierClasses[value - 1] + boundaries[value];
        }
        classes[depth][attribute] = tierClasses;
      }
    }
    return classes;
  }

  #buildFoodPlans(foods: readonly FoodInfo[]): FoodPlan[] {
    if (foods.length === 0) return [{ food: undefined, key: "no-food" }];

    // A stronger food can cross an attribute ceiling, so ordinary food
    // dominance is only valid when no final attribute has an upper bound.
    if (this.#upperConstrainedIndexes.length > 0) {
      return foods.map((food, index) => ({
        food,
        key: `${index}|${food.itemId}|${food.key}`,
      }));
    }

    const retained: FoodInfo[] = [];
    for (const food of foods) {
      let dominated = false;
      for (const other of retained) {
        if (this.#foodNoWeaker(other, food)) {
          dominated = true;
          break;
        }
      }
      if (dominated) continue;

      for (let i = retained.length - 1; i >= 0; i--) {
        if (this.#foodNoWeaker(food, retained[i])) retained.splice(i, 1);
      }
      retained.push(food);
    }

    return retained.map((food, index) => ({
      food,
      key: `${index}|${food.itemId}|${food.key}`,
    }));
  }

  #foodNoWeaker(first: FoodInfo, second: FoodInfo): boolean {
    const firstParams = new Map<number, FoodParam>();
    const secondParams = new Map<number, FoodParam>();
    for (const param of first.baseParams)
      firstParams.set(param.baseParamId, param);
    for (const param of second.baseParams)
      secondParams.set(param.baseParamId, param);

    for (const attributeId of this.#attributeIds) {
      const firstParam = firstParams.get(attributeId);
      const secondParam = secondParams.get(attributeId);
      const firstRate = (firstParam?.multiplier ?? 1) - 1;
      const secondRate = (secondParam?.multiplier ?? 1) - 1;
      const firstCap = firstParam?.maxValue ?? 0;
      const secondCap = secondParam?.maxValue ?? 0;
      if (firstRate < secondRate || firstCap < secondCap) return false;
    }
    return true;
  }

  #createGreedyLowerBound(foodPlans: readonly FoodPlan[]): FoodPlan[] {
    const selectedCandidates = this.#slots.map((slot) => slot.candidates[0]);
    const attributes = this.#zeroAttributes();
    for (const candidate of selectedCandidates) {
      this.#add(attributes, candidate.attributes);
    }

    const orderedFoodPlans = [...foodPlans].sort((first, second) =>
      this.#compareFoodPriority(first, second),
    );
    const foodPlan = orderedFoodPlans[0];
    const selection = new Array<EquipInfo>(this.#slots.length);
    for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
      const slot = this.#slots[slotIndex];
      selection[slot.inputIndex] = selectedCandidates[slotIndex].equipment;
    }
    this.#consider(
      this.#damageWithFood(attributes, foodPlan),
      selection,
      foodPlan,
      attributes,
    );
    this.statistics.initialGreedyDamage = this.#bestDamage();
    this.#debugLog(
      `[V1] 初始贪心解：属性优先级=${this.#greedyPriorityIndexes.map((index) => this.#attributeIds[index]).join(">")}；食物=${this.#foodLabel(foodPlan)}；装备=${selection.map((equipment) => equipment.itemId).join(",")}；伤害=${this.#bestDamage()}`,
    );
    const improvedDamage = this.#improveLowerBound(
      selectedCandidates,
      foodPlans,
    );
    this.statistics.localSearchDamage = this.#bestDamage();
    this.#debugLog(
      `[V1] 局部改良下界：食物=${this.#best?.food === undefined ? "无食物" : `${this.#best.food.itemId}/${this.#best.food.key}`}；装备=${this.#best?.selection.map((equipment) => equipment.itemId).join(",")}；伤害=${this.#bestDamage()}；单槽改良=${this.statistics.singleSlotImprovements}；双槽改良=${this.statistics.pairwiseImprovements}`,
    );
    const searchOrder = [...orderedFoodPlans].sort((first, second) => {
      const priorityDifference = this.#compareFoodPriority(first, second);
      if (priorityDifference !== 0) return priorityDifference;
      const difference =
        improvedDamage.get(second.key)! - improvedDamage.get(first.key)!;
      return (
        difference ||
        orderedFoodPlans.indexOf(first) - orderedFoodPlans.indexOf(second)
      );
    });
    this.#debugLog(
      `[V1] 食物搜索顺序：${searchOrder.map((plan) => `${this.#foodLabel(plan)}=${improvedDamage.get(plan.key)}`).join(",")}`,
    );
    return searchOrder;
  }

  #improveLowerBound(
    greedyCandidates: readonly Candidate[],
    foodPlans: readonly FoodPlan[],
  ): Map<string, number> {
    const damageByFood = new Map<string, number>();
    for (const foodPlan of foodPlans) {
      const selectedCandidates = [...greedyCandidates];
      const attributes = this.#zeroAttributes();
      for (const candidate of selectedCandidates) {
        this.#add(attributes, candidate.attributes);
      }
      let damage = this.#damageWithFood(attributes, foodPlan);
      let violation = this.#constraintViolation(attributes, foodPlan.food);

      let improved = true;
      while (improved) {
        improved = false;
        for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
          const current = selectedCandidates[slotIndex];
          this.#subtract(attributes, current.attributes);
          let bestCandidate = current;
          let bestDamage = damage;
          let bestViolation = violation;
          for (const candidate of this.#slots[slotIndex].candidates) {
            this.#add(attributes, candidate.attributes);
            const candidateDamage = this.#damageWithFood(attributes, foodPlan);
            const candidateViolation = this.#constraintViolation(
              attributes,
              foodPlan.food,
            );
            this.#subtract(attributes, candidate.attributes);
            if (
              candidateViolation < bestViolation ||
              (candidateViolation === bestViolation &&
                candidateDamage > bestDamage)
            ) {
              bestCandidate = candidate;
              bestDamage = candidateDamage;
              bestViolation = candidateViolation;
            }
          }
          selectedCandidates[slotIndex] = bestCandidate;
          this.#add(attributes, bestCandidate.attributes);
          if (
            bestViolation < violation ||
            (bestViolation === violation && bestDamage > damage)
          ) {
            damage = bestDamage;
            violation = bestViolation;
            improved = true;
            this.statistics.singleSlotImprovements++;
          }
        }

        if (this.options.pairwiseLowerBound !== false) {
          for (
            let firstSlotIndex = 0;
            firstSlotIndex < this.#slots.length;
            firstSlotIndex++
          ) {
            for (
              let secondSlotIndex = firstSlotIndex + 1;
              secondSlotIndex < this.#slots.length;
              secondSlotIndex++
            ) {
              const currentFirst = selectedCandidates[firstSlotIndex];
              const currentSecond = selectedCandidates[secondSlotIndex];
              this.#subtract(attributes, currentFirst.attributes);
              this.#subtract(attributes, currentSecond.attributes);

              let bestFirst = currentFirst;
              let bestSecond = currentSecond;
              let bestDamage = damage;
              let bestViolation = violation;
              for (const first of this.#slots[firstSlotIndex].candidates) {
                this.#add(attributes, first.attributes);
                for (const second of this.#slots[secondSlotIndex].candidates) {
                  this.#add(attributes, second.attributes);
                  const candidateDamage = this.#damageWithFood(
                    attributes,
                    foodPlan,
                  );
                  const candidateViolation = this.#constraintViolation(
                    attributes,
                    foodPlan.food,
                  );
                  this.#subtract(attributes, second.attributes);
                  if (
                    candidateViolation < bestViolation ||
                    (candidateViolation === bestViolation &&
                      candidateDamage > bestDamage)
                  ) {
                    bestFirst = first;
                    bestSecond = second;
                    bestDamage = candidateDamage;
                    bestViolation = candidateViolation;
                  }
                }
                this.#subtract(attributes, first.attributes);
              }

              selectedCandidates[firstSlotIndex] = bestFirst;
              selectedCandidates[secondSlotIndex] = bestSecond;
              this.#add(attributes, bestFirst.attributes);
              this.#add(attributes, bestSecond.attributes);
              if (
                bestViolation < violation ||
                (bestViolation === violation && bestDamage > damage)
              ) {
                damage = bestDamage;
                violation = bestViolation;
                improved = true;
                this.statistics.pairwiseImprovements++;
              }
            }
          }
        }
      }

      const selection = new Array<EquipInfo>(this.#slots.length);
      for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
        const slot = this.#slots[slotIndex];
        selection[slot.inputIndex] = selectedCandidates[slotIndex].equipment;
      }
      this.#consider(damage, selection, foodPlan, attributes);
      damageByFood.set(
        foodPlan.key,
        violation === 0 ? damage : Number.NEGATIVE_INFINITY,
      );
    }
    return damageByFood;
  }

  #compareFoodPriority(first: FoodPlan, second: FoodPlan): number {
    return this.options.foodPriorityComparator?.(first.food, second.food) ?? 0;
  }

  #orderSlotsForSearch(foodPlans: readonly FoodPlan[]): void {
    const coordinateMaximum = this.#zeroAttributes();
    for (const slot of this.#slots) this.#add(coordinateMaximum, slot.maximum);

    const relaxationGap = new Map<SlotState, number>();
    for (const slot of this.#slots) {
      const otherMaximum = [...coordinateMaximum];
      this.#subtract(otherMaximum, slot.maximum);
      let totalGap = 0;
      for (const foodPlan of foodPlans) {
        const relaxedDamage = this.#damageWithFood(coordinateMaximum, foodPlan);
        let resolvedDamage = Number.NEGATIVE_INFINITY;
        for (const candidate of slot.candidates) {
          resolvedDamage = Math.max(
            resolvedDamage,
            this.#damageWithFood(
              this.#sum(otherMaximum, candidate.attributes),
              foodPlan,
            ),
          );
        }
        if (Number.isFinite(relaxedDamage) && Number.isFinite(resolvedDamage)) {
          totalGap += relaxedDamage - resolvedDamage;
        }
      }
      relaxationGap.set(slot, totalGap);
    }

    const order = this.options.slotOrder ?? "relaxation-gap-with-small-suffix";
    const compareByRelaxationGap = (
      first: SlotState,
      second: SlotState,
    ): number => {
      const gapDifference =
        relaxationGap.get(second)! - relaxationGap.get(first)!;
      return (
        gapDifference ||
        first.candidates.length - second.candidates.length ||
        first.inputIndex - second.inputIndex
      );
    };
    const compareByCandidateCount = (
      first: SlotState,
      second: SlotState,
    ): number =>
      second.candidates.length - first.candidates.length ||
      compareByRelaxationGap(first, second);

    if (order === "candidate-count-descending") {
      this.#slots.sort(compareByCandidateCount);
    } else if (order === "relaxation-gap") {
      this.#slots.sort(compareByRelaxationGap);
    } else {
      const requestedSlotCount = Math.min(
        this.options.suffixFrontierSlotCount ??
          DEFAULT_SUFFIX_FRONTIER_SLOT_COUNT,
        this.#slots.length,
      );
      const maximumCombinations =
        this.options.suffixFrontierMaxCombinations ??
        DEFAULT_SUFFIX_FRONTIER_MAX_COMBINATIONS;
      const smallestSlots = [...this.#slots].sort(
        (first, second) =>
          first.candidates.length - second.candidates.length ||
          compareByRelaxationGap(first, second),
      );
      const suffixSlots = new Set<SlotState>();
      let combinations = 1;
      for (const slot of smallestSlots) {
        if (suffixSlots.size === requestedSlotCount) break;
        const nextCombinations = combinations * slot.candidates.length;
        if (nextCombinations > maximumCombinations) break;
        suffixSlots.add(slot);
        combinations = nextCombinations;
      }
      const prefix = this.#slots
        .filter((slot) => !suffixSlots.has(slot))
        .sort(compareByRelaxationGap);
      const suffix = this.#slots
        .filter((slot) => suffixSlots.has(slot))
        .sort(compareByCandidateCount);
      this.#slots = [...prefix, ...suffix];
    }
    this.#debugLog(
      `[V1] 槽位搜索顺序：策略=${order}；${this.#slots.map((slot) => `${slot.inputIndex}(候选=${slot.candidates.length},上界虚高影响=${relaxationGap.get(slot)!.toFixed(6)})`).join(",")}`,
    );
  }

  #orderCandidatesForSearch(foodPlans: readonly FoodPlan[]): void {
    const coordinateMaximum = this.#zeroAttributes();
    for (const slot of this.#slots) this.#add(coordinateMaximum, slot.maximum);

    for (const slot of this.#slots) {
      const otherMaximum = [...coordinateMaximum];
      this.#subtract(otherMaximum, slot.maximum);
      const optimisticDamage = new Map<Candidate, number>();
      for (const candidate of slot.candidates) {
        const attributes = this.#sum(otherMaximum, candidate.attributes);
        let damage = Number.NEGATIVE_INFINITY;
        for (const foodPlan of foodPlans) {
          damage = Math.max(damage, this.#damageWithFood(attributes, foodPlan));
        }
        optimisticDamage.set(candidate, damage);
      }
      slot.candidates.sort((first, second) => {
        const difference =
          optimisticDamage.get(second)! - optimisticDamage.get(first)!;
        return difference || this.#compareGreedyCandidates(first, second);
      });
    }
  }

  #buildSuffixFrontier(): void {
    const requestedSlotCount = Math.min(
      this.options.suffixFrontierSlotCount ??
        DEFAULT_SUFFIX_FRONTIER_SLOT_COUNT,
      this.#slots.length,
    );
    const maximumCombinations =
      this.options.suffixFrontierMaxCombinations ??
      DEFAULT_SUFFIX_FRONTIER_MAX_COMBINATIONS;

    let rawCombinations = 1;
    let slotCount = 0;
    while (slotCount < requestedSlotCount) {
      const slot = this.#slots[this.#slots.length - slotCount - 1];
      const nextCombinations = rawCombinations * slot.candidates.length;
      if (nextCombinations > maximumCombinations) break;
      rawCombinations = nextCombinations;
      slotCount++;
    }

    this.#suffixStart = this.#slots.length - slotCount;
    this.statistics.suffixSlotCount = slotCount;
    this.statistics.suffixRawCombinations =
      slotCount === 0 ? 0 : rawCombinations;
    if (slotCount === 0) {
      this.#debugLog("[V1] 后缀Pareto前沿：已禁用或组合数超过限制");
      return;
    }

    let frontier: SuffixFrontierState[] = [
      {
        attributes: this.#zeroAttributes(),
        attributeSum: 0,
        candidates: [],
      },
    ];
    const layerSizes: string[] = [];
    for (
      let slotIndex = this.#suffixStart;
      slotIndex < this.#slots.length;
      slotIndex++
    ) {
      const generated: SuffixFrontierState[] = [];
      for (const state of frontier) {
        for (const candidate of this.#slots[slotIndex].candidates) {
          generated.push({
            attributes: this.#sum(state.attributes, candidate.attributes),
            attributeSum: state.attributeSum + candidate.attributeSum,
            candidates: [...state.candidates, candidate],
          });
        }
      }
      frontier = this.#pruneSuffixFrontier(generated);
      layerSizes.push(`${generated.length}->${frontier.length}`);
    }

    this.statistics.suffixFrontierSize = frontier.length;
    this.#suffixFrontierRoot = this.#buildSuffixFrontierTree(frontier);
    this.#debugLog(
      `[V1] 后缀Pareto前沿：槽位=${this.#slots
        .slice(this.#suffixStart)
        .map((slot) => `${slot.inputIndex}/${slot.candidates.length}`)
        .join(
          ",",
        )}；原始组合=${rawCombinations}；逐层=${layerSizes.join(",")}；最终前沿=${frontier.length}`,
    );
  }

  #pruneSuffixFrontier(states: SuffixFrontierState[]): SuffixFrontierState[] {
    states.sort((first, second) => {
      const sumDifference = second.attributeSum - first.attributeSum;
      if (sumDifference !== 0) return sumDifference;
      return -this.#compareParetoVectors(first.attributes, second.attributes);
    });

    const index = new DominanceIndex(this.#paretoDimensionCount());
    const frontier: SuffixFrontierState[] = [];
    for (const state of states) {
      if (
        index.accept(this.#buildStaticParetoVector(state.attributes)).accepted
      ) {
        frontier.push(state);
      }
    }
    return frontier;
  }

  #buildSuffixFrontierTree(states: SuffixFrontierState[]): SuffixFrontierNode {
    const minimum = new Array<number>(this.attributeCount).fill(
      Number.POSITIVE_INFINITY,
    );
    const maximum = this.#zeroAttributes();
    for (const state of states) {
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        minimum[attribute] = Math.min(
          minimum[attribute],
          state.attributes[attribute],
        );
        maximum[attribute] = Math.max(
          maximum[attribute],
          state.attributes[attribute],
        );
      }
    }
    if (states.length <= SUFFIX_FRONTIER_LEAF_SIZE) {
      return { minimum, maximum, states };
    }

    let splitAttribute = 0;
    let largestSpread = Number.NEGATIVE_INFINITY;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      let minimum = Number.POSITIVE_INFINITY;
      let maximumValue = Number.NEGATIVE_INFINITY;
      for (const state of states) {
        minimum = Math.min(minimum, state.attributes[attribute]);
        maximumValue = Math.max(maximumValue, state.attributes[attribute]);
      }
      const spread = maximumValue - minimum;
      if (spread > largestSpread) {
        largestSpread = spread;
        splitAttribute = attribute;
      }
    }
    states.sort(
      (first, second) =>
        first.attributes[splitAttribute] - second.attributes[splitAttribute],
    );
    const middle = Math.trunc(states.length / 2);
    return {
      minimum,
      maximum,
      left: this.#buildSuffixFrontierTree(states.slice(0, middle)),
      right: this.#buildSuffixFrontierTree(states.slice(middle)),
    };
  }

  #searchFood(
    zeroAttributes: number[],
    inputSlotCount: number,
    foodPlan: FoodPlan,
  ): void {
    const zeroParetoVector = this.#buildParetoVector(0, zeroAttributes);
    this.#stateDominanceIndexes[0].accept(zeroParetoVector);
    this.#acceptedStateCounts[0]++;
    this.#frontierPeakSizes[0] = Math.max(this.#frontierPeakSizes[0], 1);
    this.#searchDepth(
      0,
      zeroAttributes,
      new Array<EquipInfo>(inputSlotCount),
      foodPlan,
    );
  }

  #searchDepth(
    slotIndex: number,
    parentAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlan: FoodPlan,
  ): void {
    if (
      slotIndex === this.#suffixStart &&
      this.#suffixFrontierRoot !== undefined
    ) {
      this.#searchSuffixFrontier(
        this.#suffixFrontierRoot,
        parentAttributes,
        selection,
        foodPlan,
      );
      return;
    }

    const depth = slotIndex + 1;
    const slot = this.#slots[slotIndex];
    const diagnostics = this.#depthDiagnostics[slotIndex];

    for (const candidate of slot.candidates) {
      this.#activeDepth = depth;
      this.#searchedCount++;
      diagnostics.attemptedCount++;
      if (this.#searchedCount % 100_000 === 0) {
        this.#logProgress("搜索中");
      }

      const attributes = this.#sum(parentAttributes, candidate.attributes);
      if (
        !this.#canMeetConstraints(
          attributes,
          this.#suffixMinimums[depth],
          this.#suffixMaximums[depth],
          foodPlan,
        )
      ) {
        this.statistics.constraintPruned++;
        continue;
      }
      const upperDamage = this.#upperDamageOfSum(
        attributes,
        this.#suffixMaximums[depth],
        foodPlan,
      );
      diagnostics.upperGapBuckets[this.#upperGapBucket(upperDamage)]++;
      if (this.#best !== undefined && upperDamage <= this.#best.damage) {
        this.#upperPrunedCounts[depth]++;
        continue;
      }
      diagnostics.upperPassedCount++;

      selection[slot.inputIndex] = candidate.equipment;
      if (depth === this.#slots.length) {
        diagnostics.dominancePassedCount++;
        this.#acceptedStateCounts[depth]++;
        this.#leafCount++;
        this.#consider(upperDamage, selection, foodPlan, attributes);
      } else {
        const paretoVector = this.#buildParetoVector(depth, attributes);
        const dominance =
          this.#stateDominanceIndexes[depth].accept(paretoVector);
        this.#dominanceComparisonCount += dominance.comparisons;
        this.#dominanceComparisonCounts[depth] += dominance.comparisons;
        if (!dominance.accepted) {
          this.#statePrunedCounts[depth]++;
          if (dominance.equal) {
            this.#duplicatePrunedCounts[depth]++;
            diagnostics.duplicatePrunedCount++;
          }
          continue;
        }
        diagnostics.dominancePassedCount++;
        this.#acceptedStateCounts[depth]++;
        this.#frontierPeakSizes[depth] = Math.max(
          this.#frontierPeakSizes[depth],
          this.#stateDominanceIndexes[depth].size,
        );
        this.#searchDepth(depth, attributes, selection, foodPlan);
      }
    }
  }

  #searchSuffixFrontier(
    node: SuffixFrontierNode,
    prefixAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlan: FoodPlan,
    knownUpperDamage?: number,
  ): void {
    this.statistics.suffixBoundChecks++;
    if (
      !this.#canMeetConstraints(
        prefixAttributes,
        node.minimum,
        node.maximum,
        foodPlan,
      )
    ) {
      this.statistics.suffixConstraintPruned++;
      return;
    }
    const upperDamage =
      knownUpperDamage ??
      this.#upperDamageOfSum(prefixAttributes, node.maximum, foodPlan);
    if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
      this.statistics.suffixBoundPruned++;
      return;
    }

    if (node.states !== undefined) {
      for (const state of node.states) {
        this.#activeDepth = this.#slots.length;
        this.#searchedCount++;
        this.statistics.suffixVectorsEvaluated++;
        if (this.#searchedCount % 100_000 === 0) {
          this.#logProgress("搜索中");
        }
        if (
          !this.#canMeetConstraints(
            prefixAttributes,
            state.attributes,
            state.attributes,
            foodPlan,
          )
        ) {
          this.statistics.suffixConstraintPruned++;
          continue;
        }
        const damage = this.#upperDamageOfSum(
          prefixAttributes,
          state.attributes,
          foodPlan,
        );
        this.#leafCount++;
        if (damage <= this.#bestDamage()) continue;
        for (let index = 0; index < state.candidates.length; index++) {
          const slot = this.#slots[this.#suffixStart + index];
          selection[slot.inputIndex] = state.candidates[index].equipment;
        }
        this.#consider(
          damage,
          selection,
          foodPlan,
          this.#sum(prefixAttributes, state.attributes),
        );
      }
      return;
    }

    const children = [node.left, node.right].filter(
      (child): child is SuffixFrontierNode => child !== undefined,
    );
    const orderedChildren = children
      .map((child) => ({
        child,
        upperDamage: this.#upperDamageOfSum(
          prefixAttributes,
          child.maximum,
          foodPlan,
        ),
      }))
      .sort((first, second) => second.upperDamage - first.upperDamage);
    for (const child of orderedChildren) {
      this.#searchSuffixFrontier(
        child.child,
        prefixAttributes,
        selection,
        foodPlan,
        child.upperDamage,
      );
    }
  }

  #buildParetoVector(depth: number, attributes: readonly number[]): number[] {
    const vector = attributes.map((value, attribute) => {
      const tierClasses = this.#stateTierClasses[depth][attribute];
      if (tierClasses === undefined) return value;
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value >= tierClasses.length
      ) {
        throw new RangeError("阈值 Pareto 状态属性超出预计算范围");
      }
      return tierClasses[value];
    });
    for (const attribute of this.#upperConstrainedIndexes) {
      vector.push(-attributes[attribute]);
    }
    return vector;
  }

  #buildStaticParetoVector(attributes: readonly number[]): number[] {
    const vector = [...attributes];
    for (const attribute of this.#upperConstrainedIndexes) {
      vector.push(-attributes[attribute]);
    }
    return vector;
  }

  #paretoDimensionCount(): number {
    return this.attributeCount + this.#upperConstrainedIndexes.length;
  }

  #compareParetoVectors(
    first: readonly number[],
    second: readonly number[],
  ): number {
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const difference = first[attribute] - second[attribute];
      if (difference !== 0) return difference;
    }
    return 0;
  }

  #consider(
    damage: number,
    selection: EquipInfo[],
    foodPlan: FoodPlan,
    attributes: readonly number[],
  ): void {
    if (Number.isNaN(damage)) return;
    if (!this.#isFinalFeasible(attributes, foodPlan.food)) return;
    if (this.#best !== undefined && damage <= this.#best.damage) return;
    this.#bestUpdateCount++;
    this.#best = {
      damage,
      selection: selection.slice(),
      food: foodPlan.food,
    };
  }

  #bestDamage(): number {
    return this.#best === undefined
      ? Number.NEGATIVE_INFINITY
      : this.#best.damage;
  }

  #hasBest(): boolean {
    return this.#best !== undefined;
  }

  #damageWithFood(attributes: readonly number[], foodPlan: FoodPlan): number {
    const key = `${foodPlan.key}|${attributes.join(",")}`;
    const cached = this.damageCache.get(key);
    if (cached !== undefined || this.damageCache.has(key)) {
      this.#damageCacheHitCount++;
      return cached!;
    }

    this.#damageCacheMissCount++;
    const damage = this.#uncachedDamageWithFood(attributes, foodPlan);
    if (this.damageCache.size >= MAX_DAMAGE_CACHE_ENTRIES) {
      this.damageCache.clear();
      this.#damageCacheClearCount++;
    }
    this.damageCache.set(key, damage);
    return damage;
  }

  #uncachedDamageWithFood(
    attributes: readonly number[],
    foodPlan: FoodPlan,
  ): number {
    return this.damageFunction(this.#applyFood(attributes, foodPlan.food));
  }

  #upperDamageOfSum(
    first: readonly number[],
    second: readonly number[],
    foodPlan: FoodPlan,
  ): number {
    const attributes = this.#zeroAttributes();
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      attributes[attribute] = first[attribute] + second[attribute];
    }
    for (const attribute of this.#upperConstrainedIndexes) {
      attributes[attribute] = Math.min(
        attributes[attribute],
        this.#inverseFoodMaximum(
          this.#attributeRanges[attribute]!.max,
          attribute,
          foodPlan.food,
          attributes[attribute],
        ),
      );
    }
    this.#applyFoodInPlace(attributes, foodPlan.food);
    return this.damageFunction(attributes);
  }

  #logProgress(stage: string): void {
    if (this.options.debug === false) return;
    const elapsedMs = Math.max(1, Date.now() - this.#searchStartedAt);
    const cacheTotal = this.#damageCacheHitCount + this.#damageCacheMissCount;
    const cacheHitRate =
      cacheTotal === 0
        ? "0.0"
        : ((this.#damageCacheHitCount * 100) / cacheTotal).toFixed(1);
    this.#debugLog(
      `[V1] ${stage}：食物=${this.#activeFood || "预处理"}；搜索=${this.#searchedCount}；速率=${Math.round((this.#searchedCount * 1000) / elapsedMs)}/秒；当前深度=${this.#formatActiveDepth()}；状态通过=${this.#formatDepthCounts(this.#acceptedStateCounts)}；状态剪枝=${this.#formatDepthCounts(this.#statePrunedCounts)}；上界剪枝=${this.#formatDepthCounts(this.#upperPrunedCounts)}；约束剪枝=${this.statistics.constraintPruned}/${this.statistics.suffixConstraintPruned}；后缀=前沿${this.statistics.suffixFrontierSize},界检查${this.statistics.suffixBoundChecks},界剪枝${this.statistics.suffixBoundPruned},向量评估${this.statistics.suffixVectorsEvaluated}；支配索引=${this.#stateDominanceIndexes.map((index) => index.size).join("/")}；索引峰值=${this.#frontierPeakSizes.join("/")}；支配比较=${this.#dominanceComparisonCount}；叶子=${this.#leafCount}；最优=${this.#bestDamage()}(更新${this.#bestUpdateCount})；缓存命中=${cacheHitRate}%(${this.damageCache.size}项,清空${this.#damageCacheClearCount}次)；内存=${this.#formatMemoryUsage()}`,
    );
  }

  #upperGapBucket(upperDamage: number): number {
    const bestDamage = this.#bestDamage();
    if (upperDamage <= bestDamage) return 0;
    if (!Number.isFinite(bestDamage)) return 4;
    const relativeGap =
      (upperDamage - bestDamage) / Math.max(1, Math.abs(bestDamage));
    if (relativeGap <= 0.0001) return 1;
    if (relativeGap <= 0.001) return 2;
    if (relativeGap <= 0.01) return 3;
    return 4;
  }

  #formatActiveDepth(): string {
    if (
      this.#suffixFrontierRoot !== undefined &&
      this.#activeDepth > this.#suffixStart
    ) {
      return `后缀Pareto(${this.statistics.suffixSlotCount}槽,前沿=${this.statistics.suffixFrontierSize})`;
    }
    const diagnostics = this.#depthDiagnostics[this.#activeDepth - 1];
    if (diagnostics === undefined) return "无";
    return `${diagnostics.depth}(候选=${diagnostics.candidateCount},尝试=${diagnostics.attemptedCount},上界通过=${diagnostics.upperPassedCount},Pareto通过=${diagnostics.dominancePassedCount},余量[≤0/≤0.01%/≤0.1%/≤1%/>1%]=${diagnostics.upperGapBuckets.join("/")})`;
  }

  #formatMemoryUsage(): string {
    const { heapUsed, rss } = process.memoryUsage();
    const mib = 1024 * 1024;
    return `heap=${Math.round(heapUsed / mib)}MiB,rss=${Math.round(rss / mib)}MiB`;
  }

  #logDepthDiagnostics(): void {
    if (this.options.debug === false) return;
    const rows = this.#depthDiagnostics
      .slice(0, this.#suffixStart)
      .map((diagnostics) => {
        const upperPruned =
          diagnostics.attemptedCount - diagnostics.upperPassedCount;
        const statePruned =
          diagnostics.upperPassedCount - diagnostics.dominancePassedCount;
        const strictPruned = statePruned - diagnostics.duplicatePrunedCount;
        return `${diagnostics.depth}:尝试=${diagnostics.attemptedCount},Pareto剪枝=${statePruned}(重复=${diagnostics.duplicatePrunedCount},严格=${strictPruned}),上界剪枝=${upperPruned},通过=${diagnostics.upperPassedCount},余量=${diagnostics.upperGapBuckets.join("/")},剩余不相容=${this.#formatSuffixUpperCompatibility(diagnostics.depth)}`;
      });
    this.#debugLog(
      `[V1] 分层诊断：食物=${this.#activeFood}；余量顺序=[≤0/≤0.01%/≤0.1%/≤1%/>1%]；${rows.join("；")}；后缀Pareto=槽位${this.statistics.suffixSlotCount},原始${this.statistics.suffixRawCombinations},前沿${this.statistics.suffixFrontierSize},界检查${this.statistics.suffixBoundChecks},界剪枝${this.statistics.suffixBoundPruned},向量评估${this.statistics.suffixVectorsEvaluated}`,
    );
  }

  #logUpperBoundCompatibility(): void {
    if (this.options.debug === false) return;
    const slots = this.#slots.map((slot) => {
      const compatible = slot.candidates.some((candidate) =>
        this.#attributesNoWeaker(candidate.attributes, slot.maximum),
      );
      const maximumSum = slot.maximum.reduce((sum, value) => sum + value, 0);
      const attainableSum = Math.max(
        ...slot.candidates.map((candidate) => candidate.attributeSum),
      );
      return `${slot.inputIndex}:${compatible ? "可达" : "不相容"}(超额=${maximumSum - attainableSum})`;
    });
    this.#debugLog(
      `[V1] 逐属性上界：槽位(输入序号:单件能否同时达到各维最大值/最大向量属性和超额)=${slots.join(",")}`,
    );
  }

  #formatSuffixUpperCompatibility(depth: number): string {
    let incompatible = 0;
    let excess = 0;
    for (let slotIndex = depth; slotIndex < this.#slots.length; slotIndex++) {
      const slot = this.#slots[slotIndex];
      if (
        !slot.candidates.some((candidate) =>
          this.#attributesNoWeaker(candidate.attributes, slot.maximum),
        )
      ) {
        incompatible++;
      }
      excess +=
        slot.maximum.reduce((sum, value) => sum + value, 0) -
        Math.max(...slot.candidates.map((candidate) => candidate.attributeSum));
    }
    return `${incompatible}/${this.#slots.length - depth}(属性和超额=${excess})`;
  }

  #logTierCompression(): void {
    if (this.options.debug === false) return;
    const byDepth = this.#stateTierClasses.map((tables, depth) => {
      let rawValues = 0;
      let tierClasses = 0;
      let suffixValues = 0;
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const table = tables[attribute];
        if (table === undefined) continue;
        rawValues += table.length;
        tierClasses += table[table.length - 1] + 1;
        suffixValues += this.#suffixReachableValues[depth][attribute]!.length;
      }
      return `${depth}:${rawValues}->${tierClasses}/后缀${suffixValues}`;
    });
    this.#debugLog(
      `[V1] 阈值压缩：食物=${this.#activeFood}；深度(原始整数值数之和->未来等价类数之和/后缀可达值数之和)=${byDepth.join(",")}`,
    );
  }

  #foodLabel(foodPlan: FoodPlan): string {
    return foodPlan.food === undefined
      ? "无食物"
      : `${foodPlan.food.itemId}/${foodPlan.food.key}`;
  }

  #sumCounts(counts: readonly number[]): number {
    return counts.reduce((sum, count) => sum + count, 0);
  }

  #formatDepthCounts(counts: readonly number[]): string {
    return counts.map((count, depth) => `${depth}:${count}`).join("/");
  }

  #debugLog(message: string): void {
    if (this.options.debug === false) return;
    const label = this.options.debugLabel;
    console.log(
      label === undefined ? message : message.replace(/^\[V1\]/, `[${label}]`),
    );
  }

  #applyFood(
    attributes: readonly number[],
    food: FoodInfo | undefined,
  ): number[] {
    const result = [...attributes];
    this.#applyFoodInPlace(result, food);
    return result;
  }

  #applyFoodInPlace(attributes: number[], food: FoodInfo | undefined): void {
    if (food === undefined) return;

    for (const param of food.baseParams) {
      const index = this.#attributeIndex.get(param.baseParamId);
      if (index === undefined) {
        throw new RangeError(`食物包含未配置的属性 id：${param.baseParamId}`);
      }
      const bonus = Math.min(
        param.maxValue,
        Math.trunc(attributes[index] * (param.multiplier - 1) + 1e-7),
      );
      attributes[index] += bonus;
    }
  }

  #applyFoodValue(
    value: number,
    attribute: number,
    food: FoodInfo | undefined,
  ): number {
    if (food === undefined) return value;
    const attributeId = this.#attributeIds[attribute];
    const param = food.baseParams.find(
      (candidate) => candidate.baseParamId === attributeId,
    );
    if (param === undefined) return value;
    return (
      value +
      Math.min(
        param.maxValue,
        Math.trunc(value * (param.multiplier - 1) + 1e-7),
      )
    );
  }

  #canMeetConstraints(
    prefix: readonly number[],
    remainingMinimum: readonly number[],
    remainingMaximum: readonly number[],
    foodPlan: FoodPlan,
  ): boolean {
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const range = this.#attributeRanges[attribute];
      if (range === undefined) continue;
      const minimum = this.#applyFoodValue(
        prefix[attribute] + remainingMinimum[attribute],
        attribute,
        foodPlan.food,
      );
      const maximum = this.#applyFoodValue(
        prefix[attribute] + remainingMaximum[attribute],
        attribute,
        foodPlan.food,
      );
      if (maximum < range.min || minimum > range.max) return false;
    }
    return true;
  }

  #isFinalFeasible(
    attributes: readonly number[],
    food: FoodInfo | undefined,
  ): boolean {
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const range = this.#attributeRanges[attribute];
      if (range === undefined) continue;
      const value = this.#applyFoodValue(
        attributes[attribute],
        attribute,
        food,
      );
      if (value < range.min || value > range.max) return false;
    }
    return true;
  }

  #constraintViolation(
    attributes: readonly number[],
    food: FoodInfo | undefined,
  ): number {
    let violation = 0;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const range = this.#attributeRanges[attribute];
      if (range === undefined) continue;
      const value = this.#applyFoodValue(
        attributes[attribute],
        attribute,
        food,
      );
      if (value < range.min) violation += range.min - value;
      if (value > range.max) violation += value - range.max;
    }
    return violation;
  }

  #inverseFoodMaximum(
    maximumFinalValue: number,
    attribute: number,
    food: FoodInfo | undefined,
    upperBaseValue: number,
  ): number {
    if (!Number.isSafeInteger(upperBaseValue) || upperBaseValue < 0) {
      throw new RangeError("有上限约束的属性总和必须是非负安全整数");
    }
    let lower = -1;
    let upper = upperBaseValue + 1;
    while (upper - lower > 1) {
      const middle = Math.trunc((lower + upper) / 2);
      if (this.#applyFoodValue(middle, attribute, food) <= maximumFinalValue) {
        lower = middle;
      } else {
        upper = middle;
      }
    }
    return lower;
  }

  #equipmentParams(equipment: EquipInfo): readonly ParamInfo[] {
    return (
      this.options.equipmentAttributeExtractor?.(equipment) ??
      equipment.baseParams
    );
  }

  #equipmentAttributes(equipment: EquipInfo): number[] {
    const attributes = this.#zeroAttributes();
    for (const param of this.#equipmentParams(equipment)) {
      const index = this.#attributeIndex.get(param.baseParamId);
      if (index === undefined) {
        throw new RangeError(`装备包含未配置的属性 id：${param.baseParamId}`);
      }
      if (!Number.isFinite(param.value)) {
        throw new TypeError(`装备属性值必须是有限数字：${param.baseParamId}`);
      }
      attributes[index] += param.value;
    }
    return attributes;
  }

  #zeroAttributes(): number[] {
    return new Array<number>(this.attributeCount).fill(0);
  }

  #add(target: number[], source: readonly number[]): void {
    for (let i = 0; i < this.attributeCount; i++) target[i] += source[i];
  }

  #subtract(target: number[], source: readonly number[]): void {
    for (let i = 0; i < this.attributeCount; i++) target[i] -= source[i];
  }

  #sum(first: readonly number[], second: readonly number[]): number[] {
    const result = this.#zeroAttributes();
    for (let i = 0; i < this.attributeCount; i++) {
      result[i] = first[i] + second[i];
    }
    return result;
  }
}
