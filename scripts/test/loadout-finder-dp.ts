import {
  DominanceIndex,
  type AttributeTierProjector,
  type LoadoutFinderV1Options,
  type LoadoutV1Result,
} from "./loadout-finder-v1.ts";
import type { EquipInfo, FoodInfo, FoodParam, ParamInfo } from "./types.ts";

const MAX_DAMAGE_CACHE_ENTRIES = 500_000;

type Candidate = {
  equipment: EquipInfo;
  attributes: number[];
  attributeSum: number;
};

type SlotState = {
  inputIndex: number;
  originalCandidateCount: number;
  candidates: Candidate[];
  maximum: number[];
};

type FoodPlan = {
  food: FoodInfo | undefined;
  key: string;
};

type DpState = {
  attributes: number[];
  paretoVector: number[];
  pathCode: bigint;
};

export type LoadoutDpDepthStatistics = {
  transitions: number;
  equivalentMerged: number;
  upperPruned: number;
  paretoPruned: number;
  frontierPeak: number;
};

export type LoadoutDpStatistics = {
  elapsedMs: number;
  transitions: number;
  equivalentMerged: number;
  upperPruned: number;
  paretoPruned: number;
  peakGeneratedStates: number;
  peakFrontierStates: number;
  peakHeapUsedMiB: number;
  peakRssMiB: number;
  completedFoodBranches: number;
  skippedFoodBranches: number;
  depths: LoadoutDpDepthStatistics[];
};

/**
 * Layered dynamic programming variant of V1. States with the same future-safe
 * tier vector are merged while a layer is generated. The complete layer is
 * then Pareto-pruned before any state in it is expanded.
 */
export class LoadoutFinderDp {
  readonly damageFunction: (attributes: readonly number[]) => number;
  readonly attributeCount: number;
  readonly options: LoadoutFinderV1Options;
  readonly damageCache = new Map<string, number>();
  statistics: LoadoutDpStatistics;

  #attributeIds: number[] = [];
  #attributeIndex = new Map<number, number>();
  #greedyPriorityIndexes: number[] = [];
  #tierProjectors: (AttributeTierProjector | undefined)[] = [];
  #slots: SlotState[] = [];
  #suffixMaximums: number[][] = [];
  #prefixMaximums: number[][] = [];
  #suffixReachableValues: (number[] | undefined)[][] = [];
  #stateTierClasses: (Int32Array | undefined)[][] = [];
  #best: LoadoutV1Result | undefined;
  #searchStartedAt = 0;
  #activeFood = "";
  #activeDepth = 0;
  #activeParentStates = 0;
  #activeGeneratedStates = 0;
  #activeFrontierStates = 0;
  #damageCacheHitCount = 0;
  #damageCacheMissCount = 0;
  #damageCacheClearCount = 0;

  constructor(
    damageFunction: (attributes: readonly number[]) => number,
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
    this.options = Array.isArray(options)
      ? { attributeIds: [...(options as readonly number[])] }
      : (options as LoadoutFinderV1Options);
    if (
      this.options.attributeIds !== undefined &&
      this.options.attributeIds.length !== attributeCount
    ) {
      throw new RangeError("attributeIds 的长度必须等于 attributeCount");
    }
    if (
      this.options.attributeIds !== undefined &&
      new Set(this.options.attributeIds).size !== attributeCount
    ) {
      throw new RangeError("attributeIds 不能包含重复属性 id");
    }
    this.statistics = this.#emptyStatistics();
  }

