import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildRingPairEquipInfos, isRingPairEquipInfo } from "./ring-pairs.ts";
import type { EquipInfo } from "./types.ts";

function ring(
  itemId: number,
  itemLevel: number,
  attributes: readonly [number, number][],
): EquipInfo {
  return {
    itemId,
    itemLevel,
    key: attributes.map(([baseParamId]) => baseParamId).join("-"),
    baseParams: attributes.map(([baseParamId, value]) => ({
      baseParamId,
      value,
    })),
    PDMG: 0,
    MDMG: 0,
    DLY: 0,
  };
}

describe("double-ring candidates", () => {
  it("combines both rings and keeps their source EquipInfo values", () => {
    const first = ring(10, 100, [
      [1, 20],
      [3, 5],
    ]);
    const second = ring(20, 110, [
      [2, 30],
      [3, 7],
    ]);

    const pairs = buildRingPairEquipInfos([first, second], () => false);
    const pair = pairs.find(
      (candidate) =>
        candidate.ringEquips[0] === first && candidate.ringEquips[1] === second,
    );

    assert.ok(pair !== undefined && isRingPairEquipInfo(pair));
    assert.deepEqual(pair.ringEquips, [first, second]);
    assert.deepEqual(pair.baseParams, [
      { baseParamId: 1, value: 20 },
      { baseParamId: 2, value: 30 },
      { baseParamId: 3, value: 12 },
    ]);
    assert.equal(pair.itemLevel, 210);
  });

  it("rejects duplicate unique rings but permits duplicate non-unique rings", () => {
    const unique = ring(10, 100, [[1, 20]]);
    const repeatable = ring(20, 100, [[1, 10]]);

    const pairs = buildRingPairEquipInfos(
      [unique, repeatable],
      (itemId) => itemId === unique.itemId,
    );

    assert.equal(
      pairs.some(
        ({ ringEquips }) =>
          ringEquips[0] === unique && ringEquips[1] === unique,
      ),
      false,
    );
    assert.equal(
      pairs.some(
        ({ ringEquips }) =>
          ringEquips[0] === repeatable && ringEquips[1] === repeatable,
      ),
      true,
    );
  });

  it("keeps one order per pair when the caller proves both ring slots are symmetric", () => {
    const unique = ring(10, 100, [[1, 20]]);
    const repeatable = ring(20, 100, [[1, 10]]);

    const pairs = buildRingPairEquipInfos(
      [unique, repeatable],
      (itemId) => itemId === unique.itemId,
      (left, right) => left.itemId - right.itemId,
    );

    assert.equal(pairs.length, 2);
    assert.ok(pairs.some(({ ringEquips }) =>
      ringEquips[0] === unique && ringEquips[1] === repeatable));
    assert.ok(pairs.some(({ ringEquips }) =>
      ringEquips[0] === repeatable && ringEquips[1] === repeatable));
    assert.equal(pairs.some(({ ringEquips }) =>
      ringEquips[0] === repeatable && ringEquips[1] === unique), false);
  });
});
