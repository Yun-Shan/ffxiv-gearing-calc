import { describe, expect, test } from "vitest";
import { roundedLog, strictLogThresholdLoss } from "./exact-arithmetic.ts";
import { addRows, addTerm } from "./model-builder.ts";
import { validateMipSolution } from "./solution-validation.ts";
import type { ModelRow } from "./model-types.ts";
import {
  atanhLogFixedBounds,
  logRatioFixedBounds,
  floorDiv,
} from "./exact-arithmetic.ts";

describe("exact proof primitives", () => {
  test("fixed-point logarithm guards and signed division preserve mathematical bounds", () => {
    expect(atanhLogFixedBounds(0n, 1n)).toEqual([0n, 0n]);
    for (const [a, b] of [
      [-1n, 2n],
      [2n, 2n],
      [3n, 2n],
    ]) {
      expect(() => atanhLogFixedBounds(a!, b!)).toThrow(RangeError);
    }
    for (const [a, b] of [
      [0n, 1n],
      [1n, 0n],
      [-1n, 1n],
    ]) {
      expect(() => logRatioFixedBounds(a!, b!)).toThrow(RangeError);
    }
    expect(floorDiv(-5n, 2n)).toBe(-3n);
    expect(floorDiv(-4n, 2n)).toBe(-2n);
    for (const [a, b] of [
      [2n, 3n],
      [3n, 2n],
      [1n, 7n],
    ]) {
      const [low, high] = logRatioFixedBounds(a!, b!);
      const estimate = Math.log(Number(a) / Number(b));
      expect(Number(low) / 1e30).toBeCloseTo(estimate, 14);
      expect(high).toBeGreaterThanOrEqual(low);
    }
  });
  test("quantized logs and strict thresholds retain the integer boundary", () => {
    expect(roundedLog(1)).toBe(0);
    expect(roundedLog(2)).toBe(693_147_180_560);
    expect(roundedLog(10)).toBe(2_302_585_092_994);
    expect(strictLogThresholdLoss(1n, 1n)).toBe(-1n);
    expect(strictLogThresholdLoss(1n, 2n)).toBe(693_147_180_559n);
    expect(
      strictLogThresholdLoss(9_999_999_999_999_999n, 10_000_000_000_000_000n),
    ).toBe(0n);
    for (const value of [
      0,
      -1,
      1.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => roundedLog(value)).toThrow(/正安全整数/);
    }
    for (const [numerator, denominator] of [
      [0n, 1n],
      [-1n, 1n],
      [2n, 1n],
      [1n, 0n],
    ]) {
      expect(() => strictLogThresholdLoss(numerator!, denominator!)).toThrow(
        /阈值/,
      );
    }
  });

  test("model rows own their coefficients and reject unsafe arithmetic", () => {
    const coefficients = new Map([["x", 3]]);
    addTerm(coefficients, "x", -3);
    addTerm(coefficients, "ignored", 0);
    expect(coefficients.size).toBe(0);
    addTerm(coefficients, "x", 2);
    const rows: ModelRow[] = [];
    addRows(rows, "limit", coefficients, "<=", 4);
    coefficients.set("x", 99);
    expect(rows[0]!.terms.get("x")).toBe(2);
    expect(() => addRows(rows, "unsafe", [["x", 0.1]], "=", 0)).toThrow(/系数/);
    expect(() => addRows(rows, "unsafe", [], "=", Infinity)).toThrow(/右侧/);
  });

  test("integer feasibility never accepts floating point cancellation as an exact row", () => {
    const coefficient = 1_000_000_000;
    const rows: ModelRow[] = [
      {
        name: "exact-cancellation",
        sense: "=",
        rhs: 1,
        terms: new Map([
          ["x", coefficient],
          ["unit", 1],
          ["y", -coefficient],
        ]),
      },
    ];
    const bounds = [
      { name: "x", min: coefficient, max: coefficient },
      { name: "unit", min: 0, max: 1 },
      { name: "y", min: coefficient, max: coefficient },
    ];
    expect(() =>
      validateMipSolution(rows, bounds, { unit: { Primal: 1 } }),
    ).not.toThrow();
    expect(() => validateMipSolution(rows, bounds, {})).toThrow(
      /不满足整数模型行/,
    );
    expect(() =>
      validateMipSolution([], bounds, { unit: { Primal: 0.25 } }),
    ).toThrow(/不是可靠整数/);
    expect(() =>
      validateMipSolution([], bounds, { unit: { Primal: 2 } }),
    ).toThrow(/超出上下界/);
    expect(() =>
      validateMipSolution([], [{ name: "missing", min: 1, max: 2 }], {}),
    ).toThrow(/缺少变量/);
    expect(() =>
      validateMipSolution(
        [{ ...rows[0]!, terms: new Map([["unknown", 1]]) }],
        bounds,
        {},
      ),
    ).toThrow(/未知变量/);
  });
});
