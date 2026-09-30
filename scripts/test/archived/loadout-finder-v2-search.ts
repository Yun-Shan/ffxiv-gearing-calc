import type { EquipInfo, FoodInfo, FoodParam, ParamInfo } from "../types.ts";

const MAX_DAMAGE_CACHE_ENTRIES = 500_000;
const DEFAULT_SUFFIX_FRONTIER_SLOT_COUNT = 4;
const DEFAULT_SUFFIX_FRONTIER_MAX_COMBINATIONS = 6_000_000;
const CONSTRAINED_SUFFIX_FRONTIER_LEAF_SIZE = 32;
const DEFAULT_SUFFIX_FRONTIER_LEAF_SIZE = 65_536;
const SUFFIX_GROUP_STATE_LIMIT = 32;
// A fixed-sum block is still too wide for the component-wise envelope to be
// useful after a strong incumbent has been found.  These small contiguous
// ranges keep the evaluator array-friendly while tightening the envelope.
const SUFFIX_SUBBLOCK_STATE_LIMIT = 2;
const DEFAULT_SUFFIX_FLAT_TREE_LEAF_SIZE = 256;
const TOTAL_SIGNATURE_LIMIT = 500_000;
const MAX_COMBINED_DAMAGE_CACHE_ENTRIES = 1_000_000;
const COMBINED_DAMAGE_CACHE_PROBE_LIMIT = 16_384;
const COMBINED_DAMAGE_CACHE_MIN_HIT_RATE = 0.2;
const LOWER_BOUND_RANDOM_SEEDS = 4_096;
const LOWER_BOUND_RANDOM_LOCAL_SEEDS = 128;
// Keep the disabled path nearly allocation-free; the diagnostic cache grows
// geometrically only when the corresponding option is explicitly enabled.
const TOTAL_DAMAGE_CACHE_INITIAL_CAPACITY = 1 << 12;
const TOTAL_DAMAGE_CACHE_MAX_CAPACITY = 1 << 21;
const TOTAL_HASH_FOOD = 0x27d4eb2d;
const TOTAL_HASH_ATTRIBUTE = 0x9e3779b1;
const TOTAL_HASH_ATTRIBUTE_STEP = 0x85ebca6b;
const DEFAULT_SUFFIX_PREFIX_GRID_SIZE = 3;
const MAX_SUFFIX_PREFIX_GRID_CELLS = 4096;
const MAX_SUFFIX_PREFIX_GRID_STATE_CELLS = 64;
const SUFFIX_SUM_ADAPTIVE_PROBE_CALLS = 8;
const SUFFIX_SUM_ADAPTIVE_MIN_SKIP_RATE = 0.12;

export type DamageFunction = (attributes: readonly number[]) => number;

/**
 * Fast exact evaluator for a suffix vector stored in a flat numeric array.
 * `offset` points at the first attribute of the suffix state.  The callback
 * must preserve the same result as the ordinary combined evaluator.
 */
export type CombinedDamageFlatFunction = (
  first: readonly number[],
  suffix: ArrayLike<number>,
  offset: number,
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
) => number;

export type MaxCombinedDamageFlatFunction = (
  first: readonly number[],
  suffix: ArrayLike<number>,
  attributeCount: number,
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  startStateIndex?: number,
  endStateIndex?: number,
  suffixPairIndexes?: ArrayLike<number>,
) => { damage: number; stateIndex: number };

export type MaxCombinedDamageFlatBatchFunction = (
  first: readonly number[],
  suffix: ArrayLike<number>,
  attributeCount: number,
  transforms: readonly (readonly { attribute: number; maxValue: number; rate: number }[])[],
  startStateIndex?: number,
  endStateIndex?: number,
  suffixPairIndexes?: ArrayLike<number>,
) => readonly { damage: number; stateIndex: number }[];

/** Fast maximum evaluator over one precomputed column per attribute. */
export type MaxCombinedDamageFlatColumnsFunction = (
  first: readonly number[],
  suffixColumns: readonly ArrayLike<number>[],
  transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  startStateIndex?: number,
  endStateIndex?: number,
  suffixPairIndexes?: ArrayLike<number>,
) => { damage: number; stateIndex: number };

export type EquipmentAttributeExtractor = (
  equipment: EquipInfo,
) => readonly ParamInfo[];

export type AttributeTierProjector = (value: number) => number;

export type FoodPriorityComparator = (
  first: FoodInfo | undefined,
  second: FoodInfo | undefined,
) => number;

export type LoadoutSearchOptions = {
  attributeIds?: readonly number[];
  equipmentAttributeExtractor?: EquipmentAttributeExtractor;
  attributeTierProjectors?: ReadonlyMap<number, AttributeTierProjector>;
  /** Keep these attributes exact as dominance buckets, then compare the remaining dimensions. */
  dominanceBucketAttributeIds?: readonly number[];
  /** Use a flat live Pareto set instead of the historical KD-tree index. */
  compactDominance?: boolean;
  greedyPriorityAttributeIds?: readonly number[];
  foodPriorityComparator?: FoodPriorityComparator;
  pairwiseLowerBound?: boolean;
  slotOrder?:
    | "candidate-count-descending"
    | "relaxation-gap"
    | "relaxation-gap-with-small-suffix";
  suffixFrontierSlotCount?: number;
  suffixFrontierMaxCombinations?: number;
  suffixFrontierLeafSize?: number;
  debug?: boolean;
  debugLabel?: string;
  /** Collect expensive total-vector diagnostics for short profiling runs. */
  collectTotalSignatures?: boolean;
  combinedDamageCache?: boolean;
  /** Stop after this many hot-path states; intended for bounded diagnostics. */
  abortAfterSearched?: number;
  shouldAbort?: () => boolean;
  combinedDamageFunction?: (
    first: readonly number[],
    second: readonly number[],
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
  ) => number;
  combinedDamageFlatFunction?: CombinedDamageFlatFunction;
  maxCombinedDamageFlat?: MaxCombinedDamageFlatFunction;
  maxCombinedDamageFlatBatch?: MaxCombinedDamageFlatBatchFunction;
  maxCombinedDamageFlatColumnsFunction?: MaxCombinedDamageFlatColumnsFunction;
  /** Share the prefix traversal across food branches when possible. */
  shareFoods?: boolean;
  /** Select sequential suffix scans when sharing prefixes. */
  shareFoodsMode?: "batch" | "sequential";
  /** Skip prefix upper-bound checks when profiling shows they never prune. */
  prefixUpperBound?: boolean;
  /**
   * Replace the loose all-suffix envelope with the maximum of fixed-sum block
   * envelopes at prefix layers. This is exact only as an upper bound and is
   * intentionally opt-in because it performs one check per suffix block.
   */
  prefixSuffixBlockUpperBound?: boolean;
  /** Refine near-incumbent suffix blocks by a low-cardinality attribute. */
  suffixSubblockRefinement?: boolean;
  /** Number of states grouped into each refined suffix subblock. */
  suffixSubblockStateLimit?: number;
  /** Use the contiguous suffix evaluator; false selects the frontier tree. */
  suffixFlatScan?: boolean;
  /** Traverse a tree whose leaves are contiguous flat-array ranges. */
  suffixFlatTree?: boolean;
  suffixFlatTreeLeafSize?: number;
  /**
   * Enable component-wise prefix maxima as exact suffix-state upper bounds.
   * Callers must only enable this when their damage evaluator is monotone in
   * every attribute (the built-in equipped evaluator is).
   */
  suffixStateUpperBound?: boolean;
  /** Share raw component-wise prefix dominance across monotone food branches. */
  sharedRawPrefixDominance?: boolean;
  /**
   * Use monotonicity-derived necessary suffix thresholds.  This is an exact
   * filter: if even the component-wise maximum of every other suffix
   * attribute cannot beat the incumbent, the state is skipped safely.
   * Callers must only enable this for evaluators monotone in every attribute.
   */
  suffixNecessaryLowerBound?: boolean;
  /**
   * Evaluate each suffix block's component-wise maximum exactly.  Only enable
   * this when the evaluator is monotone in every attribute.
   */
  suffixExactBlockUpperBound?: boolean;
  /** Reorder suffix blocks by their prefix-specific optimistic score. */
  suffixDynamicBlockOrder?: boolean;
  /** Use per-slot bounds when applying a fixed suffix attribute budget. */
  suffixPerSlotBounds?: boolean;
  /** Intersect all necessary suffix thresholds before exact evaluation. */
  suffixNecessaryIntersection?: boolean;
  /**
   * Use fixed-sum block thresholds to skip impossible suffix states. The
   * supplied combined evaluator must be monotone in every attribute.
   */
  suffixSumNecessaryBound?: boolean;
  /** Memoize exact final total-vector scores during flat suffix scans. */
  suffixTotalDamageCache?: boolean;
  /**
   * Precompute exact per-block maxima at prefix-grid upper corners.  This is
   * an exact upper bound only for evaluators monotone in every attribute.
   */
  suffixPrefixGridUpperBound?: boolean;
  /** Number of cells per prefix attribute for the grid upper bound. */
  suffixPrefixGridSize?: number;
  /** Build per-cell suffix tail maxima for binary state cutoffs. */
  suffixPrefixGridStateUpperBound?: boolean;
  /**
   * Reuse the exact suffix maximum for equivalent future-tier prefixes. This
   * is valid only when the evaluator depends on projected attributes exactly
   * as described by `attributeTierProjectors`; unprojected dimensions remain
   * exact in the cache key.
   */
  suffixPrefixTierLookup?: boolean;
  /**
   * Optional pair-index fast path for separable weapon/primary factors. The
   * stride must match the evaluator's weapon/primary factor table width.
   */
  suffixPairAttributes?: readonly [number, number];
  suffixPairStride?: number;
  /** Build one raw prefix Pareto frontier before scanning flat suffixes. */
  prefixFrontierBatch?: boolean;
  /**
   * Collapse suffix states whose threshold attributes are indistinguishable
   * for every reachable prefix value and every food transform. This is exact
   * only when the evaluator uses the supplied tier projectors for those
   * attributes and exact values for all remaining dimensions.
   */
  suffixFutureTierCompression?: boolean;
  /**
   * Canonicalize cache keys through food-adjusted tier tables.  This is only
   * valid when the supplied evaluator depends on tiered attributes exactly as
   * the built-in vector evaluator does; un-tiered attributes stay exact.
   */
  suffixTotalDamageTierCache?: boolean;
  combinedDamageUpperBoundFunction?: (
    first: readonly number[],
    second: readonly number[],
    transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    secondMinimum: readonly number[],
    secondAttributeSumMaximum: number,
    slotBounds?: readonly UpperBoundSlot[],
  ) => number;
};

export type AttributeRangeConstraint = {
  attributeId: number;
  min?: number;
  max?: number;
};

export type LoadoutSearchResult = {
  damage: number;
  selection: EquipInfo[];
  food: FoodInfo | undefined;
};

export type LoadoutSearchStatistics = {
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
  suffixNecessaryBoundChecks: number;
  suffixNecessaryBoundSkipped: number;
  suffixVectorsEvaluated: number;
  suffixTotalVectorSamples: number;
  suffixTotalVectorUnique: number;
  suffixTierSignatureSamples: number;
  suffixTierSignatureUnique: number;
  suffixSignatureSaturated: boolean;
  totalDamageCacheHits: number;
  totalDamageCacheMisses: number;
  totalDamageCacheSize: number;
  suffixPrefixTierLookupHits: number;
  suffixPrefixTierLookupMisses: number;
  suffixPrefixTierLookupEntries: number;
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
  cacheIndex: number;
  transforms: readonly FoodTransform[];
};

type UpperBoundSlot = {
  minimum: number[];
  maximum: number[];
  attributeSumMaximum: number;
};

type FoodTransform = {
  attribute: number;
  maxValue: number;
  rate: number;
};

type SuffixFrontierState = {
  attributes: number[];
  attributeSum: number;
  candidates: Candidate[];
  flatOffset?: number;
};

type PrefixFrontierState = {
  attributes: number[];
  attributeSum: number;
  selection: EquipInfo[];
  foodMask: number;
};

type SuffixFrontierGroup = {
  minimum: number[];
  maximum: number[];
  attributeSumMaximum: number;
  slotBounds: UpperBoundSlot[];
  states: SuffixFrontierState[];
  remainingMinimums: number[][];
  remainingAttributeSumMaximums: number[];
  remainingMaximums: number[][];
};

type SuffixFlatBlock = {
  start: number;
  end: number;
  minimum: number[];
  maximum: number[];
  /** Safe component maxima tightened by pairwise attribute-sum limits. */
  boundMaximum?: number[];
  attributeSumMaximum: number;
  slotBounds?: UpperBoundSlot[];
  subBlocks?: SuffixFlatBlock[];
  /** Exact evaluator maximum at the component-wise maximum prefix. */
  foodUpperBounds?: Map<string, number>;
  /** Per-state exact upper bounds for the first (priority) food. */
  stateUpperBounds?: Float64Array;
  stateUpperBoundsByFood?: Map<string, Float64Array>;
  stateUpperBoundsByFoodIndex?: (Float64Array | undefined)[];
  /** Per-attribute sorted views with prefix maxima for fixed-sum filtering. */
  attributeViews?: (SuffixFlatAttributeView | undefined)[];
  parent?: SuffixFlatBlock;
  tree?: SuffixFlatTreeNode;
};

type SuffixFlatAttributeView = {
  attributes: Int32Array;
  columns: Int32Array[];
  pairIndexes?: Int32Array;
  stateIndexes: Int32Array;
  /** Component maxima of the first `count` sorted states, flattened. */
  prefixMaximums: Int32Array;
};

type SuffixFlatTreeNode = {
  start: number;
  end: number;
  minimum: number[];
  maximum: number[];
  /** Component maxima tightened by pairwise sums inside this fixed-sum node. */
  boundMaximum?: number[];
  attributeSumMaximum: number;
  left?: SuffixFlatTreeNode;
  right?: SuffixFlatTreeNode;
};

type SuffixPrefixTierLookupValue = {
  damage: number;
  stateIndex: number;
};


type SuffixFrontierNode = {
  minimum: number[];
  maximum: number[];
  attributeSumMaximum: number;
  slotBounds: UpperBoundSlot[];
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
  minimum: number[];
  maximum: number[];
  left: DominanceTreeNode | undefined;
  right: DominanceTreeNode | undefined;
};

type DominanceTree = {
  points: number[][];
  root: DominanceTreeNode;
};

type PackedDominanceTree = {
  points: number[][];
  root: number;
  point: Float64Array;
  minimum: Float64Array;
  maximum: Float64Array;
  left: Int32Array;
  right: Int32Array;
};

/**
 * Exact vector set used on hot paths where string keys create avoidable
 * allocation pressure. Hash collisions are checked component-wise.
 */
class ExactVectorSet {
  readonly dimensionCount: number;
  #capacity: number;
  #size = 0;
  #hashes: Uint32Array;
  #used: Uint8Array;
  #values: Float64Array;

  constructor(dimensionCount: number) {
    this.dimensionCount = dimensionCount;
    this.#capacity = 1 << 10;
    this.#hashes = new Uint32Array(this.#capacity);
    this.#used = new Uint8Array(this.#capacity);
    this.#values = new Float64Array(this.#capacity * dimensionCount);
  }

  get size(): number {
    return this.#size;
  }

  add(vector: readonly number[]): boolean {
    const hash = this.#hash(vector);
    if (this.#size * 10 >= this.#capacity * 7) this.#resize();
    let index = hash & (this.#capacity - 1);
    while (this.#used[index] !== 0) {
      if (this.#hashes[index] === hash && this.#equalAt(index, vector)) {
        return false;
      }
      index = (index + 1) & (this.#capacity - 1);
    }
    this.#used[index] = 1;
    this.#hashes[index] = hash;
    const offset = index * this.dimensionCount;
    for (let attribute = 0; attribute < this.dimensionCount; attribute++) {
      this.#values[offset + attribute] = vector[attribute] ?? 0;
    }
    this.#size++;
    return true;
  }

  #resize(): void {
    const oldCapacity = this.#capacity;
    const oldHashes = this.#hashes;
    const oldUsed = this.#used;
    const oldValues = this.#values;
    this.#capacity *= 2;
    this.#hashes = new Uint32Array(this.#capacity);
    this.#used = new Uint8Array(this.#capacity);
    this.#values = new Float64Array(this.#capacity * this.dimensionCount);
    for (let oldIndex = 0; oldIndex < oldCapacity; oldIndex++) {
      if (oldUsed[oldIndex] === 0) continue;
      const hash = oldHashes[oldIndex]!;
      let index = hash & (this.#capacity - 1);
      while (this.#used[index] !== 0) {
        index = (index + 1) & (this.#capacity - 1);
      }
      this.#used[index] = 1;
      this.#hashes[index] = hash;
      const oldOffset = oldIndex * this.dimensionCount;
      const newOffset = index * this.dimensionCount;
      for (let attribute = 0; attribute < this.dimensionCount; attribute++) {
        this.#values[newOffset + attribute] = oldValues[oldOffset + attribute]!;
      }
    }
  }

  #hash(vector: readonly number[]): number {
    let hash = 2166136261;
    for (const value of vector) hash = Math.imul(hash ^ value, 16777619);
    return hash >>> 0;
  }

  #equalAt(index: number, vector: readonly number[]): boolean {
    const offset = index * this.dimensionCount;
    for (let attribute = 0; attribute < this.dimensionCount; attribute++) {
      if (this.#values[offset + attribute] !== (vector[attribute] ?? 0)) {
        return false;
      }
    }
    return true;
  }
}

type CombinedDamageCacheEntry = {
  foodIndex: number;
  attributes: number[];
  value: number;
};

/** Numeric-key cache for exact prefix+suffix evaluations. */
class CombinedDamageCache {
  readonly dimensionCount: number;
  readonly buckets = new Map<number, CombinedDamageCacheEntry[]>();
  size = 0;

  constructor(dimensionCount: number) {
    this.dimensionCount = dimensionCount;
  }

  clear(): void {
    this.buckets.clear();
    this.size = 0;
  }

  get(
    first: readonly number[],
    second: readonly number[],
    foodIndex: number,
  ): number | undefined {
    const hash = this.#hash(first, second, foodIndex);
    const bucket = this.buckets.get(hash);
    if (bucket === undefined) return undefined;
    for (const entry of bucket) {
      if (entry.foodIndex !== foodIndex) continue;
      let equal = true;
      for (let index = 0; index < this.dimensionCount; index++) {
        if (
          entry.attributes[index] !==
          (first[index] ?? 0) + (second[index] ?? 0)
        ) {
          equal = false;
          break;
        }
      }
      if (equal) return entry.value;
    }
    return undefined;
  }

  set(
    first: readonly number[],
    second: readonly number[],
    foodIndex: number,
    value: number,
  ): void {
    const hash = this.#hash(first, second, foodIndex);
    const attributes = new Array<number>(this.dimensionCount);
    for (let index = 0; index < this.dimensionCount; index++) {
      attributes[index] = (first[index] ?? 0) + (second[index] ?? 0);
    }
    const bucket = this.buckets.get(hash);
    const entry = { foodIndex, attributes, value };
    if (bucket === undefined) this.buckets.set(hash, [entry]);
    else bucket.push(entry);
    this.size++;
  }

  #hash(
    first: readonly number[],
    second: readonly number[],
    foodIndex: number,
  ): number {
    let hash = 2166136261;
    hash = Math.imul(hash ^ foodIndex, 16777619);
    for (let index = 0; index < this.dimensionCount; index++) {
      hash = Math.imul(
        hash ^ ((first[index] ?? 0) + (second[index] ?? 0)),
        16777619,
      );
    }
    return hash >>> 0;
  }
}

/**
 * Exact cache for the value of one final gear+food attribute vector.
 *
 * The flat suffix evaluator normally recomputes the same final vector when
 * two different prefix/suffix decompositions meet at the same total.  This
 * cache uses open addressing so that those hits do not allocate a string or
 * a temporary array.  It stores only the score; the caller still retains the
 * current suffix index, so equal totals remain fully interchangeable.
 */
class TotalDamageCache {
  readonly dimensionCount: number;
  #capacity = TOTAL_DAMAGE_CACHE_INITIAL_CAPACITY;
  #size = 0;
  #hashes = new Uint32Array(this.#capacity);
  #foods = new Int32Array(this.#capacity);
  #used = new Uint8Array(this.#capacity);
  #attributes: Float64Array;
  #values = new Float64Array(this.#capacity);

  constructor(dimensionCount: number) {
    this.dimensionCount = dimensionCount;
    this.#attributes = new Float64Array(this.#capacity * dimensionCount);
  }

  get size(): number {
    return this.#size;
  }

  clear(): void {
    this.#size = 0;
    this.#used.fill(0);
  }

