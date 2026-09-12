import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  equippedEffects,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "./equipped-effects.ts";
import { LoadoutFinderV1 } from "./loadout-finder-v1.ts";
import {
  LoadoutFinderV2,
  type LoadoutV2Constraints,
} from "./loadout-finder-v2.ts";
import type { EquipInfo, FoodInfo } from "./types.ts";

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
  it("degenerates to V1 when constraints are empty", () => {
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
    const v1 = new LoadoutFinderV1(damage, 3, options);
    const v2 = new LoadoutFinderV2(damage, 3, {
      ...options,
      speedAttributeId: 1,
      toughnessAttributeId: 2,
    });

    const v1Result = v1.findBest(slots, [food]);
    const v2Result = v2.findBest(slots, [food]);

    assert.equal(v2Result?.damage, v1Result?.damage);
    assert.deepEqual(
      v2Result?.selection.map((entry) => entry.itemId),
      v1Result?.selection.map((entry) => entry.itemId),
    );
    assert.equal(v2Result?.food?.itemId, v1Result?.food?.itemId);
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
