import { describe, expect, test } from "vitest";
import {
  maxSubstatFactorProductWithinBudget,
  prepareSubstatFactorBudgetQuery,
  type SubstatFactorBudgetMaximum,
  type SubstatFactorClass,
} from "./substat-factor-budget";

function exhaustiveMaximum(
  crt: readonly SubstatFactorClass[],
  det: readonly SubstatFactorClass[],
  dht: readonly SubstatFactorClass[],
  budget: number,
): SubstatFactorBudgetMaximum | undefined {
  let best: SubstatFactorBudgetMaximum | undefined;
  for (let crtIndex = 0; crtIndex < crt.length; crtIndex += 1) {
    for (let detIndex = 0; detIndex < det.length; detIndex += 1) {
      for (let dhtIndex = 0; dhtIndex < dht.length; dhtIndex += 1) {
        if (crt[crtIndex].min + det[detIndex].min + dht[dhtIndex].min > budget) continue;
        const product = BigInt(crt[crtIndex].value) * BigInt(det[detIndex].value) * BigInt(dht[dhtIndex].value);
        if (best === undefined || product > best.product) {
          best = { product, crtIndex, detIndex, dhtIndex };
        }
      }
    }
  }
  return best;
}

describe("CRT/DET/DHT factor budget maximum", () => {
  test("matches an exhaustive oracle over small class domains and budgets", () => {
    const crt = [
      { min: 0, value: 7 },
      { min: 2, value: 11 },
      { min: 5, value: 13 },
    ];
    const det = [
      { min: 1, value: 3 },
      { min: 4, value: 17 },
      { min: 6, value: 19 },
    ];
    const dht = [
      { min: 0, value: 5 },
      { min: 3, value: 23 },
      { min: 7, value: 29 },
    ];

    const query = prepareSubstatFactorBudgetQuery(crt, det, dht);
    expect(query).toBeTypeOf("function");
    for (let budget = 0; budget <= 20; budget += 1) {
      expect(query?.(budget))
        .toEqual(exhaustiveMaximum(crt, det, dht, budget));
    }
  });

  test("includes combinations exactly on the budget boundary", () => {
    const query = prepareSubstatFactorBudgetQuery(
      [{ min: 4, value: 2 }],
      [{ min: 5, value: 3 }],
      [{ min: 6, value: 7 }],
    );
    expect(query?.(15)).toEqual({ product: 42n, crtIndex: 0, detIndex: 0, dhtIndex: 0 });

    expect(query?.(14)).toBeUndefined();
  });

  test("returns undefined for empty groups or when every triple exceeds budget", () => {
    const emptyGroupQuery = prepareSubstatFactorBudgetQuery([], [{ min: 0, value: 1 }], [{ min: 0, value: 1 }]);
    expect(emptyGroupQuery?.(0))
      .toBeUndefined();
    const query = prepareSubstatFactorBudgetQuery(
      [{ min: 1, value: 1 }],
      [{ min: 1, value: 1 }],
      [{ min: 1, value: 1 }],
    );
    expect(query?.(2))
      .toBeUndefined();
  });

  test("fails open for invalid numeric input or a work limit that is exceeded", () => {
    const valid = [{ min: 0, value: 1 }];
    const query = prepareSubstatFactorBudgetQuery(valid, valid, valid);
    expect(maxSubstatFactorProductWithinBudget(valid, valid, valid, -1)).toBeUndefined();
    expect(maxSubstatFactorProductWithinBudget(valid, valid, valid, Number.NaN)).toBeUndefined();
    expect(maxSubstatFactorProductWithinBudget(valid, valid, valid, Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
    expect(query?.(-1)).toBeUndefined();
    expect(query?.(Number.NaN)).toBeUndefined();
    expect(prepareSubstatFactorBudgetQuery([{ min: -1, value: 2 }], valid, valid)).toBeUndefined();
    expect(prepareSubstatFactorBudgetQuery([{ min: 0, value: Number.POSITIVE_INFINITY }], valid, valid))
      .toBeUndefined();
    expect(prepareSubstatFactorBudgetQuery(valid, valid, valid, { maxWork: -1 })).toBeUndefined();
    expect(prepareSubstatFactorBudgetQuery(valid, valid, valid, { maxWork: 0 })).toBeUndefined();
    expect(prepareSubstatFactorBudgetQuery(valid, valid, valid, { maxWork: Number.NaN })).toBeUndefined();
  });

  test("keeps the lexically earliest triple when factor products tie", () => {
    const equalFactorClasses = [
      { min: 5, value: 2 },
      { min: 0, value: 2 },
    ];
    const query = prepareSubstatFactorBudgetQuery(
      equalFactorClasses,
      equalFactorClasses,
      equalFactorClasses,
    );
    expect(query?.(15)).toEqual({ product: 8n, crtIndex: 0, detIndex: 0, dhtIndex: 0 });

    const zeroFactorQuery = prepareSubstatFactorBudgetQuery(
      [{ min: 3, value: 1 }, { min: 0, value: 100 }],
      [{ min: 0, value: 1 }],
      [{ min: 0, value: 0 }],
    );
    expect(zeroFactorQuery?.(3)).toEqual({ product: 0n, crtIndex: 0, detIndex: 0, dhtIndex: 0 });
  });
});
