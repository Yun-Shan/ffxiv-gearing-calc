import { describe, expect, test } from "vitest";
import {
  cannotBeatThreshold,
  compareCappedRatioSums,
  ratioAtOrBelowThreshold,
  ratioSumAtOrBelowThreshold,
  sumCappedRatios,
} from "./joint-arithmetic.ts";

describe("exact capped joint ratios", () => {
  test("caps optimistic solo ratios at the proven baseline before summing", () => {
    const ratios = [
      { numerator: 3n, denominator: 2n },
      { numerator: 1n, denominator: 3n },
      { numerator: 1n, denominator: 6n },
    ];
    expect(sumCappedRatios(ratios)).toEqual({ numerator: 3n, denominator: 2n });
    expect(ratioSumAtOrBelowThreshold(ratios, 3n, 2n)).toBe(true);
    expect(ratioSumAtOrBelowThreshold(ratios, 149n, 100n)).toBe(false);
    expect(ratioAtOrBelowThreshold(ratios[0]!, 1n, 1n)).toBe(true);
    expect(ratioAtOrBelowThreshold(ratios[0]!, 99n, 100n)).toBe(false);
  });

  test.each([
    ["unknown", undefined],
    ["zero denominator", { numerator: 1n, denominator: 0n }],
    ["negative denominator", { numerator: 1n, denominator: -1n }],
  ] as const)(
    "unknown or invalid ratios cannot establish a sum bound: %s",
    (_reason, ratio) => {
      expect(
        sumCappedRatios([{ numerator: 1n, denominator: 2n }, ratio]),
      ).toBeUndefined();
      expect(ratioSumAtOrBelowThreshold([ratio], 2n, 1n)).toBe(false);
    },
  );

  test("keeps one-unit distinctions above JavaScript's exact integer range", () => {
    const denominator = 10n ** 30n;
    const ratio = { numerator: denominator - 1n, denominator };
    expect(ratioAtOrBelowThreshold(ratio, denominator - 2n, denominator)).toBe(
      false,
    );
    expect(ratioAtOrBelowThreshold(ratio, denominator - 1n, denominator)).toBe(
      true,
    );
    expect(
      cannotBeatThreshold([undefined, ratio], denominator - 2n, denominator),
    ).toBe(false);
    expect(
      cannotBeatThreshold([undefined, ratio], denominator - 1n, denominator),
    ).toBe(true);
  });

  test("empty sums are zero and stable ordering places unknown bounds last", () => {
    expect(sumCappedRatios([])).toEqual({ numerator: 0n, denominator: 1n });
    expect(ratioSumAtOrBelowThreshold([], 0n, 1n)).toBe(true);
    const one = { numerator: 1n, denominator: 1n };
    const half = { numerator: 1n, denominator: 2n };
    expect(compareCappedRatioSums(undefined, undefined)).toBe(0);
    expect(compareCappedRatioSums(undefined, one)).toBe(1);
    expect(compareCappedRatioSums(one, undefined)).toBe(-1);
    expect(compareCappedRatioSums(one, half)).toBe(1);
    expect(compareCappedRatioSums(half, one)).toBe(-1);
    expect(
      compareCappedRatioSums(half, { numerator: 2n, denominator: 4n }),
    ).toBe(0);
  });
});