  get(
    attributes: ArrayLike<number>,
    foodIndex: number,
    hash = this.#hash(attributes, foodIndex),
  ): number | undefined {
    let index = hash & (this.#capacity - 1);
    while (this.#used[index] !== 0) {
      if (
        this.#hashes[index] === hash &&
        this.#foods[index] === foodIndex &&
        this.#equalAt(index, attributes)
      ) {
        return this.#values[index];
      }
      index = (index + 1) & (this.#capacity - 1);
    }
    return undefined;
  }

  set(
    attributes: ArrayLike<number>,
    foodIndex: number,
    value: number,
    hash = this.#hash(attributes, foodIndex),
  ): void {
    if (this.#size * 10 >= this.#capacity * 7) {
      if (this.#capacity < TOTAL_DAMAGE_CACHE_MAX_CAPACITY) this.#resize();
      else return;
    }
    let index = hash & (this.#capacity - 1);
    while (this.#used[index] !== 0) {
      if (
        this.#hashes[index] === hash &&
        this.#foods[index] === foodIndex &&
        this.#equalAt(index, attributes)
      ) {
        this.#values[index] = value;
        return;
      }
      index = (index + 1) & (this.#capacity - 1);
    }
    this.#used[index] = 1;
    this.#hashes[index] = hash;
    this.#foods[index] = foodIndex;
    this.#values[index] = value;
    const offset = index * this.dimensionCount;
    for (let attribute = 0; attribute < this.dimensionCount; attribute++) {
      this.#attributes[offset + attribute] = attributes[attribute] ?? 0;
    }
    this.#size++;
  }

  #resize(): void {
    const oldCapacity = this.#capacity;
    const oldHashes = this.#hashes;
    const oldFoods = this.#foods;
    const oldUsed = this.#used;
    const oldAttributes = this.#attributes;
    const oldValues = this.#values;
    this.#capacity *= 2;
    this.#hashes = new Uint32Array(this.#capacity);
    this.#foods = new Int32Array(this.#capacity);
    this.#used = new Uint8Array(this.#capacity);
    this.#attributes = new Float64Array(this.#capacity * this.dimensionCount);
    this.#values = new Float64Array(this.#capacity);
    this.#size = 0;
    for (let oldIndex = 0; oldIndex < oldCapacity; oldIndex++) {
      if (oldUsed[oldIndex] === 0) continue;
      const offset = oldIndex * this.dimensionCount;
      const attributes = oldAttributes.subarray(
        offset,
        offset + this.dimensionCount,
      );
      this.set(attributes, oldFoods[oldIndex]!, oldValues[oldIndex]!);
    }
  }

  #hash(attributes: ArrayLike<number>, foodIndex: number): number {
    let hash = Math.imul(foodIndex, TOTAL_HASH_FOOD);
    for (let attribute = 0; attribute < this.dimensionCount; attribute++) {
      const coefficient =
        (TOTAL_HASH_ATTRIBUTE +
          Math.imul(attribute, TOTAL_HASH_ATTRIBUTE_STEP)) |
        0;
      hash = (hash + Math.imul(coefficient, attributes[attribute] ?? 0)) >>> 0;
    }
    return hash >>> 0;
  }

  #equalAt(index: number, attributes: ArrayLike<number>): boolean {
    const offset = index * this.dimensionCount;
    for (let attribute = 0; attribute < this.dimensionCount; attribute++) {
      if (this.#attributes[offset + attribute] !== (attributes[attribute] ?? 0)) {
        return false;
      }
    }
    return true;
  }
}

/**
 * A logarithmic collection of balanced k-d trees. Dominated historical points
 * may stay indexed: any state they dominate is also dominated transitively by
 * the newer point, so deletion is unnecessary for correctness.
 */
export class DominanceIndex {
  readonly dimensionCount: number;
  readonly trees: (DominanceTree | undefined)[] = [];
  size = 0;
  #comparisonCount = 0;
  #exactPointBuckets = new Map<number, number[][]>();
  readonly #compact: boolean;
  #packedTrees: (PackedDominanceTree | undefined)[] = [];
  #packedSearchStack: number[] = [];

  constructor(dimensionCount: number, compact = false) {
    this.dimensionCount = dimensionCount;
    this.#compact = compact;
  }

  accept(point: number[]): {
    accepted: boolean;
    comparisons: number;
    equal: boolean;
  } {
    this.#comparisonCount = 0;
    const hash = this.#hash(point);
    const exactBucket = this.#exactPointBuckets.get(hash);
    if (exactBucket !== undefined) {
      for (const existing of exactBucket) {
        if (this.#equal(existing, point)) {
          return { accepted: false, comparisons: 0, equal: true };
        }
      }
    }
    if (this.#compact) return this.#acceptCompact(point, hash, exactBucket);
    for (const tree of this.trees) {
      if (tree === undefined) continue;
      const dominator = this.#findDominator(tree.root, point);
      if (dominator !== undefined)
        return {
          accepted: false,
          comparisons: this.#comparisonCount,
          equal: this.#equal(dominator, point),
        };
    }

    const ownedPoint = this.#insert(point);
    if (exactBucket === undefined) {
      this.#exactPointBuckets.set(hash, [ownedPoint]);
    } else {
      exactBucket.push(ownedPoint);
    }
    return { accepted: true, comparisons: this.#comparisonCount, equal: false };
  }

  /**
   * Use the same logarithmic merge levels as the fallback index, but store
   * each low-dimensional tree in flat typed arrays.  Exact speed buckets
   * remove one dimension from these trees and keep unrelated speeds from
   * inflating the same search structure.
   */
  #acceptCompact(
    point: readonly number[],
    hash: number,
    exactBucket: number[][] | undefined,
  ): {
    accepted: boolean;
    comparisons: number;
    equal: boolean;
  } {
    for (const tree of this.#packedTrees) {
      if (tree === undefined) continue;
      const dominator = this.#findPackedDominator(tree, point);
      if (dominator !== undefined) {
        return {
          accepted: false,
          comparisons: this.#comparisonCount,
          equal: this.#equal(dominator, point),
        };
      }
    }

    const ownedPoint = this.#insertPacked(point);
    if (exactBucket === undefined) {
      this.#exactPointBuckets.set(hash, [ownedPoint]);
    } else {
      exactBucket.push(ownedPoint);
    }
    return { accepted: true, comparisons: this.#comparisonCount, equal: false };
  }

  #findPackedDominator(
    tree: PackedDominanceTree,
    target: readonly number[],
  ): number[] | undefined {
    const stack = this.#packedSearchStack;
    stack.length = 0;
    stack.push(tree.root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      const offset = node * this.dimensionCount;
      let everyPointDominates = true;
      let possible = true;
      for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
        if (tree.maximum[offset + dimension]! < target[dimension]!) {
          possible = false;
          break;
        }
        if (tree.minimum[offset + dimension]! < target[dimension]!) {
          everyPointDominates = false;
        }
      }
      if (!possible) continue;
      if (everyPointDominates) {
        return Array.from(
          tree.point.subarray(offset, offset + this.dimensionCount),
        );
      }

      this.#comparisonCount++;
      let dominates = true;
      for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
        if (tree.point[offset + dimension]! < target[dimension]!) {
          dominates = false;
          break;
        }
      }
      if (dominates) {
        return Array.from(
          tree.point.subarray(offset, offset + this.dimensionCount),
        );
      }
      const left = tree.left[node]!;
      const right = tree.right[node]!;
      if (right >= 0) stack.push(right);
      if (left >= 0) stack.push(left);
    }
    return undefined;
  }

  #insertPacked(point: readonly number[]): number[] {
    const ownedPoint = [...point];
    let mergedPoints = [ownedPoint];
    let level = 0;
    while (this.#packedTrees[level] !== undefined) {
      mergedPoints = mergedPoints.concat(this.#packedTrees[level]!.points);
      this.#packedTrees[level] = undefined;
      level++;
    }
    this.#packedTrees[level] = this.#buildPackedTree(mergedPoints);
    this.size++;
    return ownedPoint;
  }

  #buildPackedTree(points: number[][]): PackedDominanceTree {
    const count = points.length;
    const point = new Float64Array(count * this.dimensionCount);
    const minimum = new Float64Array(count * this.dimensionCount);
    const maximum = new Float64Array(count * this.dimensionCount);
    const left = new Int32Array(count);
    const right = new Int32Array(count);
    left.fill(-1);
    right.fill(-1);
    let nextNode = 0;

    const build = (indexes: number[], depth: number): number => {
      let axis = depth % this.dimensionCount;
      let widestRange = Number.NEGATIVE_INFINITY;
      for (let candidateAxis = 0; candidateAxis < this.dimensionCount; candidateAxis++) {
        let minimumValue = Number.POSITIVE_INFINITY;
        let maximumValue = Number.NEGATIVE_INFINITY;
        for (const index of indexes) {
          const value = points[index]![candidateAxis]!;
          minimumValue = Math.min(minimumValue, value);
          maximumValue = Math.max(maximumValue, value);
        }
        const range = maximumValue - minimumValue;
        if (range > widestRange) {
          widestRange = range;
          axis = candidateAxis;
        }
      }
      indexes.sort(
        (first, second) =>
          points[first]![axis]! - points[second]![axis]!,
      );
      const middle = Math.trunc(indexes.length / 2);
      const node = nextNode++;
      const nodeOffset = node * this.dimensionCount;
      const middlePoint = points[indexes[middle]!]!;
      for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
        const value = middlePoint[dimension]!;
        point[nodeOffset + dimension] = value;
        minimum[nodeOffset + dimension] = value;
        maximum[nodeOffset + dimension] = value;
      }
      if (middle > 0) left[node] = build(indexes.slice(0, middle), depth + 1);
      if (middle + 1 < indexes.length) {
        right[node] = build(indexes.slice(middle + 1), depth + 1);
      }
      for (const child of [left[node], right[node]]) {
        if (child < 0) continue;
        const childOffset = child * this.dimensionCount;
        for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
          minimum[nodeOffset + dimension] = Math.min(
            minimum[nodeOffset + dimension]!,
            minimum[childOffset + dimension]!,
          );
          maximum[nodeOffset + dimension] = Math.max(
            maximum[nodeOffset + dimension]!,
            maximum[childOffset + dimension]!,
          );
        }
      }
      return node;
    };

    return {
      points,
      root: build(Array.from({ length: count }, (_, index) => index), 0),
      point,
      minimum,
      maximum,
      left,
      right,
    };
  }

  #hash(point: readonly number[]): number {
    let hash = 2166136261;
    for (const value of point) hash = Math.imul(hash ^ value, 16777619);
    return hash >>> 0;
  }

  #findDominator(
    node: DominanceTreeNode,
    target: readonly number[],
  ): number[] | undefined {
    let everyPointDominates = true;
    for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
      if (node.maximum[dimension] < target[dimension]) return undefined;
      if (node.minimum[dimension] < target[dimension]) {
        everyPointDominates = false;
      }
    }
    if (everyPointDominates) return node.point;

    this.#comparisonCount++;
    let dominates = true;
    for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
      if (node.point[dimension] < target[dimension]) {
        dominates = false;
        break;
      }
    }
    if (dominates) return node.point;
    if (node.left !== undefined) {
      const left = this.#findDominator(node.left, target);
      if (left !== undefined) return left;
    }
    if (node.right !== undefined) {
      return this.#findDominator(node.right, target);
    }
    return undefined;
  }

  #equal(first: readonly number[], second: readonly number[]): boolean {
    for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
      if (first[dimension] !== second[dimension]) return false;
    }
    return true;
  }

  #insert(point: readonly number[]): number[] {
    const ownedPoint = [...point];
    let mergedPoints = [ownedPoint];
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
    return ownedPoint;
  }

  #buildTree(points: number[][], depth: number): DominanceTreeNode {
    let axis = depth % this.dimensionCount;
    let widestRange = Number.NEGATIVE_INFINITY;
    for (let candidateAxis = 0; candidateAxis < this.dimensionCount; candidateAxis++) {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (const point of points) {
        minimum = Math.min(minimum, point[candidateAxis]!);
        maximum = Math.max(maximum, point[candidateAxis]!);
      }
      const range = maximum - minimum;
      if (range > widestRange) {
        widestRange = range;
        axis = candidateAxis;
      }
    }
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
    const minimum = [...points[middle]];
    const maximum = [...points[middle]];
    for (const child of [left, right]) {
      if (child === undefined) continue;
      for (let dimension = 0; dimension < this.dimensionCount; dimension++) {
        minimum[dimension] = Math.min(
          minimum[dimension],
          child.minimum[dimension],
        );
        maximum[dimension] = Math.max(
          maximum[dimension],
          child.maximum[dimension],
        );
      }
    }
    return { point: points[middle], minimum, maximum, left, right };
  }
}

/**
 * Finds the maximum damage loadout for one job without GCD or toughness
 * constraints. The damage function is expected to be monotonic by attribute.
 */
export class LoadoutFinderV2Search {
  readonly damageFunction: DamageFunction;
  readonly attributeCount: number;
  readonly options: LoadoutSearchOptions;
  readonly damageCache = new Map<string, number>();
  readonly combinedDamageCache: CombinedDamageCache;
  readonly totalDamageCache: TotalDamageCache;
  readonly statistics: LoadoutSearchStatistics = {
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
    suffixNecessaryBoundChecks: 0,
    suffixNecessaryBoundSkipped: 0,
    suffixVectorsEvaluated: 0,
    suffixTotalVectorSamples: 0,
    suffixTotalVectorUnique: 0,
    suffixTierSignatureSamples: 0,
    suffixTierSignatureUnique: 0,
    suffixSignatureSaturated: false,
    totalDamageCacheHits: 0,
    totalDamageCacheMisses: 0,
    totalDamageCacheSize: 0,
    suffixPrefixTierLookupHits: 0,
    suffixPrefixTierLookupMisses: 0,
    suffixPrefixTierLookupEntries: 0,
    constraintPruned: 0,
    suffixConstraintPruned: 0,
  };

  #attributeIds: number[] = [];
  #attributeIndex = new Map<number, number>();
  #greedyPriorityIndexes: number[] = [];
  #slots: SlotState[] = [];
  #suffixMinimums: number[][] = [];
  #suffixMaximums: number[][] = [];
  #suffixAttributeSumMaximums: number[] = [];
  #suffixSlotBounds: UpperBoundSlot[][] = [];
  #prefixMaximums: number[][] = [];
  #suffixReachableValues: (number[] | undefined)[][] = [];
  #prefixReachableValues: (number[] | undefined)[][] = [];
  #tierProjectors: (AttributeTierProjector | undefined)[] = [];
  #stateTierClasses: (Int32Array | undefined)[][] = [];
  #paretoScratch: number[] = [];
  #staticParetoScratch: number[] = [];
  #best: LoadoutSearchResult | undefined;
  #searchedCount = 0;
  #stateDominanceIndexes: Map<string, DominanceIndex>[] = [];
  #seenPrefixAttributes: ExactVectorSet[] = [];
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
  #combinedDamageCacheHitCount = 0;
  #combinedDamageCacheMissCount = 0;
  #combinedDamageCacheClearCount = 0;
  #combinedDamageCacheEnabled = false;
  #combinedDamageCacheProbeCount = 0;
  #totalDamageCacheEnabled = false;
  #suffixPrefixTierLookup = new Map<
    string,
    Map<string, SuffixPrefixTierLookupValue>
  >();
  #suffixPrefixTierLookupBest = Number.NEGATIVE_INFINITY;
  #suffixPrefixTierLookupStateIndex = -1;
  #searchStartedAt = 0;
  #lastProgressAt = 0;
  #lastRateAt = 0;
  #lastRateSearched = 0;
  #lastRateLeaves = 0;
  #activeFood = "";
  #activeDepth = 0;
  #depthDiagnostics: DepthDiagnostics[] = [];
  #suffixStart = 0;
  #suffixFrontierRoot: SuffixFrontierNode | undefined;
  #suffixRootGroups: number[][] = [];
  #suffixFrontierGroups: SuffixFrontierGroup[] = [];
  #suffixGroupRemainingMaximums: number[][] = [];
  #suffixSplitFoodPlan: FoodPlan | undefined;
  #suffixFlatAttributes: Int32Array | undefined;
  #suffixFlatColumns: Int32Array[] = [];
  #suffixFlatStates: SuffixFrontierState[] = [];
  #suffixFlatAttributeOrders: Int32Array[] = [];
  #suffixFlatAttributeArrays: Int32Array[] = [];
  #suffixFlatAttributeRanks: Int32Array[] = [];
  #suffixFlatPairIndexes: Int32Array | undefined;
  #suffixFlatBlocks: SuffixFlatBlock[] = [];
  #suffixFlatScanBlocks: SuffixFlatBlock[] = [];
  #suffixFlatHashes: Uint32Array | undefined;
  #suffixFlatAttributesByFood = new Map<string, Int32Array>();
  #suffixFlatStateOrdersByFood = new Map<string, Int32Array>();
  #suffixFlatHashesByFood = new Map<string, Uint32Array>();
  #suffixFlatColumnsByFood = new Map<string, Int32Array[]>();
  #suffixFlatPairIndexesByFood = new Map<string, Int32Array>();
  #totalDamageCacheKeyLookups = new Map<
    string,
    (Int32Array | undefined)[]
  >();
  #suffixFlatBlockOrders = new Map<string, SuffixFlatBlock[]>();
  #suffixFlatScanBlockOrders = new Map<string, SuffixFlatBlock[]>();
  #suffixPrefixGridBoundsByFood = new Map<string, Float64Array>();
  #suffixPrefixGridCellUpperByFood = new Map<string, Float64Array>();
  #suffixPrefixGridBlockIndexes = new Map<SuffixFlatBlock, number>();
  #suffixPrefixGridSize = DEFAULT_SUFFIX_PREFIX_GRID_SIZE;
  #suffixPrefixGridMaxima: number[] = [];
  #suffixPrefixGridBlockCount = 0;
  #suffixPrefixGridStateTailsByFood = new Map<string, Float64Array>();
  #suffixKdAttributes: Int32Array | undefined;
  #suffixKdStateOrder: Int32Array | undefined;
  #totalVectorSignatures: ExactVectorSet | undefined;
  #tierSignatures: ExactVectorSet | undefined;
  #totalSignatureScratch: number[] = [];
  #tierSignatureScratch: number[] = [];
  #attributeRanges: (NormalizedAttributeRange | undefined)[] = [];
  #upperConstrainedIndexes: number[] = [];
  #dominanceBucketIndexes: number[] = [];
  #dominanceGroupIndexes: number[] = [];
  #dominanceExcludedIndexes = new Set<number>();
  #hasConstraints = false;
  // Search callbacks are synchronous and do not retain these scratch arrays.
  #foodAttributes: number[];
  #upperAttributes: number[];
  #necessarySuffixAttributes: number[];
  #necessarySuffixThresholds: number[];
  #suffixSumNecessaryProbeCalls = 0;
  #suffixSumNecessaryProbeSkipped = 0;
  #suffixSumNecessaryProbeEvaluated = 0;
  #suffixSumNecessaryDisabled = false;

