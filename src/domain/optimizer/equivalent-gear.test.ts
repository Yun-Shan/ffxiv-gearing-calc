import { afterEach, describe, expect, it, vi } from "vitest";
import * as gearOptions from "../gear-options";
import * as candidates from "./equipment-candidates";
import { equipmentIdentity } from "../search/equipment-identity";
import type {
  Gear,
  GearSlot,
  MeldedGear,
  OptimizationConfig,
  OptimizationResult,
  Stats,
} from "../types";
import type { GearCandidate } from "./context";
import { attachEquivalentGear } from "./equivalent-gear";

const config: OptimizationConfig = {
  jobId: "SAM",
  minItemLevel: 1,
  maxItemLevel: 795,
  sync: { kind: "itemLevel", value: 735 },
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  foodId: 0,
};
function gear(
  id: number,
  slot: GearSlot = "ring",
  stats: Stats = { CRT: 100 },
): MeldedGear {
  return {
    id,
    slot,
    name: `gear-${id}`,
    level: 790,
    equipLevel: 100,
    rawSlot: 0,
    roleId: 0,
    jobCategory: 0,
    stats,
    materiaSlots: 0,
    jobs: ["SAM"],
    finalStats: stats,
    melds: [],
  };
}
function result(gear: MeldedGear[]): OptimizationResult {
  return {
    gear,
    food: {
      id: 1,
      name: "test",
      level: 1,
      stats: {},
      statRates: {},
      actualStats: {},
      utilization: 0,
    },
    stats: {},
    effects: {} as OptimizationResult["effects"],
    score: 1,
    damagePerSecond: 1,
    objective: "damage",
    gcdTier: 2.5,
    searchedCandidates: 1,
    durationMs: 1,
  };
}
function pool(
  items: MeldedGear[],
  adjustment?: GearCandidate["equipment"]["resistanceWeaponAdjust"],
) {
  vi.spyOn(gearOptions, "gearOptionsFor").mockImplementation((_, slot) =>
    items.filter((g) => g.slot === (slot === "ring2" ? "ring" : slot)),
  );
  vi.spyOn(candidates, "makeGearCandidates").mockImplementation(
    (raw, slot, _, map) => {
      const item = {
        ...raw,
        slot,
        melds: (raw as MeldedGear).melds,
        finalStats: (raw as MeldedGear).finalStats,
      };
      const equipment: GearCandidate["equipment"] = {
        itemId: raw.id,
        itemLevel: raw.level,
        key: "",
        baseParams: [],
        PDMG: raw.stats.PDMG ?? 0,
        MDMG: raw.stats.MDMG ?? 0,
        DLY: raw.stats.DLY ?? 0,
        resistanceWeaponAdjust: raw.resistanceWeaponAdjust
          ? (adjustment ?? raw.resistanceWeaponAdjust)
          : undefined,
      };
      map.set(equipmentIdentity(equipment), item);
      return [{ gear: item, equipment }];
    },
  );
}
afterEach(() => vi.restoreAllMocks());

