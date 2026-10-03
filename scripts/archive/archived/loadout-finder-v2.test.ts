import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDamageGcdVectorEvaluator,
  createEquippedEffectsVectorEvaluator,
  equippedEffects,
  equippedAttributeTier,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "../equipped-effects.ts";
import {
  LoadoutFinderV2,
  type LoadoutV2Constraints,
} from "./loadout-finder-v2.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import type { Stat } from "../../../reference/ffxiv-gearing/src/game.ts";

function equipment(itemId: number, values: readonly number[]): EquipInfo {
  return {
    itemId,
    itemLevel: itemId,
    key: String(itemId),
    baseParams: values.map((value, baseParamId) => ({ baseParamId, value })),
    PDMG: 0,
    MDMG: 0,
    DLY: 0,
  };
}

function applyFood(
  values: readonly number[],
  food: FoodInfo | undefined,
): number[] {
  const result = [...values];
  for (const param of food?.baseParams ?? []) {
    const value = result[param.baseParamId];
    result[param.baseParamId] += Math.min(
      param.maxValue,
      Math.trunc(value * (param.multiplier - 1) + 1e-7),
    );
  }
  return result;
}

function resultAttributes(
  selection: readonly EquipInfo[],
  food: FoodInfo | undefined,
  attributeCount: number,
): number[] {
  const attributes = new Array<number>(attributeCount).fill(0);
  for (const selected of selection) {
    for (const param of selected.baseParams) {
      attributes[param.baseParamId] += param.value;
    }
  }
  return applyFood(attributes, food);
}

function bruteForce(
  slots: readonly (readonly EquipInfo[])[],
  foods: readonly FoodInfo[],
  damageFunction: (attributes: readonly number[]) => number,
  constraints: LoadoutV2Constraints,
): { damage: number; toughness: number } | undefined {
  const current = [0, 0, 0];
  const effectiveFoods = foods.length === 0 ? [undefined] : foods;
  const feasible: { damage: number; toughness: number }[] = [];

  const search = (depth: number): void => {
    if (depth < slots.length) {
      for (const candidate of slots[depth]) {
        for (const param of candidate.baseParams) {
          current[param.baseParamId] += param.value;
        }
        search(depth + 1);
        for (const param of candidate.baseParams) {
          current[param.baseParamId] -= param.value;
        }
      }
      return;
    }

    for (const food of effectiveFoods) {
      const attributes = applyFood(current, food);
      if (
        (constraints.speedMin !== undefined &&
          attributes[1] < constraints.speedMin) ||
        (constraints.speedMax !== undefined &&
          attributes[1] > constraints.speedMax) ||
        (constraints.toughMin !== undefined &&
          attributes[2] < constraints.toughMin)
      ) {
        continue;
      }
      feasible.push({
        damage: damageFunction(attributes),
        toughness: attributes[2],
      });
    }
  };
  search(0);
  if (feasible.length === 0) return undefined;

  if (constraints.maxToughnessMode === true) {
    const maximumToughness = Math.max(
      ...feasible.map((entry) => entry.toughness),
    );
    return {
      damage: Math.max(
        ...feasible
          .filter((entry) => entry.toughness === maximumToughness)
          .map((entry) => entry.damage),
      ),
      toughness: maximumToughness,
    };
  }
  const best = feasible.reduce((first, second) =>
    second.damage > first.damage ? second : first,
  );
  return best;
}

function finder(
  damageFunction: (attributes: readonly number[]) => number,
  suffixFrontierSlotCount = 3,
): LoadoutFinderV2 {
  return new LoadoutFinderV2(damageFunction, 3, 1, 2, {
    attributeIds: [0, 1, 2],
    suffixFrontierSlotCount,
    debug: false,
  });
}