  #maxSuffixBlockUpperBound(
    prefixAttributes: readonly number[],
    foodPlan: FoodPlan,
  ): number {
    let upperDamage = Number.NEGATIVE_INFINITY;
    const blocks = this.#suffixFlatBlocks;
    for (const block of blocks) {
      let blockUpper = this.#upperDamageOfSum(
        prefixAttributes,
        block.boundMaximum ?? block.maximum,
        foodPlan,
        block.minimum,
        block.attributeSumMaximum,
        block.slotBounds,
      );
      blockUpper = this.#tightenSuffixBlockUpper(
        prefixAttributes,
        block.boundMaximum ?? block.maximum,
        foodPlan,
        blockUpper,
      );
      if (blockUpper > upperDamage) upperDamage = blockUpper;
    }
    return upperDamage;
  }

  constructor(
    damageFunction: DamageFunction,
    attributeCount: number,
    options: LoadoutSearchOptions | readonly number[] = {},
  ) {
    if (typeof damageFunction !== "function") {
      throw new TypeError("damageFunction 必须是函数");
    }
    if (!Number.isInteger(attributeCount) || attributeCount < 0) {
      throw new RangeError("attributeCount 必须是非负整数");
    }

    this.damageFunction = damageFunction;
    this.attributeCount = attributeCount;
    const normalizedOptions: LoadoutSearchOptions = Array.isArray(options)
      ? { attributeIds: [...(options as readonly number[])] }
      : (options as LoadoutSearchOptions);
    this.options = normalizedOptions;
    this.combinedDamageCache = new CombinedDamageCache(attributeCount);
    this.totalDamageCache = new TotalDamageCache(attributeCount);
    this.#foodAttributes = this.#zeroAttributes();
    this.#upperAttributes = this.#zeroAttributes();
    this.#necessarySuffixAttributes = this.#zeroAttributes();
    this.#necessarySuffixThresholds = this.#zeroAttributes();

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
      ["suffixFrontierLeafSize", this.options.suffixFrontierLeafSize],
      ["suffixFlatTreeLeafSize", this.options.suffixFlatTreeLeafSize],
      ["suffixPrefixGridSize", this.options.suffixPrefixGridSize],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
        throw new RangeError(`${name} 必须是非负整数`);
      }
    }
    if (
      this.options.suffixSubblockStateLimit !== undefined &&
      (!Number.isInteger(this.options.suffixSubblockStateLimit) ||
        this.options.suffixSubblockStateLimit < 1)
    ) {
      throw new RangeError("suffixSubblockStateLimit 必须是正整数");
    }
    if (
      this.options.suffixFrontierLeafSize !== undefined &&
      this.options.suffixFrontierLeafSize < 1
    ) {
      throw new RangeError("suffixFrontierLeafSize 必须是正整数");
    }
    if (
      this.options.suffixFlatTreeLeafSize !== undefined &&
      this.options.suffixFlatTreeLeafSize < 1
    ) {
      throw new RangeError("suffixFlatTreeLeafSize 必须是正整数");
    }
    if (
      this.options.suffixPrefixGridSize !== undefined &&
      (this.options.suffixPrefixGridSize < 2 ||
        this.options.suffixPrefixGridSize > 16)
    ) {
      throw new RangeError("suffixPrefixGridSize 必须在 2 到 16 之间");
    }
    if (this.options.suffixPairAttributes !== undefined) {
      if (this.options.suffixPairAttributes.length !== 2 ||
          this.options.suffixPairAttributes[0] === this.options.suffixPairAttributes[1] ||
          this.options.suffixPairAttributes.some((value) =>
            !Number.isInteger(value) || value < 0 || value >= attributeCount)) {
        throw new RangeError("suffixPairAttributes 必须包含两个有效属性索引");
      }
      if (this.options.suffixPairStride !== undefined &&
          (!Number.isInteger(this.options.suffixPairStride) ||
            this.options.suffixPairStride <= 0)) {
        throw new RangeError("suffixPairStride 必须是正整数");
      }
    } else if (this.options.suffixPairStride !== undefined) {
      throw new RangeError("suffixPairStride 需要同时配置 suffixPairAttributes");
    }
  }

  findBest(
    slots: readonly (readonly EquipInfo[])[],
    foods: readonly FoodInfo[],
    constraints: readonly AttributeRangeConstraint[] = [],
  ): LoadoutSearchResult | undefined {
    this.damageCache.clear();
    this.combinedDamageCache.clear();
    this.totalDamageCache.clear();
    this.#best = undefined;
    this.#searchedCount = 0;
    this.#dominanceComparisonCount = 0;
    this.#leafCount = 0;
    this.#bestUpdateCount = 0;
    this.#damageCacheHitCount = 0;
    this.#damageCacheMissCount = 0;
    this.#damageCacheClearCount = 0;
    this.#combinedDamageCacheHitCount = 0;
    this.#combinedDamageCacheMissCount = 0;
    this.#combinedDamageCacheClearCount = 0;
    this.#combinedDamageCacheEnabled = this.options.combinedDamageCache === true;
    this.#combinedDamageCacheProbeCount = 0;
    this.#totalDamageCacheEnabled = this.options.suffixTotalDamageCache === true;
    this.#suffixPrefixTierLookup.clear();
    this.#suffixPrefixTierLookupBest = Number.NEGATIVE_INFINITY;
    this.#suffixPrefixTierLookupStateIndex = -1;
    this.#searchStartedAt = Date.now();
    this.#lastProgressAt = this.#searchStartedAt;
    this.#lastRateAt = this.#searchStartedAt;
    this.#lastRateSearched = 0;
    this.#lastRateLeaves = 0;
    this.#suffixSumNecessaryProbeCalls = 0;
    this.#suffixSumNecessaryProbeSkipped = 0;
    this.#suffixSumNecessaryProbeEvaluated = 0;
    this.#suffixSumNecessaryDisabled = false;
    this.#resetStatistics();
    this.#totalVectorSignatures = this.options.collectTotalSignatures
      ? new ExactVectorSet(this.attributeCount + 1)
      : undefined;
    this.#tierSignatures = this.options.collectTotalSignatures
      ? new ExactVectorSet(this.attributeCount + 1)
      : undefined;
    this.#totalSignatureScratch = new Array<number>(this.attributeCount + 1);
    this.#tierSignatureScratch = new Array<number>(this.attributeCount + 1);
    if (this.options.shouldAbort?.()) {
      this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
      this.statistics.searched = this.#searchedCount;
      this.statistics.leaves = this.#leafCount;
      this.#abortSearch();
    }

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
    this.#dominanceBucketIndexes = [
      ...new Set(
        (this.options.dominanceBucketAttributeIds ?? []).map((attributeId) => {
          const index = this.#attributeIndex.get(attributeId);
          if (index === undefined) {
            throw new RangeError(`支配分桶包含未配置的属性 id：${attributeId}`);
          }
          return index;
        }),
      ),
    ];
    this.#setAttributeRanges(constraints);
    this.#dominanceGroupIndexes = [
      ...new Set([
        ...this.#upperConstrainedIndexes,
        ...this.#dominanceBucketIndexes,
      ]),
    ].sort((first, second) => first - second);
    this.#dominanceExcludedIndexes = new Set(this.#dominanceGroupIndexes);
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
      `[V2搜索] 搜索配置：槽位候选=${this.#slots
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
    this.#suffixAttributeSumMaximums = this.#buildSuffixAttributeSumMaximums(
      this.#slots,
    );
    this.#suffixSlotBounds = this.#buildSuffixSlotBounds(this.#slots);
    this.#buildTotalDamageCacheKeyLookups(foodPlans);
    this.#prefixMaximums = this.#buildPrefixMaximums(this.#slots);
    this.#suffixReachableValues = this.#buildSuffixReachableValues(this.#slots);
    this.#prefixReachableValues = this.#buildPrefixReachableValues(this.#slots);
    this.#suffixSplitFoodPlan = foodPlans[0];
    this.#buildSuffixFrontier(foodPlans);
    this.#buildSuffixFlatBlockOrders(foodPlans);
    this.#buildSuffixPrefixGridUpperBounds(foodPlans);
    this.#buildSuffixPrefixGridStateTails(foodPlans);
    this.#acceptedStateCounts = new Array(this.#slots.length + 1).fill(0);
    this.#statePrunedCounts = new Array(this.#slots.length + 1).fill(0);
    this.#duplicatePrunedCounts = new Array(this.#slots.length + 1).fill(0);
    this.#upperPrunedCounts = new Array(this.#slots.length + 1).fill(0);
    this.#frontierPeakSizes = new Array(this.#slots.length + 1).fill(0);
    this.#dominanceComparisonCounts = new Array(this.#slots.length + 1).fill(0);
    this.#activeDepth = 0;
    this.#depthDiagnostics = [];

    const zeroAttributes = this.#zeroAttributes();
    if (
      this.options.prefixFrontierBatch === true &&
      !this.#hasConstraints &&
      this.options.maxCombinedDamageFlatBatch !== undefined &&
      this.options.combinedDamageFlatFunction !== undefined &&
      this.options.suffixFlatScan !== false &&
      this.#suffixFlatAttributes !== undefined &&
      this.#suffixFlatStates.length > 0 &&
      this.#suffixStart > 0
    ) {
      this.#searchSharedFoods(zeroAttributes, slots.length, foodPlans);
    } else if (
      !this.#hasConstraints &&
      this.options.maxCombinedDamageFlatBatch !== undefined &&
      this.options.combinedDamageFlatFunction !== undefined &&
      this.options.suffixFlatScan !== false &&
      this.options.suffixNecessaryLowerBound !== true &&
      this.options.shareFoods !== false &&
      this.#suffixFlatAttributes !== undefined &&
      this.#suffixFlatStates.length > 0 &&
      this.#suffixStart > 0 &&
      foodPlans.length > 1
    ) {
      this.#searchSharedFoods(zeroAttributes, slots.length, foodPlans);
    } else for (const foodPlan of foodPlans) {
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
          `[V2搜索] 跳过食物分支：${this.#activeFood}；最终属性约束不可行`,
        );
        continue;
      }
      const globalUpperDamage = this.#upperDamageOfSum(
        zeroAttributes,
        this.#suffixMaximums[0],
        foodPlan,
        this.#suffixMinimums[0],
        this.#suffixAttributeSumMaximums[0],
        this.#suffixSlotBounds[0],
      );
      if (this.#hasBest() && globalUpperDamage <= this.#bestDamage()) {
        this.#debugLog(
          `[V2搜索] 跳过食物分支：${this.#activeFood}；上界=${globalUpperDamage}；当前最优=${this.#bestDamage()}`,
        );
        continue;
      }
      this.#stateDominanceIndexes = Array.from(
        { length: this.#slots.length + 1 },
        () => new Map<string, DominanceIndex>(),
      );
      this.#seenPrefixAttributes = Array.from(
        { length: this.#suffixStart + 1 },
        () => new ExactVectorSet(this.attributeCount),
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
        `[V2搜索] 完成食物分支：${this.#activeFood}；耗时=${Date.now() - branchStartedAt}ms；搜索=${this.#searchedCount - searchedBefore}；状态剪枝=${this.#sumCounts(this.#statePrunedCounts) - statePrunedBefore}；上界剪枝=${this.#sumCounts(this.#upperPrunedCounts) - upperPrunedBefore}；后缀上界剪枝=${this.statistics.suffixBoundPruned}；叶子=${this.#leafCount - leafBefore}`,
      );
    }

    this.#logProgress("搜索完成");
    this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
    this.statistics.searched = this.#searchedCount;
    this.statistics.leaves = this.#leafCount;
    this.statistics.totalDamageCacheSize = this.totalDamageCache.size;
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
    this.statistics.suffixNecessaryBoundChecks = 0;
    this.statistics.suffixNecessaryBoundSkipped = 0;
    this.statistics.suffixVectorsEvaluated = 0;
    this.statistics.suffixTotalVectorSamples = 0;
    this.statistics.suffixTotalVectorUnique = 0;
    this.statistics.suffixTierSignatureSamples = 0;
    this.statistics.suffixTierSignatureUnique = 0;
    this.statistics.suffixSignatureSaturated = false;
    this.statistics.totalDamageCacheHits = 0;
    this.statistics.totalDamageCacheMisses = 0;
    this.statistics.totalDamageCacheSize = 0;
    this.statistics.suffixPrefixTierLookupHits = 0;
    this.statistics.suffixPrefixTierLookupMisses = 0;
    this.statistics.suffixPrefixTierLookupEntries = 0;
    this.statistics.constraintPruned = 0;
    this.statistics.suffixConstraintPruned = 0;
    this.#suffixStart = this.#slots.length;
    this.#suffixFrontierRoot = undefined;
    this.#suffixFlatAttributes = undefined;
    this.#suffixFlatColumns = [];
    this.#suffixFlatStates = [];
    this.#suffixFlatAttributeOrders = [];
    this.#suffixFlatAttributeArrays = [];
    this.#suffixFlatAttributeRanks = [];
    this.#suffixFlatPairIndexes = undefined;
    this.#suffixFlatScanBlocks = [];
    this.#suffixFlatBlocks = [];
    this.#suffixPrefixGridBoundsByFood.clear();
    this.#suffixPrefixGridCellUpperByFood.clear();
    this.#suffixPrefixGridBlockIndexes.clear();
    this.#suffixPrefixGridSize =
      this.options.suffixPrefixGridSize ?? DEFAULT_SUFFIX_PREFIX_GRID_SIZE;
    this.#suffixPrefixGridMaxima = [];
    this.#suffixPrefixGridBlockCount = 0;
    this.#suffixPrefixGridStateTailsByFood.clear();
    this.#suffixFlatHashes = undefined;
    this.#suffixFlatAttributesByFood.clear();
    this.#suffixFlatStateOrdersByFood.clear();
    this.#suffixFlatHashesByFood.clear();
    this.#suffixFlatColumnsByFood.clear();
    this.#suffixFlatPairIndexesByFood.clear();
    this.#totalDamageCacheKeyLookups.clear();
    this.#suffixKdAttributes = undefined;
    this.#suffixKdStateOrder = undefined;
    this.#suffixFlatBlockOrders.clear();
    this.#suffixFlatScanBlockOrders.clear();
    this.#suffixAttributeSumMaximums = [];
    this.#suffixSlotBounds = [];
    this.#prefixReachableValues = [];
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
    this.#hasConstraints = this.#attributeRanges.some(
      (range) => range !== undefined,
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

  #buildSuffixAttributeSumMaximums(slots: readonly SlotState[]): number[] {
    const suffix = new Array<number>(slots.length + 1).fill(0);
    for (let index = slots.length - 1; index >= 0; index--) {
      const maximum = Math.max(
        ...slots[index].candidates.map((candidate) => candidate.attributeSum),
      );
      suffix[index] = suffix[index + 1] + maximum;
    }
    return suffix;
  }

  #buildSuffixSlotBounds(slots: readonly SlotState[]): UpperBoundSlot[][] {
    return Array.from({ length: slots.length + 1 }, (_, depth) =>
      slots.slice(depth).map((slot) => ({
        minimum: [...slot.minimum],
        maximum: [...slot.maximum],
        attributeSumMaximum: Math.max(
          ...slot.candidates.map((candidate) => candidate.attributeSum),
        ),
      })),
    );
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

  #buildPrefixReachableValues(
    slots: readonly SlotState[],
  ): (number[] | undefined)[][] {
    const reachable = Array.from(
      { length: slots.length + 1 },
      () => new Array<number[] | undefined>(this.attributeCount),
    );
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      reachable[0][attribute] = [0];
    }
    for (let depth = 0; depth < slots.length; depth++) {
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const previous = reachable[depth][attribute]!;
        const values = new Set<number>();
        for (const candidate of slots[depth].candidates) {
          const candidateValue = candidate.attributes[attribute];
          if (!Number.isInteger(candidateValue) || candidateValue < 0) {
            throw new RangeError("阈值 Pareto 属性必须是非负整数");
          }
          for (const previousValue of previous) {
            values.add(candidateValue + previousValue);
          }
        }
        reachable[depth + 1][attribute] = [...values].sort((a, b) => a - b);
      }
    }
    return reachable;
  }

  #compressSuffixFutureTierStates(
    states: readonly SuffixFrontierState[],
    foodPlans: readonly FoodPlan[],
  ): SuffixFrontierState[] {
    if (states.length < 2 || foodPlans.length === 0) return [...states];
    const classes = new Array<Int32Array | undefined>(this.attributeCount);
    const prefixValues = this.#prefixReachableValues[this.#suffixStart]!;
    const suffixMaximum = this.#suffixMaximums[this.#suffixStart]!;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const projector = this.#tierProjectors[attribute];
      if (projector === undefined) continue;
      const maximum = suffixMaximum[attribute] ?? 0;
      const boundaries = new Uint8Array(maximum + 1);
      const possiblePrefixes = prefixValues[attribute] ?? [0];
      for (let suffixValue = 1; suffixValue <= maximum; suffixValue++) {
        let distinguishable = false;
        for (const prefixValue of possiblePrefixes) {
          for (const foodPlan of foodPlans) {
            const first = projector(
              this.#applyFoodValue(prefixValue + suffixValue - 1, attribute, foodPlan.food),
            );
            const second = projector(
              this.#applyFoodValue(prefixValue + suffixValue, attribute, foodPlan.food),
            );
            if (first !== second) {
              distinguishable = true;
              break;
            }
          }
          if (distinguishable) break;
        }
        if (distinguishable) boundaries[suffixValue] = 1;
      }
      const tierClasses = new Int32Array(maximum + 1);
      for (let value = 1; value <= maximum; value++) {
        tierClasses[value] = tierClasses[value - 1] + boundaries[value];
      }
      classes[attribute] = tierClasses;
    }

    const retained = new Map<string, SuffixFrontierState>();
    for (const state of states) {
      const keyParts = new Array<number>(this.attributeCount);
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const value = state.attributes[attribute] ?? 0;
        keyParts[attribute] = classes[attribute]?.[value] ?? value;
      }
      const key = keyParts.join(",");
      if (!retained.has(key)) retained.set(key, state);
    }
    return [...retained.values()];
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
    if (foods.length === 0) {
      return [{ food: undefined, key: "no-food", cacheIndex: 0, transforms: [] }];
    }

    const makePlan = (food: FoodInfo, index: number): FoodPlan => ({
      food,
      key: `${index}|${food.itemId}|${food.key}`,
      cacheIndex: index + 1,
      transforms: food.baseParams.flatMap((param) => {
        const attribute = this.#attributeIndex.get(param.baseParamId);
        if (attribute === undefined) {
          throw new RangeError(`食物包含未配置的属性 id：${param.baseParamId}`);
        }
        return [{
          attribute,
          maxValue: param.maxValue,
          rate: param.multiplier - 1,
        }];
      }),
    });

    // A stronger food can cross an attribute ceiling, so ordinary food
    // dominance is only valid when no final attribute has an upper bound.
    if (this.#upperConstrainedIndexes.length > 0) {
      return foods.map(makePlan);
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

    return retained.map(makePlan);
  }

  #buildTotalDamageCacheKeyLookups(foodPlans: readonly FoodPlan[]): void {
    this.#totalDamageCacheKeyLookups.clear();
    if (this.options.suffixTotalDamageTierCache !== true) return;
    const maximums = this.#suffixMaximums[0];
    if (maximums === undefined) return;
    for (const foodPlan of foodPlans) {
      const transformsByAttribute = new Map<number, FoodTransform[]>();
      for (const transform of foodPlan.transforms) {
        const existing = transformsByAttribute.get(transform.attribute);
        if (existing === undefined) {
          transformsByAttribute.set(transform.attribute, [transform]);
        } else {
          existing.push(transform);
        }
      }
      const lookups = new Array<Int32Array | undefined>(this.attributeCount);
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const projector = this.#tierProjectors[attribute];
        const transforms = transformsByAttribute.get(attribute);
        if (projector === undefined && transforms === undefined) continue;
        const maximum = maximums[attribute] ?? 0;
        if (!Number.isSafeInteger(maximum) || maximum < 0) continue;
        const lookup = new Int32Array(maximum + 1);
        for (let value = 0; value <= maximum; value++) {
          let transformed = value;
          for (const transform of transforms ?? []) {
            transformed += Math.min(
              transform.maxValue,
              Math.trunc(transformed * transform.rate + 1e-7),
            );
          }
          lookup[value] = projector === undefined
            ? transformed
            : projector(transformed);
        }
        lookups[attribute] = lookup;
      }
      this.#totalDamageCacheKeyLookups.set(foodPlan.key, lookups);
    }
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
      `[V2搜索] 初始贪心解：属性优先级=${this.#greedyPriorityIndexes.map((index) => this.#attributeIds[index]).join(">")}；食物=${this.#foodLabel(foodPlan)}；装备=${selection.map((equipment) => equipment.itemId).join(",")}；伤害=${this.#bestDamage()}`,
    );
    const improvedDamage = this.#improveLowerBound(
      selectedCandidates,
      foodPlans,
    );
    this.statistics.localSearchDamage = this.#bestDamage();
    this.#debugLog(
      `[V2搜索] 局部改良下界：食物=${this.#best?.food === undefined ? "无食物" : `${this.#best.food.itemId}/${this.#best.food.key}`}；装备=${this.#best?.selection.map((equipment) => equipment.itemId).join(",")}；伤害=${this.#bestDamage()}；单槽改良=${this.statistics.singleSlotImprovements}；双槽改良=${this.statistics.pairwiseImprovements}`,
    );
    const searchOrder = [...orderedFoodPlans].sort((first, second) => {
      const difference =
        improvedDamage.get(second.key)! - improvedDamage.get(first.key)!;
      return (
        difference ||
        this.#compareFoodPriority(first, second) ||
        orderedFoodPlans.indexOf(first) - orderedFoodPlans.indexOf(second)
      );
    });
    this.#debugLog(
      `[V2搜索] 食物搜索顺序：${searchOrder.map((plan) => `${this.#foodLabel(plan)}=${improvedDamage.get(plan.key)}`).join(",")}`,
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

      // A few deterministic mixed seeds often escape the single/pairwise
      // coordinate basin and raise the pruning lower bound at negligible cost.
      let randomState = 0x9e3779b9;
      let sampledBestDamage = damage;
      let sampledBestFeasible = violation === 0;
      for (let seed = 0; seed < LOWER_BOUND_RANDOM_SEEDS; seed++) {
        const trialAttributes = this.#zeroAttributes();
        const trialSelection = new Array<EquipInfo>(this.#slots.length);
        const trialCandidates: Candidate[] = [];
        for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
          randomState = (Math.imul(randomState, 1664525) + 1013904223) | 0;
          const candidates = this.#slots[slotIndex].candidates;
          const candidate = candidates[(randomState >>> 0) % candidates.length];
          trialCandidates[slotIndex] = candidate;
          this.#add(trialAttributes, candidate.attributes);
          trialSelection[this.#slots[slotIndex].inputIndex] = candidate.equipment;
        }
        let trialViolation = this.#constraintViolation(
          trialAttributes,
          foodPlan.food,
        );
        if (trialViolation !== 0) continue;
        let trialDamage = this.#damageWithFood(trialAttributes, foodPlan);
        if (!sampledBestFeasible || trialDamage > sampledBestDamage) {
          sampledBestDamage = trialDamage;
          sampledBestFeasible = true;
          this.#consider(trialDamage, trialSelection, foodPlan, trialAttributes);
        }
        if (seed >= LOWER_BOUND_RANDOM_LOCAL_SEEDS) continue;
        // Refine only a bounded number of random feasible seeds. This is a
        // lower-bound search, so even a poor local optimum remains safe while
        // often escaping the single-coordinate basin above.
        for (let pass = 0; pass < 2; pass++) {
          let improved = false;
          for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
            const slot = this.#slots[slotIndex]!;
            const current = trialCandidates[slotIndex]!;
            this.#subtract(trialAttributes, current.attributes);
            let bestCandidate = current;
            let bestCandidateDamage = trialDamage;
            let bestCandidateViolation: number = trialViolation;
            for (const candidate of slot.candidates) {
              this.#add(trialAttributes, candidate.attributes);
              const candidateViolation = this.#constraintViolation(
                trialAttributes,
                foodPlan.food,
              );
              const candidateDamage = this.#damageWithFood(
                trialAttributes,
                foodPlan,
              );
              this.#subtract(trialAttributes, candidate.attributes);
              if (
                candidateViolation < bestCandidateViolation ||
                (candidateViolation === bestCandidateViolation &&
                  candidateDamage > bestCandidateDamage)
              ) {
                bestCandidate = candidate;
                bestCandidateDamage = candidateDamage;
                bestCandidateViolation = candidateViolation;
              }
            }
            trialCandidates[slotIndex] = bestCandidate;
            this.#add(trialAttributes, bestCandidate.attributes);
            trialSelection[slot.inputIndex] = bestCandidate.equipment;
            if (
              bestCandidateViolation < trialViolation ||
              (bestCandidateViolation === trialViolation &&
                bestCandidateDamage > trialDamage)
            ) {
              trialViolation = bestCandidateViolation;
              trialDamage = bestCandidateDamage;
              improved = true;
              if (trialViolation === 0) {
                sampledBestFeasible = true;
                if (trialDamage > sampledBestDamage) {
                  sampledBestDamage = trialDamage;
                  this.#consider(
                    trialDamage,
                    trialSelection,
                    foodPlan,
                    trialAttributes,
                  );
                }
              }
            }
          }
          if (!improved) break;
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
        sampledBestFeasible ? Math.max(damage, sampledBestDamage) : Number.NEGATIVE_INFINITY,
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

    // The relaxation-gap order keeps the slots whose independent maxima are
    // least representative in the prefix, while leaving a smaller correlated
    // suffix frontier.  It consistently reduces prefix*suffix work on the
    // production RDM data without changing any acceptance or bound rule.
    const order = this.options.slotOrder ?? "relaxation-gap";
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
      `[V2搜索] 槽位搜索顺序：策略=${order}；${this.#slots.map((slot) => `${slot.inputIndex}(候选=${slot.candidates.length},上界虚高影响=${relaxationGap.get(slot)!.toFixed(6)})`).join(",")}`,
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

  #buildSuffixFrontier(foodPlans: readonly FoodPlan[]): void {
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
    this.#suffixRootGroups = [];
    this.#suffixFrontierGroups = [];
    this.#suffixGroupRemainingMaximums = [];
    this.statistics.suffixSlotCount = slotCount;
    this.statistics.suffixRawCombinations =
      slotCount === 0 ? 0 : rawCombinations;
    if (slotCount === 0) {
      this.#debugLog("[V2搜索] 后缀Pareto前沿：已禁用或组合数超过限制");
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
          if (
            (generated.length & 4095) === 0 &&
            this.options.shouldAbort?.()
          ) {
            this.#abortSearch();
          }
          generated.push({
            attributes: this.#sum(state.attributes, candidate.attributes),
            attributeSum: state.attributeSum + candidate.attributeSum,
            candidates: [...state.candidates, candidate],
          });
        }
      }
      const unique = this.#deduplicateSuffixStates(generated);
      frontier = this.#pruneSuffixFrontier(unique);
      layerSizes.push(`${generated.length}->${unique.length}->${frontier.length}`);
    }

    const frontierBeforeCompression = frontier.length;
    if (this.options.suffixFutureTierCompression === true) {
      frontier = this.#compressSuffixFutureTierStates(frontier, foodPlans);
      layerSizes.push(`等效${frontierBeforeCompression}->${frontier.length}`);
    }

    this.statistics.suffixFrontierSize = frontier.length;
    // Keep the final frontier in one contiguous numeric block.  Ordering the
    // states by the first food's relaxed score makes a good incumbent appear
    // early; block and tail bounds then stop most later scans safely.
    let flatStates = [...frontier];
    const flatPrefix = this.#prefixMaximums[this.#suffixStart]!;
    const flatFood = this.#suffixSplitFoodPlan!;
    const statesBySum = new Map<number, SuffixFrontierState[]>();
    for (const state of flatStates) {
      const bucket = statesBySum.get(state.attributeSum);
      if (bucket === undefined) statesBySum.set(state.attributeSum, [state]);
      else bucket.push(state);
    }
    const sumGroups = [...statesBySum.values()].map((states) => {
      states.sort(
        (first, second) =>
          this.#upperDamageOfSum(flatPrefix, second.attributes, flatFood) -
          this.#upperDamageOfSum(flatPrefix, first.attributes, flatFood),
      );
      return states;
    });
    const groupBounds = (states: readonly SuffixFrontierState[]): number[] => {
      const maximum = this.#zeroAttributes();
      for (const state of states) {
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          maximum[attribute] = Math.max(maximum[attribute]!, state.attributes[attribute]!);
        }
      }
      return maximum;
    };
    sumGroups.sort(
      (first, second) =>
        this.#upperDamageOfSum(flatPrefix, groupBounds(second), flatFood) -
        this.#upperDamageOfSum(flatPrefix, groupBounds(first), flatFood),
    );
    flatStates = sumGroups.flat();
    this.#suffixFlatBlocks = [];
    let flatBlockStart = 0;
    const buildFlatSlotBounds = (
      states: readonly SuffixFrontierState[],
    ): UpperBoundSlot[] => {
      const slotBounds = Array.from(
        { length: this.#slots.length - this.#suffixStart },
        () => ({
          minimum: new Array<number>(this.attributeCount).fill(
            Number.POSITIVE_INFINITY,
          ),
          maximum: this.#zeroAttributes(),
          attributeSumMaximum: 0,
        }),
      );
      for (const state of states) {
        for (let suffixOffset = 0; suffixOffset < slotBounds.length; suffixOffset++) {
          const candidate = state.candidates[suffixOffset];
          if (candidate === undefined) continue;
          const bound = slotBounds[suffixOffset]!;
          bound.attributeSumMaximum = Math.max(
            bound.attributeSumMaximum,
            candidate.attributeSum,
          );
          for (let attribute = 0; attribute < this.attributeCount; attribute++) {
            bound.minimum[attribute] = Math.min(
              bound.minimum[attribute]!,
              candidate.attributes[attribute]!,
            );
            bound.maximum[attribute] = Math.max(
              bound.maximum[attribute]!,
              candidate.attributes[attribute]!,
            );
          }
        }
      }
      return slotBounds;
    };
    const correlatedMaximum = (
      states: readonly SuffixFrontierState[],
      minimum: readonly number[],
      maximum: readonly number[],
    ): number[] => {
      if (states.length < 2 || this.attributeCount < 2 || this.attributeCount > 12) {
        return [...maximum];
      }
      const subsetCount = 1 << this.attributeCount;
      const subsetMaximums = new Array<number>(subsetCount).fill(
        Number.NEGATIVE_INFINITY,
      );
      const subsetSums = new Array<number>(subsetCount).fill(0);
      for (const state of states) {
        for (let mask = 1; mask < subsetCount; mask++) {
          const bit = mask & -mask;
          const attribute = 31 - Math.clz32(bit);
          subsetSums[mask] =
            subsetSums[mask ^ bit]! + state.attributes[attribute]!;
          if (subsetSums[mask]! > subsetMaximums[mask]!) {
            subsetMaximums[mask] = subsetSums[mask]!;
          }
        }
      }
      const result = [...maximum];
      const minimumSums = new Array<number>(subsetCount).fill(0);
      for (let mask = 1; mask < subsetCount; mask++) {
        const bit = mask & -mask;
        const attribute = 31 - Math.clz32(bit);
        minimumSums[mask] = minimumSums[mask ^ bit]! + (minimum[attribute] ?? 0);
      }
      for (let mask = 1; mask < subsetCount; mask++) {
        const maximumSum = subsetMaximums[mask]!;
        if (!Number.isFinite(maximumSum)) continue;
        let remaining = mask;
        while (remaining !== 0) {
          const bit = remaining & -remaining;
          const attribute = 31 - Math.clz32(bit);
          result[attribute] = Math.min(
            result[attribute]!,
            maximumSum - minimumSums[mask ^ bit]!,
          );
          remaining ^= bit;
        }
      }
      return result;
    };
    const buildSubBlocks = (
      states: readonly SuffixFrontierState[],
      start: number,
    ): SuffixFlatBlock[] => {
      const subBlocks: SuffixFlatBlock[] = [];
      const subblockStateLimit =
        this.options.suffixSubblockStateLimit ?? SUFFIX_SUBBLOCK_STATE_LIMIT;
      for (let localStart = 0; localStart < states.length; localStart += subblockStateLimit) {
        const localEnd = Math.min(
          states.length,
          localStart + subblockStateLimit,
        );
        const minimum = new Array<number>(this.attributeCount).fill(
          Number.POSITIVE_INFINITY,
        );
        const maximum = this.#zeroAttributes();
        for (let localIndex = localStart; localIndex < localEnd; localIndex++) {
          const state = states[localIndex]!;
          for (let attribute = 0; attribute < this.attributeCount; attribute++) {
            minimum[attribute] = Math.min(
              minimum[attribute]!,
              state.attributes[attribute]!,
            );
            maximum[attribute] = Math.max(
              maximum[attribute]!,
              state.attributes[attribute]!,
            );
          }
        }
        subBlocks.push({
          start: start + localStart,
          end: start + localEnd,
          minimum,
          maximum,
          boundMaximum: correlatedMaximum(
            states.slice(localStart, localEnd),
            minimum,
            maximum,
          ),
          attributeSumMaximum: states[localStart]?.attributeSum ?? 0,
          slotBounds:
            this.options.suffixPerSlotBounds === true
              ? buildFlatSlotBounds(states.slice(localStart, localEnd))
              : undefined,
        });
      }
      return subBlocks;
    };
    for (const states of sumGroups) {
      const minimum = new Array<number>(this.attributeCount).fill(
        Number.POSITIVE_INFINITY,
      );
      const maximum = this.#zeroAttributes();
      for (const state of states) {
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          minimum[attribute] = Math.min(
            minimum[attribute]!,
            state.attributes[attribute]!,
          );
          maximum[attribute] = Math.max(
            maximum[attribute]!,
            state.attributes[attribute]!,
          );
        }
      }
      const end = flatBlockStart + states.length;
      const block: SuffixFlatBlock = {
        start: flatBlockStart,
        end,
        minimum,
        maximum,
        boundMaximum: correlatedMaximum(states, minimum, maximum),
        attributeSumMaximum: states[0]?.attributeSum ?? 0,
        slotBounds:
          this.options.suffixPerSlotBounds === true
            ? buildFlatSlotBounds(states)
            : undefined,
      };
      const subblockStateLimit =
        this.options.suffixSubblockStateLimit ?? SUFFIX_SUBBLOCK_STATE_LIMIT;
      if (this.options.suffixSubblockRefinement === true && states.length > subblockStateLimit) {
        block.subBlocks = buildSubBlocks(states, flatBlockStart);
        for (const subBlock of block.subBlocks) subBlock.parent = block;
      }
      this.#suffixFlatBlocks.push(block);
      flatBlockStart = end;
    }
    this.#suffixFlatStates = flatStates;
    this.#suffixFlatAttributes = new Int32Array(
      flatStates.length * this.attributeCount,
    );
    this.#suffixFlatHashes = new Uint32Array(flatStates.length);
    for (let index = 0; index < flatStates.length; index++) {
      const state = flatStates[index]!;
      state.flatOffset = index * this.attributeCount;
      this.#suffixFlatAttributes.set(state.attributes, state.flatOffset);
      this.#suffixFlatHashes[index] = this.#attributeVectorHash(state.attributes);
    }
    this.#suffixFlatColumns = Array.from(
      { length: this.attributeCount },
      (_, attribute) => {
        const column = new Int32Array(flatStates.length);
        for (let stateIndex = 0; stateIndex < flatStates.length; stateIndex++) {
          column[stateIndex] = flatStates[stateIndex]!.attributes[attribute] ?? 0;
        }
        return column;
      },
    );
    this.#suffixFlatPairIndexes = this.#buildSuffixPairIndexes();
    if (this.#suffixFlatPairIndexes !== undefined) {
      this.#debugLog(
        `[V2搜索] 后缀复合下标：属性=${this.options.suffixPairAttributes!.join(",")}；步长=${this.options.suffixPairStride}`,
      );
    }
    if (
      this.options.suffixSumNecessaryBound === true &&
      !this.#hasConstraints
    ) {
      for (const block of this.#suffixFlatBlocks) {
        const views = new Array<SuffixFlatAttributeView | undefined>(
          this.attributeCount,
        );
        const pivotAttributes = this.#greedyPriorityIndexes.length === 0
          ? [0]
          : this.#greedyPriorityIndexes;
        for (const attribute of pivotAttributes) {
          const order = Array.from(
            { length: block.end - block.start },
            (_, localIndex) => block.start + localIndex,
          );
          order.sort((first, second) => {
            const difference =
              this.#suffixFlatAttributes![first * this.attributeCount + attribute]! -
              this.#suffixFlatAttributes![second * this.attributeCount + attribute]!;
            return difference || first - second;
          });
          const orderView = new Int32Array(order);
          const stateCount = orderView.length;
          const orderedAttributes = new Int32Array(
            stateCount * this.attributeCount,
          );
          const columns = Array.from(
            { length: this.attributeCount },
            () => new Int32Array(stateCount),
          );
          const prefixMaximums = new Int32Array(
            (stateCount + 1) * this.attributeCount,
          );
          for (let sortedIndex = 0; sortedIndex < stateCount; sortedIndex++) {
            if (
              (sortedIndex & 4095) === 0 &&
              this.options.shouldAbort?.()
            ) {
              this.#abortSearch();
            }
            const stateIndex = orderView[sortedIndex]!;
            const sourceOffset = stateIndex * this.attributeCount;
            const targetOffset = sortedIndex * this.attributeCount;
            orderedAttributes.set(
              this.#suffixFlatAttributes!.subarray(
                sourceOffset,
                sourceOffset + this.attributeCount,
              ),
              targetOffset,
            );
            for (let other = 0; other < this.attributeCount; other++) {
              columns[other]![sortedIndex] =
                this.#suffixFlatAttributes![sourceOffset + other]!;
            }
            const prefixOffset = (sortedIndex + 1) * this.attributeCount;
            const previousOffset = sortedIndex * this.attributeCount;
            for (let other = 0; other < this.attributeCount; other++) {
              prefixMaximums[prefixOffset + other] = Math.max(
                prefixMaximums[previousOffset + other]!,
                orderedAttributes[targetOffset + other]!,
              );
            }
          }
          views[attribute] = {
            attributes: orderedAttributes,
            columns,
            pairIndexes: this.#buildSuffixPairIndexes(orderView),
            stateIndexes: orderView,
            prefixMaximums,
          };
        }
        block.attributeViews = views;
      }
    }
    if (
      this.options.suffixNecessaryLowerBound === true &&
      this.options.combinedDamageFunction !== undefined
    ) {
      this.#buildSuffixAttributeViews();
    }
    const flatScore = this.options.combinedDamageFlatFunction;
    if (
      this.options.suffixStateUpperBound === true &&
      flatScore !== undefined &&
      this.#suffixSplitFoodPlan !== undefined
    ) {
      const flatFood = this.#suffixSplitFoodPlan;
      const fillStateUpperBounds = (block: SuffixFlatBlock): void => {
        const bounds = new Float64Array(block.end - block.start);
        for (let index = block.start; index < block.end; index++) {
          bounds[index - block.start] = flatScore(
            flatPrefix,
            this.#suffixFlatAttributes!,
            index * this.attributeCount,
            flatFood.transforms,
          );
        }
        let sortedDescending = true;
        for (let index = 1; index < bounds.length; index++) {
          if (bounds[index]! > bounds[index - 1]! + 1e-12) {
            sortedDescending = false;
            break;
          }
        }
        if (sortedDescending) block.stateUpperBounds = bounds;
        for (const subBlock of block.subBlocks ?? []) {
          fillStateUpperBounds(subBlock);
        }
      };
      for (const block of this.#suffixFlatBlocks) fillStateUpperBounds(block);
    }
    const groupMaximums = new Map<Candidate, number[]>();
    const groupsByFirst = new Map<
      Candidate,
      Map<Candidate | undefined, SuffixFrontierGroup>
    >();
    for (const state of frontier) {
      const candidate = state.candidates[0];
      let maximum = groupMaximums.get(candidate);
      if (maximum === undefined) {
        maximum = [...state.attributes];
        groupMaximums.set(candidate, maximum);
      } else {
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          maximum[attribute] = Math.max(maximum[attribute], state.attributes[attribute]);
        }
      }

      const secondCandidate = state.candidates[1];
      let groupsBySecond = groupsByFirst.get(candidate);
      if (groupsBySecond === undefined) {
        groupsBySecond = new Map();
        groupsByFirst.set(candidate, groupsBySecond);
      }
      let group = groupsBySecond.get(secondCandidate);
      if (group === undefined) {
        group = {
          minimum: new Array<number>(this.attributeCount).fill(
            Number.POSITIVE_INFINITY,
          ),
          maximum: this.#zeroAttributes(),
          attributeSumMaximum: 0,
          slotBounds: [],
          states: [],
          remainingMinimums: [],
          remainingAttributeSumMaximums: [],
          remainingMaximums: [],
        };
        groupsBySecond.set(secondCandidate, group);
      }
      const targetGroup = group!;
      targetGroup.states.push(state);
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        targetGroup.minimum[attribute] = Math.min(
          targetGroup.minimum[attribute],
          state.attributes[attribute],
        );
        targetGroup.maximum[attribute] = Math.max(
          targetGroup.maximum[attribute],
          state.attributes[attribute],
        );
      }
    }
    this.#suffixRootGroups = [...groupMaximums.values()];
    const baseGroups = [...groupsByFirst.values()].flatMap((groups) =>
      [...groups.values()],
    );
    this.#suffixFrontierGroups = [];
    for (const baseGroup of baseGroups) {
      // States made from the same item-level/materia-slot profile have a
      // fixed total attribute sum.  Keep different sums out of the same
      // bounding box whenever possible; mixing them recreates the loose
      // component-wise maximum that this frontier is intended to avoid.
      baseGroup.states.sort((first, second) =>
        second.attributeSum - first.attributeSum ||
        this.#upperDamageOfSum(
          this.#prefixMaximums[this.#suffixStart],
          second.attributes,
          this.#suffixSplitFoodPlan!,
        ) - this.#upperDamageOfSum(
          this.#prefixMaximums[this.#suffixStart],
          first.attributes,
          this.#suffixSplitFoodPlan!,
        ),
      );
      for (
        let start = 0;
        start < baseGroup.states.length;
        start += SUFFIX_GROUP_STATE_LIMIT
      ) {
        const states = baseGroup.states.slice(
          start,
          start + SUFFIX_GROUP_STATE_LIMIT,
        );
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
        const attributeSumMaximum = Math.max(
          ...states.map((state) => state.attributeSum),
        );
        const remainingMinimums = Array.from(
          { length: states.length + 1 },
          () => new Array<number>(this.attributeCount).fill(
            Number.POSITIVE_INFINITY,
          ),
        );
        const remainingAttributeSumMaximums = new Array<number>(
          states.length + 1,
        ).fill(0);
        const remainingMaximums = Array.from(
          { length: states.length + 1 },
          () => this.#zeroAttributes(),
        );
        const slotBounds: UpperBoundSlot[] = [];
        const representative = states[0];
        for (
          let suffixOffset = 0;
          suffixOffset < this.#slots.length - this.#suffixStart;
          suffixOffset++
        ) {
          const fixedCandidate = representative?.candidates[suffixOffset];
          if (fixedCandidate !== undefined && suffixOffset < 2) {
            slotBounds.push({
              minimum: [...fixedCandidate.attributes],
              maximum: [...fixedCandidate.attributes],
              attributeSumMaximum: fixedCandidate.attributeSum,
            });
            continue;
          }
          const globalBound =
            this.#suffixSlotBounds[this.#suffixStart + suffixOffset]?.[0];
          if (globalBound !== undefined) {
            slotBounds.push({
              minimum: [...globalBound.minimum],
              maximum: [...globalBound.maximum],
              attributeSumMaximum: globalBound.attributeSumMaximum,
            });
          }
        }
        for (let index = states.length - 1; index >= 0; index--) {
          const nextMinimum = remainingMinimums[index + 1]!;
          const currentMinimum = remainingMinimums[index]!;
          const remaining = remainingMaximums[index + 1]!;
          const current = remainingMaximums[index]!;
          const state = states[index]!;
          remainingAttributeSumMaximums[index] = Math.max(
            remainingAttributeSumMaximums[index + 1]!,
            state.attributeSum,
          );
          for (let attribute = 0; attribute < this.attributeCount; attribute++) {
            currentMinimum[attribute] = Math.min(
              nextMinimum[attribute],
              state.attributes[attribute],
            );
            current[attribute] = Math.max(
              remaining[attribute],
              state.attributes[attribute],
            );
          }
        }
        this.#suffixFrontierGroups.push({
          minimum,
          maximum,
          attributeSumMaximum,
          slotBounds,
          states,
          remainingMinimums,
          remainingAttributeSumMaximums,
          remainingMaximums,
        });
      }
    }
    this.#suffixFrontierGroups.sort((first, second) =>
      this.#upperDamageOfSum(
        this.#prefixMaximums[this.#suffixStart],
        second.maximum,
        this.#suffixSplitFoodPlan!,
      ) - this.#upperDamageOfSum(
        this.#prefixMaximums[this.#suffixStart],
      first.maximum,
        this.#suffixSplitFoodPlan!,
      ),
    );
    this.#suffixGroupRemainingMaximums = Array.from(
      { length: this.#suffixFrontierGroups.length + 1 },
      () => this.#zeroAttributes(),
    );
    for (
      let groupIndex = this.#suffixFrontierGroups.length - 1;
      groupIndex >= 0;
      groupIndex--
    ) {
      const current = this.#suffixGroupRemainingMaximums[groupIndex]!;
      const next = this.#suffixGroupRemainingMaximums[groupIndex + 1]!;
      const groupMaximum = this.#suffixFrontierGroups[groupIndex]!.maximum;
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        current[attribute] = Math.max(next[attribute], groupMaximum[attribute]);
      }
    }
    this.#suffixFrontierRoot = this.#buildSuffixFrontierTree(frontier);
    this.#debugLog(
      `[V2搜索] 后缀Pareto前沿：槽位=${this.#slots
        .slice(this.#suffixStart)
        .map((slot) => `${slot.inputIndex}/${slot.candidates.length}`)
        .join(
          ",",
        )}；原始组合=${rawCombinations}；逐层=${layerSizes.join(",")}；最终前沿=${frontier.length}；总属性和组=${sumGroups.length}`,
    );
  }

  /**
   * Encode two suffix attributes into the same row-major offset used by the
   * evaluator's weapon/primary factor table.  The encoding is additive:
   * `pair(prefix + suffix) = pair(prefix) + pair(suffix)`, so the hot loop
   * needs one addition and one array read instead of a multiply per state.
   */
  #buildSuffixPairIndexes(
    stateOrder?: ArrayLike<number>,
  ): Int32Array | undefined {
    const pairAttributes = this.options.suffixPairAttributes;
    const stride = this.options.suffixPairStride;
    const flat = this.#suffixFlatAttributes;
    if (pairAttributes === undefined || stride === undefined || flat === undefined) {
      return undefined;
    }
    const [first, second] = pairAttributes;
    const result = new Int32Array(this.#suffixFlatStates.length);
    for (let index = 0; index < result.length; index++) {
      const sourceIndex = stateOrder?.[index] ?? index;
      const offset = sourceIndex * this.attributeCount;
      const secondValue = flat[offset + second] ?? 0;
      if (secondValue < 0 || secondValue >= stride) {
        this.#debugLog("[V2搜索] 后缀复合索引已跳过：主属性分量超出步长");
        return undefined;
      }
      const encoded = (flat[offset + first] ?? 0) * stride + secondValue;
      if (!Number.isSafeInteger(encoded) || encoded < 0 || encoded > 2_147_483_647) {
        this.#debugLog("[V2搜索] 后缀复合索引已跳过：编码超出 Int32 范围");
        return undefined;
      }
      result[index] = encoded;
    }
    return result;
  }

  #buildSuffixFlatBlockOrders(foodPlans: readonly FoodPlan[]): void {
    this.#suffixFlatBlockOrders.clear();
    this.#suffixFlatScanBlockOrders.clear();
    this.#suffixFlatScanBlocks = this.#suffixFlatBlocks.flatMap(
      (parentBlock) => parentBlock.subBlocks ?? [parentBlock],
    );
    if (this.#suffixFlatBlocks.length === 0) return;
    const prefixMaximum = this.#prefixMaximums[this.#suffixStart]!;
    if (this.options.suffixFlatTree === true) {
      this.#buildSuffixKdTrees();
    }
    const flatAttributes = this.#suffixFlatAttributes;
    const maxFlat = this.options.maxCombinedDamageFlat;
    const maxFlatBatch = this.options.maxCombinedDamageFlatBatch;
    if (
      this.options.suffixStateUpperBound === true &&
      flatAttributes !== undefined &&
      this.options.combinedDamageFlatFunction !== undefined &&
      this.options.suffixFlatTree !== true &&
      this.options.shareFoodsMode !== "batch" &&
      foodPlans.length > 0
    ) {
      // Preserve each scan block's range, but sort its states by the exact
      // score at the component-wise prefix maximum for each food.  The score
      // then becomes a monotone per-food upper-bound array, while the mapping
      // keeps the canonical suffix state available for result reconstruction.
      const flatScore = this.options.combinedDamageFlatFunction;
      const stateCount = this.#suffixFlatStates.length;
      for (const foodPlan of foodPlans) {
        const scores = new Float64Array(stateCount);
        for (let index = 0; index < stateCount; index++) {
          scores[index] = flatScore(
            prefixMaximum,
            flatAttributes,
            index * this.attributeCount,
            foodPlan.transforms,
          );
        }
        const orderedAttributes = new Int32Array(flatAttributes.length);
        const stateOrder = new Int32Array(stateCount);
        const hashes = new Uint32Array(stateCount);
        for (const scanBlock of this.#suffixFlatScanBlocks) {
          const indexes = Array.from(
            { length: scanBlock.end - scanBlock.start },
            (_, offset) => scanBlock.start + offset,
          );
          indexes.sort(
            (first, second) =>
              scores[second]! - scores[first]! || first - second,
          );
          for (let offset = 0; offset < indexes.length; offset++) {
            const sourceIndex = indexes[offset]!;
            const targetIndex = scanBlock.start + offset;
            stateOrder[targetIndex] = sourceIndex;
            const sourceOffset = sourceIndex * this.attributeCount;
            const targetOffset = targetIndex * this.attributeCount;
            for (let attribute = 0; attribute < this.attributeCount; attribute++) {
              orderedAttributes[targetOffset + attribute] =
                flatAttributes[sourceOffset + attribute]!;
            }
            hashes[targetIndex] = this.#suffixFlatHashes?.[sourceIndex] ?? 0;
          }
        }
        const orderedColumns = Array.from(
          { length: this.attributeCount },
          () => new Int32Array(stateCount),
        );
        for (let index = 0; index < stateCount; index++) {
          const offset = index * this.attributeCount;
          for (let attribute = 0; attribute < this.attributeCount; attribute++) {
            orderedColumns[attribute]![index] =
              orderedAttributes[offset + attribute]!;
          }
        }
        this.#suffixFlatAttributesByFood.set(foodPlan.key, orderedAttributes);
        this.#suffixFlatStateOrdersByFood.set(foodPlan.key, stateOrder);
        this.#suffixFlatHashesByFood.set(foodPlan.key, hashes);
        this.#suffixFlatColumnsByFood.set(foodPlan.key, orderedColumns);
        const orderedPairIndexes = this.#buildSuffixPairIndexes(stateOrder);
        if (orderedPairIndexes !== undefined) {
          this.#suffixFlatPairIndexesByFood.set(
            foodPlan.key,
            orderedPairIndexes,
          );
        }
      }
    }
    if (
      this.options.suffixStateUpperBound === true &&
      flatAttributes !== undefined &&
      (maxFlat !== undefined || maxFlatBatch !== undefined)
    ) {
      for (const block of this.#suffixFlatBlocks) {
        const upperBounds = new Map<string, number>();
        if (maxFlatBatch !== undefined) {
          const results = maxFlatBatch(
            prefixMaximum,
            flatAttributes,
            this.attributeCount,
            foodPlans.map((foodPlan) => foodPlan.transforms),
            block.start,
            block.end,
          );
          for (let index = 0; index < foodPlans.length; index++) {
            upperBounds.set(foodPlans[index]!.key, results[index]!.damage);
          }
        } else {
          for (const foodPlan of foodPlans) {
            upperBounds.set(
              foodPlan.key,
              maxFlat!(
                prefixMaximum,
                flatAttributes,
                this.attributeCount,
                foodPlan.transforms,
                block.start,
                block.end,
              ).damage,
            );
          }
        }
        block.foodUpperBounds = upperBounds;
        if (block.subBlocks !== undefined) {
          for (const subBlock of block.subBlocks) {
            const subUpperBounds = new Map<string, number>();
            if (maxFlatBatch !== undefined) {
              const results = maxFlatBatch(
                prefixMaximum,
                flatAttributes,
                this.attributeCount,
                foodPlans.map((foodPlan) => foodPlan.transforms),
                subBlock.start,
                subBlock.end,
              );
              for (let index = 0; index < foodPlans.length; index++) {
                subUpperBounds.set(foodPlans[index]!.key, results[index]!.damage);
              }
            } else {
              for (const foodPlan of foodPlans) {
                subUpperBounds.set(
                  foodPlan.key,
                  maxFlat!(
                    prefixMaximum,
                    flatAttributes,
                    this.attributeCount,
                    foodPlan.transforms,
                    subBlock.start,
                    subBlock.end,
                  ).damage,
                );
              }
            }
            subBlock.foodUpperBounds = subUpperBounds;
          }
        }
      }
    }
    if (
      this.options.suffixStateUpperBound === true &&
      flatAttributes !== undefined &&
      this.options.combinedDamageFlatFunction !== undefined &&
      foodPlans.length > 0
    ) {
      const flatScore = this.options.combinedDamageFlatFunction;
      const fillStateUpperBounds = (block: SuffixFlatBlock): void => {
        const boundsByFood = new Map<string, Float64Array>();
        const boundsByFoodIndex: (Float64Array | undefined)[] = [];
        for (const foodPlan of foodPlans) {
          const bounds = new Float64Array(block.end - block.start);
          const orderedAttributes = this.#suffixFlatAttributesByFood.get(foodPlan.key);
          const sourceAttributes = orderedAttributes ?? flatAttributes;
          for (let index = block.start; index < block.end; index++) {
            bounds[index - block.start] = flatScore(
              prefixMaximum,
              sourceAttributes,
              index * this.attributeCount,
              foodPlan.transforms,
            );
          }
          let sortedDescending = true;
          for (let index = 1; index < bounds.length; index++) {
            if (bounds[index]! > bounds[index - 1]! + 1e-12) {
              sortedDescending = false;
              break;
            }
          }
          if (sortedDescending) {
            boundsByFood.set(foodPlan.key, bounds);
            boundsByFoodIndex[foodPlan.cacheIndex] = bounds;
          }
        }
        block.stateUpperBoundsByFood = boundsByFood;
        block.stateUpperBoundsByFoodIndex = boundsByFoodIndex;
        block.stateUpperBounds = boundsByFood.get(
          this.#suffixSplitFoodPlan?.key ?? "",
        );
        for (const subBlock of block.subBlocks ?? []) {
          fillStateUpperBounds(subBlock);
        }
      };
      for (const block of this.#suffixFlatBlocks) fillStateUpperBounds(block);
    }
    for (const foodPlan of foodPlans) {
        const ordered = [...this.#suffixFlatBlocks];
        ordered.sort(
          (first, second) =>
          this.#upperDamageOfSum(
            prefixMaximum,
            second.boundMaximum ?? second.maximum,
            foodPlan,
            second.minimum,
            second.attributeSumMaximum,
            second.slotBounds,
          ) -
          this.#upperDamageOfSum(
            prefixMaximum,
            first.boundMaximum ?? first.maximum,
            foodPlan,
            first.minimum,
            first.attributeSumMaximum,
            first.slotBounds,
          ),
        );
      this.#suffixFlatBlockOrders.set(foodPlan.key, ordered);
      this.#suffixFlatScanBlockOrders.set(
        foodPlan.key,
        ordered.flatMap((parentBlock) => parentBlock.subBlocks ?? [parentBlock]),
      );
    }
  }

  /**
   * Build a small exact upper-bound table indexed by a coarse prefix vector.
   * For one grid cell the table stores the exact maximum at that cell's
   * component-wise upper corner.  Since the built-in damage/DPS evaluators
   * are monotone in every contribution, every prefix in the cell is bounded
   * by that value.  The table is only an optional pruning aid; surviving
   * blocks still use the ordinary exact evaluator.
   */
  #buildSuffixPrefixGridUpperBounds(
    foodPlans: readonly FoodPlan[],
  ): void {
    this.#suffixPrefixGridBoundsByFood.clear();
    this.#suffixPrefixGridBlockIndexes.clear();
    this.#suffixPrefixGridBlockCount = 0;
    if (
      this.options.suffixPrefixGridUpperBound !== true ||
      this.#hasConstraints ||
      this.#suffixFlatAttributes === undefined ||
      this.#suffixFlatBlocks.length === 0 ||
      foodPlans.length === 0
    ) {
      return;
    }
    const prefixMaximum = this.#prefixMaximums[this.#suffixStart];
    const maxBatch = this.options.maxCombinedDamageFlatBatch;
    const maxSingle = this.options.maxCombinedDamageFlat;
    if (prefixMaximum === undefined || (maxBatch === undefined && maxSingle === undefined)) {
      return;
    }
    const gridSize = this.#suffixPrefixGridSize;
    const cellCount = Math.pow(gridSize, this.attributeCount);
    if (!Number.isSafeInteger(cellCount) || cellCount > MAX_SUFFIX_PREFIX_GRID_CELLS) {
      this.#debugLog(
        `[V2搜索] 前缀网格上界已跳过：单维=${gridSize}；单元=${cellCount}；上限=${MAX_SUFFIX_PREFIX_GRID_CELLS}`,
      );
      return;
    }
    const blockCount = this.#suffixFlatBlocks.length;
    this.#suffixPrefixGridBlockIndexes.clear();
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
      this.#suffixPrefixGridBlockIndexes.set(
        this.#suffixFlatBlocks[blockIndex]!,
        blockIndex,
      );
    }
    const boundsByFood = foodPlans.map(
      () => new Float64Array(cellCount * blockCount),
    );
    this.#suffixPrefixGridMaxima = prefixMaximum.map((value) =>
      Math.max(0, Math.trunc(value ?? 0)),
    );
    this.#suffixPrefixGridBlockCount = blockCount;
    const prefixUpper = this.#upperAttributes;
    const transforms = foodPlans.map((foodPlan) => foodPlan.transforms);
    for (let cell = 0; cell < cellCount; cell++) {
      let remainder = cell;
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const bin = remainder % gridSize;
        remainder = Math.trunc(remainder / gridSize);
        const maximum = this.#suffixPrefixGridMaxima[attribute]!;
        prefixUpper[attribute] = maximum === 0
          ? 0
          : Math.trunc((((bin + 1) * (maximum + 1)) - 1) / gridSize);
      }
      for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
        if ((blockIndex & 63) === 0 && this.options.shouldAbort?.()) {
          this.#abortSearch();
        }
        const block = this.#suffixFlatBlocks[blockIndex]!;
        const results = maxBatch !== undefined
          ? maxBatch(
              prefixUpper,
              this.#suffixFlatAttributes,
              this.attributeCount,
              transforms,
              block.start,
              block.end,
            )
          : foodPlans.map((foodPlan) =>
              maxSingle!(
                prefixUpper,
                this.#suffixFlatAttributes!,
                this.attributeCount,
                foodPlan.transforms,
                block.start,
                block.end,
              ),
            );
        for (let foodIndex = 0; foodIndex < foodPlans.length; foodIndex++) {
          boundsByFood[foodIndex]![cell * blockCount + blockIndex] =
            results[foodIndex]?.damage ?? Number.NEGATIVE_INFINITY;
        }
      }
    }
    for (let foodIndex = 0; foodIndex < foodPlans.length; foodIndex++) {
      this.#suffixPrefixGridBoundsByFood.set(
        foodPlans[foodIndex]!.key,
        boundsByFood[foodIndex]!,
      );
      const cellUpper = new Float64Array(cellCount);
      cellUpper.fill(Number.NEGATIVE_INFINITY);
      const bounds = boundsByFood[foodIndex]!;
      for (let cell = 0; cell < cellCount; cell++) {
        let upper = Number.NEGATIVE_INFINITY;
        const offset = cell * blockCount;
        for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
          upper = Math.max(upper, bounds[offset + blockIndex]!);
        }
        cellUpper[cell] = upper;
      }
      this.#suffixPrefixGridCellUpperByFood.set(
        foodPlans[foodIndex]!.key,
        cellUpper,
      );
    }
    this.#debugLog(
      `[V2搜索] 前缀网格上界：单维=${gridSize}；单元=${cellCount}；块=${blockCount}；食物=${foodPlans.length}`,
    );
  }

  #suffixPrefixGridCellIndex(prefixAttributes: readonly number[]): number {
    if (
      this.#suffixPrefixGridBlockCount === 0 ||
      this.#suffixPrefixGridMaxima.length !== this.attributeCount
    ) {
      return -1;
    }
    let cell = 0;
    let stride = 1;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const maximum = this.#suffixPrefixGridMaxima[attribute]!;
      const value = Math.max(0, Math.trunc(prefixAttributes[attribute] ?? 0));
      const bin = maximum === 0
        ? 0
        : Math.min(
            this.#suffixPrefixGridSize - 1,
            Math.trunc((value * this.#suffixPrefixGridSize) / (maximum + 1)),
          );
      cell += bin * stride;
      stride *= this.#suffixPrefixGridSize;
    }
    return cell;
  }

  /**
   * Precompute monotone tail maxima for each small prefix-grid cell.  Within
   * one fixed-sum block, the tail maximum at index `i` is the maximum exact
   * score of states `i..end`; binary-searching this array is therefore a safe
   * lower-bound filter for the current incumbent.
   */
  #buildSuffixPrefixGridStateTails(
    foodPlans: readonly FoodPlan[],
  ): void {
    this.#suffixPrefixGridStateTailsByFood.clear();
    if (
      this.options.suffixPrefixGridStateUpperBound !== true ||
      this.#hasConstraints ||
      this.#suffixFlatAttributes === undefined ||
      this.#suffixFlatStates.length === 0 ||
      this.#suffixFlatBlocks.length === 0 ||
      this.options.combinedDamageFlatFunction === undefined
    ) {
      return;
    }
    const prefixMaximum = this.#prefixMaximums[this.#suffixStart];
    if (prefixMaximum === undefined || foodPlans.length === 0) return;
    const gridSize = this.#suffixPrefixGridSize;
    const cellCount = Math.pow(gridSize, this.attributeCount);
    if (
      !Number.isSafeInteger(cellCount) ||
      cellCount > MAX_SUFFIX_PREFIX_GRID_STATE_CELLS
    ) {
      this.#debugLog(
        `[V2搜索] 前缀逐状态网格上界已跳过：单维=${gridSize}；单元=${cellCount}；上限=${MAX_SUFFIX_PREFIX_GRID_STATE_CELLS}`,
      );
      return;
    }
    const stateCount = this.#suffixFlatStates.length;
    const blockCount = this.#suffixFlatBlocks.length;
    this.#suffixPrefixGridMaxima = prefixMaximum.map((value) =>
      Math.max(0, Math.trunc(value ?? 0)),
    );
    this.#suffixPrefixGridBlockCount = blockCount;
    const prefixUpper = this.#upperAttributes;
    const score = this.options.combinedDamageFlatFunction;
    for (const foodPlan of foodPlans) {
      const tails = new Float64Array(cellCount * stateCount);
      for (let cell = 0; cell < cellCount; cell++) {
        let remainder = cell;
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          const bin = remainder % gridSize;
          remainder = Math.trunc(remainder / gridSize);
          const maximum = this.#suffixPrefixGridMaxima[attribute]!;
          prefixUpper[attribute] = maximum === 0
            ? 0
            : Math.trunc((((bin + 1) * (maximum + 1)) - 1) / gridSize);
        }
        for (const block of this.#suffixFlatBlocks) {
          let tailMaximum = Number.NEGATIVE_INFINITY;
          const tailOffset = cell * stateCount;
          for (let index = block.end - 1; index >= block.start; index--) {
            const value = score(
              prefixUpper,
              this.#suffixFlatAttributes,
              index * this.attributeCount,
              foodPlan.transforms,
            );
            if (value > tailMaximum) tailMaximum = value;
            tails[tailOffset + index] = tailMaximum;
            if ((index & 4095) === 0 && this.options.shouldAbort?.()) {
              this.#abortSearch();
            }
          }
        }
      }
      this.#suffixPrefixGridStateTailsByFood.set(foodPlan.key, tails);
    }
    this.#debugLog(
      `[V2搜索] 前缀逐状态网格上界：单维=${gridSize}；单元=${cellCount}；状态=${stateCount}；食物=${foodPlans.length}`,
    );
  }

  #buildSuffixFlatTree(start: number, end: number): SuffixFlatTreeNode {
    const minimum = new Array<number>(this.attributeCount).fill(
      Number.POSITIVE_INFINITY,
    );
    const maximum = this.#zeroAttributes();
    let attributeSumMaximum = 0;
    for (let stateIndex = start; stateIndex < end; stateIndex++) {
      const state = this.#suffixFlatStates[stateIndex]!;
      attributeSumMaximum = Math.max(attributeSumMaximum, state.attributeSum);
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        minimum[attribute] = Math.min(
          minimum[attribute]!,
          state.attributes[attribute]!,
        );
        maximum[attribute] = Math.max(
          maximum[attribute]!,
          state.attributes[attribute]!,
        );
      }
    }
    const node: SuffixFlatTreeNode = {
      start,
      end,
      minimum,
      maximum,
      attributeSumMaximum,
    };
    const leafSize =
      this.options.suffixFlatTreeLeafSize ?? DEFAULT_SUFFIX_FLAT_TREE_LEAF_SIZE;
    if (end - start <= leafSize) return node;
    const middle = start + Math.trunc((end - start) / 2);
    node.left = this.#buildSuffixFlatTree(start, middle);
    node.right = this.#buildSuffixFlatTree(middle, end);
    return node;
  }

  /**
   * Build a KD partition over each fixed-sum block and materialize its leaves
   * in contiguous typed-array ranges.  Unlike the legacy flat tree, every
   * split is spatial: the widest attribute range is partitioned at its
   * median, so child bounding boxes describe actual correlated states.
   */
  #buildSuffixKdTrees(): void {
    const flatAttributes = this.#suffixFlatAttributes;
    const stateCount = this.#suffixFlatStates.length;
    if (flatAttributes === undefined || stateCount === 0) return;
    const kdAttributes = new Int32Array(stateCount * this.attributeCount);
    const kdStateOrder = new Int32Array(stateCount);
  const leafSize =
      this.options.suffixFlatTreeLeafSize ?? DEFAULT_SUFFIX_FLAT_TREE_LEAF_SIZE;
    let writeIndex = 0;
    const tightenMaximum = (
      indices: readonly number[],
      minimum: readonly number[],
      maximum: readonly number[],
    ): number[] => {
      if (indices.length < 2 || this.attributeCount < 2) return [...maximum];
      const pairMaximums = new Array<number>(
        this.attributeCount * this.attributeCount,
      ).fill(Number.NEGATIVE_INFINITY);
      for (const stateIndex of indices) {
        const offset = stateIndex * this.attributeCount;
        for (let first = 0; first < this.attributeCount; first++) {
          const firstValue = flatAttributes[offset + first]!;
          for (let second = first + 1; second < this.attributeCount; second++) {
            const pairOffset = first * this.attributeCount + second;
            const pairValue = firstValue + flatAttributes[offset + second]!;
            if (pairValue > pairMaximums[pairOffset]!) {
              pairMaximums[pairOffset] = pairValue;
            }
          }
        }
      }
      const result = [...maximum];
      for (let first = 0; first < this.attributeCount; first++) {
        for (let second = 0; second < this.attributeCount; second++) {
          if (first === second) continue;
          const pairOffset = Math.min(first, second) * this.attributeCount +
            Math.max(first, second);
          const pairMaximum = pairMaximums[pairOffset]!;
          if (Number.isFinite(pairMaximum)) {
            result[first] = Math.min(
              result[first]!,
              pairMaximum - (minimum[second] ?? 0),
            );
          }
        }
      }
      return result;
    };
    const build = (indices: number[]): SuffixFlatTreeNode => {
      const minimum = new Array<number>(this.attributeCount).fill(
        Number.POSITIVE_INFINITY,
      );
      const maximum = this.#zeroAttributes();
      let attributeSumMaximum = 0;
      for (const stateIndex of indices) {
        const offset = stateIndex * this.attributeCount;
        const state = this.#suffixFlatStates[stateIndex]!;
        attributeSumMaximum = Math.max(
          attributeSumMaximum,
          state.attributeSum,
        );
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          const value = flatAttributes[offset + attribute]!;
          minimum[attribute] = Math.min(minimum[attribute]!, value);
          maximum[attribute] = Math.max(maximum[attribute]!, value);
        }
      }
      const start = writeIndex;
      if (indices.length <= leafSize) {
        for (const stateIndex of indices) {
          const sourceOffset = stateIndex * this.attributeCount;
          kdStateOrder[writeIndex] = stateIndex;
          kdAttributes.set(
            flatAttributes.subarray(
              sourceOffset,
              sourceOffset + this.attributeCount,
            ),
            writeIndex * this.attributeCount,
          );
          writeIndex++;
        }
        return {
          start,
          end: writeIndex,
          minimum,
          maximum,
          boundMaximum: tightenMaximum(indices, minimum, maximum),
          attributeSumMaximum,
        };
      }
      let splitAttribute = 0;
      let largestRange = Number.NEGATIVE_INFINITY;
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const range = maximum[attribute]! - minimum[attribute]!;
        if (range > largestRange) {
          largestRange = range;
          splitAttribute = attribute;
        }
      }
      indices.sort((first, second) => {
        const difference =
          flatAttributes[first * this.attributeCount + splitAttribute]! -
          flatAttributes[second * this.attributeCount + splitAttribute]!;
        return difference || first - second;
      });
      const middle = Math.trunc(indices.length / 2);
      build(indices.slice(0, middle));
      build(indices.slice(middle));
      return {
        start,
        end: writeIndex,
        minimum,
        maximum,
        boundMaximum: tightenMaximum(indices, minimum, maximum),
        attributeSumMaximum,
      };
    };
    for (const block of this.#suffixFlatBlocks) {
      block.tree = build(
        Array.from({ length: block.end - block.start }, (_, index) =>
          block.start + index,
        ),
      );
    }
    this.#suffixKdAttributes = kdAttributes;
    this.#suffixKdStateOrder = kdStateOrder;
  }

  /**
   * Build one contiguous suffix view per attribute.  The views are used only
   * by the necessary-lower-bound experiment; the default path keeps the
   * original score-ordered blocks and therefore allocates no extra arrays.
   */
  #buildSuffixAttributeViews(): void {
    const flatAttributes = this.#suffixFlatAttributes;
    const stateCount = this.#suffixFlatStates.length;
    if (flatAttributes === undefined || stateCount === 0) return;
    this.#suffixFlatAttributeOrders = [];
    this.#suffixFlatAttributeArrays = [];
    this.#suffixFlatAttributeRanks = [];
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const order = Array.from({ length: stateCount }, (_, index) => index);
      order.sort((first, second) => {
        const difference =
          flatAttributes[first * this.attributeCount + attribute]! -
          flatAttributes[second * this.attributeCount + attribute]!;
        return difference || first - second;
      });
      const orderView = new Int32Array(order);
      const ranks = new Int32Array(stateCount);
      for (let index = 0; index < stateCount; index++) {
        ranks[order[index]!] = index;
      }
      const sortedAttributes = new Int32Array(
        stateCount * this.attributeCount,
      );
      for (let index = 0; index < stateCount; index++) {
        const sourceOffset = order[index]! * this.attributeCount;
        sortedAttributes.set(
          flatAttributes.subarray(
            sourceOffset,
            sourceOffset + this.attributeCount,
          ),
          index * this.attributeCount,
        );
      }
      this.#suffixFlatAttributeOrders.push(orderView);
      this.#suffixFlatAttributeArrays.push(sortedAttributes);
      this.#suffixFlatAttributeRanks.push(ranks);
    }
  }

  #suffixBlocksForFood(foodPlan: FoodPlan): readonly SuffixFlatBlock[] {
    return this.#suffixFlatBlockOrders.get(foodPlan.key) ?? this.#suffixFlatBlocks;
  }

  /**
   * Return the cheapest exact monotonic filter for the current prefix.  For
   * each attribute we hold every other suffix component at its independent
   * maximum and binary-search the first value whose score can beat the
   * incumbent.  Any real suffix with a smaller value is therefore unable to
   * improve the incumbent, even though the component-wise maxima are not
   * jointly attainable.
   */
  #necessarySuffixRange(
    prefixAttributes: readonly number[],
    foodPlan: FoodPlan,
  ): {
    attribute: number;
    start: number;
    starts: readonly number[];
    thresholds: readonly number[];
  } | undefined {
    if (
      this.options.suffixNecessaryLowerBound !== true ||
      this.options.combinedDamageFunction === undefined ||
      this.#suffixFlatAttributeArrays.length !== this.attributeCount ||
      !this.#hasBest() ||
      this.#suffixStart >= this.#suffixMaximums.length
    ) {
      return undefined;
    }
    const suffixMaximum = this.#suffixMaximums[this.#suffixStart]!;
    const probe = this.#necessarySuffixAttributes;
    const thresholds = this.#necessarySuffixThresholds;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      probe[attribute] = suffixMaximum[attribute] ?? 0;
      thresholds[attribute] = 0;
    }
    const best = this.#bestDamage();
    let selectedAttribute = -1;
    let selectedStart = Number.POSITIVE_INFINITY;
    const starts = new Array<number>(this.attributeCount).fill(0);
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const maximum = Math.max(0, Math.trunc(suffixMaximum[attribute] ?? 0));
      let low = 0;
      let high = maximum + 1;
      while (low < high) {
        const middle = Math.trunc((low + high) / 2);
        probe[attribute] = middle;
        const score = this.options.combinedDamageFunction(
          prefixAttributes,
          probe,
          foodPlan.transforms,
        );
        if (score > best) high = middle;
        else low = middle + 1;
      }
      thresholds[attribute] = low;
      probe[attribute] = maximum;
      const order = this.#suffixFlatAttributeOrders[attribute]!;
      const values = this.#suffixFlatAttributeArrays[attribute]!;
      let start = 0;
      let end = order.length;
      while (start < end) {
        const middle = Math.trunc((start + end) / 2);
        if (values[middle * this.attributeCount + attribute]! < low) {
          start = middle + 1;
        } else {
          end = middle;
        }
      }
      starts[attribute] = start;
      if (start < selectedStart) {
        selectedStart = start;
        selectedAttribute = attribute;
      }
    }
    if (selectedAttribute < 0 || selectedStart === Number.POSITIVE_INFINITY) {
      return undefined;
    }
    this.statistics.suffixNecessaryBoundChecks++;
    return {
      attribute: selectedAttribute,
      start: selectedStart,
      starts,
      thresholds,
    };
  }

  #tightenSuffixBlockUpper(
    prefixAttributes: readonly number[],
    blockMaximum: readonly number[],
    foodPlan: FoodPlan,
    upperDamage: number,
  ): number {
    if (
      this.options.suffixExactBlockUpperBound !== true ||
      this.options.combinedDamageFunction === undefined
    ) {
      return upperDamage;
    }
    const exactMaximum = this.options.combinedDamageFunction(
      prefixAttributes,
      blockMaximum,
      foodPlan.transforms,
    );
    return Math.min(upperDamage, exactMaximum);
  }

  #pruneSuffixFrontier(states: SuffixFrontierState[]): SuffixFrontierState[] {
    states.sort((first, second) => {
      const sumDifference = second.attributeSum - first.attributeSum;
      if (sumDifference !== 0) return sumDifference;
      return -this.#compareParetoVectors(first.attributes, second.attributes);
    });

    const indexes = new Map<string, DominanceIndex>();
    const frontier: SuffixFrontierState[] = [];
    for (const state of states) {
      const groupKey = this.#dominanceGroupKey(state.attributes);
      let index = indexes.get(groupKey);
      if (index === undefined) {
        index = this.#createDominanceIndex(this.#paretoDimensionCount());
        indexes.set(groupKey, index);
      }
      if (index.accept(this.#buildStaticParetoVector(state.attributes)).accepted) {
        frontier.push(state);
      }
    }
    return frontier;
  }

  #deduplicateSuffixStates(
    states: readonly SuffixFrontierState[],
  ): SuffixFrontierState[] {
    const buckets = new Map<number, SuffixFrontierState[]>();
    const unique: SuffixFrontierState[] = [];
    for (const state of states) {
      let hash = 2166136261;
      for (const value of state.attributes) {
        hash = Math.imul(hash ^ value, 16777619);
      }
      hash >>>= 0;
      const bucket = buckets.get(hash);
      if (bucket !== undefined) {
        let duplicate = false;
        for (const existing of bucket) {
          if (this.#attributesEqual(existing.attributes, state.attributes)) {
            duplicate = true;
            break;
          }
        }
        if (duplicate) continue;
        bucket.push(state);
      } else {
        buckets.set(hash, [state]);
      }
      unique.push(state);
    }
    return unique;
  }

  #buildSuffixFrontierTree(states: SuffixFrontierState[]): SuffixFrontierNode {
    const minimum = new Array<number>(this.attributeCount).fill(
      Number.POSITIVE_INFINITY,
    );
    const maximum = this.#zeroAttributes();
    let attributeSumMaximum = 0;
    for (const state of states) {
      attributeSumMaximum = Math.max(attributeSumMaximum, state.attributeSum);
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
    const slotBounds: UpperBoundSlot[] = [];
    const suffixSlotCount = this.#slots.length - this.#suffixStart;
    for (let suffixOffset = 0; suffixOffset < suffixSlotCount; suffixOffset++) {
      const slotMinimum = new Array<number>(this.attributeCount).fill(
        Number.POSITIVE_INFINITY,
      );
      const slotMaximum = this.#zeroAttributes();
      let attributeSumMaximum = 0;
      for (const state of states) {
        const candidate = state.candidates[suffixOffset];
        if (candidate === undefined) continue;
        attributeSumMaximum = Math.max(
          attributeSumMaximum,
          candidate.attributeSum,
        );
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          slotMinimum[attribute] = Math.min(
            slotMinimum[attribute],
            candidate.attributes[attribute],
          );
          slotMaximum[attribute] = Math.max(
            slotMaximum[attribute],
            candidate.attributes[attribute],
          );
        }
      }
      slotBounds.push({
        minimum: slotMinimum,
        maximum: slotMaximum,
        attributeSumMaximum,
      });
    }
    const leafSize =
      this.options.suffixFrontierLeafSize ??
      (this.#hasConstraints
        ? CONSTRAINED_SUFFIX_FRONTIER_LEAF_SIZE
        : DEFAULT_SUFFIX_FRONTIER_LEAF_SIZE);
    if (states.length <= leafSize) {
      return { minimum, maximum, attributeSumMaximum, slotBounds, states };
    }

    let splitAttribute = 0;
    let largestImpact = Number.NEGATIVE_INFINITY;
    const prefixMaximum = this.#prefixMaximums[this.#suffixStart];
    const relaxedDamage = this.#upperDamageOfSum(
      prefixMaximum,
      maximum,
      this.#suffixSplitFoodPlan!,
      minimum,
      attributeSumMaximum,
      slotBounds,
    );
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      if (maximum[attribute] === minimum[attribute]) continue;
      const resolved = [...maximum];
      resolved[attribute] = minimum[attribute];
      const impact = relaxedDamage - this.#upperDamageOfSum(
        prefixMaximum,
        resolved,
        this.#suffixSplitFoodPlan!,
        minimum,
        attributeSumMaximum,
        slotBounds,
      );
      if (impact > largestImpact) {
        largestImpact = impact;
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
      attributeSumMaximum,
      slotBounds,
      left: this.#buildSuffixFrontierTree(states.slice(0, middle)),
      right: this.#buildSuffixFrontierTree(states.slice(middle)),
    };
  }

  /**
   * Enumerate the prefix once and evaluate all still-live foods together at
   * the suffix.  Each food keeps its own tier classes, duplicate set and
   * dominance index; only the suffix vector loads are shared.
   */
  #searchSharedFoods(
    zeroAttributes: readonly number[],
    inputSlotCount: number,
    foodPlans: readonly FoodPlan[],
  ): void {
    const activePlans: FoodPlan[] = [];
    for (const foodPlan of foodPlans) {
      this.#activeFood = this.#foodLabel(foodPlan);
      const globalUpperDamage = this.#upperDamageOfSum(
        zeroAttributes,
        this.#suffixMaximums[0],
        foodPlan,
        this.#suffixMinimums[0],
        this.#suffixAttributeSumMaximums[0],
        this.#suffixSlotBounds[0],
      );
      if (this.#hasBest() && globalUpperDamage <= this.#bestDamage()) {
        this.#debugLog(
          `[V2搜索] 跳过食物分支：${this.#activeFood}；上界=${globalUpperDamage}；当前最优=${this.#bestDamage()}`,
        );
        continue;
      }
      activePlans.push(foodPlan);
    }
    if (activePlans.length === 0) return;

    const tierClasses = activePlans.map((foodPlan) =>
      this.#buildStateTierClasses(foodPlan),
    );
    const dominanceIndexes = activePlans.map(() =>
      Array.from(
        { length: this.#slots.length + 1 },
        () => new Map<string, DominanceIndex>(),
      ),
    );
    const sharedRawDominance =
      this.options.sharedRawPrefixDominance === true
        ? Array.from(
            { length: this.#suffixStart + 1 },
            () => this.#createDominanceIndex(this.attributeCount),
          )
        : undefined;
    // Exact prefix vectors are food-independent.  Once a vector has been
    // reached, another equipment path with the same vector cannot produce a
    // different suffix total for any food branch, so one shared set is safe.
    const seenPrefixAttributes = Array.from(
      { length: this.#suffixStart + 1 },
      () => new ExactVectorSet(this.attributeCount),
    );
    const collectedPrefixStates: PrefixFrontierState[] = [];
    this.#depthDiagnostics = this.#slots.map((slot, index) => ({
      depth: index + 1,
      candidateCount: slot.candidates.length,
      attemptedCount: 0,
      dominancePassedCount: 0,
      duplicatePrunedCount: 0,
      upperPassedCount: 0,
      upperGapBuckets: new Array(5).fill(0),
    }));
    for (let foodIndex = 0; foodIndex < activePlans.length; foodIndex++) {
      this.#stateTierClasses = tierClasses[foodIndex]!;
      this.#activeFood = this.#foodLabel(activePlans[foodIndex]!);
      this.#logTierCompression();
      const zeroIndex = this.#createDominanceIndex(this.#paretoDimensionCount());
      dominanceIndexes[foodIndex]![0]!.set(
        this.#dominanceGroupKey(zeroAttributes),
        zeroIndex,
      );
      zeroIndex.accept(this.#buildParetoVector(0, zeroAttributes));
      this.#acceptedStateCounts[0]++;
      this.#frontierPeakSizes[0] = Math.max(this.#frontierPeakSizes[0], 1);
    }

    const recurse = (
      slotIndex: number,
      parentAttributes: readonly number[],
      selection: EquipInfo[],
      liveFoods: readonly number[],
    ): void => {
      if (slotIndex === this.#suffixStart) {
        if (this.options.prefixFrontierBatch === true) {
          const attributeSum = parentAttributes.reduce(
            (sum, value) => sum + value,
            0,
          );
          let foodMask = 0;
          for (const foodIndex of liveFoods) foodMask |= 1 << foodIndex;
          collectedPrefixStates.push({
            attributes: [...parentAttributes],
            attributeSum,
            selection: selection.slice(),
            foodMask,
          });
        } else if (
          this.options.shareFoodsMode === "sequential" &&
          this.options.maxCombinedDamageFlat !== undefined
        ) {
          for (const foodIndex of liveFoods) {
            this.#activeFood = this.#foodLabel(activePlans[foodIndex]!);
            this.#stateTierClasses = tierClasses[foodIndex]!;
            this.#searchSuffixFlatBatch(
              parentAttributes,
              selection,
              activePlans[foodIndex]!,
            );
          }
        } else {
          this.#searchSuffixFlatBatchShared(
            parentAttributes,
            selection,
            activePlans,
            liveFoods,
          );
        }
        return;
      }
      const depth = slotIndex + 1;
      const slot = this.#slots[slotIndex]!;
      const diagnostics = this.#depthDiagnostics[slotIndex]!;
      for (const candidate of slot.candidates) {
        const attributes = this.#sum(parentAttributes, candidate.attributes);
        const sharedSeen = seenPrefixAttributes[depth]!;
        if (!sharedSeen.add(attributes)) {
          this.#searchedCount += liveFoods.length;
          this.#statePrunedCounts[depth] += liveFoods.length;
          this.#duplicatePrunedCounts[depth] += liveFoods.length;
          diagnostics.attemptedCount += liveFoods.length;
          diagnostics.duplicatePrunedCount += liveFoods.length;
          this.#maybeLogProgress();
          continue;
        }
        if (sharedRawDominance !== undefined) {
          const dominance = sharedRawDominance[depth]!.accept([...attributes]);
          this.#dominanceComparisonCount += dominance.comparisons;
          this.#dominanceComparisonCounts[depth] += dominance.comparisons;
          if (!dominance.accepted) {
            this.#searchedCount += liveFoods.length;
            this.#statePrunedCounts[depth] += liveFoods.length;
            if (dominance.equal) {
              this.#duplicatePrunedCounts[depth] += liveFoods.length;
              diagnostics.duplicatePrunedCount += liveFoods.length;
            }
            diagnostics.attemptedCount += liveFoods.length;
            this.#maybeLogProgress();
            continue;
          }
        }
        const nextLiveFoods: number[] = [];
        for (const foodIndex of liveFoods) {
          this.#activeFood = this.#foodLabel(activePlans[foodIndex]!);
          this.#activeDepth = depth;
          this.#searchedCount++;
          diagnostics.attemptedCount++;
          this.#maybeLogProgress();
          const foodPlan = activePlans[foodIndex]!;
          if (this.options.prefixUpperBound !== false) {
            const upperDamage = this.#upperDamageOfSum(
              attributes,
              this.#suffixMaximums[depth],
              foodPlan,
              this.#suffixMinimums[depth],
              this.#suffixAttributeSumMaximums[depth],
              this.#suffixSlotBounds[depth],
            );
            diagnostics.upperGapBuckets[this.#upperGapBucket(upperDamage)]++;
            if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
              this.#upperPrunedCounts[depth]++;
              continue;
            }
            diagnostics.upperPassedCount++;
          }
          this.#stateTierClasses = tierClasses[foodIndex]!;
          const paretoVector = this.#buildParetoVector(depth, attributes);
          const groupKey = this.#dominanceGroupKey(attributes);
          let dominanceIndex = dominanceIndexes[foodIndex]![depth]!.get(groupKey);
          if (dominanceIndex === undefined) {
            dominanceIndex = this.#createDominanceIndex(this.#paretoDimensionCount());
            dominanceIndexes[foodIndex]![depth]!.set(groupKey, dominanceIndex);
          }
          const dominance = dominanceIndex.accept(paretoVector);
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
            this.#sumDominanceIndexSizes(dominanceIndexes[foodIndex]![depth]!),
          );
          nextLiveFoods.push(foodIndex);
        }
        if (nextLiveFoods.length === 0) continue;
        selection[slot.inputIndex] = candidate.equipment;
        recurse(depth, attributes, selection, nextLiveFoods);
      }
    };

    recurse(
      0,
      zeroAttributes,
      new Array<EquipInfo>(inputSlotCount),
      activePlans.map((_, index) => index),
    );
    if (this.options.prefixFrontierBatch === true) {
      const states = this.#prunePrefixFrontierStates(collectedPrefixStates);
      this.#debugLog(
        `[V2搜索] 前缀前沿批量：收集=${collectedPrefixStates.length}；前沿=${states.length}`,
      );
      for (let foodIndex = 0; foodIndex < activePlans.length; foodIndex++) {
        const foodPlan = activePlans[foodIndex]!;
        this.#activeFood = this.#foodLabel(foodPlan);
        this.#stateTierClasses = tierClasses[foodIndex]!;
        for (const state of states) {
          if ((state.foodMask & (1 << foodIndex)) === 0) continue;
          this.#searchSuffixFlatBatch(
            state.attributes,
            state.selection,
            foodPlan,
          );
        }
      }
    }
    this.#stateDominanceIndexes = dominanceIndexes[0] ?? [];
    this.#stateTierClasses = tierClasses[0]!;
    this.#logDepthDiagnostics();
  }

  #searchSuffixFlatBatchShared(
    prefixAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlans: readonly FoodPlan[],
    liveFoods: readonly number[],
  ): void {
    const maxEvaluator = this.options.maxCombinedDamageFlatBatch!;
    const flatAttributes = this.#suffixFlatAttributes!;
    const states = this.#suffixFlatStates;
    for (const parentBlock of this.#suffixFlatBlocks) {
      let parentFoods: readonly number[] = liveFoods;
      if (parentBlock.subBlocks !== undefined) {
        const survivingFoods: number[] = [];
        for (const foodIndex of liveFoods) {
          const foodPlan = foodPlans[foodIndex]!;
          this.statistics.suffixBoundChecks++;
          let parentUpper = this.#upperDamageOfSum(
            prefixAttributes,
            parentBlock.maximum,
            foodPlan,
            parentBlock.minimum,
            parentBlock.attributeSumMaximum,
            parentBlock.slotBounds,
          );
          parentUpper = this.#tightenSuffixBlockUpper(
            prefixAttributes,
            parentBlock.maximum,
            foodPlan,
            parentUpper,
          );
          const exactPrefixUpper = parentBlock.foodUpperBounds?.get(foodPlan.key);
          if (exactPrefixUpper !== undefined) {
            parentUpper = Math.min(parentUpper, exactPrefixUpper);
          }
          if (!this.#hasBest() || parentUpper > this.#bestDamage()) {
            survivingFoods.push(foodIndex);
          } else {
            this.statistics.suffixBoundPruned++;
          }
        }
        parentFoods = survivingFoods;
        if (parentFoods.length === 0) continue;
      }
      const scanBlocks = parentBlock.subBlocks ?? [parentBlock];
      for (const block of scanBlocks) {
      if (this.options.shouldAbort?.()) {
        this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
        this.statistics.searched = this.#searchedCount;
        this.statistics.leaves = this.#leafCount;
        this.#abortSearch();
      }
      const blockFoods: number[] = [];
      for (const foodIndex of parentFoods) {
        const foodPlan = foodPlans[foodIndex]!;
        this.statistics.suffixBoundChecks++;
        const exactPrefixUpper = block.foodUpperBounds?.get(foodPlan.key);
        if (this.#hasBest() && exactPrefixUpper !== undefined && exactPrefixUpper <= this.#bestDamage()) {
          this.statistics.suffixBoundPruned++;
          continue;
        }
        let upperDamage = this.#upperDamageOfSum(
          prefixAttributes,
          block.boundMaximum ?? block.maximum,
          foodPlan,
          block.minimum,
          block.attributeSumMaximum,
          block.slotBounds,
        );
        upperDamage = this.#tightenSuffixBlockUpper(
          prefixAttributes,
          block.boundMaximum ?? block.maximum,
          foodPlan,
          upperDamage,
        );
        if (exactPrefixUpper !== undefined) {
          upperDamage = Math.min(upperDamage, exactPrefixUpper);
        }
        if (!this.#hasBest() || upperDamage > this.#bestDamage()) {
          blockFoods.push(foodIndex);
        } else {
          this.statistics.suffixBoundPruned++;
        }
      }
      if (blockFoods.length === 0) continue;
      const results = maxEvaluator(
        prefixAttributes,
        flatAttributes,
        this.attributeCount,
        blockFoods.map((foodIndex) => foodPlans[foodIndex]!.transforms),
        block.start,
        block.end,
        this.#suffixFlatPairIndexes,
      );
      const evaluated = block.end - block.start;
      this.#searchedCount += evaluated * blockFoods.length;
      this.statistics.suffixVectorsEvaluated += evaluated * blockFoods.length;
      this.#leafCount += evaluated * blockFoods.length;
      if (this.options.collectTotalSignatures) {
        for (const foodIndex of blockFoods) {
          const foodPlan = foodPlans[foodIndex]!;
          for (let stateIndex = block.start; stateIndex < block.end; stateIndex++) {
            this.#recordTotalSignatures(prefixAttributes, states[stateIndex]!, foodPlan);
          }
        }
      }
      this.#activeDepth = this.#slots.length;
      this.#maybeLogProgress();
      for (let resultIndex = 0; resultIndex < blockFoods.length; resultIndex++) {
        const result = results[resultIndex]!;
        const foodIndex = blockFoods[resultIndex]!;
        if (result.stateIndex < 0 || result.damage <= this.#bestDamage()) continue;
        const state = states[result.stateIndex]!;
        for (let index = 0; index < state.candidates.length; index++) {
          const slot = this.#slots[this.#suffixStart + index]!;
          selection[slot.inputIndex] = state.candidates[index]!.equipment;
        }
        this.#consider(
          result.damage,
          selection,
          foodPlans[foodIndex]!,
          this.#sum(prefixAttributes, state.attributes),
        );
      }
      }
    }
  }

  #prunePrefixFrontierStates(
    states: PrefixFrontierState[],
  ): PrefixFrontierState[] {
    states.sort((first, second) =>
      second.attributeSum - first.attributeSum ||
      this.#compareParetoVectors(second.attributes, first.attributes),
    );
    const index = this.#createDominanceIndex(this.#paretoDimensionCount());
    const frontier: PrefixFrontierState[] = [];
    for (const state of states) {
      const dominance = index.accept(
        this.#buildStaticParetoVector(state.attributes),
      );
      this.#dominanceComparisonCount += dominance.comparisons;
      if (dominance.accepted) frontier.push(state);
    }
    return frontier;
  }

  /**
   * Materialize the raw prefix Pareto frontier before entering the suffix.
   * Prefixes are sorted by total attribute sum at every layer, so a state
   * that can dominate another state is seen first.  With no upper constraints
   * and a monotone evaluator, discarding dominated prefixes is exact for every
   * suffix and every food transform.
   */
  #searchPrefixFrontierBatch(
    zeroAttributes: readonly number[],
    inputSlotCount: number,
    foodPlans: readonly FoodPlan[],
  ): void {
    this.#depthDiagnostics = this.#slots.map((slot, index) => ({
      depth: index + 1,
      candidateCount: slot.candidates.length,
      attemptedCount: 0,
      dominancePassedCount: 0,
      duplicatePrunedCount: 0,
      upperPassedCount: 0,
      upperGapBuckets: new Array(5).fill(0),
    }));
    let frontier: PrefixFrontierState[] = [{
      attributes: [...zeroAttributes],
      attributeSum: 0,
      selection: new Array<EquipInfo>(inputSlotCount),
      foodMask: 0,
    }];
    const dominanceIndexes: Map<string, DominanceIndex>[] = Array.from(
      { length: this.#suffixStart + 1 },
      () => new Map<string, DominanceIndex>(),
    );
    for (let slotIndex = 0; slotIndex < this.#suffixStart; slotIndex++) {
      const slot = this.#slots[slotIndex]!;
      const generated: PrefixFrontierState[] = [];
      const diagnostics = this.#depthDiagnostics[slotIndex]!;
      for (const state of frontier) {
        for (const candidate of slot.candidates) {
          this.#activeDepth = slotIndex + 1;
          this.#searchedCount++;
          diagnostics.attemptedCount++;
          this.#maybeLogProgress();
          const attributes = this.#sum(state.attributes, candidate.attributes);
          const selection = state.selection.slice();
          selection[slot.inputIndex] = candidate.equipment;
          generated.push({
            attributes,
            attributeSum: state.attributeSum + candidate.attributeSum,
            selection,
            foodMask: state.foodMask,
          });
        }
      }
      generated.sort((first, second) =>
        second.attributeSum - first.attributeSum ||
        this.#compareParetoVectors(second.attributes, first.attributes),
      );
      const unique: PrefixFrontierState[] = [];
      const exact = new Map<number, PrefixFrontierState[]>();
      for (const state of generated) {
        const hash = this.#attributeVectorHash(state.attributes);
        const bucket = exact.get(hash);
        let duplicate = false;
        if (bucket !== undefined) {
          for (const existing of bucket) {
            if (this.#attributesEqual(existing.attributes, state.attributes)) {
              duplicate = true;
              break;
            }
          }
        }
        if (duplicate) {
          this.#statePrunedCounts[slotIndex + 1]++;
          this.#duplicatePrunedCounts[slotIndex + 1]++;
          diagnostics.duplicatePrunedCount++;
          continue;
        }
        if (bucket === undefined) exact.set(hash, [state]);
        else bucket.push(state);
        unique.push(state);
      }
      const index = this.#createDominanceIndex(this.#paretoDimensionCount());
      dominanceIndexes[slotIndex + 1]!.set("", index);
      const next: PrefixFrontierState[] = [];
      for (const state of unique) {
        const dominance = index.accept(
          this.#buildStaticParetoVector(state.attributes),
        );
        this.#dominanceComparisonCount += dominance.comparisons;
        this.#dominanceComparisonCounts[slotIndex + 1] += dominance.comparisons;
        if (!dominance.accepted) {
          this.#statePrunedCounts[slotIndex + 1]++;
          if (dominance.equal) this.#duplicatePrunedCounts[slotIndex + 1]++;
          continue;
        }
        next.push(state);
      }
      frontier = next;
      this.#acceptedStateCounts[slotIndex + 1] += frontier.length;
      this.#frontierPeakSizes[slotIndex + 1] = Math.max(
        this.#frontierPeakSizes[slotIndex + 1]!,
        frontier.length,
      );
      this.#debugLog(
        `[V2搜索] 前缀前沿层${slotIndex + 1}：生成=${generated.length}；唯一=${unique.length}；前沿=${frontier.length}`,
      );
      if (frontier.length === 0) return;
    }
    this.#stateDominanceIndexes = dominanceIndexes;
    this.#debugLog(
      `[V2搜索] 前缀前沿批量：槽位=${this.#suffixStart}；状态=${frontier.length}；食物=${foodPlans.length}`,
    );
    for (const foodPlan of foodPlans) {
      this.#activeFood = this.#foodLabel(foodPlan);
      this.#stateTierClasses = this.#buildStateTierClasses(foodPlan);
      for (const state of frontier) {
        this.#searchSuffixFlatBatch(
          state.attributes,
          state.selection,
          foodPlan,
        );
      }
    }
  }

  #searchFood(
    zeroAttributes: number[],
    inputSlotCount: number,
    foodPlan: FoodPlan,
  ): void {
    const zeroParetoVector = this.#buildParetoVector(0, zeroAttributes);
    const zeroIndex = this.#createDominanceIndex(this.#paretoDimensionCount());
    this.#stateDominanceIndexes[0].set(
      this.#dominanceGroupKey(zeroAttributes),
      zeroIndex,
    );
    zeroIndex.accept(zeroParetoVector);
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
      !this.#hasConstraints &&
      this.options.maxCombinedDamageFlat !== undefined &&
      this.options.combinedDamageFlatFunction !== undefined &&
      this.options.suffixFlatScan !== false &&
      this.#suffixFlatAttributes !== undefined &&
      this.#suffixFlatStates.length > 0
    ) {
      this.#searchSuffixFlatBatch(parentAttributes, selection, foodPlan);
      return;
    }
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
    if (
      slotIndex === this.#suffixStart &&
      this.#suffixFrontierGroups.length > 0
    ) {
      this.#searchSuffixGroups(parentAttributes, selection, foodPlan);
      return;
    }

    const depth = slotIndex + 1;
    const slot = this.#slots[slotIndex];
    const diagnostics = this.#depthDiagnostics[slotIndex];

    for (const candidate of slot.candidates) {
      this.#activeDepth = depth;
      this.#searchedCount++;
      diagnostics.attemptedCount++;
      this.#maybeLogProgress();

      const attributes = this.#sum(parentAttributes, candidate.attributes);
      if (depth <= this.#suffixStart) {
        const seen = this.#seenPrefixAttributes[depth];
        if (!seen.add(attributes)) {
          this.#statePrunedCounts[depth]++;
          this.#duplicatePrunedCounts[depth]++;
          diagnostics.duplicatePrunedCount++;
          continue;
        }
      }
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
      let upperDamage = Number.POSITIVE_INFINITY;
      if (this.options.prefixUpperBound !== false) {
        upperDamage = this.#upperDamageOfSum(
          attributes,
          this.#suffixMaximums[depth],
          foodPlan,
          this.#suffixMinimums[depth],
          this.#suffixAttributeSumMaximums[depth],
          this.#suffixSlotBounds[depth],
        );
      if (
        this.options.prefixSuffixBlockUpperBound === true &&
        this.#suffixFlatBlocks.length > 0
      ) {
          upperDamage = Math.min(
            upperDamage,
            this.#maxSuffixBlockUpperBound(attributes, foodPlan),
          );
        }
        if (
          this.options.suffixPrefixGridUpperBound === true &&
          !this.#hasConstraints
        ) {
          const gridCell = this.#suffixPrefixGridCellIndex(attributes);
          const gridUpper = this.#suffixPrefixGridCellUpperByFood
            .get(foodPlan.key)?.[gridCell];
          if (gridUpper !== undefined) upperDamage = Math.min(upperDamage, gridUpper);
        }
        diagnostics.upperGapBuckets[this.#upperGapBucket(upperDamage)]++;
        if (this.#best !== undefined && upperDamage <= this.#best.damage) {
          this.#upperPrunedCounts[depth]++;
          continue;
        }
        diagnostics.upperPassedCount++;
      }

      selection[slot.inputIndex] = candidate.equipment;
      if (depth === this.#slots.length) {
        diagnostics.dominancePassedCount++;
        this.#acceptedStateCounts[depth]++;
        this.#leafCount++;
        // The recursive upper bound is admissible but not an exact leaf score.
        // Always evaluate the completed loadout before updating the incumbent.
        const leafDamage = this.#damageWithFood(attributes, foodPlan);
        this.#consider(leafDamage, selection, foodPlan, attributes);
      } else if (depth === this.#suffixStart && this.#suffixStart === this.#slots.length - 1) {
        // With a one-slot suffix, querying its tiny frontier is cheaper than
        // building the large boundary dominance index. Skipping this optional
        // pruning cannot remove a feasible loadout.
        diagnostics.dominancePassedCount++;
        this.#acceptedStateCounts[depth]++;
        this.#frontierPeakSizes[depth] = Math.max(
          this.#frontierPeakSizes[depth],
        );
        this.#searchDepth(depth, attributes, selection, foodPlan);
      } else {
        const paretoVector = this.#buildParetoVector(depth, attributes);
        const groupKey = this.#dominanceGroupKey(attributes);
        let dominanceIndex = this.#stateDominanceIndexes[depth].get(groupKey);
        if (dominanceIndex === undefined) {
          dominanceIndex = this.#createDominanceIndex(this.#paretoDimensionCount());
          this.#stateDominanceIndexes[depth].set(groupKey, dominanceIndex);
        }
        const dominance = dominanceIndex.accept(paretoVector);
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
          this.#sumDominanceIndexSizes(this.#stateDominanceIndexes[depth]),
        );
        this.#searchDepth(depth, attributes, selection, foodPlan);
      }
    }
  }

  #searchSuffixFlatSumNecessary(
    prefixAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlan: FoodPlan,
  ): void {
    const states = this.#suffixFlatStates;
    const evaluator = this.options.maxCombinedDamageFlat!;
    const combined = this.options.combinedDamageFunction!;
    const orderedBlocks = this.#suffixBlocksForFood(foodPlan);
    const probe = this.#necessarySuffixAttributes;

    for (const block of orderedBlocks) {
      const views = block.attributeViews;
      if (views === undefined || views.length !== this.attributeCount) continue;
      this.statistics.suffixBoundChecks++;
      const blockMaximum = block.boundMaximum ?? block.maximum;
      let upperDamage = this.#upperDamageOfSum(
        prefixAttributes,
        blockMaximum,
        foodPlan,
        block.minimum,
        block.attributeSumMaximum,
        block.slotBounds,
      );
      upperDamage = this.#tightenSuffixBlockUpper(
        prefixAttributes,
        blockMaximum,
        foodPlan,
        upperDamage,
      );
      if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
        this.statistics.suffixBoundPruned++;
        continue;
      }

      // For a sorted prefix of one attribute, its component-wise maxima are
      // an admissible upper vector for every state in that prefix.  The
      // maxima are monotone as the prefix grows, so the number of states that
      // can be discarded is found with a binary search and no state loop.
      let selectedView: SuffixFlatAttributeView | undefined;
      let selectedStart = 0;
      const pivotAttributes = this.#greedyPriorityIndexes.length === 0
        ? [0]
        : this.#greedyPriorityIndexes.slice(
            0,
            this.#greedyPriorityIndexes.length,
          );
      for (const attribute of pivotAttributes) {
        const view = views[attribute]!;
        let low = 0;
        let high = view.stateIndexes.length;
        while (low < high) {
          const middle = Math.trunc((low + high + 1) / 2);
          if (middle === 0) {
            low = middle;
            continue;
          }
          const prefixOffset = middle * this.attributeCount;
          for (let other = 0; other < this.attributeCount; other++) {
            probe[other] = view.prefixMaximums[prefixOffset + other]!;
          }
          const score = combined(prefixAttributes, probe, foodPlan.transforms);
          if (score <= this.#bestDamage()) low = middle;
          else high = middle - 1;
        }
        if (low > selectedStart || selectedView === undefined) {
          selectedStart = low;
          selectedView = view;
        }
      }

      if (selectedView === undefined) continue;
      const start = selectedStart;
      const end = selectedView.stateIndexes.length;
      this.statistics.suffixNecessaryBoundChecks++;
      this.statistics.suffixNecessaryBoundSkipped += start;
      if (start >= end) continue;
      const columnsEvaluator = this.options.maxCombinedDamageFlatColumnsFunction;
      const result = columnsEvaluator !== undefined
        ? columnsEvaluator(
            prefixAttributes,
            selectedView.columns,
            foodPlan.transforms,
            start,
            end,
            selectedView.pairIndexes,
          )
        : evaluator(
            prefixAttributes,
            selectedView.attributes,
            this.attributeCount,
            foodPlan.transforms,
            start,
            end,
            selectedView.pairIndexes,
          );
      const evaluated = end - start;
      this.#searchedCount += evaluated;
      this.statistics.suffixVectorsEvaluated += evaluated;
      this.#leafCount += evaluated;
      this.#maybeLogProgress();
      if (
        result.stateIndex < 0 ||
        result.damage <= this.#bestDamage()
      ) continue;
      const stateIndex = selectedView.stateIndexes[result.stateIndex]!;
      const state = states[stateIndex]!;
      for (let index = 0; index < state.candidates.length; index++) {
        const slot = this.#slots[this.#suffixStart + index]!;
        selection[slot.inputIndex] = state.candidates[index]!.equipment;
      }
      this.#consider(
        result.damage,
        selection,
        foodPlan,
        this.#sum(prefixAttributes, state.attributes),
      );
    }
  }


  #searchSuffixFlatBatch(
    prefixAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlan: FoodPlan,
  ): void {
    const maxEvaluator = this.options.maxCombinedDamageFlat!;
    const flatAttributes = this.#suffixFlatAttributes!;
    const foodFlatAttributes =
      this.#suffixFlatAttributesByFood.get(foodPlan.key) ?? flatAttributes;
    const foodStateOrder = this.#suffixFlatStateOrdersByFood.get(foodPlan.key);
    const foodFlatHashes = this.#suffixFlatHashesByFood.get(foodPlan.key);
    const foodPairIndexes =
      this.#suffixFlatPairIndexesByFood.get(foodPlan.key) ??
      this.#suffixFlatPairIndexes;
    const states = this.#suffixFlatStates;
    const tierLookupKey = this.#suffixPrefixTierLookupKey(prefixAttributes);
    const tierLookupInitialBest = this.#bestDamage();
    let tierLookupBestDamage = Number.NEGATIVE_INFINITY;
    let tierLookupBestStateIndex = -1;
    if (tierLookupKey !== undefined) {
      let foodCache = this.#suffixPrefixTierLookup.get(foodPlan.key);
      if (foodCache === undefined) {
        foodCache = new Map<string, SuffixPrefixTierLookupValue>();
        this.#suffixPrefixTierLookup.set(foodPlan.key, foodCache);
      }
      const cached = foodCache.get(tierLookupKey);
      if (cached !== undefined) {
        this.statistics.suffixPrefixTierLookupHits++;
        if (
          cached.stateIndex >= 0 &&
          cached.damage > this.#bestDamage()
        ) {
          const state = states[cached.stateIndex]!;
          for (let index = 0; index < state.candidates.length; index++) {
            const slot = this.#slots[this.#suffixStart + index]!;
            selection[slot.inputIndex] = state.candidates[index]!.equipment;
          }
          this.#consider(
            cached.damage,
            selection,
            foodPlan,
            this.#sum(prefixAttributes, state.attributes),
          );
        }
        return;
      }
      this.statistics.suffixPrefixTierLookupMisses++;
    }
    if (
      this.options.suffixSumNecessaryBound === true &&
      !this.#hasConstraints &&
      this.attributeCount > 0 &&
      this.options.suffixFlatTree !== true &&
      this.options.combinedDamageFunction !== undefined &&
      this.options.combinedDamageFlatFunction !== undefined &&
      !this.#suffixSumNecessaryDisabled &&
      this.#suffixFlatBlocks.every((block) => block.subBlocks === undefined && block.attributeViews !== undefined)
    ) {
      const skippedBefore = this.statistics.suffixNecessaryBoundSkipped;
      const evaluatedBefore = this.statistics.suffixVectorsEvaluated;
      this.#searchSuffixFlatSumNecessary(prefixAttributes, selection, foodPlan);
      this.#suffixSumNecessaryProbeCalls++;
      if (this.#suffixSumNecessaryProbeCalls <= SUFFIX_SUM_ADAPTIVE_PROBE_CALLS) {
        this.#suffixSumNecessaryProbeSkipped +=
          this.statistics.suffixNecessaryBoundSkipped - skippedBefore;
        this.#suffixSumNecessaryProbeEvaluated +=
          this.statistics.suffixVectorsEvaluated - evaluatedBefore;
      }
      if (this.#suffixSumNecessaryProbeCalls === SUFFIX_SUM_ADAPTIVE_PROBE_CALLS) {
        const total =
          this.#suffixSumNecessaryProbeSkipped +
          this.#suffixSumNecessaryProbeEvaluated;
        if (
          total > 0 &&
          this.#suffixSumNecessaryProbeSkipped / total <
            SUFFIX_SUM_ADAPTIVE_MIN_SKIP_RATE
        ) {
          this.#suffixSumNecessaryDisabled = true;
          this.#debugLog(
            `[V2搜索] 固定和必要界自适应关闭：样本跳过=${this.#suffixSumNecessaryProbeSkipped}/${total}`,
          );
        }
      }
      return;
    }
    const prefixGridBounds =
      this.options.suffixSubblockRefinement === true
        ? undefined
        : this.#suffixPrefixGridBoundsByFood.get(foodPlan.key);
    const stateGridTails =
      this.options.suffixStateUpperBound === true
        ? undefined
        : this.#suffixPrefixGridStateTailsByFood.get(foodPlan.key);
    const prefixGridCell =
      prefixGridBounds === undefined && stateGridTails === undefined
        ? -1
        : this.#suffixPrefixGridCellIndex(prefixAttributes);
    const necessaryRange = this.#necessarySuffixRange(prefixAttributes, foodPlan);
    // A single sorted attribute can skip a large prefix of the suffix array,
    // but intersecting all necessary per-attribute thresholds is stronger.
    // Use the filtered path only when the pivot already removes a substantial
    // part of the array; otherwise the contiguous batch evaluator is faster.
    if (
      necessaryRange !== undefined &&
      (this.options.suffixNecessaryIntersection === true ||
        necessaryRange.start >= Math.trunc(states.length * 0.35))
    ) {
      this.#searchSuffixFlatNecessary(
        prefixAttributes,
        selection,
        foodPlan,
        necessaryRange,
      );
      return;
    }
    if (this.options.suffixFlatTree === true) {
      for (const block of this.#suffixBlocksForFood(foodPlan)) {
        if (block.tree === undefined) continue;
        this.#searchSuffixFlatTree(
          block.tree,
          prefixAttributes,
          selection,
          foodPlan,
        );
      }
      return;
    }
    const subblockStateLimit =
      this.options.suffixSubblockStateLimit ?? SUFFIX_SUBBLOCK_STATE_LIMIT;
    // Singleton refinement is useful for inspecting bound quality, but a
    // per-state callback loses the throughput of the contiguous evaluator.
    // Collapse that diagnostic layout back to parent ranges for the actual
    // exact scan; the parent upper bound remains safe and the evaluator still
    // visits every suffix state exactly once.
    const scanBlocks =
      this.options.suffixSubblockRefinement === true &&
      subblockStateLimit === 1
        ? this.#suffixFlatBlocks
        : (this.#suffixFlatScanBlockOrders.get(foodPlan.key) ??
          this.#suffixFlatScanBlocks);
    const orderedBlocks = this.options.suffixDynamicBlockOrder === true
      ? scanBlocks.map((block) => {
          let upper = this.#upperDamageOfSum(
            prefixAttributes,
            block.boundMaximum ?? block.maximum,
            foodPlan,
            block.minimum,
            block.attributeSumMaximum,
            block.slotBounds,
          );
          upper = this.#tightenSuffixBlockUpper(
            prefixAttributes,
            block.boundMaximum ?? block.maximum,
            foodPlan,
            upper,
          );
          const exactPrefixUpper = block.foodUpperBounds?.get(foodPlan.key);
          if (exactPrefixUpper !== undefined) {
            upper = Math.min(upper, exactPrefixUpper);
          }
          return { block, upper };
        }).sort((first, second) => second.upper - first.upper)
      : undefined;
    const blockCount = orderedBlocks?.length ?? scanBlocks.length;
    let lastParent: SuffixFlatBlock | undefined;
    let parentPruned = false;
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
      const block = orderedBlocks === undefined
        ? scanBlocks[blockIndex]!
        : orderedBlocks[blockIndex]!.block;
      if (this.options.shouldAbort?.()) {
        this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
        this.statistics.searched = this.#searchedCount;
        this.statistics.leaves = this.#leafCount;
        this.#abortSearch();
      }
      if (block.parent === undefined) {
        lastParent = undefined;
        parentPruned = false;
      } else if (block.parent !== lastParent) {
        lastParent = block.parent;
        this.statistics.suffixBoundChecks++;
        const exactPrefixUpper = block.parent.foodUpperBounds?.get(foodPlan.key);
        if (this.#hasBest() && exactPrefixUpper !== undefined && exactPrefixUpper <= this.#bestDamage()) {
          parentPruned = true;
          this.statistics.suffixBoundPruned++;
        } else {
          let parentUpper = this.#upperDamageOfSum(
            prefixAttributes,
            block.parent.maximum,
            foodPlan,
            block.parent.minimum,
            block.parent.attributeSumMaximum,
            block.parent.slotBounds,
          );
          parentUpper = this.#tightenSuffixBlockUpper(
            prefixAttributes,
            block.parent.maximum,
            foodPlan,
            parentUpper,
          );
          if (exactPrefixUpper !== undefined) {
            parentUpper = Math.min(parentUpper, exactPrefixUpper);
          }
          parentPruned = this.#hasBest() && parentUpper <= this.#bestDamage();
          if (parentPruned) this.statistics.suffixBoundPruned++;
        }
      }
      if (parentPruned) continue;
      const prefixGridBlock =
        this.#suffixPrefixGridBlockIndexes.get(block) ?? -1;
      if (
        prefixGridBounds !== undefined &&
        prefixGridCell >= 0 &&
        prefixGridBlock >= 0
      ) {
        this.statistics.suffixBoundChecks++;
        const gridUpper = prefixGridBounds[
          prefixGridCell * this.#suffixPrefixGridBlockCount + prefixGridBlock
        ]!;
        if (this.#hasBest() && gridUpper <= this.#bestDamage()) {
          this.statistics.suffixBoundPruned++;
          continue;
        }
      }
      let evaluationEnd = block.end;
      const stateBounds =
        this.options.suffixStateUpperBound === true
          ? block.stateUpperBoundsByFoodIndex?.[foodPlan.cacheIndex] ??
            block.stateUpperBoundsByFood?.get(foodPlan.key) ??
            (foodPlan.key === this.#suffixSplitFoodPlan?.key
              ? block.stateUpperBounds
              : undefined)
          : undefined;
      if (stateBounds !== undefined && this.#hasBest()) {
        // The first entry is the exact score at the component-wise maximum
        // prefix.  It is a cheap necessary check before the tighter resource
        // allocation bound below.
        this.statistics.suffixBoundChecks++;
        const best = this.#bestDamage();
        if (stateBounds[0]! <= best) {
          this.statistics.suffixBoundPruned++;
          continue;
        }
      }

      this.statistics.suffixBoundChecks++;
      const exactPrefixUpper = block.foodUpperBounds?.get(foodPlan.key);
      if (this.#hasBest() && exactPrefixUpper !== undefined && exactPrefixUpper <= this.#bestDamage()) {
        this.statistics.suffixBoundPruned++;
        continue;
      }
      const precomputedUpper = orderedBlocks?.[blockIndex]?.upper;
      const useDirectSmallBlockUpper =
        precomputedUpper === undefined &&
        this.options.suffixExactBlockUpperBound === true &&
        this.options.combinedDamageFunction !== undefined &&
        block.end - block.start <=
          (this.options.suffixSubblockStateLimit ?? SUFFIX_SUBBLOCK_STATE_LIMIT);
      let upperDamage = precomputedUpper ?? (useDirectSmallBlockUpper
        ? this.options.combinedDamageFunction!(
            prefixAttributes,
            block.boundMaximum ?? block.maximum,
            foodPlan.transforms,
          )
        : this.#upperDamageOfSum(
            prefixAttributes,
            block.boundMaximum ?? block.maximum,
            foodPlan,
            block.minimum,
            block.attributeSumMaximum,
            block.slotBounds,
          ));
      if (precomputedUpper === undefined && !useDirectSmallBlockUpper) {
        upperDamage = this.#tightenSuffixBlockUpper(
          prefixAttributes,
          block.boundMaximum ?? block.maximum,
          foodPlan,
          upperDamage,
        );
        if (exactPrefixUpper !== undefined) upperDamage = Math.min(upperDamage, exactPrefixUpper);
      }
      if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
        this.statistics.suffixBoundPruned++;
        continue;
      }
      if (stateBounds !== undefined && this.#hasBest()) {
        const best = this.#bestDamage();
        let low = 0;
        let high = stateBounds.length;
        while (low < high) {
          const middle = Math.trunc((low + high) / 2);
          if (stateBounds[middle]! > best) low = middle + 1;
          else high = middle;
        }
        evaluationEnd = block.start + low;
        if (evaluationEnd <= block.start) {
          this.statistics.suffixBoundPruned++;
          continue;
        }
      }
      if (
        stateGridTails !== undefined &&
        prefixGridCell >= 0 &&
        this.#hasBest()
      ) {
        this.statistics.suffixBoundChecks++;
        const tailOffset = prefixGridCell * states.length;
        const best = this.#bestDamage();
        let low = block.start;
        let high = block.end;
        while (low < high) {
          const middle = Math.trunc((low + high) / 2);
          if (stateGridTails[tailOffset + middle]! > best) low = middle + 1;
          else high = middle;
        }
        evaluationEnd = Math.min(evaluationEnd, low);
        if (evaluationEnd <= block.start) {
          this.statistics.suffixBoundPruned++;
          continue;
        }
      }
      let result: { damage: number; stateIndex: number };
      const columnsEvaluator = this.options.maxCombinedDamageFlatColumnsFunction;
      const foodColumns =
        this.#suffixFlatColumnsByFood.get(foodPlan.key) ??
        this.#suffixFlatColumns;
      if (
        columnsEvaluator !== undefined &&
        !this.#totalDamageCacheEnabled &&
        foodColumns.length === this.attributeCount
      ) {
        result = columnsEvaluator(
          prefixAttributes,
          foodColumns,
          foodPlan.transforms,
          block.start,
          evaluationEnd,
          foodPairIndexes,
        );
      } else if (this.#totalDamageCacheEnabled) {
        result = { damage: Number.NEGATIVE_INFINITY, stateIndex: -1 };
        const prefixHash = this.#attributeVectorHash(prefixAttributes);
        for (
          let stateIndex = block.start;
          stateIndex < evaluationEnd;
          stateIndex++
        ) {
          const score = this.#cachedFlatSuffixScore(
            prefixAttributes,
            prefixHash,
            foodFlatAttributes,
            stateIndex * this.attributeCount,
            foodFlatHashes?.[stateIndex] ?? this.#suffixFlatHashes?.[stateIndex] ?? 0,
            foodPlan,
          );
          if (score > result.damage) {
            result = { damage: score, stateIndex };
          }
        }
      } else {
        result = maxEvaluator(
          prefixAttributes,
          foodFlatAttributes,
          this.attributeCount,
          foodPlan.transforms,
          block.start,
          evaluationEnd,
          foodPairIndexes,
        );
      }
      const evaluated = evaluationEnd - block.start;
      this.#searchedCount += evaluated;
      this.statistics.suffixVectorsEvaluated += evaluated;
      this.#leafCount += evaluated;
      if (this.options.collectTotalSignatures) {
        for (let stateIndex = block.start; stateIndex < block.end; stateIndex++) {
          this.#recordTotalSignatures(prefixAttributes, states[stateIndex]!, foodPlan);
        }
      }
      this.#maybeLogProgress();
      if (this.options.shouldAbort?.()) {
        this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
        this.statistics.searched = this.#searchedCount;
        this.statistics.leaves = this.#leafCount;
        this.#abortSearch();
      }
      if (tierLookupKey !== undefined && result.stateIndex >= 0) {
        if (result.damage > tierLookupBestDamage) {
          tierLookupBestDamage = result.damage;
          tierLookupBestStateIndex =
            foodStateOrder?.[result.stateIndex] ?? result.stateIndex;
        }
      }
      if (result.stateIndex < 0 || result.damage <= this.#bestDamage()) continue;
      const canonicalStateIndex =
        foodStateOrder?.[result.stateIndex] ?? result.stateIndex;
      const state = states[canonicalStateIndex]!;
      for (let index = 0; index < state.candidates.length; index++) {
        const slot = this.#slots[this.#suffixStart + index];
        selection[slot.inputIndex] = state.candidates[index].equipment;
      }
      this.#consider(
        result.damage,
        selection,
        foodPlan,
        this.#sum(prefixAttributes, state.attributes),
      );
    }
    if (tierLookupKey !== undefined) {
      const foodCache = this.#suffixPrefixTierLookup.get(foodPlan.key)!;
      foodCache.set(tierLookupKey, {
        // If the scan encountered a block whose upper bound was below the
        // incumbent, a later reuse can only be useful when this exact result
        // still beats that incumbent.  A non-improving entry is therefore
        // represented without a state and acts as a proven skip.
        damage: tierLookupBestDamage,
        stateIndex:
          tierLookupBestDamage > tierLookupInitialBest
            ? tierLookupBestStateIndex
            : -1,
      });
      this.statistics.suffixPrefixTierLookupEntries++;
    }
  }

  #searchSuffixFlatNecessary(
    prefixAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlan: FoodPlan,
    necessaryRange: {
      attribute: number;
      start: number;
      starts: readonly number[];
      thresholds: readonly number[];
    },
  ): void {
    const flatAttributes = this.#suffixFlatAttributes!;
    const states = this.#suffixFlatStates;
    const order = this.#suffixFlatAttributeOrders[necessaryRange.attribute]!;
    const ranks = this.#suffixFlatAttributeRanks;
    const thresholds = necessaryRange.thresholds;
    const useIntersection =
      this.options.suffixNecessaryIntersection === true &&
      ranks.length === this.attributeCount &&
      necessaryRange.starts.length === this.attributeCount;
    const evaluator = this.options.combinedDamageFlatFunction!;
    let examined = 0;
    let evaluated = 0;
    let bestDamage = Number.NEGATIVE_INFINITY;
    let bestStateIndex = -1;
    for (let sortedIndex = necessaryRange.start; sortedIndex < order.length; sortedIndex++) {
      const stateIndex = order[sortedIndex]!;
      const offset = stateIndex * this.attributeCount;
      let possible = true;
      if (useIntersection) {
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          if (ranks[attribute]![stateIndex]! < necessaryRange.starts[attribute]!) {
            possible = false;
            break;
          }
        }
      } else {
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          if (flatAttributes[offset + attribute]! < thresholds[attribute]!) {
            possible = false;
            break;
          }
        }
      }
      examined++;
      this.#searchedCount++;
      if (!possible) {
        this.statistics.suffixNecessaryBoundSkipped++;
      } else {
        const damage = evaluator(
          prefixAttributes,
          flatAttributes,
          offset,
          foodPlan.transforms,
        );
        evaluated++;
        if (damage > bestDamage) {
          bestDamage = damage;
          bestStateIndex = stateIndex;
        }
      }
      if ((examined & 4095) === 0) this.#maybeLogProgress();
    }
    this.statistics.suffixNecessaryBoundSkipped += necessaryRange.start;
    this.statistics.suffixVectorsEvaluated += evaluated;
    this.#leafCount += evaluated;
    this.#maybeLogProgress();
    if (bestStateIndex < 0 || bestDamage <= this.#bestDamage()) return;
    const state = states[bestStateIndex]!;
    for (let index = 0; index < state.candidates.length; index++) {
      const slot = this.#slots[this.#suffixStart + index]!;
      selection[slot.inputIndex] = state.candidates[index]!.equipment;
    }
    this.#consider(
      bestDamage,
      selection,
      foodPlan,
      this.#sum(prefixAttributes, state.attributes),
    );
  }

  #cachedFlatSuffixScore(
    prefixAttributes: readonly number[],
    prefixHash: number,
    suffix: ArrayLike<number>,
    offset: number,
    suffixHash: number,
    foodPlan: FoodPlan,
  ): number {
    const total = this.#upperAttributes;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      total[attribute] =
        (prefixAttributes[attribute] ?? 0) + (suffix[offset + attribute] ?? 0);
    }
    let hash =
      (prefixHash + suffixHash + Math.imul(foodPlan.cacheIndex, TOTAL_HASH_FOOD)) >>>
      0;
    let cacheAttributes: readonly number[] = total;
    if (this.options.suffixTotalDamageTierCache === true) {
      const lookups = this.#totalDamageCacheKeyLookups.get(foodPlan.key);
      if (lookups !== undefined) {
        let canonical = false;
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          const lookup = lookups[attribute];
          const value = total[attribute]!;
          if (lookup !== undefined && value >= 0 && value < lookup.length) {
            this.#foodAttributes[attribute] = lookup[value]!;
            canonical = true;
          } else {
            this.#foodAttributes[attribute] = value;
          }
        }
        if (canonical) {
          cacheAttributes = this.#foodAttributes;
          hash =
            (this.#attributeVectorHash(cacheAttributes) +
              Math.imul(foodPlan.cacheIndex, TOTAL_HASH_FOOD)) >>> 0;
        }
      }
    }
    const cached = this.totalDamageCache.get(
      cacheAttributes,
      foodPlan.cacheIndex,
      hash,
    );
    if (cached !== undefined) {
      this.statistics.totalDamageCacheHits++;
      return cached;
    }
    this.statistics.totalDamageCacheMisses++;
    const score = this.options.combinedDamageFlatFunction!(
      prefixAttributes,
      suffix,
      offset,
      foodPlan.transforms,
    );
    this.totalDamageCache.set(
      cacheAttributes,
      foodPlan.cacheIndex,
      score,
      hash,
    );
    return score;
  }

  #attributeVectorHash(attributes: readonly number[]): number {
    let hash = 0;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const coefficient =
        (TOTAL_HASH_ATTRIBUTE + Math.imul(attribute, TOTAL_HASH_ATTRIBUTE_STEP)) |
        0;
      hash = (hash + Math.imul(coefficient, attributes[attribute] ?? 0)) >>> 0;
    }
    return hash;
  }

  #searchSuffixFlatTree(
    node: SuffixFlatTreeNode,
    prefixAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlan: FoodPlan,
    knownUpperDamage?: number,
  ): void {
    if (this.options.shouldAbort?.()) {
      this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
      this.statistics.searched = this.#searchedCount;
      this.statistics.leaves = this.#leafCount;
      this.#abortSearch();
    }
    this.statistics.suffixBoundChecks++;
    const upperDamage = knownUpperDamage ?? this.#tightenSuffixBlockUpper(
      prefixAttributes,
      node.boundMaximum ?? node.maximum,
      foodPlan,
      this.#upperDamageOfSum(
        prefixAttributes,
        node.boundMaximum ?? node.maximum,
        foodPlan,
        node.minimum,
        node.attributeSumMaximum,
      ),
    );
    if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
      this.statistics.suffixBoundPruned++;
      return;
    }
    if (node.left === undefined || node.right === undefined) {
      const maxEvaluator = this.options.maxCombinedDamageFlat!;
      const result = maxEvaluator(
        prefixAttributes,
        this.#suffixKdAttributes ?? this.#suffixFlatAttributes!,
        this.attributeCount,
        foodPlan.transforms,
        node.start,
        node.end,
      );
      const evaluated = node.end - node.start;
      this.#searchedCount += evaluated;
      this.statistics.suffixVectorsEvaluated += evaluated;
      this.#leafCount += evaluated;
      if (this.options.collectTotalSignatures) {
        for (let stateIndex = node.start; stateIndex < node.end; stateIndex++) {
          this.#recordTotalSignatures(
            prefixAttributes,
            this.#suffixFlatStates[
              this.#suffixKdStateOrder?.[stateIndex] ?? stateIndex
            ]!,
            foodPlan,
          );
        }
      }
      this.#activeDepth = this.#slots.length;
      this.#maybeLogProgress();
      if (result.stateIndex < 0 || result.damage <= this.#bestDamage()) return;
      const state = this.#suffixFlatStates[
        this.#suffixKdStateOrder?.[result.stateIndex] ?? result.stateIndex
      ]!;
      for (let index = 0; index < state.candidates.length; index++) {
        const slot = this.#slots[this.#suffixStart + index]!;
        selection[slot.inputIndex] = state.candidates[index]!.equipment;
      }
      this.#consider(
        result.damage,
        selection,
        foodPlan,
        this.#sum(prefixAttributes, state.attributes),
      );
      return;
    }
    const left = node.left;
    const right = node.right;
    const leftUpper = this.#tightenSuffixBlockUpper(
      prefixAttributes,
      left.boundMaximum ?? left.maximum,
      foodPlan,
      this.#upperDamageOfSum(
        prefixAttributes,
        left.boundMaximum ?? left.maximum,
        foodPlan,
        left.minimum,
        left.attributeSumMaximum,
      ),
    );
    const rightUpper = this.#tightenSuffixBlockUpper(
      prefixAttributes,
      right.boundMaximum ?? right.maximum,
      foodPlan,
      this.#upperDamageOfSum(
        prefixAttributes,
        right.boundMaximum ?? right.maximum,
        foodPlan,
        right.minimum,
        right.attributeSumMaximum,
      ),
    );
    if (leftUpper >= rightUpper) {
      this.#searchSuffixFlatTree(left, prefixAttributes, selection, foodPlan, leftUpper);
      this.#searchSuffixFlatTree(right, prefixAttributes, selection, foodPlan, rightUpper);
    } else {
      this.#searchSuffixFlatTree(right, prefixAttributes, selection, foodPlan, rightUpper);
      this.#searchSuffixFlatTree(left, prefixAttributes, selection, foodPlan, leftUpper);
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
      this.#upperDamageOfSum(
        prefixAttributes,
        node.maximum,
        foodPlan,
        node.minimum,
        node.attributeSumMaximum,
        node.slotBounds,
      );
    if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
      this.statistics.suffixBoundPruned++;
      return;
    }
    if (node === this.#suffixFrontierRoot && this.#suffixRootGroups.length > 1) {
      let canImprove = false;
      for (const groupMaximum of this.#suffixRootGroups) {
        this.statistics.suffixBoundChecks++;
        if (this.#upperDamageOfSum(prefixAttributes, groupMaximum, foodPlan) > this.#bestDamage()) {
          canImprove = true;
          break;
        }
      }
      if (!canImprove) {
        this.statistics.suffixBoundPruned++;
        return;
      }
    }

    if (node.states !== undefined) {
      for (const state of node.states) {
        this.#activeDepth = this.#slots.length;
        this.#searchedCount++;
        this.statistics.suffixVectorsEvaluated++;
        this.#maybeLogProgress();
        if (this.options.collectTotalSignatures) {
          this.#recordTotalSignatures(prefixAttributes, state, foodPlan);
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

    const left = node.left!;
    const right = node.right!;
    const leftUpper = this.#upperDamageOfSum(
      prefixAttributes,
      left.maximum,
      foodPlan,
      left.minimum,
      left.attributeSumMaximum,
      left.slotBounds,
    );
    const rightUpper = this.#upperDamageOfSum(
      prefixAttributes,
      right.maximum,
      foodPlan,
      right.minimum,
      right.attributeSumMaximum,
      right.slotBounds,
    );
    if (leftUpper >= rightUpper) {
      this.#searchSuffixFrontier(
        left,
        prefixAttributes,
        selection,
        foodPlan,
        leftUpper,
      );
      this.#searchSuffixFrontier(
        right,
        prefixAttributes,
        selection,
        foodPlan,
        rightUpper,
      );
    } else {
      this.#searchSuffixFrontier(
        right,
        prefixAttributes,
        selection,
        foodPlan,
        rightUpper,
      );
      this.#searchSuffixFrontier(
        left,
        prefixAttributes,
        selection,
        foodPlan,
        leftUpper,
      );
    }
  }

  #recordTotalSignatures(
    prefixAttributes: readonly number[],
    state: SuffixFrontierState,
    foodPlan: FoodPlan,
  ): void {
    const total = this.#sum(prefixAttributes, state.attributes);
    const vectorSet = this.#totalVectorSignatures;
    const tierSet = this.#tierSignatures;
    if (vectorSet !== undefined) {
      this.statistics.suffixTotalVectorSamples++;
      if (vectorSet.size < TOTAL_SIGNATURE_LIMIT) {
        const signature = this.#totalSignatureScratch;
        signature[0] = foodPlan.cacheIndex;
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          signature[attribute + 1] = total[attribute] ?? 0;
        }
        vectorSet.add(signature);
        this.statistics.suffixTotalVectorUnique = vectorSet.size;
      } else {
        this.statistics.suffixSignatureSaturated = true;
      }
    }
    if (tierSet === undefined) return;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      this.#foodAttributes[attribute] = total[attribute]!;
    }
    this.#applyFoodInPlace(this.#foodAttributes, foodPlan.transforms);
    const tiers = this.#tierSignatureScratch;
    tiers[0] = foodPlan.cacheIndex;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const projector = this.#tierProjectors[attribute];
      tiers[attribute + 1] = projector === undefined
        ? this.#foodAttributes[attribute]!
        : projector(this.#foodAttributes[attribute]!);
    }
    this.statistics.suffixTierSignatureSamples++;
    if (tierSet.size < TOTAL_SIGNATURE_LIMIT) {
      tierSet.add(tiers);
      this.statistics.suffixTierSignatureUnique = tierSet.size;
    } else {
      this.statistics.suffixSignatureSaturated = true;
    }
  }

  #buildParetoVector(depth: number, attributes: readonly number[]): number[] {
    const vector = this.#paretoScratch;
    vector.length = this.attributeCount;
    let vectorLength = 0;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      if (
        this.#hasUpperConstraint(attribute) ||
        this.#dominanceExcludedIndexes.has(attribute)
      ) continue;
      const value = attributes[attribute]!;
      const tierClasses = this.#stateTierClasses[depth][attribute];
      if (tierClasses === undefined) {
        vector[vectorLength++] = value;
      } else {
        if (
          !Number.isInteger(value) ||
          value < 0 ||
          value >= tierClasses.length
        ) {
          throw new RangeError("阈值 Pareto 状态属性超出预计算范围");
        }
        vector[vectorLength++] = tierClasses[value]!;
      }
    }
    vector.length = vectorLength;
    return vector;
  }

  /**
   * Return the exact future-tier equivalence key for a suffix prefix.  The
   * classes are constructed against every reachable suffix value and food
   * transform, so equal class ids produce the same final tier for every
   * suffix state.  Attributes without a projector (for example weapon
   * damage) remain exact in the key.
   */
  #suffixPrefixTierLookupKey(
    prefixAttributes: readonly number[],
  ): string | undefined {
    if (
      this.options.suffixPrefixTierLookup !== true ||
      this.#hasConstraints ||
      this.#suffixStart <= 0 ||
      this.options.combinedDamageFlatFunction === undefined ||
      this.options.maxCombinedDamageFlat === undefined ||
      this.options.suffixFlatTree === true ||
      this.options.suffixStateUpperBound === true ||
      this.options.suffixSumNecessaryBound === true ||
      this.#stateTierClasses.length <= this.#suffixStart
    ) {
      return undefined;
    }
    const classes = this.#stateTierClasses[this.#suffixStart];
    if (classes === undefined) return undefined;
    const parts = new Array<string>(this.attributeCount);
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      const value = prefixAttributes[attribute] ?? 0;
      const tierClasses = classes[attribute];
      if (tierClasses === undefined) {
        parts[attribute] = String(value);
      } else {
        if (!Number.isInteger(value) || value < 0 || value >= tierClasses.length) {
          throw new RangeError("前缀阈值属性超出后缀复用范围");
        }
        parts[attribute] = String(tierClasses[value]!);
      }
    }
    return parts.join(",");
  }

  #buildStaticParetoVector(attributes: readonly number[]): number[] {
    const vector = this.#staticParetoScratch;
    vector.length = 0;
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      if (
        this.#hasUpperConstraint(attribute) ||
        this.#dominanceExcludedIndexes.has(attribute)
      ) continue;
      vector.push(attributes[attribute]!);
    }
    return vector;
  }

  #paretoDimensionCount(): number {
    return this.attributeCount - this.#dominanceExcludedIndexes.size;
  }

  #dominanceGroupKey(attributes: readonly number[]): string {
    if (this.#dominanceGroupIndexes.length === 0) return "";
    return this.#dominanceGroupIndexes
      .map((attribute) => attributes[attribute]!)
      .join(",");
  }

  #createDominanceIndex(dimensionCount: number): DominanceIndex {
    const compact =
      this.options.compactDominance === true ||
      (this.#dominanceBucketIndexes.length > 0 &&
        this.options.compactDominance !== false);
    return new DominanceIndex(dimensionCount, compact);
  }

  #sumDominanceIndexSizes(
    indexes: ReadonlyMap<string, DominanceIndex>,
  ): number {
    let size = 0;
    for (const index of indexes.values()) size += index.size;
    return size;
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

  #attributesEqual(
    first: readonly number[],
    second: readonly number[],
  ): boolean {
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      if (first[attribute] !== second[attribute]) return false;
    }
    return true;
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
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      this.#foodAttributes[attribute] = attributes[attribute];
    }
    this.#applyFoodInPlace(this.#foodAttributes, foodPlan.transforms);
    return this.damageFunction(this.#foodAttributes);
  }

  #upperDamageOfSum(
    first: readonly number[],
    second: readonly number[],
    foodPlan: FoodPlan,
    secondMinimum?: readonly number[],
    secondAttributeSumMaximum?: number,
    secondSlotBounds?: readonly UpperBoundSlot[],
    useCombinedUpperBound = true,
  ): number {
    if (
      useCombinedUpperBound &&
      this.options.combinedDamageUpperBoundFunction !== undefined &&
      this.#upperConstrainedIndexes.length === 0 &&
      secondMinimum !== undefined &&
      secondAttributeSumMaximum !== undefined
    ) {
      return this.options.combinedDamageUpperBoundFunction(
        first,
        second,
        foodPlan.transforms,
        secondMinimum,
        secondAttributeSumMaximum,
        secondSlotBounds,
      );
    }
    if (
      this.options.combinedDamageFunction !== undefined &&
      this.#upperConstrainedIndexes.length === 0 &&
      secondMinimum === undefined &&
      secondAttributeSumMaximum === undefined
    ) {
      if (!this.#combinedDamageCacheEnabled) {
        return this.options.combinedDamageFunction(
          first,
          second,
          foodPlan.transforms,
        );
      }
      const cached = this.combinedDamageCache.get(
        first,
        second,
        foodPlan.cacheIndex,
      );
      if (cached !== undefined) {
        this.#combinedDamageCacheHitCount++;
        this.#combinedDamageCacheProbeCount++;
        if (
          this.#combinedDamageCacheProbeCount ===
            COMBINED_DAMAGE_CACHE_PROBE_LIMIT &&
          this.#combinedDamageCacheHitCount /
              this.#combinedDamageCacheProbeCount <
            COMBINED_DAMAGE_CACHE_MIN_HIT_RATE
        ) {
          this.#combinedDamageCacheEnabled = false;
          this.combinedDamageCache.clear();
          this.#combinedDamageCacheClearCount++;
        }
        return cached;
      }
      this.#combinedDamageCacheMissCount++;
      this.#combinedDamageCacheProbeCount++;
      const damage = this.options.combinedDamageFunction(
        first,
        second,
        foodPlan.transforms,
      );
      if (this.combinedDamageCache.size >= MAX_COMBINED_DAMAGE_CACHE_ENTRIES) {
        this.combinedDamageCache.clear();
        this.#combinedDamageCacheClearCount++;
      }
      this.combinedDamageCache.set(
        first,
        second,
        foodPlan.cacheIndex,
        damage,
      );
      if (
        this.#combinedDamageCacheProbeCount ===
          COMBINED_DAMAGE_CACHE_PROBE_LIMIT &&
        this.#combinedDamageCacheHitCount /
            this.#combinedDamageCacheProbeCount <
          COMBINED_DAMAGE_CACHE_MIN_HIT_RATE
      ) {
        this.#combinedDamageCacheEnabled = false;
        this.combinedDamageCache.clear();
        this.#combinedDamageCacheClearCount++;
      }
      return damage;
    }
    const attributes = this.#upperAttributes;
    const hasAttributeSumBound =
      secondMinimum !== undefined && secondAttributeSumMaximum !== undefined;
    let spareAttributeSum = 0;
    if (hasAttributeSumBound) {
      let minimumSum = 0;
      for (let index = 0; index < this.attributeCount; index++) {
        minimumSum += secondMinimum![index];
      }
      spareAttributeSum = Math.max(
        0,
        secondAttributeSumMaximum! - minimumSum,
      );
    }
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      let secondValue = second[attribute];
      if (hasAttributeSumBound) {
        secondValue = Math.min(
          secondValue,
          secondMinimum![attribute] + spareAttributeSum,
        );
      }
      attributes[attribute] = first[attribute] + secondValue;
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
    this.#applyFoodInPlace(attributes, foodPlan.transforms);
    return this.damageFunction(attributes);
  }

  #logProgress(stage: string): void {
    if (this.options.debug === false) return;
    const elapsedMs = Math.max(1, Date.now() - this.#searchStartedAt);
    const rateElapsedMs = Math.max(1, Date.now() - this.#lastRateAt);
    const intervalSearched = this.#searchedCount - this.#lastRateSearched;
    const intervalLeaves = this.#leafCount - this.#lastRateLeaves;
    const cacheTotal = this.#damageCacheHitCount + this.#damageCacheMissCount;
    const cacheHitRate =
      cacheTotal === 0
        ? "0.0"
        : ((this.#damageCacheHitCount * 100) / cacheTotal).toFixed(1);
    const elapsedSeconds = elapsedMs / 1000;
    const suffixBoundRate =
      this.statistics.suffixBoundChecks === 0
        ? "0.0"
        : (
            (this.statistics.suffixBoundPruned * 100) /
            this.statistics.suffixBoundChecks
          ).toFixed(1);
    const leafRate =
      elapsedSeconds <= 0
        ? "0"
        : Math.round(this.#leafCount / elapsedSeconds);
    const intervalRate = Math.round((intervalSearched * 1000) / rateElapsedMs);
    const intervalLeafRate = Math.round((intervalLeaves * 1000) / rateElapsedMs);
    const combinedCacheTotal =
      this.#combinedDamageCacheHitCount + this.#combinedDamageCacheMissCount;
    const combinedCacheHitRate =
      combinedCacheTotal === 0
        ? "0.0"
        : (
            (this.#combinedDamageCacheHitCount * 100) /
            combinedCacheTotal
        ).toFixed(1);
    const totalCacheTotal =
      this.statistics.totalDamageCacheHits +
      this.statistics.totalDamageCacheMisses;
    const totalCacheHitRate =
      totalCacheTotal === 0
        ? "0.0"
        : ((this.statistics.totalDamageCacheHits * 100) / totalCacheTotal).toFixed(1);
    this.statistics.totalDamageCacheSize = this.totalDamageCache.size;
    this.#lastRateAt = Date.now();
    this.#lastRateSearched = this.#searchedCount;
    this.#lastRateLeaves = this.#leafCount;
    this.#debugLog(
      `[V2搜索] ${stage}：食物=${this.#activeFood || "预处理"}；搜索=${this.#searchedCount}；状态/向量速率=${Math.round((this.#searchedCount * 1000) / elapsedMs)}/秒(最近=${intervalRate}/秒)；叶子速率=${leafRate}/秒(最近=${intervalLeafRate}/秒)；当前深度=${this.#formatActiveDepth()}；状态通过=${this.#formatDepthCounts(this.#acceptedStateCounts)}；状态剪枝=${this.#formatDepthCounts(this.#statePrunedCounts)}；上界剪枝=${this.#formatDepthCounts(this.#upperPrunedCounts)}；约束剪枝=${this.statistics.constraintPruned}/${this.statistics.suffixConstraintPruned}；后缀=前沿${this.statistics.suffixFrontierSize},界检查${this.statistics.suffixBoundChecks},界剪枝${this.statistics.suffixBoundPruned}(${suffixBoundRate}%),必要界检查${this.statistics.suffixNecessaryBoundChecks},跳过状态${this.statistics.suffixNecessaryBoundSkipped},向量评估${this.statistics.suffixVectorsEvaluated}；支配索引=${this.#stateDominanceIndexes.map((indexes) => this.#sumDominanceIndexSizes(indexes)).join("/")}；索引峰值=${this.#frontierPeakSizes.join("/")}；支配比较=${this.#dominanceComparisonCount}；叶子=${this.#leafCount}；最优=${this.#bestDamage()}(更新${this.#bestUpdateCount})；缓存命中=${cacheHitRate}%(${this.damageCache.size}项,清空${this.#damageCacheClearCount}次)；合并缓存命中=${combinedCacheHitRate}%(${this.combinedDamageCache.size}项,清空${this.#combinedDamageCacheClearCount}次)；总属性缓存命中=${totalCacheHitRate}%(${this.totalDamageCache.size}项)；前缀阈值查找=${this.statistics.suffixPrefixTierLookupHits}/${this.statistics.suffixPrefixTierLookupMisses}命中/${this.statistics.suffixPrefixTierLookupEntries}项；内存=${this.#formatMemoryUsage()}`,
    );
  }

  #searchSuffixGroups(
    prefixAttributes: readonly number[],
    selection: EquipInfo[],
    foodPlan: FoodPlan,
  ): void {
    for (let groupIndex = 0; groupIndex < this.#suffixFrontierGroups.length; groupIndex++) {
      // The groups are ordered by an optimistic score.  Every eighth group,
      // check a component-wise maximum for the entire remaining tail; this is
      // a safe bound and lets a strong incumbent terminate the linear scan.
      if ((groupIndex & 7) === 0) {
        this.statistics.suffixBoundChecks++;
        const remainingMaximum = this.#suffixGroupRemainingMaximums[groupIndex]!;
        const remainingUpper = this.#upperDamageOfSum(
          prefixAttributes,
          remainingMaximum,
          foodPlan,
        );
        if (this.#hasBest() && remainingUpper <= this.#bestDamage()) {
          this.statistics.suffixBoundPruned++;
          break;
        }
      }
      const group = this.#suffixFrontierGroups[groupIndex]!;
      this.statistics.suffixBoundChecks++;
      if (
        !this.#canMeetConstraints(
          prefixAttributes,
          group.minimum,
          group.maximum,
          foodPlan,
        )
      ) {
        this.statistics.suffixConstraintPruned++;
        continue;
      }
      const upperDamage = this.#upperDamageOfSum(
        prefixAttributes,
        group.maximum,
        foodPlan,
        group.minimum,
        group.attributeSumMaximum,
        group.slotBounds,
      );
      if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
        this.statistics.suffixBoundPruned++;
        continue;
      }
      for (let stateIndex = 0; stateIndex < group.states.length; stateIndex++) {
        if (stateIndex > 0) {
          this.statistics.suffixBoundChecks++;
          const remainingUpper = this.#upperDamageOfSum(
            prefixAttributes,
            group.remainingMaximums[stateIndex]!,
            foodPlan,
            group.remainingMinimums[stateIndex]!,
            group.remainingAttributeSumMaximums[stateIndex]!,
            group.slotBounds,
          );
          if (this.#hasBest() && remainingUpper <= this.#bestDamage()) {
            this.statistics.suffixBoundPruned++;
            break;
          }
        }
        const state = group.states[stateIndex]!;
        this.#activeDepth = this.#slots.length;
        this.#searchedCount++;
        this.statistics.suffixVectorsEvaluated++;
        this.#maybeLogProgress();
        if (this.options.collectTotalSignatures) {
          this.#recordTotalSignatures(prefixAttributes, state, foodPlan);
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
        const flatEvaluator = this.options.combinedDamageFlatFunction;
        const damage =
          flatEvaluator !== undefined &&
          this.#suffixFlatAttributes !== undefined &&
          state.flatOffset !== undefined
            ? flatEvaluator(
                prefixAttributes,
                this.#suffixFlatAttributes,
                state.flatOffset,
                foodPlan.transforms,
              )
            : this.#upperDamageOfSum(
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
    }
  }

  #maybeLogProgress(): void {
    if ((this.#searchedCount & 4095) !== 0) return;
    if (
      (this.options.abortAfterSearched !== undefined &&
        this.#searchedCount >= this.options.abortAfterSearched) ||
      this.options.shouldAbort?.()
    ) {
      this.#abortSearch();
    }
    if (this.options.debug === false) return;
    const now = Date.now();
    if (now - this.#lastProgressAt < 1000) return;
    this.#lastProgressAt = now;
    this.#logProgress("搜索中");
  }

  #abortSearch(): never {
    this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
    this.statistics.searched = this.#searchedCount;
    this.statistics.leaves = this.#leafCount;
    this.statistics.totalDamageCacheSize = this.totalDamageCache.size;
    throw new Error("V2 搜索已中断，未完成最优性证明");
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
        const upperPruned = this.#upperPrunedCounts[diagnostics.depth] ?? 0;
        const statePruned =
          diagnostics.upperPassedCount - diagnostics.dominancePassedCount;
        const strictPruned = statePruned - diagnostics.duplicatePrunedCount;
        return `${diagnostics.depth}:尝试=${diagnostics.attemptedCount},Pareto剪枝=${statePruned}(重复=${diagnostics.duplicatePrunedCount},严格=${strictPruned}),上界剪枝=${upperPruned},通过=${diagnostics.upperPassedCount},余量=${diagnostics.upperGapBuckets.join("/")},剩余不相容=${this.#formatSuffixUpperCompatibility(diagnostics.depth)}`;
      });
    this.#debugLog(
      `[V2搜索] 分层诊断：食物=${this.#activeFood}；余量顺序=[≤0/≤0.01%/≤0.1%/≤1%/>1%]；${rows.join("；")}；后缀Pareto=槽位${this.statistics.suffixSlotCount},原始${this.statistics.suffixRawCombinations},前沿${this.statistics.suffixFrontierSize},界检查${this.statistics.suffixBoundChecks},界剪枝${this.statistics.suffixBoundPruned},向量评估${this.statistics.suffixVectorsEvaluated}`,
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
      `[V2搜索] 逐属性上界：槽位(输入序号:单件能否同时达到各维最大值/最大向量属性和超额)=${slots.join(",")}`,
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
      const perAttribute: number[] = [];
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        const table = tables[attribute];
        if (table === undefined) {
          perAttribute.push(1);
          continue;
        }
        rawValues += table.length;
        const classes = table[table.length - 1] + 1;
        tierClasses += classes;
        perAttribute.push(classes);
        suffixValues += this.#suffixReachableValues[depth][attribute]!.length;
      }
      const product = perAttribute.reduce(
        (value, count) => value * BigInt(Math.max(1, count)),
        1n,
      );
      return `${depth}:${rawValues}->${tierClasses}/后缀${suffixValues}/组合=${product.toString()}(${perAttribute.join("x")})`;
    });
    this.#debugLog(
      `[V2搜索] 阈值压缩：食物=${this.#activeFood}；深度(原始整数值数之和->未来等价类数之和/后缀可达值数之和)=${byDepth.join(",")}`,
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
      label === undefined
        ? message
        : message.replace(/^\[V2搜索\]/, `[${label}]`),
    );
  }

  #applyFoodInPlace(
    attributes: number[],
    transforms: readonly FoodTransform[],
  ): void {
    for (const transform of transforms) {
      const bonus = Math.min(
        transform.maxValue,
        Math.trunc(attributes[transform.attribute] * transform.rate + 1e-7),
      );
      attributes[transform.attribute] += bonus;
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
    if (!this.#hasConstraints) return true;
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
    if (!this.#hasConstraints) return true;
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
    if (!this.#hasConstraints) return 0;
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
