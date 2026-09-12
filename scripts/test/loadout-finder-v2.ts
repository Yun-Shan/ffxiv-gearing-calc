import {
  LoadoutFinderV2Search,
  type AttributeRangeConstraint,
  type DamageFunction,
  type LoadoutSearchOptions,
  type LoadoutSearchResult,
  type LoadoutSearchStatistics,
} from "./loadout-finder-v2-search.ts";
import type { EquipInfo, FoodInfo, ParamInfo } from "./types.ts";

export type DamageEvaluation = {
  damage: number;
  gcd: number;
};

export type EvaluationFunction = (
  attributes: readonly number[],
) => DamageEvaluation | undefined;

export type LoadoutV2Constraints = {
  gcd?: number;
  speedMin?: number;
  speedMax?: number;
  toughnessMinPercent?: number;
  toughMin?: number;
  maxToughnessMode?: boolean;
};

export type GcdSpeedRange = {
  min: number;
  max: number;
};

export type LoadoutFinderV2Options = LoadoutSearchOptions & {
  evaluationFunction?: EvaluationFunction;
  speedAttributeId?: number;
  toughnessAttributeId?: number;
  gcdToSpeedRange?: (gcdSeconds: number) => GcdSpeedRange | undefined;
  toughnessPercentToMinimum?: (percentage: number) => number;
};

export type LoadoutV2Result = LoadoutSearchResult & {
  maximumToughness?: number;
};

export type LoadoutV2Statistics = LoadoutSearchStatistics & {
  maximumToughness?: number;
  toughnessPhase?: LoadoutSearchStatistics;
  damagePhase?: LoadoutSearchStatistics;
};