describe("complete equivalent result groups", () => {
  it.each([false, true])("omits the identical two-unique-ring pool when both are equipped (reversed: %s)", (reversed) => {
    const a = { ...gear(1), unique: true };
    const b = { ...gear(2), unique: true };
    pool([a, b]);
    const pair = reversed ? [b, a] : [a, b];
    const original = result([pair[0]!, { ...pair[1]!, slot: "ring2" }]);
    const next = attachEquivalentGear(original, config);
    expect(next.equivalentGear).toBeUndefined();
    for (const selected of next.gear) {
      expect(selected).not.toHaveProperty("replacementGroupKey");
      expect(selected).not.toHaveProperty("uniqueReplacementGroupKey");
    }
    expect(next.gear).toEqual(original.gear);
    expect(next.stats).toBe(original.stats);
    expect(next.score).toBe(original.score);
  });

  it("keeps unrelated replacement groups when omitting the equipped unique ring pair", () => {
    const a = { ...gear(1), unique: true };
    const b = { ...gear(2), unique: true };
    const head = gear(3, "head");
    pool([a, b, head, gear(4, "head")]);
    const next = attachEquivalentGear(result([a, { ...b, slot: "ring2" }, head]), config);
    expect(Object.keys(next.equivalentGear!)).toHaveLength(1);
    expect(next.equivalentGear![next.gear[2]!.replacementGroupKey!]!.map((item) => item.id)).toEqual([3, 4]);
    expect(next.gear[0]).not.toHaveProperty("replacementGroupKey");
    expect(next.gear[1]).not.toHaveProperty("replacementGroupKey");
  });

  it("keeps a pool with a third unique ring", () => {
    const items = [1, 2, 3].map((id) => ({ ...gear(id), unique: true }));
    pool(items);
    const next = attachEquivalentGear(result([items[0]!, { ...items[1]!, slot: "ring2" }]), config);
    expect(next.equivalentGear![next.gear[0]!.replacementGroupKey!]).toHaveLength(3);
  });

  it("keeps different two-unique-ring pools", () => {
    const a = { ...gear(1), unique: true };
    const b = { ...gear(2), unique: true };
    const c = { ...gear(3, "ring", { DET: 100 }), unique: true };
    const d = { ...gear(4, "ring", { DET: 100 }), unique: true };
    pool([a, b, c, d]);
    const next = attachEquivalentGear(result([a, { ...c, slot: "ring2" }]), config);
    expect(next.gear[0]!.replacementGroupKey).toBeDefined();
    expect(next.gear[1]!.replacementGroupKey).toBeDefined();
    expect(next.gear[0]!.replacementGroupKey).not.toBe(next.gear[1]!.replacementGroupKey);
  });

  it("keeps the unforced pool when the other unique ring is forced", () => {
    const a = { ...gear(1), unique: true };
    const b = { ...gear(2), unique: true };
    pool([a, b]);
    const next = attachEquivalentGear(result([a, { ...b, slot: "ring2" }]), {
      ...config, forcedGear: { ring2: b.id },
    });
    expect(next.equivalentGear![next.gear[0]!.replacementGroupKey!]).toHaveLength(2);
    expect(next.gear[1]).not.toHaveProperty("replacementGroupKey");
  });

  it("keeps selected, includes unique rings in the full array and indexes their subset, and shares groups across both ring slots", () => {
    const a = gear(1),
      b = { ...gear(2), unique: true },
      c = gear(3, "ring", { CRT: 101 });
    pool([a, b, c]);
    const original = result([a, { ...b, slot: "ring2" }]);
    const next = attachEquivalentGear(original, config);
    expect(next.gear[0]!.replacementGroupKey).toBe(
      next.gear[1]!.replacementGroupKey,
    );
    expect(next.gear[0]!.uniqueReplacementGroupKey).toBe(
      next.gear[1]!.uniqueReplacementGroupKey,
    );
    expect(
      next.equivalentGear![next.gear[0]!.replacementGroupKey!]!.map(
        (g) => g.id,
      ),
    ).toEqual([1, 2]);
    expect(
      next.equivalentGear![next.gear[0]!.uniqueReplacementGroupKey!]!.map(
        (g) => g.id,
      ),
    ).toEqual([2]);
    expect(original.gear[0]).not.toHaveProperty("replacementGroupKey");
    expect(next.stats).toBe(original.stats);
    expect(next.effects).toBe(original.effects);
    expect(next.food).toBe(original.food);
  });
  it("omits all replacement keys and arrays for forced singleton ordinary and unique rings", () => {
    const a = gear(1),
      b = { ...gear(2), unique: true };
    pool([a, b]);
    const next = attachEquivalentGear(result([a, { ...b, slot: "ring2" }]), {
      ...config,
      forcedGear: { ring: 1, ring2: 2 },
    });
    expect(next.equivalentGear).toBeUndefined();
    for (const selected of next.gear) {
      expect(selected).not.toHaveProperty("replacementGroupKey");
      expect(selected).not.toHaveProperty("uniqueReplacementGroupKey");
    }
  });
  it.each([
    1,
    { id: 1, melds: [null] },
    { id: 1, customStats: { CRT: 36 } },
  ])("skips all equivalent candidate generation for forced value %j", (forced) => {
    const selected = gear(1);
    pool([selected, gear(2)]);
    const next = attachEquivalentGear(result([selected]), {
      ...config, forcedGear: { ring: forced },
    });
    expect(candidates.makeGearCandidates).not.toHaveBeenCalled();
    expect(next.equivalentGear).toBeUndefined();
    expect(next.gear[0]).not.toHaveProperty("replacementGroupKey");
    expect(next.gear[0]).not.toHaveProperty("uniqueReplacementGroupKey");
    expect(next.gear[0]!.id).toBe(1);
  });
  it("compares all final weapon stats, performance and delay; zero equals an absent stat", () => {
    const a = {
      ...gear(1, "weapon", { CRT: 100, PDMG: 100, MDMG: 50, DLY: 2800 }),
      weaponDamage: 100,
    };
    const b = {
      ...a,
      id: 2,
      name: "gear-2",
      finalStats: { ...a.finalStats, DET: 0 },
    };
    const c = { ...a, id: 3, finalStats: { ...a.finalStats, DLY: 3000 } };
    const d = { ...a, id: 4, finalStats: { ...a.finalStats, MDMG: 51 } };
    const e = { ...a, id: 5, weaponDamage: 101 };
    pool([e, c, b, a, d]);
    const next = attachEquivalentGear(result([a]), config);
    expect(
      next.equivalentGear![next.gear[0]!.replacementGroupKey!]!.map(
        (g) => g.id,
      ),
    ).toEqual([1, 2]);
    expect(next.gear[0]).not.toHaveProperty("uniqueReplacementGroupKey");
  });
  it("orders complete groups by ascending item level then numeric item ID", () => {
    const items = [
      { ...gear(1, "head"), level: 795, name: "A" },
      { ...gear(10, "head"), level: 780, name: "B" },
      { ...gear(2, "head"), level: 780, name: "Z" },
      { ...gear(3, "head"), level: 790, name: "C" },
    ];
    pool(items);
    const next = attachEquivalentGear(result([items[0]!]), config);
    expect(next.equivalentGear![next.gear[0]!.replacementGroupKey!]!.map(g => g.id)).toEqual([2, 10, 3, 1]);
  });
  it("preserves distinct complete meld plans for the same physical item", () => {
    const a = gear(1, "head"),
      b = { ...a, melds: [{ stat: "CRT" as const, value: 36, grade: 12 }] };
    pool([a, b]);
    const next = attachEquivalentGear(result([a]), config);
    expect(
      next.equivalentGear![next.gear[0]!.replacementGroupKey!]!,
    ).toHaveLength(2);
  });
  it("does not attach groups without sync and honors cancellation / invalid selected snapshots", () => {
    const original = result([gear(1)]);
    expect(
      attachEquivalentGear(original, { ...config, sync: undefined }),
    ).toBe(original);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      attachEquivalentGear(original, config, { signal: controller.signal }),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));
    pool([]);
    expect(() => attachEquivalentGear(original, config)).toThrow(
      "当前装备不在合法同属性候选中",
    );
  });
  it("matches bounded resistance allocations without enumerating all assignments", () => {
    const adjustment = {
      maxTotalStats: 100,
      maxEachStat: 70,
      stats: ["CRT", "DET"] as const,
    };
    const base = {
      ...gear(1, "weapon", { CRT: 10, DET: 10, PDMG: 100, DLY: 2800 }),
      resistanceWeaponAdjust: { ...adjustment, stats: [...adjustment.stats] },
    };
    const target = {
      ...base,
      finalStats: { ...base.finalStats, CRT: 40, DET: 50 },
      melds: [
        { stat: "CRT" as const, value: 30, grade: 0 },
        { stat: "DET" as const, value: 40, grade: 0 },
      ],
    };
    pool([base, { ...base, id: 2, name: "second resistance weapon" }]);
    const next = attachEquivalentGear(result([target]), config);
    expect(
      next.equivalentGear![next.gear[0]!.replacementGroupKey!]![0]!.melds,
    ).toEqual(target.melds);
  });
  it.each([
    [{ CRT: 9, DET: 10 }, {}],
    [{ CRT: 10.5, DET: 10 }, {}],
    [{ CRT: 81, DET: 10 }, {}],
    [{ CRT: 70, DET: 70 }, {}],
    [{ CRT: 30, DET: 10 }, { CRT: 10 }],
    [{ CRT: 10, DET: 10, DLY: 999 }, {}],
  ])(
    "excludes resistance candidates outside bounds or with different fixed stats: %j",
    (targetStats, statMaximums) => {
      const base = {
        ...gear(2, "weapon", { CRT: 10, DET: 10 }),
        resistanceWeaponAdjust: {
          maxTotalStats: 100,
          maxEachStat: 70,
          stats: ["CRT", "DET"] as ("CRT" | "DET")[],
        },
      };
      const selected = gear(1, "weapon", targetStats);
      pool([selected, base], { ...base.resistanceWeaponAdjust, statMaximums });
      const next = attachEquivalentGear(result([selected]), config);
      expect(next.equivalentGear).toBeUndefined();
      expect(next.gear[0]).not.toHaveProperty("replacementGroupKey");
    },
  );
});
