import { describe, expect, it, vi } from "vitest";
import type { Effects, FoodResult, MeldedGear, Stats } from "@/domain";
import {
  createComparisonEntryId,
  type ComparisonEntry,
  type GearsetResultSnapshot,
} from "./types";
import {
  appendComparisonEntry,
  approveComparisonJobChange,
  buildComparisonGearTableRows,
  buildComparisonMetricEntries,
  comparisonEntryValidationError,
  comparisonPlanLabel,
  hasCrossDataVersion,
  MAX_COMPARISON_ENTRIES,
  removeComparisonEntry,
} from "./comparison-model";

function testGear(
  id: number,
  slot: MeldedGear["slot"],
  crt: number,
): MeldedGear {
  const stats: Stats = { CRT: crt };
  return {
    id,
    name: `装备 ${id}`,
    slot,
    rawSlot: 0,
    level: 700,
    equipLevel: 100,
    roleId: 0,
    jobCategory: 0,
    stats,
    materiaSlots: 2,
    source: "测试来源",
    jobs: ["PLD"],
    sourceFile: "test.json",
    melds: [{ stat: "CRT", value: 36, grade: 12 }],
    finalStats: stats,
  };
}

function testFood(id: number): FoodResult {
  return {
    id,
    name: `食物 ${id}`,
    level: 700,
    stats: { DET: 50 },
    statRates: { DET: 10 },
    actualStats: { DET: 50 },
    utilization: 100,
    sourceFile: "food-test.json",
  };
}

function testEffects(overrides: Partial<Effects> = {}): Effects {
  return {
    crtChance: 0.2,
    crtDamage: 1.4,
    detDamage: 1.1,
    dhtChance: 0.05,
    tenDamage: 1,
    tenMitigation: 0.01,
    damage: 100,
    gcd: 2.5,
    hp: 1000,
    mp: 1000,
    ...overrides,
  };
}

function entry({
  damage = 100,
  dps = 800,
  gcd = 2.5,
  mitigation = 0.01,
  dataVersion = "v1",
  gear = [testGear(1, "weapon", 100)],
  food = testFood(10),
}: {
  damage?: number;
  dps?: number;
  gcd?: number;
  mitigation?: number;
  dataVersion?: string;
  gear?: MeldedGear[];
  food?: FoodResult;
} = {}): ComparisonEntry {
  const snapshot: GearsetResultSnapshot = {
    jobId: "PLD",
    calculationLevel: 100,
    gear,
    food,
    stats: { STR: 2000 },
    effects: testEffects({ damage, gcd, tenMitigation: mitigation }),
    damagePerPotency: damage,
    damagePerSecond: dps,
  };
  return {
    entryId: createComparisonEntryId(),
    snapshot,
    dataVersion,
    source: { kind: "history", historyId: `history-${damage}` },
  };
}

