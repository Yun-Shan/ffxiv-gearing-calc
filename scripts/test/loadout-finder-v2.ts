import {
  LoadoutFinderV1,
  type AttributeRangeConstraint,
  type DamageFunction,
  type LoadoutFinderV1Options,
  type LoadoutV1Result,
  type LoadoutV1Statistics,
} from "./loadout-finder-v1.ts";
import type { EquipInfo, FoodInfo } from "./types.ts";

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

export type LoadoutFinderV2Options = LoadoutFinderV1Options & {
  speedAttributeId?: number;
  toughnessAttributeId?: number;
  gcdToSpeedRange?: (gcdSeconds: number) => GcdSpeedRange | undefined;
  toughnessPercentToMinimum?: (percentage: number) => number;
};

export type LoadoutV2Result = LoadoutV1Result & {
  maximumToughness?: number;
};

export type LoadoutV2Statistics = LoadoutV1Statistics & {
  maximumToughness?: number;
  toughnessPhase?: LoadoutV1Statistics;
  damagePhase?: LoadoutV1Statistics;
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
  readonly options: LoadoutFinderV1Options;
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
        ...v1Options
      } = speedOrOptions;
      this.speedAttributeId = speedAttributeId;
      this.toughnessAttributeId = configuredToughnessId;
      this.gcdToSpeedRange = gcdToSpeedRange;
      this.toughnessPercentToMinimum = toughnessPercentToMinimum;
      this.options = v1Options;
    } else {
      const {
        gcdToSpeedRange,
        toughnessPercentToMinimum,
        speedAttributeId: _speedAttributeId,
        toughnessAttributeId: _toughnessAttributeId,
        ...v1Options
      } = options;
      this.speedAttributeId = speedOrOptions;
      this.toughnessAttributeId = toughnessAttributeId;
      this.gcdToSpeedRange = gcdToSpeedRange;
      this.toughnessPercentToMinimum = toughnessPercentToMinimum;
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
      const finder = this.#createDamageFinder("V2");
      const result = finder.findBest(slots, foods, ranges);
      this.statistics = {
        ...finder.statistics,
        damagePhase: { ...finder.statistics },
      };
      return result;
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
    const toughnessFinder = new LoadoutFinderV1(
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

    const damageFinder = this.#createDamageFinder("V2");
    const result = damageFinder.findBest(slots, foods, exactToughnessRanges);
    this.statistics = this.#combineStatistics(
      toughnessFinder.statistics,
      damageFinder.statistics,
      maximumToughness,
    );
    return result === undefined ? undefined : { ...result, maximumToughness };
  }

  #createDamageFinder(label: string): LoadoutFinderV1 {
    return new LoadoutFinderV1(this.damageFunction, this.attributeCount, {
      ...this.options,
      debugLabel: label,
    });
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
    toughness: LoadoutV1Statistics,
    damage: LoadoutV1Statistics,
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
