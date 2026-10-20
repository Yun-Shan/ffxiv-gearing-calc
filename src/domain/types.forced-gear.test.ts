import { describe, expect, it } from "vitest";
import {
  assertForcedGearValue,
  cloneForcedGearValue,
  cloneForcedGearMap,
  forcedGearEqual,
  forcedGearId,
} from "./types.ts";
import type { ForcedGearMap, ForcedGearValue } from "./types.ts";

describe("forced gear value helpers", () => {
  it("clones complete force maps and removes undefined entries without sharing nested values", () => {
    const original: ForcedGearMap = {
      head: 123,
      body: { id: 456, melds: [{ stat: "CRT", grade: 12, value: 54 }, null] },
      weapon: { id: 789, customStats: { CRT: 209 } },
      ring: undefined,
    };
    const before = structuredClone(original);
    const cloned = cloneForcedGearMap(original);
    expect(cloned).toEqual({ head: original.head, body: original.body, weapon: original.weapon });
    expect(cloned).not.toBe(original);
    const body = cloned.body as Extract<ForcedGearValue, { melds: unknown }>;
    body.melds[0]!.value = 1;
    const weapon = cloned.weapon as Extract<ForcedGearValue, { customStats: unknown }>;
    weapon.customStats.CRT = 1;
    expect(original).toEqual(before);
    expect(cloneForcedGearMap({})).toEqual({});
  });
  it("validates legacy IDs and both object forms", () => {
    expect(() => assertForcedGearValue(undefined)).not.toThrow();
    expect(() => assertForcedGearValue(123)).not.toThrow();
    expect(() =>
      assertForcedGearValue({ id: 123, melds: [null] }),
    ).not.toThrow();
    expect(() =>
      assertForcedGearValue({ id: 123, customStats: { CRT: 10 } }),
    ).not.toThrow();

    for (const id of [1, Number.MAX_SAFE_INTEGER]) {
      for (const value of [id, { id, melds: [] }, { id, customStats: {} }]) {
        expect(() => assertForcedGearValue(value)).not.toThrow();
      }
    }
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      for (const value of [id, { id, melds: [] }, { id, customStats: {} }]) {
        expect(() => assertForcedGearValue(value)).toThrow("ID 必须是正安全整数");
      }
    }
    for (const value of [
      null,
      [],
      "123",
      { id: 123 },
      { id: 123, melds: [], customStats: {} },
      { id: 123, melds: [], extra: true },
      { id: 0, customStats: {} },
      { id: 123, melds: "CRT" },
      { id: 123, customStats: null },
    ]) {
      expect(() => assertForcedGearValue(value)).toThrow(TypeError);
    }
  });

  it("extracts numeric IDs from every supported value", () => {
    expect(forcedGearId(undefined)).toBeUndefined();
    expect(forcedGearId(123)).toBe(123);
    expect(forcedGearId({ id: 234, melds: [null] })).toBe(234);
    expect(forcedGearId({ id: 345, customStats: { CRT: 10 } })).toBe(345);
  });

  it("deep clones mutable restrictions and compares them without property-order dependence", () => {
    const meldValue: ForcedGearValue = {
      id: 123,
      melds: [{ stat: "CRT", value: 36, grade: 12, slotIndex: 0 }, null],
    };
    const meldClone = cloneForcedGearValue(meldValue)!;
    expect(meldClone).toEqual(meldValue);
    expect(meldClone).not.toBe(meldValue);
    if (typeof meldClone !== "number" && "melds" in meldClone) {
      expect(meldClone.melds).not.toBe(
        (meldValue as Extract<ForcedGearValue, { melds: unknown }>).melds,
      );
      expect(meldClone.melds[0]).not.toBe(
        (meldValue as Extract<ForcedGearValue, { melds: unknown }>).melds[0],
      );
    }

    const statsValue: ForcedGearValue = {
      id: 456,
      customStats: { CRT: 20, DET: 10 },
    };
    const statsClone = cloneForcedGearValue(statsValue)!;
    expect(statsClone).toEqual(statsValue);
    expect(statsClone).not.toBe(statsValue);
    if (typeof statsClone !== "number" && "customStats" in statsClone) {
      expect(statsClone.customStats).not.toBe(
        (statsValue as Extract<ForcedGearValue, { customStats: unknown }>)
          .customStats,
      );
    }

    expect(cloneForcedGearValue(undefined)).toBeUndefined();
    expect(cloneForcedGearValue(789)).toBe(789);
    expect(
      forcedGearEqual(meldValue, {
        id: 123,
        melds: [{ slotIndex: 0, grade: 12, value: 36, stat: "CRT" }, null],
      }),
    ).toBe(true);
    expect(
      forcedGearEqual(statsValue, {
        id: 456,
        customStats: { DET: 10, CRT: 20 },
      }),
    ).toBe(true);
    expect(forcedGearEqual(123, 123)).toBe(true);
    expect(forcedGearEqual(123, { id: 123, melds: [] })).toBe(false);
    expect(forcedGearEqual(undefined, undefined)).toBe(true);
    expect(forcedGearEqual(undefined, 123)).toBe(false);
    expect(
      forcedGearEqual(meldValue, { id: 124, melds: meldValue.melds }),
    ).toBe(false);
    expect(
      forcedGearEqual(meldValue, {
        id: 123,
        melds: [null, meldValue.melds[0]!],
      }),
    ).toBe(false);
    expect(
      forcedGearEqual(statsValue, {
        id: 456,
        customStats: { CRT: 21, DET: 10 },
      }),
    ).toBe(false);
    expect(
      forcedGearEqual(
        { id: 999 } as ForcedGearValue,
        { id: 999 } as ForcedGearValue,
      ),
    ).toBe(false);
  });
});
