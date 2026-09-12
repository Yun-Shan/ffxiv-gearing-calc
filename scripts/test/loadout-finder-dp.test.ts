import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoadoutFinderDp } from "./loadout-finder-dp.ts";
import type { EquipInfo, FoodInfo } from "./types.ts";

function equipment(itemId: number, values: readonly number[]): EquipInfo {
  return {
    itemId,
    itemLevel: itemId,
    key: String(itemId),
    baseParams: values.map((value, baseParamId) => ({
      baseParamId,
      value,
    })),
    PDMG: 0,
    MDMG: 0,
    DLY: 0,
  };
}

function applyFood(values: readonly number[], food: FoodInfo): number[] {
  const result = [...values];
  for (const param of food.baseParams) {
    const value = result[param.baseParamId];
    result[param.baseParamId] += Math.min(
      param.maxValue,
      Math.trunc(value * (param.multiplier - 1) + 1e-7),
    );
  }
  return result;
}

function bruteForce(
  slots: readonly (readonly EquipInfo[])[],
  foods: readonly FoodInfo[],
  damage: (values: readonly number[]) => number,
): number {
  let best = Number.NEGATIVE_INFINITY;
  const current = [0, 0, 0];
  const effectiveFoods = foods.length === 0 ? [undefined] : foods;

  const search = (depth: number): void => {
    if (depth === slots.length) {
      for (const food of effectiveFoods) {
        best = Math.max(
          best,
          damage(food === undefined ? current : applyFood(current, food)),
        );
      }
      return;
    }
    for (const candidate of slots[depth]) {
      for (const param of candidate.baseParams) {
        current[param.baseParamId] += param.value;
      }
      search(depth + 1);
      for (const param of candidate.baseParams) {
        current[param.baseParamId] -= param.value;
      }
    }
  };

  search(0);
  return best;
}

describe("LoadoutFinderDp", () => {
  it("merges equal reachable vectors before expanding another layer", () => {
    const damage = (values: readonly number[]): number =>
      values[0] + (values[1] >= 20 ? 100 : 0);
    const finder = new LoadoutFinderDp(damage, 2, {
      attributeIds: [0, 1],
      greedyPriorityAttributeIds: [0, 1],
      debug: false,
      attributeTierProjectors: new Map([
        [1, (value: number) => Math.trunc(value / 20)],
      ]),
    });

    const result = finder.findBest(
      [
        [equipment(1, [10, 0]), equipment(2, [0, 10])],
        [equipment(3, [0, 10]), equipment(4, [10, 0])],
        [equipment(5, [10, 0]), equipment(6, [0, 10])],
      ],
      [],
    );

    assert.equal(result?.damage, 110);
    assert.ok(finder.statistics.equivalentMerged >= 1);
  });

  it("does not merge current tiers that a reachable suffix can separate", () => {
    const damage = (values: readonly number[]): number =>
      (Math.trunc(values[0] / 10) + 1) * (Math.trunc(values[1] / 10) + 1);
    const finder = new LoadoutFinderDp(damage, 3, {
      attributeIds: [0, 1, 2],
      debug: false,
      attributeTierProjectors: new Map([
        [0, (value: number) => Math.trunc(value / 10)],
        [1, (value: number) => Math.trunc(value / 10)],
      ]),
    });
    const slots = [
      [equipment(2, [10, 0, 9]), equipment(1, [19, 0, 0])],
      [
        equipment(3, [1, 0, 0]),
        equipment(4, [0, 1, 0]),
        equipment(5, [0, 0, 1]),
      ],
    ];

    const result = finder.findBest(slots, []);

    assert.equal(result?.damage, 3);
    assert.equal(result?.selection[0].itemId, 1);
  });

  it("matches exhaustive search around tiers and food caps", () => {
    let seed = 0x5eed1234;
    const random = (maximum: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % maximum;
    };
    const damage = (values: readonly number[]): number =>
      (Math.trunc(values[0] / 3) + 1) * (Math.trunc(values[1] / 4) + 1) +
      values[2];
    const foods: FoodInfo[] = [
      {
        itemId: 1,
        itemLevel: 1,
        key: "first",
        baseParams: [
          { baseParamId: 0, multiplier: 1.1, maxValue: 3 },
          { baseParamId: 1, multiplier: 1.2, maxValue: 2 },
        ],
      },
      {
        itemId: 2,
        itemLevel: 1,
        key: "second",
        baseParams: [
          { baseParamId: 0, multiplier: 1.2, maxValue: 2 },
          { baseParamId: 1, multiplier: 1.1, maxValue: 3 },
        ],
      },
    ];

    for (let sample = 0; sample < 100; sample++) {
      let itemId = 10;
      const slots = Array.from({ length: 4 }, () =>
        Array.from({ length: 3 }, () =>
          equipment(itemId++, [random(10), random(10), random(5)]),
        ),
      );
      const finder = new LoadoutFinderDp(damage, 3, {
        attributeIds: [0, 1, 2],
        debug: false,
        attributeTierProjectors: new Map([
          [0, (value: number) => Math.trunc(value / 3)],
          [1, (value: number) => Math.trunc(value / 4)],
        ]),
      });

      assert.equal(
        finder.findBest(slots, foods)?.damage,
        bruteForce(slots, foods, damage),
      );
    }
  });

  it("uses explicit food priority when damage ties", () => {
    const lowerPriorityFood: FoodInfo = {
      itemId: 1,
      itemLevel: 1,
      key: "lower",
      baseParams: [{ baseParamId: 0, multiplier: 1.5, maxValue: 50 }],
    };
    const higherPriorityFood: FoodInfo = {
      itemId: 2,
      itemLevel: 1,
      key: "higher",
      baseParams: [{ baseParamId: 1, multiplier: 1.01, maxValue: 1 }],
    };
    const finder = new LoadoutFinderDp(() => 1, 2, {
      attributeIds: [0, 1],
      debug: false,
      foodPriorityComparator: (first, second) =>
        (first?.itemId === higherPriorityFood.itemId ? 0 : 1) -
        (second?.itemId === higherPriorityFood.itemId ? 0 : 1),
    });

    const result = finder.findBest(
      [[equipment(10, [100, 100])]],
      [lowerPriorityFood, higherPriorityFood],
    );

    assert.equal(result?.food?.itemId, higherPriorityFood.itemId);
  });
});
