import { describe, expect, it } from "vitest";
import { applyFood } from "./rules";
import { describeFoodResult } from "./food-result";
import type { Food } from "./types";
const food: Food = {
  id: 1,
  name: "test",
  level: 700,
  stats: { CRT: 120, DET: 80, VIT: 100 },
  statRates: { CRT: 10, DET: 10, VIT: 10 },
  sourceFile: "test",
};
describe("calculated food result", () => {
  it("returns caps, rates, exact applied gains and the reference weighted utilization", () => {
    const before = { CRT: 2000, DET: 400, VIT: 990 };
    const after = applyFood(before, food.stats, food.statRates);
    const snapshot = describeFoodResult(food, before, after);
    expect(snapshot.stats).toEqual({ CRT: 120, DET: 80, VIT: 100 });
    expect(snapshot.statRates).toEqual({ CRT: 10, DET: 10, VIT: 10 });
    expect(snapshot.actualStats).toEqual({ CRT: 120, DET: 40, VIT: 99 });
    expect(snapshot.utilization).toBe(86);
    expect(before).toEqual({ CRT: 2000, DET: 400, VIT: 990 });
    expect(food).not.toHaveProperty("actualStats");
  });
  it("keeps unused job stats at zero while including their original caps in utilization", () => {
    const other: Food = {
      ...food,
      stats: { CRT: 100, SPS: 100 },
      statRates: { CRT: 10, SPS: 10 },
    };
    const before = { CRT: 2000 };
    const after = applyFood(before, { CRT: 100 }, { CRT: 10 });
    expect(describeFoodResult(other, before, after).actualStats).toEqual({
      CRT: 100,
      SPS: 0,
    });
    expect(describeFoodResult(other, before, after).utilization).toBe(50);
  });
  it("reports full utilization at the caps and zero when there is no food gain", () => {
    const before = { CRT: 2000, DET: 2000, VIT: 2000 };
    expect(
      describeFoodResult(
        food,
        before,
        applyFood(before, food.stats, food.statRates),
      ).utilization,
    ).toBe(100);
    expect(describeFoodResult(food, {}, {}).utilization).toBe(0);
    expect(
      describeFoodResult({ ...food, stats: { CRT: undefined } }, {}, {})
        .utilization,
    ).toBe(0);
    expect(
      describeFoodResult({ ...food, stats: {}, statRates: {} }, {}, {})
        .utilization,
    ).toBe(0);
  });
});