describe("gear comparison model", () => {
  it("merges default socket order with identical explicit imported positions", () => {
    const original = testGear(1, "weapon", 100);
    const imported = {
      ...original,
      melds: original.melds.map((meld, slotIndex) => ({ ...meld, slotIndex })),
    };
    const rows = buildComparisonGearTableRows([
      entry({ gear: [original] }),
      entry({ gear: [imported] }),
    ]);
    expect(rows.filter((row) => row.item.kind === "gear")).toMatchObject([
      { marker: "全部" },
    ]);
    const moved = {
      ...imported,
      melds: imported.melds.map((meld) => ({ ...meld, slotIndex: 2 })),
    };
    expect(
      buildComparisonGearTableRows([
        entry({ gear: [original] }),
        entry({ gear: [moved] }),
      ]).filter((row) => row.item.kind === "gear"),
    ).toHaveLength(2);
  });

  it("rejects invalid damage values and mixed jobs before adding", () => {
    expect(
      comparisonEntryValidationError(entry({ damage: 0 }), "PLD"),
    ).toContain("伤害指标");
    expect(() =>
      appendComparisonEntry([], entry({ damage: Number.NaN }), "PLD"),
    ).toThrow("伤害指标");
    expect(
      comparisonEntryValidationError(
        {
          ...entry(),
          snapshot: { ...entry().snapshot, jobId: "WAR" },
        },
        "PLD",
      ),
    ).toContain("职业不匹配");
  });

  it("limits comparison to four and promotes the next entry after baseline deletion", () => {
    const entries = [100, 110, 120, 130].map((damage) => entry({ damage }));
    expect(
      entries.reduce(
        (current, next) => appendComparisonEntry(current, next, "PLD"),
        [] as ComparisonEntry[],
      ),
    ).toHaveLength(MAX_COMPARISON_ENTRIES);
    expect(() =>
      appendComparisonEntry(entries, entry({ damage: 140 }), "PLD"),
    ).toThrow("最多同时比较 4 套方案");

    const afterBaselineRemoval = removeComparisonEntry(entries, 0);
    expect(afterBaselineRemoval).toEqual(entries.slice(1));
    expect(buildComparisonMetricEntries(afterBaselineRemoval)[0]?.label).toBe(
      "A",
    );
    expect(removeComparisonEntry(afterBaselineRemoval, 0)).toHaveLength(2);
    expect(removeComparisonEntry([entries[0]!], 0)).toEqual([]);
    expect(comparisonPlanLabel(3)).toBe("D");
  });

  it("keeps duplicate source entries independently keyed when either is removed", () => {
    const first = entry({ damage: 100 });
    const duplicate = { ...first, entryId: createComparisonEntryId() };
    const entries = [first, duplicate];
    expect(new Set(entries.map(({ entryId }) => entryId)).size).toBe(2);
    const afterBaselineRemoval = removeComparisonEntry(entries, 0);
    expect(afterBaselineRemoval).toEqual([duplicate]);
    expect(buildComparisonMetricEntries(afterBaselineRemoval)[0]?.label).toBe(
      "A",
    );
  });

  it("requires confirmation only when the current selection is nonempty", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    expect(await approveComparisonJobChange([], confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(await approveComparisonJobChange([entry()], confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("uses saved metrics and baseline-relative absolute, percent, and pp deltas", () => {
    const metrics = buildComparisonMetricEntries([
      entry({ damage: 100, dps: 800, gcd: 2.5, mitigation: 0.01 }),
      entry({ damage: 110, dps: 840, gcd: 2.48, mitigation: 0.012 }),
    ]);
    expect(metrics[0]?.damagePerPotency).toBe(100);
    expect(metrics[1]?.deltas?.damagePerPotency).toEqual({
      absolute: 10,
      percent: 10,
    });
    expect(metrics[1]?.deltas?.damagePerSecond).toEqual({
      absolute: 40,
      percent: 5,
    });
    expect(metrics[1]?.deltas?.gcd).toBeCloseTo(-0.02);
    expect(metrics[1]?.deltas?.tenacityMitigationPp).toBeCloseTo(0.2);
  });

  it("groups identical gear and food, while preserving distinct meld/stat variants", () => {
    const sharedGear = testGear(1, "weapon", 100);
    const entries = [
      entry({ gear: [sharedGear], food: testFood(10) }),
      entry({
        damage: 110,
        gear: [testGear(2, "weapon", 100)],
        food: testFood(11),
      }),
      entry({ damage: 120, gear: [sharedGear], food: testFood(10) }),
    ];
    const rows = buildComparisonGearTableRows(entries);
    const weaponRows = rows.filter((row) => row.item.kind === "gear");
    const foodRows = rows.filter((row) => row.item.kind === "food");
    expect(weaponRows).toHaveLength(2);
    expect(weaponRows.map((row) => row.marker)).toEqual(["A/C", "B"]);
    expect(weaponRows.map((row) => row.slotLabel)).toEqual(["武器", ""]);
    expect(foodRows).toHaveLength(2);
    expect(foodRows.map((row) => row.marker)).toEqual(["A/C", "B"]);
    expect(
      foodRows.every(
        (row) =>
          row.item.kind === "food" && row.item.statsMeaning === "actual-gain",
      ),
    ).toBe(true);
    expect(rows.filter((row) => row.item.kind === "summary")).toHaveLength(3);
    expect(hasCrossDataVersion(entries)).toBe(false);
    expect(
      hasCrossDataVersion([entries[0]!, { ...entries[1]!, dataVersion: "v2" }]),
    ).toBe(true);
  });

  it("does not merge same-id gear snapshots with distinct UI variant keys", () => {
    const original = testGear(77, "weapon", 100);
    const variantA = { ...original, variantKey: "variant-a" };
    const variantB = { ...original, variantKey: "variant-b" };
    const rows = buildComparisonGearTableRows([
      entry({ gear: [variantA] }),
      entry({ damage: 110, gear: [variantB] }),
    ]);
    const weaponRows = rows.filter((row) => row.item.kind === "gear");
    expect(weaponRows).toHaveLength(2);
    expect(weaponRows.map((row) => row.marker)).toEqual(["A", "B"]);
  });
});

it("preserves per-result food gains and utilization when grouping comparison food rows", () => {
  const first = entry();
  const second = entry();
  first.snapshot.food = {
    ...first.snapshot.food!,
    actualStats: { DET: 25 },
    utilization: 50,
  };
  second.snapshot.food = {
    ...second.snapshot.food!,
    actualStats: { DET: 50 },
    utilization: 100,
  };
  const foodRows = buildComparisonGearTableRows([first, second]).filter(
    (row) => row.item.kind === "food",
  );
  expect(foodRows).toHaveLength(2);
  expect(foodRows.map((row) => row.item)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actualStats: { DET: 25 }, utilization: 50 }),
      expect.objectContaining({ actualStats: { DET: 50 }, utilization: 100 }),
    ]),
  );
});
