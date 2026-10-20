import { describe, expect, it } from "vitest";
import { gears } from "../data.ts";
import type { Materia, MeldedGear } from "../types.ts";
import {
  highestMateriaGrade,
  materiaForGrade,
} from "./equipment-candidates.ts";
import { restoreMateriaLayout } from "./materia-layout.ts";

function fixture(): MeldedGear {
  const raw = gears.find(
    (gear) =>
      gear.jobs.includes("SAM") &&
      gear.materiaAdvanced === true &&
      gear.materiaSlots === 2 &&
      gear.level >= 770,
  );
  if (!raw) throw new Error("缺少两安全孔禁断装备");
  return {
    ...raw,
    finalStats: { ...raw.stats },
    melds: Array.from({ length: 5 }, (_, index) => ({
      ...materiaForGrade(
        index % 2 === 0 ? "CRT" : "DET",
        highestMateriaGrade(raw.level, index <= 2),
      ),
      slotIndex: index,
    })),
  };
}

describe("materia layout after solving", () => {
  it("keeps ordinary legacy, synced and custom gear results unchanged", () => {
    const gear = fixture();
    for (const item of [
      { ...gear, melds: gear.melds.map(({ slotIndex: _, ...meld }) => meld) },
      { ...gear, melds: [] },
      { ...gear, customParameters: [] },
      {
        ...gear,
        resistanceWeaponAdjust: {
          maxTotalStats: 1,
          maxEachStat: 1,
          stats: ["CRT" as const],
        },
      },
    ])
      expect(restoreMateriaLayout(item, undefined)).toBe(item);
  });

  it("reserves lower-grade fixed gems before filling automatic holes and never mutates inputs", () => {
    const gear = fixture();
    const low = materiaForGrade("CRT", highestMateriaGrade(gear.level, false));
    const high = materiaForGrade("CRT", highestMateriaGrade(gear.level, true));
    const original = {
      ...gear,
      melds: [low, high, high, low, low].map((meld, slotIndex) => ({
        ...meld,
        slotIndex,
      })),
    };
    const requested: (Materia | null)[] = [low, null, null, null, null];
    const before = structuredClone(original);
    const restored = restoreMateriaLayout(original, {
      id: gear.id,
      melds: requested,
    });
    expect(restored.melds.map(({ grade }) => grade)).toEqual([
      low.grade,
      high.grade,
      high.grade,
      low.grade,
      low.grade,
    ]);
    expect(restored.finalStats).toBe(original.finalStats);
    expect(original).toEqual(before);
    expect(requested).toEqual([low, null, null, null, null]);
  });

  it("drops another slot's hole positions when this slot has no materia restriction", () => {
    const gear = fixture();
    const before = structuredClone(gear);
    for (const forced of [undefined, gear.id]) {
      const restored = restoreMateriaLayout(gear, forced);
      expect(restored.melds).toEqual(gear.melds.map(({ slotIndex: _, ...meld }) => meld));
      expect(restored.finalStats).toBe(gear.finalStats);
    }
    expect(gear).toEqual(before);
  });

  it("fails instead of silently dropping fixed gems or changing the selected multiset", () => {
    const gear = fixture();
    expect(() =>
      restoreMateriaLayout(gear, {
        id: gear.id + 1,
        melds: new Array(5).fill(null),
      }),
    ).toThrow(/无法按当前槽位限制还原/);
    expect(() =>
      restoreMateriaLayout(gear, { id: gear.id, melds: [] }),
    ).toThrow(/无法按当前槽位限制还原/);
    expect(() =>
      restoreMateriaLayout({ ...gear, melds: gear.melds.slice(1) }, { id: gear.id, melds: new Array(5).fill(null) }),
    ).toThrow(/无法按当前槽位限制还原/);
    expect(() =>
      restoreMateriaLayout(gear, {
        id: gear.id,
        melds: [
          materiaForGrade("DHT", gear.melds[0]!.grade),
          null,
          null,
          null,
          null,
        ],
      }),
    ).toThrow(/无法按当前槽位限制还原/);
    const low = materiaForGrade("CRT", highestMateriaGrade(gear.level, false));
    expect(() =>
      restoreMateriaLayout(
        { ...gear, melds: new Array(5).fill(low) },
        { id: gear.id, melds: new Array(5).fill(null) },
      ),
    ).toThrow(/无法按当前槽位限制还原/);
  });
});