describe("LoadoutFinderV2", () => {
  it("does not return a partial result when aborted", () => {
    const finder = new LoadoutFinderV2((attributes) => attributes[0], 1, {
      attributeIds: [0],
      shouldAbort: () => true,
      debug: false,
    });
    assert.throws(
      () => finder.findBest([[equipment(1, [1])]], []),
      /未完成最优性证明/,
    );
  });

  it("keeps the exact result when the suffix is scanned through a flat batch evaluator", () => {
    const slots = [
      [equipment(1, [8, 1, 0]), equipment(2, [3, 7, 0])],
      [equipment(3, [0, 4, 2]), equipment(4, [5, 0, 1])],
      [equipment(5, [6, 0, 3]), equipment(6, [1, 5, 0])],
      [equipment(7, [2, 2, 4]), equipment(8, [4, 1, 1])],
    ];
    const damage = (attributes: readonly number[]): number =>
      attributes[0] * 100 + attributes[1] * 10 + attributes[2];
    const combined = (
      first: readonly number[],
      second: readonly number[],
      _transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => damage(first.map((value, index) => value + (second[index] ?? 0)));
    const flat = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      offset: number,
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => combined(first, Array.from({ length: 3 }, (_, index) => suffix[offset + index] ?? 0), transforms);
    const maxFlat = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      attributeCount: number,
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
      startStateIndex = 0,
      endStateIndex = Number.POSITIVE_INFINITY,
    ): { damage: number; stateIndex: number } => {
      let best = Number.NEGATIVE_INFINITY;
      let stateIndex = -1;
      for (
        let index = startStateIndex;
        index < endStateIndex && (index + 1) * attributeCount <= suffix.length;
        index++
      ) {
        const value = flat(first, suffix, index * attributeCount, transforms);
        if (value > best) {
          best = value;
          stateIndex = index;
        }
      }
      return { damage: best, stateIndex };
    };
    const baseOptions = {
      attributeIds: [0, 1, 2],
      suffixFrontierSlotCount: 2,
      debug: false,
    } as const;
    const regular = new LoadoutFinderV2(damage, 3, baseOptions).findBest(slots, []);
    const batched = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
    }).findBest(slots, []);
    const sumNecessary = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
      suffixSumNecessaryBound: true,
    }).findBest(slots, []);
    const necessary = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
      suffixNecessaryLowerBound: true,
    }).findBest(slots, []);
    const tightened = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
      suffixExactBlockUpperBound: true,
      suffixDynamicBlockOrder: true,
    }).findBest(slots, []);
    const cachedFinder = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
      suffixTotalDamageCache: true,
    });
    const cached = cachedFinder.findBest(slots, []);
    const subblockedFinder = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
      suffixSubblockRefinement: true,
    });
    const subblocked = subblockedFinder.findBest(slots, []);
    const gridStateFinder = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
      suffixPrefixGridStateUpperBound: true,
      suffixPrefixGridSize: 2,
    });
    const gridState = gridStateFinder.findBest(slots, []);
    assert.ok(regular);
    assert.ok(batched);
    assert.ok(sumNecessary);
    assert.ok(necessary);
    assert.ok(tightened);
    assert.ok(cached);
    assert.ok(subblocked);
    assert.ok(gridState);
    assert.equal(batched.damage, regular.damage);
    assert.equal(sumNecessary.damage, regular.damage);
    assert.equal(necessary.damage, regular.damage);
    assert.equal(tightened.damage, regular.damage);
    assert.equal(cached.damage, regular.damage);
    assert.equal(subblocked.damage, regular.damage);
    assert.equal(gridState.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(batched.selection, batched.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
    assert.deepEqual(
      resultAttributes(sumNecessary.selection, sumNecessary.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
    assert.deepEqual(
      resultAttributes(necessary.selection, necessary.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
    assert.deepEqual(
      resultAttributes(tightened.selection, tightened.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
    assert.deepEqual(
      resultAttributes(cached.selection, cached.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
  });

  it("shares one prefix traversal across multiple food branches", () => {
    const slots = [
      [equipment(1, [8, 1, 0]), equipment(2, [3, 7, 0])],
      [equipment(3, [0, 4, 2]), equipment(4, [5, 0, 1])],
      [equipment(5, [6, 0, 3]), equipment(6, [1, 5, 0])],
      [equipment(7, [2, 2, 4]), equipment(8, [4, 1, 1])],
    ];
    const foods: FoodInfo[] = [
      {
        itemId: 10,
        itemLevel: 1,
        key: "food-a",
        baseParams: [{ baseParamId: 0, multiplier: 1.1, maxValue: 100 }],
      },
      {
        itemId: 11,
        itemLevel: 1,
        key: "food-b",
        baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 100 }],
      },
    ];
    const damage = (attributes: readonly number[]): number =>
      attributes[0] * 100 + attributes[1] * 10 + attributes[2];
    const applyFood = (
      values: readonly number[],
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number[] => {
      const result = [...values];
      for (const transform of transforms) {
        result[transform.attribute] =
          (result[transform.attribute] ?? 0) +
          Math.min(
            transform.maxValue,
            Math.trunc((result[transform.attribute] ?? 0) * transform.rate),
          );
      }
      return result;
    };
    const combined = (
      first: readonly number[],
      second: readonly number[],
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => damage(applyFood(
      first.map((value, index) => value + (second[index] ?? 0)),
      transforms,
    ));
    const flat = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      offset: number,
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => combined(
      first,
      Array.from({ length: 3 }, (_, index) => suffix[offset + index] ?? 0),
      transforms,
    );
    const batch = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      attributeCount: number,
      transformSets: readonly (readonly { attribute: number; maxValue: number; rate: number }[])[],
      startStateIndex = 0,
      endStateIndex = Number.POSITIVE_INFINITY,
    ): readonly { damage: number; stateIndex: number }[] =>
      transformSets.map((transforms) => {
        let best = Number.NEGATIVE_INFINITY;
        let stateIndex = -1;
        for (
          let index = startStateIndex;
          index < endStateIndex && (index + 1) * attributeCount <= suffix.length;
          index++
        ) {
          const value = flat(first, suffix, index * attributeCount, transforms);
          if (value > best) {
            best = value;
            stateIndex = index;
          }
        }
        return { damage: best, stateIndex };
      });
    const options = {
      attributeIds: [0, 1, 2],
      suffixFrontierSlotCount: 2,
      debug: false,
    } as const;
    const max = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      attributeCount: number,
      transformSet: readonly { attribute: number; maxValue: number; rate: number }[],
      startStateIndex = 0,
      endStateIndex = Number.POSITIVE_INFINITY,
    ): { damage: number; stateIndex: number } =>
      batch(
        first,
        suffix,
        attributeCount,
        [transformSet],
        startStateIndex,
        endStateIndex,
      )[0]!;
    const regular = new LoadoutFinderV2(damage, 3, {
      ...options,
      combinedDamageFunction: combined,
    }).findBest(slots, foods);
    const shared = new LoadoutFinderV2(damage, 3, {
      ...options,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: max,
      maxCombinedDamageFlatBatch: batch,
      shareFoods: true,
      shareFoodsMode: "sequential",
      suffixSubblockRefinement: true,
      sharedRawPrefixDominance: true,
      suffixStateUpperBound: true,
    }).findBest(slots, foods);
    assert.ok(regular);
    assert.ok(shared);
    assert.equal(shared.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(shared.selection, shared.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
    const sharedBatch = new LoadoutFinderV2(damage, 3, {
      ...options,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: max,
      maxCombinedDamageFlatBatch: batch,
      shareFoods: true,
      shareFoodsMode: "batch",
      sharedRawPrefixDominance: true,
    }).findBest(slots, foods);
    assert.ok(sharedBatch);
    assert.equal(sharedBatch.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(sharedBatch.selection, sharedBatch.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
    const tree = new LoadoutFinderV2(damage, 3, {
      ...options,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: max,
      maxCombinedDamageFlatBatch: batch,
      shareFoods: true,
      shareFoodsMode: "sequential",
      suffixFlatTree: true,
      suffixFlatTreeLeafSize: 2,
      sharedRawPrefixDominance: true,
    }).findBest(slots, foods);
    assert.ok(tree);
    assert.equal(tree.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(tree.selection, tree.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
  });

  it("keeps fixed-sum necessary filtering exact with capped food", () => {
    const slots = [
      [equipment(21, [8, 1, 2]), equipment(22, [3, 7, 0])],
      [equipment(23, [0, 4, 2]), equipment(24, [5, 0, 1])],
      [equipment(25, [6, 0, 3]), equipment(26, [1, 5, 0])],
      [equipment(27, [2, 2, 4]), equipment(28, [4, 1, 1])],
    ];
    const food: FoodInfo = {
      itemId: 29,
      itemLevel: 1,
      key: "capped-food",
      baseParams: [
        { baseParamId: 0, multiplier: 1.2, maxValue: 3 },
        { baseParamId: 1, multiplier: 1.1, maxValue: 2 },
      ],
    };
    const damage = (attributes: readonly number[]): number =>
      (attributes[0] + 1) * (attributes[1] + 2) + attributes[2] * 7;
    const applyTransforms = (
      values: readonly number[],
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number[] => {
      const result = [...values];
      for (const transform of transforms) {
        const value = result[transform.attribute] ?? 0;
        result[transform.attribute] =
          value + Math.min(transform.maxValue, Math.trunc(value * transform.rate + 1e-7));
      }
      return result;
    };
    const combined = (
      first: readonly number[],
      second: readonly number[],
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => damage(applyTransforms(
      first.map((value, index) => value + (second[index] ?? 0)),
      transforms,
    ));
    const flat = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      offset: number,
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => combined(
      first,
      Array.from({ length: 3 }, (_, index) => suffix[offset + index] ?? 0),
      transforms,
    );
    const maxFlat = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      attributeCount: number,
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
      startStateIndex = 0,
      endStateIndex = Number.POSITIVE_INFINITY,
    ): { damage: number; stateIndex: number } => {
      let best = Number.NEGATIVE_INFINITY;
      let stateIndex = -1;
      for (
        let index = startStateIndex;
        index < endStateIndex && (index + 1) * attributeCount <= suffix.length;
        index++
      ) {
        const value = flat(first, suffix, index * attributeCount, transforms);
        if (value > best) {
          best = value;
          stateIndex = index;
        }
      }
      return { damage: best, stateIndex };
    };
    const baseOptions = {
      attributeIds: [0, 1, 2],
      suffixFrontierSlotCount: 2,
      debug: false,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
    } as const;
    const regular = new LoadoutFinderV2(damage, 3, baseOptions).findBest(
      slots,
      [food],
    );
    const filtered = new LoadoutFinderV2(damage, 3, {
      ...baseOptions,
      suffixSumNecessaryBound: true,
    }).findBest(slots, [food]);
    assert.ok(regular);
    assert.ok(filtered);
    assert.equal(filtered.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(filtered.selection, filtered.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
  });

  it("keeps future-tier suffix compression exact", () => {
    const slots = [
      [equipment(1, [8, 1, 0]), equipment(2, [3, 7, 0])],
      [equipment(3, [0, 4, 2]), equipment(4, [5, 0, 1])],
      [equipment(5, [6, 0, 3]), equipment(6, [1, 5, 0])],
      [equipment(7, [2, 2, 4]), equipment(8, [4, 1, 1])],
    ];
    const food: FoodInfo[] = [{
      itemId: 20,
      itemLevel: 1,
      key: "future-tier-food",
      baseParams: [{ baseParamId: 0, multiplier: 1.1, maxValue: 3 }],
    }];
    const damage = (attributes: readonly number[]): number =>
      Math.floor((attributes[0] ?? 0) / 5) * 100 +
      (attributes[1] ?? 0) * 10 +
      (attributes[2] ?? 0);
    const options = {
      attributeIds: [0, 1, 2],
      attributeTierProjectors: new Map([[0, (value: number) => Math.floor(value / 5)]]),
      suffixFrontierSlotCount: 2,
      debug: false,
    } as const;
    const regular = new LoadoutFinderV2(damage, 3, options).findBest(slots, food);
    const compressed = new LoadoutFinderV2(damage, 3, {
      ...options,
      suffixFutureTierCompression: true,
    }).findBest(slots, food);
    assert.ok(regular);
    assert.ok(compressed);
    assert.equal(compressed.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(compressed.selection, compressed.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
  });

  it("uses damage per second when GCD is not specified and keeps real damage", () => {
    const damage = (attributes: readonly number[]): number => attributes[0];
    const finder = new LoadoutFinderV2(damage, 2, {
      attributeIds: [0, 1],
      speedAttributeId: 1,
      evaluationFunction: (attributes) => ({
        damage: attributes[0],
        gcd: 3 - attributes[1],
      }),
      suffixFrontierSlotCount: 0,
      debug: false,
    });

    const result = finder.findBest(
      [[equipment(1, [100, 1]), equipment(2, [90, 2])]],
      [],
    );

    assert.equal(result?.selection[0].itemId, 2);
    assert.equal(result?.damage, 90);
  });

  it("compares direct damage when an exact GCD is specified", () => {
    const damage = (attributes: readonly number[]): number => attributes[0];
    const finder = new LoadoutFinderV2(damage, 2, {
      attributeIds: [0, 1],
      speedAttributeId: 1,
      evaluationFunction: (attributes) => ({
        damage: attributes[0],
        gcd: 3 - attributes[1],
      }),
      gcdToSpeedRange: () => ({ min: 1, max: 2 }),
      suffixFrontierSlotCount: 0,
      debug: false,
    });

    const result = finder.findBest(
      [[equipment(1, [100, 1]), equipment(2, [90, 2])]],
      [],
      { gcd: 2.48 },
    );

    assert.equal(result?.selection[0].itemId, 1);
    assert.equal(result?.damage, 100);
  });

  it("keeps the unconstrained direct-damage result stable", () => {
    const damage = (attributes: readonly number[]): number =>
      attributes[0] * 100 + attributes[1] * 2 + attributes[2];
    const slots = [
      [equipment(1, [5, 1, 2]), equipment(2, [4, 4, 0])],
      [equipment(3, [3, 2, 5]), equipment(4, [6, 0, 0])],
    ];
    const food: FoodInfo = {
      itemId: 10,
      itemLevel: 1,
      key: "food",
      baseParams: [{ baseParamId: 0, multiplier: 1.1, maxValue: 2 }],
    };
    const options = {
      attributeIds: [0, 1, 2],
      suffixFrontierSlotCount: 2,
      debug: false,
    } as const;
    const v2 = new LoadoutFinderV2(damage, 3, {
      ...options,
      speedAttributeId: 1,
      toughnessAttributeId: 2,
    });

    const v2Result = v2.findBest(slots, [food]);

    assert.equal(v2Result?.damage, 1204);
    assert.deepEqual(
      v2Result?.selection.map((entry) => entry.itemId),
      [1, 4],
    );
    assert.equal(v2Result?.food?.itemId, food.itemId);
  });

  it("keeps a lower-speed candidate that ordinary Pareto dominance would remove", () => {
    const food: FoodInfo = {
      itemId: 10,
      itemLevel: 1,
      key: "speed-food",
      baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 20 }],
    };
    const result = finder((attributes) => attributes[0], 0).findBest(
      [[equipment(1, [10, 100, 0]), equipment(2, [9, 90, 0])]],
      [food],
      { speedMin: 99, speedMax: 105 },
    );

    assert.equal(result?.selection[0].itemId, 2);
    assert.equal(resultAttributes(result!.selection, result!.food, 3)[1], 99);
  });

  it("does not prune a weaker food that is required by a speed ceiling", () => {
    const stronger: FoodInfo = {
      itemId: 10,
      itemLevel: 1,
      key: "stronger",
      baseParams: [{ baseParamId: 1, multiplier: 1.2, maxValue: 30 }],
    };
    const weaker: FoodInfo = {
      itemId: 11,
      itemLevel: 1,
      key: "weaker",
      baseParams: [{ baseParamId: 1, multiplier: 1.05, maxValue: 30 }],
    };

    const result = finder((attributes) => attributes[0], 0).findBest(
      [[equipment(1, [10, 100, 0])]],
      [stronger, weaker],
      { speedMax: 110 },
    );

    assert.equal(result?.food?.itemId, weaker.itemId);
  });

  it("applies a toughness minimum after food", () => {
    const food: FoodInfo = {
      itemId: 10,
      itemLevel: 1,
      key: "tough-food",
      baseParams: [{ baseParamId: 2, multiplier: 1.1, maxValue: 20 }],
    };
    const result = finder((attributes) => attributes[0], 0).findBest(
      [[equipment(1, [20, 0, 90]), equipment(2, [15, 0, 100])]],
      [food],
      { toughMin: 110 },
    );

    assert.equal(result?.selection[0].itemId, 2);
    assert.equal(resultAttributes(result!.selection, result!.food, 3)[2], 110);
  });

  it("converts GCD seconds and toughness percentages inside V2", () => {
    const constrainedFinder = new LoadoutFinderV2(
      (attributes) => attributes[0],
      3,
      1,
      2,
      {
        attributeIds: [0, 1, 2],
        gcdToSpeedRange: (gcdSeconds) => {
          assert.equal(gcdSeconds, 2.48);
          return { min: 19, max: 19 };
        },
        toughnessPercentToMinimum: (percentage) => {
          assert.equal(percentage, 5);
          return 25;
        },
        suffixFrontierSlotCount: 0,
        debug: false,
      },
    );
    const result = constrainedFinder.findBest(
      [
        [equipment(1, [50, 10, 30]), equipment(2, [20, 19, 25])],
        [equipment(3, [0, 0, 0])],
      ],
      [],
      { gcd: 2.48, toughnessMinPercent: 5 },
    );

    assert.equal(result?.selection[0].itemId, 2);
  });

  it("intersects GCD and direct speed constraints", () => {
    const constrainedFinder = new LoadoutFinderV2(
      (attributes) => attributes[0],
      3,
      {
        attributeIds: [0, 1, 2],
        speedAttributeId: 1,
        toughnessAttributeId: 2,
        gcdToSpeedRange: () => ({ min: 10, max: 20 }),
        suffixFrontierSlotCount: 0,
        debug: false,
      },
    );
    const result = constrainedFinder.findBest(
      [
        [
          equipment(1, [100, 12, 0]),
          equipment(2, [90, 16, 0]),
          equipment(3, [80, 19, 0]),
        ],
      ],
      [],
      { gcd: 2.48, speedMin: 15, speedMax: 18 },
    );

    assert.equal(result?.selection[0].itemId, 2);
  });

  it("returns no result when intersected speed constraints are disjoint", () => {
    const constrainedFinder = new LoadoutFinderV2(
      (attributes) => attributes[0],
      3,
      {
        attributeIds: [0, 1, 2],
        speedAttributeId: 1,
        gcdToSpeedRange: () => ({ min: 10, max: 20 }),
        debug: false,
      },
    );

    assert.equal(
      constrainedFinder.findBest([[equipment(1, [100, 20, 0])]], [], {
        gcd: 2.48,
        speedMin: 21,
      }),
      undefined,
    );
  });

  it("uses the stricter raw and percentage toughness minimum", () => {
    const constrainedFinder = new LoadoutFinderV2(
      (attributes) => attributes[0],
      3,
      {
        attributeIds: [0, 1, 2],
        toughnessAttributeId: 2,
        toughnessPercentToMinimum: () => 25,
        suffixFrontierSlotCount: 0,
        debug: false,
      },
    );
    const result = constrainedFinder.findBest(
      [[equipment(1, [100, 0, 27]), equipment(2, [90, 0, 30])]],
      [],
      { toughnessMinPercent: 5, toughMin: 30 },
    );

    assert.equal(result?.selection[0].itemId, 2);
  });

  it("does not tier-collapse speed states needed by a lower bound", () => {
    const constrainedFinder = new LoadoutFinderV2(
      (attributes) => attributes[0],
      3,
      1,
      2,
      {
        attributeIds: [0, 1, 2],
        attributeTierProjectors: new Map([
          [1, (value: number) => Math.trunc(value / 10)],
        ]),
        suffixFrontierSlotCount: 0,
        debug: false,
      },
    );
    const result = constrainedFinder.findBest(
      [
        [equipment(1, [20, 10, 0]), equipment(2, [10, 19, 0])],
        [equipment(3, [0, 0, 0])],
      ],
      [],
      { speedMin: 19 },
    );

    assert.equal(result?.selection[0].itemId, 2);
  });

  it("maximizes toughness first and damage second", () => {
    const slots = [
      [equipment(1, [20, 0, 30]), equipment(2, [5, 0, 40])],
      [equipment(3, [10, 0, 20]), equipment(4, [1, 0, 10])],
    ];
    const result = finder((attributes) => attributes[0], 0).findBest(
      slots,
      [],
      { maxToughnessMode: true },
    );

    assert.equal(result?.maximumToughness, 60);
    assert.equal(result?.damage, 15);
    assert.deepEqual(
      result?.selection.map((entry) => entry.itemId),
      [2, 3],
    );
  });

  it("maximizes raw toughness rather than its damage tier", () => {
    const constrainedFinder = new LoadoutFinderV2(
      (attributes) => attributes[0],
      3,
      1,
      2,
      {
        attributeIds: [0, 1, 2],
        attributeTierProjectors: new Map([
          [2, (value: number) => Math.trunc(value / 10)],
        ]),
        suffixFrontierSlotCount: 0,
        debug: false,
      },
    );
    const result = constrainedFinder.findBest(
      [
        [equipment(1, [20, 0, 10]), equipment(2, [10, 0, 19])],
        [equipment(3, [0, 0, 0])],
      ],
      [],
      { maxToughnessMode: true },
    );

    assert.equal(result?.maximumToughness, 19);
    assert.equal(result?.selection[0].itemId, 2);
  });

  it("maximizes food-adjusted toughness before damage", () => {
    const foods: FoodInfo[] = [
      {
        itemId: 10,
        itemLevel: 1,
        key: "damage-food",
        baseParams: [{ baseParamId: 0, multiplier: 1.1, maxValue: 20 }],
      },
      {
        itemId: 11,
        itemLevel: 1,
        key: "tough-food",
        baseParams: [{ baseParamId: 2, multiplier: 1.2, maxValue: 20 }],
      },
    ];
    const result = finder((attributes) => attributes[0], 0).findBest(
      [[equipment(1, [100, 0, 50]), equipment(2, [90, 0, 60])]],
      foods,
      { maxToughnessMode: true },
    );

    assert.equal(result?.maximumToughness, 72);
    assert.equal(result?.selection[0].itemId, 2);
    assert.equal(result?.food?.itemId, 11);
  });

  it("returns undefined when no combination can satisfy the constraints", () => {
    const result = finder((attributes) => attributes[0], 0).findBest(
      [[equipment(1, [10, 50, 10])]],
      [],
      { speedMin: 100 },
    );

    assert.equal(result, undefined);
  });

  it("matches exhaustive search for random constrained inputs", () => {
    let seed = 0x2f00ba11;
    const random = (maximum: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % maximum;
    };
    const damage = (attributes: readonly number[]): number =>
      (Math.trunc(attributes[0] / 4) + 1) *
        (Math.trunc(attributes[1] / 5) + 1) +
      Math.trunc(attributes[2] / 3);
    const foods: FoodInfo[] = [
      {
        itemId: 1,
        itemLevel: 1,
        key: "speed",
        baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 3 }],
      },
      {
        itemId: 2,
        itemLevel: 1,
        key: "tough",
        baseParams: [{ baseParamId: 2, multiplier: 1.2, maxValue: 4 }],
      },
    ];

    for (let sample = 0; sample < 100; sample++) {
      let itemId = 10;
      const slots = Array.from({ length: 4 }, () =>
        Array.from({ length: 3 }, () =>
          equipment(itemId++, [random(12), random(12), random(12)]),
        ),
      );
      const constraints: LoadoutV2Constraints = {
        speedMin: 10 + random(12),
        speedMax: 25 + random(12),
        toughMin: 10 + random(20),
        maxToughnessMode: sample % 4 === 0,
      };
      const expected = bruteForce(slots, foods, damage, constraints);
      const result = finder(damage).findBest(slots, foods, constraints);

      assert.equal(result?.damage, expected?.damage, `sample ${sample}`);
      assert.equal(
        result?.maximumToughness,
        constraints.maxToughnessMode ? expected?.toughness : undefined,
        `sample ${sample} maximum toughness`,
      );
    }
  });
});

describe("V2 user-unit conversions", () => {
  it("keeps damage and GCD exactly equal across precomputed tiers and fallback", () => {
    const indexes = new Map<Stat, number>([
      ["INT", 0], ["CRT", 1], ["DET", 2], ["DHT", 3],
      ["SPS", 4], ["MDMG", 5],
    ]);
    const limits = [800, 800, 800, 800, 800, 180];
    const fast = createDamageGcdVectorEvaluator("RDM", 100, indexes, limits);
    const reference = createEquippedEffectsVectorEvaluator("RDM", 100, indexes);
    for (let sample = 0; sample < 300; sample++) {
      const values = limits.map((limit, index) =>
        sample === 299 ? limit + 1 : (sample * (index * 47 + 31)) % (limit + 1));
      const expected = reference(values);
      const actual = fast(values);
      assert.equal(actual?.damage, expected?.damage, `sample ${sample} damage`);
      assert.equal(actual?.gcd, expected?.gcd, `sample ${sample} GCD`);
    }
  });

  it("keeps the vector evaluator equivalent to equippedEffects", () => {
    const statIndexes = new Map<Stat, number>([
      ["INT", 0],
      ["CRT", 1],
      ["DET", 2],
      ["DHT", 3],
      ["SPS", 4],
      ["VIT", 5],
      ["MDMG", 6],
    ]);
    const attributes = [100, 200, 300, 100, 150, 250, 10];
    const evaluate = createEquippedEffectsVectorEvaluator(
      "RDM",
      100,
      statIndexes,
    );

    assert.deepEqual(
      evaluate(attributes),
      equippedEffects("RDM", 100, {
        INT: 100,
        CRT: 200,
        DET: 300,
        DHT: 100,
        SPS: 150,
        VIT: 250,
        MDMG: 10,
      }),
    );
  });

  it("keeps flat combined evaluation exact with capped food transforms", () => {
    const indexes = new Map<Stat, number>([
      ["INT", 0],
      ["CRT", 1],
      ["DET", 2],
      ["DHT", 3],
      ["SPS", 4],
      ["MDMG", 5],
    ]);
    const limits = [1600, 1600, 1600, 1600, 1600, 180];
    const evaluate = createDamageGcdVectorEvaluator("RDM", 100, indexes, limits);
    assert.ok(evaluate.combinedDamage);
    assert.ok(evaluate.combinedDps);
    assert.ok(evaluate.combinedDamageFlat);
    assert.ok(evaluate.combinedDpsFlat);
    const transforms = [
      { attribute: 1, maxValue: 80, rate: 0.1 },
      { attribute: 4, maxValue: 80, rate: 0.1 },
    ];
    const flat = new Int32Array(4 * limits.length);
    for (let sample = 0; sample < 40; sample++) {
      const first = limits.map((limit, index) =>
        Math.trunc((sample * (index * 19 + 7)) % Math.max(1, limit / 2)),
      );
      const second = limits.map((limit, index) =>
        Math.trunc((sample * (index * 23 + 11)) % Math.max(1, limit / 2)),
      );
      flat.set(second, 0);
      flat.set(second.map((value) => Math.trunc(value / 2)), limits.length);
      flat.set(second.map((value) => Math.trunc(value / 3)), limits.length * 2);
      flat.set(second.map((value) => Math.trunc(value / 4)), limits.length * 3);
      const pairIndexes = new Int32Array(4);
      for (let state = 0; state < 4; state++) {
        const offset = state * limits.length;
        pairIndexes[state] =
          flat[offset + 5]! * (limits[0]! + 1) + flat[offset]!;
      }
      const columns = Array.from(
        { length: limits.length },
        (_, attribute) =>
          Int32Array.from(
            { length: 4 },
            (_, state) => flat[state * limits.length + attribute]!,
          ),
      );
      for (let state = 0; state < 4; state++) {
        const offset = state * limits.length;
        const expectedDamage: number = evaluate.combinedDamage!(first, Array.from(flat.slice(offset, offset + limits.length)), transforms);
        const actualDamage: number = evaluate.combinedDamageFlat!(first, flat, offset, transforms);
        assert.equal(actualDamage, expectedDamage, `sample ${sample} state ${state} damage`);
        const expectedDps: number = evaluate.combinedDps!(first, Array.from(flat.slice(offset, offset + limits.length)), transforms);
        const actualDps: number = evaluate.combinedDpsFlat!(first, flat, offset, transforms);
        assert.equal(actualDps, expectedDps, `sample ${sample} state ${state} DPS`);
      }
      assert.ok(evaluate.maxCombinedDamageFlat);
      assert.ok(evaluate.maxCombinedDpsFlat);
      const expectedMaxDamage = Math.max(
        ...Array.from({ length: 4 }, (_, state) =>
          evaluate.combinedDamageFlat!(
            first,
            flat,
            state * limits.length,
            transforms,
          ),
        ),
      );
      const expectedMaxDps = Math.max(
        ...Array.from({ length: 4 }, (_, state) =>
          evaluate.combinedDpsFlat!(
            first,
            flat,
            state * limits.length,
            transforms,
          ),
        ),
      );
      assert.equal(
        evaluate.maxCombinedDamageFlat!(first, flat, limits.length, transforms).damage,
        expectedMaxDamage,
        `sample ${sample} maximum damage`,
      );
      assert.equal(
        evaluate.maxCombinedDamageFlat!(
          first,
          flat,
          limits.length,
          transforms,
          0,
          4,
          pairIndexes,
        ).damage,
        expectedMaxDamage,
        `sample ${sample} indexed maximum damage`,
      );
      assert.ok(evaluate.maxCombinedDamageFlatColumns);
      assert.equal(
        evaluate.maxCombinedDamageFlatColumns!(
          first,
          columns,
          transforms,
          0,
          4,
          pairIndexes,
        ).damage,
        expectedMaxDamage,
        `sample ${sample} indexed column maximum damage`,
      );
      assert.equal(
        evaluate.maxCombinedDpsFlat!(first, flat, limits.length, transforms).damage,
        expectedMaxDps,
        `sample ${sample} maximum DPS`,
      );
      assert.equal(
        evaluate.maxCombinedDpsFlat!(
          first,
          flat,
          limits.length,
          transforms,
          0,
          4,
          pairIndexes,
        ).damage,
        expectedMaxDps,
        `sample ${sample} indexed maximum DPS`,
      );
      assert.ok(evaluate.maxCombinedDpsFlatBatch);
      const batchTransforms = [transforms, []];
      const batch = evaluate.maxCombinedDpsFlatBatch!(
        first,
        flat,
        limits.length,
        batchTransforms,
      );
      const indexedBatch = evaluate.maxCombinedDpsFlatBatch!(
        first,
        flat,
        limits.length,
        batchTransforms,
        0,
        4,
        pairIndexes,
      );
      for (let batchIndex = 0; batchIndex < batchTransforms.length; batchIndex++) {
        let expectedBatchDamage = Number.NEGATIVE_INFINITY;
        let expectedBatchState = -1;
        for (let state = 0; state < 4; state++) {
          const candidate = evaluate.combinedDpsFlat!(
            first,
            flat,
            state * limits.length,
            batchTransforms[batchIndex]!,
          );
          if (candidate > expectedBatchDamage) {
            expectedBatchDamage = candidate;
            expectedBatchState = state;
          }
        }
        assert.equal(batch[batchIndex]!.damage, expectedBatchDamage,
          `sample ${sample} batch ${batchIndex} maximum DPS`);
        assert.equal(batch[batchIndex]!.stateIndex, expectedBatchState,
          `sample ${sample} batch ${batchIndex} state`);
        assert.equal(indexedBatch[batchIndex]!.damage, expectedBatchDamage,
          `sample ${sample} indexed batch ${batchIndex} maximum DPS`);
        assert.equal(indexedBatch[batchIndex]!.stateIndex, expectedBatchState,
          `sample ${sample} indexed batch ${batchIndex} state`);
      }
    }
  });

  it("keeps food-specific reordered suffix columns aligned with state indexes", () => {
    const slots = [
      [equipment(1, [8, 1, 0]), equipment(2, [3, 7, 0])],
      [equipment(3, [0, 4, 2]), equipment(4, [5, 0, 1])],
      [equipment(5, [6, 0, 3]), equipment(6, [1, 5, 0])],
      [equipment(7, [2, 2, 4]), equipment(8, [4, 1, 1])],
    ];
    const foods: FoodInfo[] = [
      {
        itemId: 10,
        itemLevel: 1,
        key: "column-food-a",
        baseParams: [{ baseParamId: 0, multiplier: 1.1, maxValue: 100 }],
      },
      {
        itemId: 11,
        itemLevel: 1,
        key: "column-food-b",
        baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 100 }],
      },
    ];
    const damage = (attributes: readonly number[]): number =>
      attributes[0] * 100 + attributes[1] * 10 + attributes[2];
    const applyFood = (
      values: readonly number[],
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number[] => {
      const result = [...values];
      for (const transform of transforms) {
        const value = result[transform.attribute] ?? 0;
        result[transform.attribute] =
          value + Math.min(transform.maxValue, Math.trunc(value * transform.rate));
      }
      return result;
    };
    const combined = (
      first: readonly number[],
      second: readonly number[],
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => damage(applyFood(
      first.map((value, index) => value + (second[index] ?? 0)),
      transforms,
    ));
    const flat = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      offset: number,
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
    ): number => combined(
      first,
      Array.from({ length: 3 }, (_, index) => suffix[offset + index] ?? 0),
      transforms,
    );
    const maxFlat = (
      first: readonly number[],
      suffix: ArrayLike<number>,
      attributeCount: number,
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
      startStateIndex = 0,
      endStateIndex = Number.POSITIVE_INFINITY,
    ): { damage: number; stateIndex: number } => {
      let best = Number.NEGATIVE_INFINITY;
      let stateIndex = -1;
      for (
        let index = startStateIndex;
        index < endStateIndex && (index + 1) * attributeCount <= suffix.length;
        index++
      ) {
        const candidate = flat(first, suffix, index * attributeCount, transforms);
        if (candidate > best) {
          best = candidate;
          stateIndex = index;
        }
      }
      return { damage: best, stateIndex };
    };
    const maxColumns = (
      first: readonly number[],
      columns: readonly ArrayLike<number>[],
      transforms: readonly { attribute: number; maxValue: number; rate: number }[],
      startStateIndex = 0,
      endStateIndex = Number.POSITIVE_INFINITY,
    ): { damage: number; stateIndex: number } => {
      let best = Number.NEGATIVE_INFINITY;
      let stateIndex = -1;
      const end = Math.min(endStateIndex, ...columns.map((column) => column.length));
      for (let index = startStateIndex; index < end; index++) {
        const candidate = combined(
          first,
          columns.map((column) => column[index] ?? 0),
          transforms,
        );
        if (candidate > best) {
          best = candidate;
          stateIndex = index;
        }
      }
      return { damage: best, stateIndex };
    };
    const common = {
      attributeIds: [0, 1, 2],
      suffixFrontierSlotCount: 2,
      debug: false,
      combinedDamageFunction: combined,
      combinedDamageFlatFunction: flat,
      maxCombinedDamageFlat: maxFlat,
    } as const;
    const regular = new LoadoutFinderV2(damage, 3, common).findBest(slots, foods);
    const reorderedColumns = new LoadoutFinderV2(damage, 3, {
      ...common,
      maxCombinedDamageFlatColumnsFunction: maxColumns,
      suffixStateUpperBound: true,
      prefixSuffixBlockUpperBound: true,
    }).findBest(slots, foods);
    assert.ok(regular);
    assert.ok(reorderedColumns);
    assert.equal(reorderedColumns.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(reorderedColumns.selection, reorderedColumns.food, 3),
      resultAttributes(regular.selection, regular.food, 3),
    );
  });

  it("keeps tier-canonical total cache results exact", () => {
    const indexes = new Map<Stat, number>([
      ["INT", 0], ["CRT", 1], ["DET", 2], ["DHT", 3],
      ["SPS", 4], ["MDMG", 5],
    ]);
    const limits = [800, 800, 800, 800, 800, 180];
    const evaluate = createDamageGcdVectorEvaluator("RDM", 100, indexes, limits);
    const foods: FoodInfo[] = [{
      itemId: 10,
      itemLevel: 1,
      key: "tier-cache-food",
      baseParams: [{ baseParamId: 1, multiplier: 1.1, maxValue: 80 }],
    }];
    const slots = Array.from({ length: 4 }, (_, slotIndex) => [
      equipment(100 + slotIndex * 2, [120 + slotIndex, 80, 90, 70, 40, 10]),
      equipment(101 + slotIndex * 2, [118, 84 + slotIndex, 88, 74, 42, 10]),
    ]);
    const common = {
      attributeIds: [0, 1, 2, 3, 4, 5],
      combinedDamageFunction: evaluate.combinedDamage,
      combinedDamageFlatFunction: evaluate.combinedDamageFlat,
      maxCombinedDamageFlat: evaluate.maxCombinedDamageFlat,
      suffixPairAttributes: [5, 0],
      suffixPairStride: limits[0]! + 1,
      suffixFrontierSlotCount: 2,
      debug: false,
    } as const;
    const regular = new LoadoutFinderV2(
      (attributes) => evaluate(attributes)?.damage ?? Number.NEGATIVE_INFINITY,
      6,
      common,
    ).findBest(slots, foods);
    const cachedFinder = new LoadoutFinderV2(
      (attributes) => evaluate(attributes)?.damage ?? Number.NEGATIVE_INFINITY,
      6,
      {
        ...common,
        suffixTotalDamageCache: true,
        suffixTotalDamageTierCache: true,
        suffixPrefixTierLookup: true,
        attributeTierProjectors: new Map([
          [0, (value: number) => equippedAttributeTier("RDM", 100, "INT", value)],
          [1, (value: number) => equippedAttributeTier("RDM", 100, "CRT", value)],
          [2, (value: number) => equippedAttributeTier("RDM", 100, "DET", value)],
          [3, (value: number) => equippedAttributeTier("RDM", 100, "DHT", value)],
          [4, (value: number) => equippedAttributeTier("RDM", 100, "SPS", value)],
        ]),
      },
    );
    const cached = cachedFinder.findBest(slots, foods);
    assert.ok(regular);
    assert.ok(cached);
    assert.equal(cached.damage, regular.damage);
    assert.deepEqual(
      resultAttributes(cached.selection, cached.food, 6),
      resultAttributes(regular.selection, regular.food, 6),
    );
  });

  it("keeps the attribute-sum damage upper bound admissible", () => {
    const indexes = new Map<Stat, number>([
      ["INT", 0],
      ["CRT", 1],
      ["DET", 2],
      ["DHT", 3],
      ["SPS", 4],
      ["MDMG", 5],
    ]);
    const limits = [800, 800, 800, 800, 800, 180];
    const evaluate = createDamageGcdVectorEvaluator("RDM", 100, indexes, limits);
    assert.ok(evaluate.combinedDamageUpperBound);
    assert.ok(evaluate.combinedDpsUpperBound);
    const transforms = [
      { attribute: 1, maxValue: 80, rate: 0.1 },
      { attribute: 4, maxValue: 80, rate: 0.1 },
    ];
    let seed = 0x5eeda11;
    const random = (maximum: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % maximum;
    };

    for (let sample = 0; sample < 200; sample++) {
      const first = limits.map((limit) => random(Math.max(1, limit / 2)));
      const second = limits.map((limit) => random(Math.max(1, limit / 2)));
      const minimum = second.map((value) => Math.trunc(value / 3));
      const minimumSum = minimum.reduce((sum, value) => sum + value, 0);
      const sumMaximum = minimumSum + random(700);
      const slotBounds = [
        {
          minimum,
          maximum: second,
          attributeSumMaximum: sumMaximum,
        },
      ];
      const upper = evaluate.combinedDamageUpperBound!(
        first,
        second,
        transforms,
        minimum,
        sumMaximum,
        slotBounds,
      );
      const dpsUpper: number = evaluate.combinedDpsUpperBound!(
        first,
        second,
        transforms,
        minimum,
        sumMaximum,
        slotBounds,
      );

      for (let trial = 0; trial < 40; trial++) {
        const suffix = second.map((value, index) => {
          const lower = minimum[index]!;
          return lower + random(Math.max(1, value - lower + 1));
        });
        if (suffix.reduce((sum, value) => sum + value, 0) > sumMaximum) {
          continue;
        }
        const score = evaluate.combinedDamage!(first, suffix, transforms);
        assert.ok(score <= upper + 1e-9, `sample ${sample} damage`);
        const dps = evaluate.combinedDps!(first, suffix, transforms);
        assert.ok(dps <= dpsUpper + 1e-9, `sample ${sample} DPS`);
      }
    }

    const multipleSlotBounds = [
      {
        minimum: [0, 20, 10, 0, 0, 0],
        maximum: [100, 100, 100, 50, 50, 20],
        attributeSumMaximum: 220,
      },
      {
        minimum: [20, 0, 0, 10, 10, 0],
        maximum: [80, 80, 80, 60, 60, 20],
        attributeSumMaximum: 180,
      },
    ];
    const aggregateMinimum = multipleSlotBounds[0]!.minimum.map(
      (value, index) => value + multipleSlotBounds[1]!.minimum[index]!,
    );
    const aggregateMaximum = multipleSlotBounds[0]!.maximum.map(
      (value, index) => value + multipleSlotBounds[1]!.maximum[index]!,
    );
    const aggregateSumMaximum = multipleSlotBounds.reduce(
      (sum, bound) => sum + bound.attributeSumMaximum,
      0,
    );
    const multiUpper = evaluate.combinedDamageUpperBound!(
      [100, 120, 140, 80, 90, 15],
      aggregateMaximum,
      transforms,
      aggregateMinimum,
      aggregateSumMaximum,
      multipleSlotBounds,
    );
    const multiDpsUpper = evaluate.combinedDpsUpperBound!(
      [100, 120, 140, 80, 90, 15],
      aggregateMaximum,
      transforms,
      aggregateMinimum,
      aggregateSumMaximum,
      multipleSlotBounds,
    );
    for (let trial = 0; trial < 200; trial++) {
      const suffix = multipleSlotBounds.reduce<number[]>(
        (total, bound) => {
          const candidate = bound.minimum.map((value, index) =>
            value + random(bound.maximum[index]! - value + 1),
          );
          if (
            candidate.reduce((sum, value) => sum + value, 0) <=
            bound.attributeSumMaximum
          ) {
            candidate.forEach((value, index) => {
              total[index] = (total[index] ?? 0) + value;
            });
          }
          return total;
        },
        new Array<number>(limits.length).fill(0),
      );
      if (suffix.every((value) => value === 0)) continue;
      const score = evaluate.combinedDamage!(
        [100, 120, 140, 80, 90, 15],
        suffix,
        transforms,
      );
      const dps = evaluate.combinedDps!(
        [100, 120, 140, 80, 90, 15],
        suffix,
        transforms,
      );
      assert.ok(score <= multiUpper + 1e-9, `multi-slot damage ${trial}`);
      assert.ok(dps <= multiDpsUpper + 1e-9, `multi-slot DPS ${trial}`);
    }
  });

  it("finds the exact speed boundaries for the default 2.48 second GCD", () => {
    const range = equippedSpeedRangeForGcd("RDM", 100, 2.48);

    assert.deepEqual(range, { min: 107, max: 192 });
    assert.equal(equippedEffects("RDM", 100, { SPS: 106 })?.gcd, 2.49);
    assert.equal(equippedEffects("RDM", 100, { SPS: 107 })?.gcd, 2.48);
    assert.equal(equippedEffects("RDM", 100, { SPS: 192 })?.gcd, 2.48);
    assert.equal(equippedEffects("RDM", 100, { SPS: 193 })?.gcd, 2.47);
  });

  it("finds the exact speed interval for a GCD value", () => {
    assert.deepEqual(equippedSpeedRangeForGcd("RDM", 100, 2.49), {
      min: 22,
      max: 106,
    });
  });

  it("finds the first toughness value reaching a mitigation percentage", () => {
    const toughness = equippedToughnessForMitigationPercent("PLD", 100, 5);

    assert.equal(toughness, 695);
    assert.equal(
      equippedEffects("PLD", 100, { TEN: toughness })?.tenMitigation,
      0.05,
    );
    assert.equal(
      equippedEffects("PLD", 100, { TEN: toughness - 1 })?.tenMitigation,
      0.049,
    );
  });
});
