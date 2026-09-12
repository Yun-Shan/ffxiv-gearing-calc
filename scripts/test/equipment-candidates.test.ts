import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { equipmentAttributeValuesKey } from "./equipment-candidates.ts";

describe("equipment candidate generation", () => {
  it("does not collapse meld layouts with the same attribute ids", () => {
    const directHitMelds = [
      { baseParamId: 4, value: 588 },
      { baseParamId: 22, value: 370 },
      { baseParamId: 27, value: 374 },
    ];
    const criticalHitMelds = [
      { baseParamId: 4, value: 588 },
      { baseParamId: 22, value: 262 },
      { baseParamId: 27, value: 482 },
    ];

    assert.notEqual(
      equipmentAttributeValuesKey(directHitMelds),
      equipmentAttributeValuesKey(criticalHitMelds),
    );
  });
});