  findBest(
    slots: readonly (readonly EquipInfo[])[],
    foods: readonly FoodInfo[],
  ): LoadoutV1Result | undefined {
    this.#reset();
    for (const slot of slots) {
      if (slot.length === 0) return undefined;
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
    this.#tierProjectors = this.#attributeIds.map((attributeId) =>
      this.options.attributeTierProjectors?.get(attributeId),
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
      `[DP] 搜索配置：槽位候选=${this.#slots
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

    foodPlans = this.#createGreedyLowerBound(foodPlans);
    this.#orderSlotsForSearch(foodPlans);
    this.#suffixMaximums = this.#buildSuffixMaximums();
    this.#prefixMaximums = this.#buildPrefixMaximums();
    this.#suffixReachableValues = this.#buildSuffixReachableValues();
    this.statistics.depths = Array.from({ length: this.#slots.length }, () => ({
      transitions: 0,
      equivalentMerged: 0,
      upperPruned: 0,
      paretoPruned: 0,
      frontierPeak: 0,
    }));

    if (this.#slots.length === 0) {
      for (const foodPlan of foodPlans) {
        this.#consider(
          this.#damageWithFood(this.#zeroAttributes(), foodPlan),
          [],
          foodPlan,
        );
      }
      return this.#finish();
    }

    for (const foodPlan of foodPlans) {
      this.#activeFood = this.#foodLabel(foodPlan);
      const globalUpperDamage = this.#damageWithFood(
        this.#suffixMaximums[0],
        foodPlan,
      );
      if (this.#hasBest() && globalUpperDamage <= this.#bestDamage()) {
        this.statistics.skippedFoodBranches++;
        this.#debugLog(
          `[DP] 跳过食物分支：${this.#activeFood}；上界=${globalUpperDamage}；当前最优=${this.#bestDamage()}`,
        );
        continue;
      }

      this.#stateTierClasses = this.#buildStateTierClasses(foodPlan);
      const branchStartedAt = Date.now();
      const transitionsBefore = this.statistics.transitions;
      this.#searchFood(foodPlan);
      this.statistics.completedFoodBranches++;
      this.#debugLog(
        `[DP] 完成食物分支：${this.#activeFood}；耗时=${Date.now() - branchStartedAt}ms；转移=${this.statistics.transitions - transitionsBefore}；当前最优=${this.#bestDamage()}`,
      );
    }

    return this.#finish();
  }

  #reset(): void {
    this.damageCache.clear();
    this.#best = undefined;
    this.#searchStartedAt = Date.now();
    this.#activeFood = "";
    this.#activeDepth = 0;
    this.#activeParentStates = 0;
    this.#activeGeneratedStates = 0;
    this.#activeFrontierStates = 0;
    this.#damageCacheHitCount = 0;
    this.#damageCacheMissCount = 0;
    this.#damageCacheClearCount = 0;
    this.statistics = this.#emptyStatistics();
  }

  #emptyStatistics(): LoadoutDpStatistics {
    return {
      elapsedMs: 0,
      transitions: 0,
      equivalentMerged: 0,
      upperPruned: 0,
      paretoPruned: 0,
      peakGeneratedStates: 0,
      peakFrontierStates: 0,
      peakHeapUsedMiB: 0,
      peakRssMiB: 0,
      completedFoodBranches: 0,
      skippedFoodBranches: 0,
      depths: [],
    };
  }

  #finish(): LoadoutV1Result | undefined {
    this.statistics.elapsedMs = Date.now() - this.#searchStartedAt;
    this.#logProgress("搜索完成");
    return this.#best;
  }

  #searchFood(foodPlan: FoodPlan): void {
    let frontier: DpState[] = [
      {
        attributes: this.#zeroAttributes(),
        paretoVector: this.#zeroAttributes(),
        pathCode: 0n,
      },
    ];

    for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
      const depth = slotIndex + 1;
      const slot = this.#slots[slotIndex];
      const depthStatistics = this.statistics.depths[slotIndex];
      const depthStatisticsBefore = { ...depthStatistics };
      const nextByVector = new Map<string, DpState>();
      const isFinalDepth = depth === this.#slots.length;
      this.#activeDepth = depth;
      this.#activeParentStates = frontier.length;
      this.#activeGeneratedStates = 0;
      this.#activeFrontierStates = 0;

      for (const state of frontier) {
        for (
          let candidateIndex = 0;
          candidateIndex < slot.candidates.length;
          candidateIndex++
        ) {
          const candidate = slot.candidates[candidateIndex];
          this.statistics.transitions++;
          depthStatistics.transitions++;
          if (this.statistics.transitions % 100_000 === 0) {
            this.#activeGeneratedStates = nextByVector.size;
            this.#logProgress("搜索中");
          }

          const attributes = this.#sum(state.attributes, candidate.attributes);
          const paretoVector = this.#buildParetoVector(depth, attributes);
          const vectorKey = paretoVector.join(",");
          if (nextByVector.has(vectorKey)) {
            this.statistics.equivalentMerged++;
            depthStatistics.equivalentMerged++;
            continue;
          }

          const upperAttributes = this.#sum(
            attributes,
            this.#suffixMaximums[depth],
          );
          const upperDamage = this.#damageWithFood(upperAttributes, foodPlan);
          if (this.#hasBest() && upperDamage <= this.#bestDamage()) {
            this.statistics.upperPruned++;
            depthStatistics.upperPruned++;
            continue;
          }

          const pathCode =
            state.pathCode * BigInt(slot.candidates.length) +
            BigInt(candidateIndex);
          if (isFinalDepth) {
            nextByVector.set(vectorKey, {
              attributes,
              paretoVector,
              pathCode,
            });
            this.#consider(
              upperDamage,
              this.#decodeSelection(pathCode, depth),
              foodPlan,
            );
            continue;
          }

          nextByVector.set(vectorKey, {
            attributes,
            paretoVector,
            pathCode,
          });
        }
      }

      const generated = [...nextByVector.values()];
      this.#activeGeneratedStates = generated.length;
      this.statistics.peakGeneratedStates = Math.max(
        this.statistics.peakGeneratedStates,
        generated.length,
      );

      if (isFinalDepth) {
        this.#activeFrontierStates = generated.length;
        depthStatistics.frontierPeak = Math.max(
          depthStatistics.frontierPeak,
          generated.length,
        );
        this.#logDepth(
          depth,
          frontier.length,
          generated.length,
          generated.length,
          this.#depthStatisticsDelta(
            depthStatistics,
            depthStatisticsBefore,
            generated.length,
          ),
        );
        return;
      }

      frontier = this.#paretoPrune(generated, depthStatistics);
      this.#activeFrontierStates = frontier.length;
      depthStatistics.frontierPeak = Math.max(
        depthStatistics.frontierPeak,
        frontier.length,
      );
      this.statistics.peakFrontierStates = Math.max(
        this.statistics.peakFrontierStates,
        frontier.length,
      );
      this.#logDepth(
        depth,
        this.#activeParentStates,
        generated.length,
        frontier.length,
        this.#depthStatisticsDelta(
          depthStatistics,
          depthStatisticsBefore,
          frontier.length,
        ),
      );
      if (frontier.length === 0) return;
    }
  }

  #paretoPrune(
    states: DpState[],
    depthStatistics: LoadoutDpDepthStatistics,
  ): DpState[] {
    states.sort((first, second) =>
      this.#compareParetoVectors(second.paretoVector, first.paretoVector),
    );
    const index = new DominanceIndex(this.attributeCount);
    const retained: DpState[] = [];
    for (const state of states) {
      if (index.accept(state.paretoVector).accepted) {
        retained.push(state);
      } else {
        this.statistics.paretoPruned++;
        depthStatistics.paretoPruned++;
      }
    }
    return retained;
  }

  #decodeSelection(pathCode: bigint, depth: number): EquipInfo[] {
    const selection = new Array<EquipInfo>(this.#slots.length);
    let remaining = pathCode;
    for (let slotIndex = depth - 1; slotIndex >= 0; slotIndex--) {
      const slot = this.#slots[slotIndex];
      const radix = BigInt(slot.candidates.length);
      const candidateIndex = Number(remaining % radix);
      remaining /= radix;
      selection[slot.inputIndex] = slot.candidates[candidateIndex].equipment;
    }
    return selection;
  }

  #depthStatisticsDelta(
    current: LoadoutDpDepthStatistics,
    before: LoadoutDpDepthStatistics,
    frontierPeak: number,
  ): LoadoutDpDepthStatistics {
    return {
      transitions: current.transitions - before.transitions,
      equivalentMerged: current.equivalentMerged - before.equivalentMerged,
      upperPruned: current.upperPruned - before.upperPruned,
      paretoPruned: current.paretoPruned - before.paretoPruned,
      frontierPeak,
    };
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
    return [...ids].sort((first, second) => first - second);
  }

  #buildSlots(slots: readonly (readonly EquipInfo[])[]): SlotState[] {
    const result = slots.map((equipments, inputIndex) => {
      const sortedCandidates: Candidate[] = equipments
        .map((equipment) => {
          const attributes = this.#equipmentAttributes(equipment);
          return {
            equipment,
            attributes,
            attributeSum: attributes.reduce((sum, value) => sum + value, 0),
          };
        })
        .sort((first, second) => {
          if (second.attributeSum !== first.attributeSum) {
            return second.attributeSum - first.attributeSum;
          }
          if (second.equipment.itemLevel !== first.equipment.itemLevel) {
            return second.equipment.itemLevel - first.equipment.itemLevel;
          }
          return second.equipment.itemId - first.equipment.itemId;
        });
      const candidates = this.#pruneCandidates(sortedCandidates).sort(
        (first, second) => this.#compareGreedyCandidates(first, second),
      );
      const maximum = this.#zeroAttributes();
      for (const candidate of candidates) {
        for (let attribute = 0; attribute < this.attributeCount; attribute++) {
          maximum[attribute] = Math.max(
            maximum[attribute],
            candidate.attributes[attribute],
          );
        }
      }
      return {
        inputIndex,
        originalCandidateCount: sortedCandidates.length,
        candidates,
        maximum,
      };
    });
    result.sort(
      (first, second) =>
        first.candidates.length - second.candidates.length ||
        first.inputIndex - second.inputIndex,
    );
    return result;
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
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      if (first[attribute] < second[attribute]) return false;
    }
    return true;
  }

  #compareGreedyCandidates(first: Candidate, second: Candidate): number {
    for (const attribute of this.#greedyPriorityIndexes) {
      const difference =
        second.attributes[attribute] - first.attributes[attribute];
      if (difference !== 0) return difference;
    }
    return (
      second.attributeSum - first.attributeSum ||
      second.equipment.itemLevel - first.equipment.itemLevel ||
      second.equipment.itemId - first.equipment.itemId
    );
  }

  #buildFoodPlans(foods: readonly FoodInfo[]): FoodPlan[] {
    if (foods.length === 0) return [{ food: undefined, key: "no-food" }];
    const retained: FoodInfo[] = [];
    for (const food of foods) {
      if (retained.some((other) => this.#foodNoWeaker(other, food))) continue;
      for (let index = retained.length - 1; index >= 0; index--) {
        if (this.#foodNoWeaker(food, retained[index]))
          retained.splice(index, 1);
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
      if (
        (firstParam?.multiplier ?? 1) < (secondParam?.multiplier ?? 1) ||
        (firstParam?.maxValue ?? 0) < (secondParam?.maxValue ?? 0)
      ) {
        return false;
      }
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
    const firstFoodPlan = orderedFoodPlans[0];
    const selection = new Array<EquipInfo>(this.#slots.length);
    for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
      const slot = this.#slots[slotIndex];
      selection[slot.inputIndex] = selectedCandidates[slotIndex].equipment;
    }
    this.#consider(
      this.#damageWithFood(attributes, firstFoodPlan),
      selection,
      firstFoodPlan,
    );
    this.#debugLog(
      `[DP] 初始贪心解：属性优先级=${this.#greedyPriorityIndexes
        .map((index) => this.#attributeIds[index])
        .join(
          ">",
        )}；食物=${this.#foodLabel(firstFoodPlan)}；伤害=${this.#bestDamage()}`,
    );

    const improvedDamage = new Map<string, number>();
    for (const foodPlan of foodPlans) {
      const candidates = [...selectedCandidates];
      const currentAttributes = this.#zeroAttributes();
      for (const candidate of candidates) {
        this.#add(currentAttributes, candidate.attributes);
      }
      let damage = this.#damageWithFood(currentAttributes, foodPlan);
      let improved = true;
      while (improved) {
        improved = false;
        for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
          const current = candidates[slotIndex];
          this.#subtract(currentAttributes, current.attributes);
          let bestCandidate = current;
          let bestDamage = damage;
          for (const candidate of this.#slots[slotIndex].candidates) {
            this.#add(currentAttributes, candidate.attributes);
            const candidateDamage = this.#damageWithFood(
              currentAttributes,
              foodPlan,
            );
            this.#subtract(currentAttributes, candidate.attributes);
            if (candidateDamage > bestDamage) {
              bestCandidate = candidate;
              bestDamage = candidateDamage;
            }
          }
          candidates[slotIndex] = bestCandidate;
          this.#add(currentAttributes, bestCandidate.attributes);
          if (bestDamage > damage) {
            damage = bestDamage;
            improved = true;
          }
        }
      }
      const improvedSelection = new Array<EquipInfo>(this.#slots.length);
      for (let slotIndex = 0; slotIndex < this.#slots.length; slotIndex++) {
        const slot = this.#slots[slotIndex];
        improvedSelection[slot.inputIndex] = candidates[slotIndex].equipment;
      }
      this.#consider(damage, improvedSelection, foodPlan);
      improvedDamage.set(foodPlan.key, damage);
    }
    this.#debugLog(
      `[DP] 局部改良下界：食物=${this.#best?.food === undefined ? "无食物" : `${this.#best.food.itemId}/${this.#best.food.key}`}；伤害=${this.#bestDamage()}`,
    );

    return [...orderedFoodPlans].sort((first, second) => {
      const priorityDifference = this.#compareFoodPriority(first, second);
      if (priorityDifference !== 0) return priorityDifference;
      return improvedDamage.get(second.key)! - improvedDamage.get(first.key)!;
    });
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
    this.#slots.sort((first, second) => {
      const gapDifference =
        relaxationGap.get(second)! - relaxationGap.get(first)!;
      return (
        gapDifference ||
        first.candidates.length - second.candidates.length ||
        first.inputIndex - second.inputIndex
      );
    });
    this.#debugLog(
      `[DP] 槽位搜索顺序：${this.#slots
        .map(
          (slot) =>
            `${slot.inputIndex}(候选=${slot.candidates.length},上界虚高影响=${relaxationGap.get(slot)!.toFixed(6)})`,
        )
        .join(",")}`,
    );
  }

  #buildSuffixMaximums(): number[][] {
    const result = new Array<number[]>(this.#slots.length + 1);
    result[this.#slots.length] = this.#zeroAttributes();
    for (let depth = this.#slots.length - 1; depth >= 0; depth--) {
      result[depth] = this.#sum(this.#slots[depth].maximum, result[depth + 1]);
    }
    return result;
  }

  #buildPrefixMaximums(): number[][] {
    const result = new Array<number[]>(this.#slots.length + 1);
    result[0] = this.#zeroAttributes();
    for (let depth = 0; depth < this.#slots.length; depth++) {
      result[depth + 1] = this.#sum(result[depth], this.#slots[depth].maximum);
    }
    return result;
  }

  #buildSuffixReachableValues(): (number[] | undefined)[][] {
    const result = Array.from(
      { length: this.#slots.length + 1 },
      () => new Array<number[] | undefined>(this.attributeCount),
    );
    for (let attribute = 0; attribute < this.attributeCount; attribute++) {
      if (this.#tierProjectors[attribute] !== undefined) {
        result[this.#slots.length][attribute] = [0];
      }
    }
    for (let depth = this.#slots.length - 1; depth >= 0; depth--) {
      for (let attribute = 0; attribute < this.attributeCount; attribute++) {
        if (this.#tierProjectors[attribute] === undefined) continue;
        const values = new Set<number>();
        for (const candidate of this.#slots[depth].candidates) {
          const candidateValue = candidate.attributes[attribute];
          if (!Number.isInteger(candidateValue) || candidateValue < 0) {
            throw new RangeError("阈值 DP 属性必须是非负整数");
          }
          for (const suffixValue of result[depth + 1][attribute]!) {
            values.add(candidateValue + suffixValue);
          }
        }
        result[depth][attribute] = [...values].sort(
          (first, second) => first - second,
        );
      }
    }
    return result;
  }

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
          throw new RangeError("阈值 DP 属性总和必须是安全整数");
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

  #buildParetoVector(depth: number, attributes: readonly number[]): number[] {
    return attributes.map((value, attribute) => {
      const classes = this.#stateTierClasses[depth][attribute];
      if (classes === undefined) return value;
      if (!Number.isInteger(value) || value < 0 || value >= classes.length) {
        throw new RangeError("阈值 DP 状态属性超出预计算范围");
      }
      return classes[value];
    });
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

  #equipmentAttributes(equipment: EquipInfo): number[] {
    const attributes = this.#zeroAttributes();
    for (const param of this.#equipmentParams(equipment)) {
      const index = this.#attributeIndex.get(param.baseParamId);
      if (index !== undefined) attributes[index] += param.value;
    }
    return attributes;
  }

  #equipmentParams(equipment: EquipInfo): readonly ParamInfo[] {
    return (
      this.options.equipmentAttributeExtractor?.(equipment) ??
      equipment.baseParams
    );
  }

  #compareFoodPriority(first: FoodPlan, second: FoodPlan): number {
    return this.options.foodPriorityComparator?.(first.food, second.food) ?? 0;
  }

  #consider(damage: number, selection: EquipInfo[], foodPlan: FoodPlan): void {
    if (Number.isNaN(damage)) return;
    if (this.#best !== undefined && damage <= this.#best.damage) return;
    this.#best = {
      damage,
      selection: selection.slice(),
      food: foodPlan.food,
    };
  }

  #damageWithFood(attributes: readonly number[], foodPlan: FoodPlan): number {
    const key = `${foodPlan.key}|${attributes.join(",")}`;
    const cached = this.damageCache.get(key);
    if (cached !== undefined || this.damageCache.has(key)) {
      this.#damageCacheHitCount++;
      return cached!;
    }
    this.#damageCacheMissCount++;
    const damage = this.damageFunction(
      this.#applyFood(attributes, foodPlan.food),
    );
    if (this.damageCache.size >= MAX_DAMAGE_CACHE_ENTRIES) {
      this.damageCache.clear();
      this.#damageCacheClearCount++;
    }
    this.damageCache.set(key, damage);
    return damage;
  }

  #applyFood(
    attributes: readonly number[],
    food: FoodInfo | undefined,
  ): number[] {
    if (food === undefined) return [...attributes];
    const result = [...attributes];
    for (const param of food.baseParams) {
      const attribute = this.#attributeIndex.get(param.baseParamId);
      if (attribute === undefined) continue;
      result[attribute] = this.#applyFoodParam(result[attribute], param);
    }
    return result;
  }

  #applyFoodValue(
    value: number,
    attribute: number,
    food: FoodInfo | undefined,
  ): number {
    const attributeId = this.#attributeIds[attribute];
    const param = food?.baseParams.find(
      (candidate) => candidate.baseParamId === attributeId,
    );
    return param === undefined ? value : this.#applyFoodParam(value, param);
  }

  #applyFoodParam(value: number, param: FoodParam): number {
    return (
      value +
      Math.min(
        param.maxValue,
        Math.trunc(value * (param.multiplier - 1) + 1e-7),
      )
    );
  }

  #zeroAttributes(): number[] {
    return new Array<number>(this.attributeCount).fill(0);
  }

  #sum(first: readonly number[], second: readonly number[]): number[] {
    return first.map((value, index) => value + second[index]);
  }

  #add(target: number[], source: readonly number[]): void {
    for (let index = 0; index < this.attributeCount; index++) {
      target[index] += source[index];
    }
  }

  #subtract(target: number[], source: readonly number[]): void {
    for (let index = 0; index < this.attributeCount; index++) {
      target[index] -= source[index];
    }
  }

  #hasBest(): boolean {
    return this.#best !== undefined;
  }

  #bestDamage(): number {
    return this.#best?.damage ?? Number.NEGATIVE_INFINITY;
  }

  #foodLabel(foodPlan: FoodPlan): string {
    return foodPlan.food === undefined
      ? "无食物"
      : `${foodPlan.food.itemId}/${foodPlan.food.key}`;
  }

  #logDepth(
    depth: number,
    parentStates: number,
    generatedStates: number,
    frontierStates: number,
    statistics: LoadoutDpDepthStatistics,
  ): void {
    this.#debugLog(
      `[DP] 完成深度=${depth}；候选=${this.#slots[depth - 1].candidates.length}；父状态=${parentStates}；转移=${statistics.transitions}；等价合并=${statistics.equivalentMerged}；上界剪枝=${statistics.upperPruned}；生成=${generatedStates}；Pareto剪枝=${statistics.paretoPruned}；前沿=${frontierStates}；内存=${this.#formatMemoryUsage()}`,
    );
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
      `[DP] ${stage}：食物=${this.#activeFood || "预处理"}；转移=${this.statistics.transitions}；速率=${Math.round((this.statistics.transitions * 1000) / elapsedMs)}/秒；当前深度=${this.#activeDepth}(父状态=${this.#activeParentStates},生成=${this.#activeGeneratedStates},前沿=${this.#activeFrontierStates})；等价合并=${this.statistics.equivalentMerged}；上界剪枝=${this.statistics.upperPruned}；Pareto剪枝=${this.statistics.paretoPruned}；峰值=${this.statistics.peakGeneratedStates}/${this.statistics.peakFrontierStates}；最优=${this.#bestDamage()}；缓存命中=${cacheHitRate}%(${this.damageCache.size}项,清空${this.#damageCacheClearCount}次)；内存=${this.#formatMemoryUsage()}`,
    );
  }

  #formatMemoryUsage(): string {
    const { heapUsed, rss } = process.memoryUsage();
    const mib = 1024 * 1024;
    const heapUsedMiB = Math.round(heapUsed / mib);
    const rssMiB = Math.round(rss / mib);
    this.statistics.peakHeapUsedMiB = Math.max(
      this.statistics.peakHeapUsedMiB,
      heapUsedMiB,
    );
    this.statistics.peakRssMiB = Math.max(this.statistics.peakRssMiB, rssMiB);
    return `heap=${heapUsedMiB}MiB,rss=${rssMiB}MiB`;
  }

  #debugLog(message: string): void {
    if (this.options.debug !== false) console.log(message);
  }
}