function emptyStatistics(): LoadoutV2Statistics {
  return {
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
}

/**
 * V1 branch-and-bound search with final, food-adjusted speed and toughness
 * constraints. Attribute ids refer to the external BaseParam ids.
 */
export class LoadoutFinderV2 {
  readonly damageFunction: DamageFunction;
  readonly attributeCount: number;
  readonly speedAttributeId: number | undefined;
  readonly toughnessAttributeId: number | undefined;
  readonly gcdToSpeedRange:
    ((gcdSeconds: number) => GcdSpeedRange | undefined) | undefined;
  readonly toughnessPercentToMinimum:
    ((percentage: number) => number) | undefined;
  readonly evaluationFunction: EvaluationFunction | undefined;
  readonly options: LoadoutSearchOptions;
  statistics: LoadoutV2Statistics = emptyStatistics();

  constructor(
    damageFunction: DamageFunction,
    attributeCount: number,
    options: LoadoutFinderV2Options,
  );
  constructor(
    damageFunction: DamageFunction,
    attributeCount: number,
    speedAttributeId?: number,
    toughnessAttributeId?: number,
    options?: LoadoutFinderV2Options,
  );
  constructor(
    damageFunction: DamageFunction,
    attributeCount: number,
    speedOrOptions: number | LoadoutFinderV2Options | undefined = undefined,
    toughnessAttributeId?: number,
    options: LoadoutFinderV2Options = {},
  ) {
    this.damageFunction = damageFunction;
    this.attributeCount = attributeCount;
    if (typeof speedOrOptions === "object") {
      const {
        speedAttributeId,
        toughnessAttributeId: configuredToughnessId,
        gcdToSpeedRange,
        toughnessPercentToMinimum,
        evaluationFunction,
        ...v1Options
      } = speedOrOptions;
      this.speedAttributeId = speedAttributeId;
      this.toughnessAttributeId = configuredToughnessId;
      this.gcdToSpeedRange = gcdToSpeedRange;
      this.toughnessPercentToMinimum = toughnessPercentToMinimum;
      this.evaluationFunction = evaluationFunction;
      this.options = v1Options;
    } else {
      const {
        gcdToSpeedRange,
        toughnessPercentToMinimum,
        speedAttributeId: _speedAttributeId,
        toughnessAttributeId: _toughnessAttributeId,
        evaluationFunction,
        ...v1Options
      } = options;
      this.speedAttributeId = speedOrOptions;
      this.toughnessAttributeId = toughnessAttributeId;
      this.gcdToSpeedRange = gcdToSpeedRange;
      this.toughnessPercentToMinimum = toughnessPercentToMinimum;
      this.evaluationFunction = evaluationFunction;
      this.options = v1Options;
    }
    this.#validateAttributeId(this.speedAttributeId, "速度");
    this.#validateAttributeId(this.toughnessAttributeId, "坚韧");
  }

  findBest(
    slots: readonly (readonly EquipInfo[])[],
    foods: readonly FoodInfo[],
    constraints: LoadoutV2Constraints = {},
  ): LoadoutV2Result | undefined {
    this.#validateConstraints(constraints);
    const ranges = this.#buildRanges(constraints);
    if (ranges === undefined) {
      this.statistics = emptyStatistics();
      return undefined;
    }

    if (constraints.maxToughnessMode !== true) {
      const useDpsObjective = this.#usesDpsObjective(constraints);
      const finder = this.#createDamageFinder("V2", useDpsObjective);
      const result = finder.findBest(slots, foods, ranges);
      this.statistics = {
        ...finder.statistics,
        damagePhase: { ...finder.statistics },
      };
      return this.#restoreActualDamage(result, useDpsObjective);
    }

    const toughnessIndex = this.#attributeIndex(
      this.#requireAttributeId(this.toughnessAttributeId, "最高坚韧模式"),
    );
    const toughnessTierProjectors =
      this.options.attributeTierProjectors === undefined
        ? undefined
        : new Map(
            [...this.options.attributeTierProjectors].filter(
              ([attributeId]) => attributeId !== this.toughnessAttributeId,
            ),
          );
    const toughnessFinder = new LoadoutFinderV2Search(
      (attributes) => attributes[toughnessIndex],
      this.attributeCount,
      {
        ...this.options,
        attributeTierProjectors: toughnessTierProjectors,
        debugLabel: "V2-最高坚韧",
      },
    );
    const toughnessResult = toughnessFinder.findBest(slots, foods, ranges);
    if (toughnessResult === undefined) {
      this.statistics = {
        ...toughnessFinder.statistics,
        toughnessPhase: { ...toughnessFinder.statistics },
      };
      return undefined;
    }

    const maximumToughness = toughnessResult.damage;
    const exactToughnessRanges = ranges.filter(
      (range) => range.attributeId !== this.toughnessAttributeId,
    );
    exactToughnessRanges.push({
      attributeId: this.toughnessAttributeId!,
      min: maximumToughness,
      max: maximumToughness,
    });

    const useDpsObjective = this.#usesDpsObjective(constraints);
    const damageFinder = this.#createDamageFinder("V2", useDpsObjective);
    const result = damageFinder.findBest(slots, foods, exactToughnessRanges);
    this.statistics = this.#combineStatistics(
      toughnessFinder.statistics,
      damageFinder.statistics,
      maximumToughness,
    );
    const actualResult = this.#restoreActualDamage(result, useDpsObjective);
    return actualResult === undefined
      ? undefined
      : { ...actualResult, maximumToughness };
  }

  #createDamageFinder(
    label: string,
    useDpsObjective: boolean,
  ): LoadoutFinderV2Search {
    const searchFunction = useDpsObjective
      ? (attributes: readonly number[]) => this.#damagePerSecond(attributes)
      : this.damageFunction;
    return new LoadoutFinderV2Search(searchFunction, this.attributeCount, {
      ...this.options,
      debugLabel: label,
    });
  }

  #usesDpsObjective(constraints: LoadoutV2Constraints): boolean {
    return constraints.gcd === undefined && this.evaluationFunction !== undefined;
  }

  #damagePerSecond(attributes: readonly number[]): number {
    const evaluation = this.evaluationFunction?.(attributes);
    if (
      evaluation === undefined ||
      !Number.isFinite(evaluation.damage) ||
      !Number.isFinite(evaluation.gcd) ||
      evaluation.gcd <= 0
    ) {
      return Number.NEGATIVE_INFINITY;
    }
    return evaluation.damage / evaluation.gcd;
  }

  #restoreActualDamage(
    result: LoadoutSearchResult | undefined,
    useDpsObjective: boolean,
  ): LoadoutSearchResult | undefined {
    if (result === undefined || !useDpsObjective) return result;
    const attributes = this.#attributesForLoadout(result.selection, result.food);
    return {
      ...result,
      damage: this.damageFunction(attributes),
    };
  }

  #attributesForLoadout(
    selection: readonly EquipInfo[],
    food: FoodInfo | undefined,
  ): number[] {
    const attributeIds = this.#resolveResultAttributeIds(selection, food);
    const attributeIndex = new Map(
      attributeIds.map((attributeId, index) => [attributeId, index]),
    );
    const attributes = new Array<number>(this.attributeCount).fill(0);
    for (const equipment of selection) {
      const params = this.#equipmentParams(equipment);
      for (const param of params) {
        const index = attributeIndex.get(param.baseParamId);
        if (index === undefined) {
          throw new RangeError(`装备包含未配置的属性 id：${param.baseParamId}`);
        }
        attributes[index] += param.value;
      }
    }
    if (food !== undefined) {
      for (const param of food.baseParams) {
        const index = attributeIndex.get(param.baseParamId);
        if (index === undefined) {
          throw new RangeError(`食物包含未配置的属性 id：${param.baseParamId}`);
        }
        attributes[index] += Math.min(
          param.maxValue,
          Math.trunc(attributes[index] * (param.multiplier - 1) + 1e-7),
        );
      }
    }
    return attributes;
  }

  #resolveResultAttributeIds(
    selection: readonly EquipInfo[],
    food: FoodInfo | undefined,
  ): number[] {
    if (this.options.attributeIds !== undefined) {
      return [...this.options.attributeIds];
    }
    const ids = new Set<number>();
    for (const equipment of selection) {
      for (const param of this.#equipmentParams(equipment)) {
        ids.add(param.baseParamId);
      }
    }
    for (const param of food?.baseParams ?? []) ids.add(param.baseParamId);
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

  #equipmentParams(equipment: EquipInfo): readonly ParamInfo[] {
    return (
      this.options.equipmentAttributeExtractor?.(equipment) ??
      equipment.baseParams
    );
  }

  #buildRanges(
    constraints: LoadoutV2Constraints,
  ): AttributeRangeConstraint[] | undefined {
    const ranges: AttributeRangeConstraint[] = [];
    if (constraints.gcd !== undefined) {
      if (this.gcdToSpeedRange === undefined) {
        throw new RangeError("按 GCD 搜索需要配置 gcdToSpeedRange");
      }
      const range = this.gcdToSpeedRange(constraints.gcd);
      if (range === undefined) return undefined;
      ranges.push({
        attributeId: this.#requireAttributeId(
          this.speedAttributeId,
          "GCD 约束",
        ),
        min: range.min,
        max: range.max,
      });
    }
    if (
      constraints.speedMin !== undefined ||
      constraints.speedMax !== undefined
    ) {
      ranges.push({
        attributeId: this.#requireAttributeId(
          this.speedAttributeId,
          "速度约束",
        ),
        min: constraints.speedMin,
        max: constraints.speedMax,
      });
    }
    if (constraints.toughMin !== undefined) {
      ranges.push({
        attributeId: this.#requireAttributeId(
          this.toughnessAttributeId,
          "坚韧约束",
        ),
        min: constraints.toughMin,
      });
    }
    if (constraints.toughnessMinPercent !== undefined) {
      if (this.toughnessPercentToMinimum === undefined) {
        throw new RangeError(
          "按坚韧百分比搜索需要配置 toughnessPercentToMinimum",
        );
      }
      ranges.push({
        attributeId: this.#requireAttributeId(
          this.toughnessAttributeId,
          "坚韧百分比约束",
        ),
        min: this.toughnessPercentToMinimum(constraints.toughnessMinPercent),
      });
    }
    if (constraints.maxToughnessMode === true) {
      this.#requireAttributeId(this.toughnessAttributeId, "最高坚韧模式");
    }
    return this.#intersectRanges(ranges);
  }

  #intersectRanges(
    ranges: readonly AttributeRangeConstraint[],
  ): AttributeRangeConstraint[] | undefined {
    const intersections = new Map<number, Required<AttributeRangeConstraint>>();
    for (const range of ranges) {
      const minimum = range.min ?? Number.NEGATIVE_INFINITY;
      const maximum = range.max ?? Number.POSITIVE_INFINITY;
      if (Number.isNaN(minimum) || Number.isNaN(maximum) || minimum > maximum) {
        throw new RangeError(`属性 ${range.attributeId} 的约束范围无效`);
      }
      const existing = intersections.get(range.attributeId);
      const intersection = {
        attributeId: range.attributeId,
        min: Math.max(existing?.min ?? Number.NEGATIVE_INFINITY, minimum),
        max: Math.min(existing?.max ?? Number.POSITIVE_INFINITY, maximum),
      };
      if (intersection.min > intersection.max) return undefined;
      intersections.set(range.attributeId, intersection);
    }
    return [...intersections.values()];
  }

  #attributeIndex(attributeId: number): number {
    if (this.options.attributeIds === undefined) {
      if (attributeId >= 0 && attributeId < this.attributeCount) {
        return attributeId;
      }
      throw new RangeError(
        "使用非连续属性 id 时必须通过 attributeIds 指定属性顺序",
      );
    }
    const index = this.options.attributeIds.indexOf(attributeId);
    if (index < 0) {
      throw new RangeError(`属性 id ${attributeId} 不在 attributeIds 中`);
    }
    return index;
  }

  #requireAttributeId(
    attributeId: number | undefined,
    feature: string,
  ): number {
    if (attributeId === undefined) {
      throw new RangeError(`${feature}需要配置对应的属性 id`);
    }
    this.#attributeIndex(attributeId);
    return attributeId;
  }

  #validateAttributeId(attributeId: number | undefined, name: string): void {
    if (attributeId !== undefined && !Number.isInteger(attributeId)) {
      throw new RangeError(`${name}属性 id 必须是整数`);
    }
  }

  #validateConstraints(constraints: LoadoutV2Constraints): void {
    for (const [name, value] of [
      ["gcd", constraints.gcd],
      ["speedMin", constraints.speedMin],
      ["speedMax", constraints.speedMax],
      ["toughnessMinPercent", constraints.toughnessMinPercent],
      ["toughMin", constraints.toughMin],
    ] as const) {
      if (value !== undefined && !Number.isFinite(value)) {
        throw new RangeError(`${name} 必须是有限数字`);
      }
    }
    if (constraints.gcd !== undefined && constraints.gcd <= 0) {
      throw new RangeError("gcd 必须大于 0");
    }
    if (
      constraints.toughnessMinPercent !== undefined &&
      constraints.toughnessMinPercent < 0
    ) {
      throw new RangeError("toughnessMinPercent 不能小于 0");
    }
    if (
      constraints.speedMin !== undefined &&
      constraints.speedMax !== undefined &&
      constraints.speedMin > constraints.speedMax
    ) {
      throw new RangeError("speedMin 不能大于 speedMax");
    }
  }

  #combineStatistics(
    toughness: LoadoutSearchStatistics,
    damage: LoadoutSearchStatistics,
    maximumToughness: number,
  ): LoadoutV2Statistics {
    return {
      ...damage,
      elapsedMs: toughness.elapsedMs + damage.elapsedMs,
      searched: toughness.searched + damage.searched,
      leaves: toughness.leaves + damage.leaves,
      singleSlotImprovements:
        toughness.singleSlotImprovements + damage.singleSlotImprovements,
      pairwiseImprovements:
        toughness.pairwiseImprovements + damage.pairwiseImprovements,
      suffixBoundChecks: toughness.suffixBoundChecks + damage.suffixBoundChecks,
      suffixBoundPruned: toughness.suffixBoundPruned + damage.suffixBoundPruned,
      suffixVectorsEvaluated:
        toughness.suffixVectorsEvaluated + damage.suffixVectorsEvaluated,
      constraintPruned: toughness.constraintPruned + damage.constraintPruned,
      suffixConstraintPruned:
        toughness.suffixConstraintPruned + damage.suffixConstraintPruned,
      maximumToughness,
      toughnessPhase: { ...toughness },
      damagePhase: { ...damage },
    };
  }
}
