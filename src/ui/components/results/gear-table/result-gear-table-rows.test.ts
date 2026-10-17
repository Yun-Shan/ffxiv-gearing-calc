import { describe, expect, it } from "vitest";
import type {
  Food,
  MeldedGear,
  OptimizationConfig,
  OptimizationResult,
  Stats,
} from "@/domain";
import {
  buildResultGearTableRows,
  buildGearTableGearItem,
  equivalentGearKey,
  replaceEquivalentGear,
  type OptimizationResultWithEquivalentGear,
} from "./result-gear-table-rows";
import { collectGearTableStatColumns } from "./GearTableView";

function gear(id: number, crt: number): MeldedGear {
  const stats: Stats = { CRT: crt, PDMG: 120, MDMG: 120, DLY: 2640 };
  return {
    id,
    name: `武器 ${id}`,
    slot: "weapon",
    rawSlot: 0,
    level: 700,
    equipLevel: 100,
    roleId: 0,
    jobCategory: 0,
    stats,
    materiaSlots: 2,
    source: "test",
    jobs: ["PLD"],
    sourceFile: "test.json",
    melds: [],
    finalStats: stats,
  };
}

const food: Food = {
  id: 200,
  name: "保存的食物",
  level: 700,
  stats: { DET: 20 },
  statRates: { DET: 10 },
  sourceFile: "food.json",
};

function result(): OptimizationResultWithEquivalentGear {
  const selected = { ...gear(1, 10), replacementGroupKey: "weapon-group" };
  const replacement = gear(2, 20);
  const another = gear(3, 30);
  return {
    calculationLevel: 100,
    gear: [selected],
    food: { ...food, actualStats: { DET: 7 }, utilization: 35 },
    stats: { STR: 999, CRT: 44 },
    effects: {
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
    },
    score: 100,
    objective: "damage",
    damagePerSecond: 800,
    gcdTier: 0,
    searchedCandidates: 1,
    durationMs: 100,
    equivalentGear: { "weapon-group": [selected, replacement, another] },
  };
}

describe("Result GearTable adapter", () => {
  it("builds rows from saved gear, food, and total stat snapshots", () => {
    const rows = buildResultGearTableRows(result(), {
      jobId: "PLD",
      syncLevel: 1,
    } as OptimizationConfig);
    expect(rows.find((row) => row.item.kind === "gear")?.item.stats).toEqual({
      CRT: 10,
    });
    const weaponRow = rows.find((row) => row.item.kind === "gear");
    expect(
      weaponRow?.item.kind === "gear" && weaponRow.item.weaponPerformance,
    ).toContain("物理基本性能 120");
    expect(collectGearTableStatColumns(rows)).not.toEqual(
      expect.arrayContaining(["PDMG", "MDMG", "DLY"]),
    );
    const foodRow = rows.find((row) => row.item.kind === "food");
    expect(foodRow?.item.stats).toEqual({ DET: 20 });
    expect(foodRow?.item.kind === "food" && foodRow.item.statsMeaning).toBe(
      "actual-gain",
    );
    if (foodRow?.item.kind === "food") {
      expect(
        collectGearTableStatColumns([
          {
            ...foodRow,
            item: {
              ...foodRow.item,
              actualStats: { DHT: 12 },
              statsMeaning: "actual-gain",
            },
          },
        ]),
      ).toContain("DHT");
    }
    expect(rows.find((row) => row.item.kind === "summary")?.item.stats).toEqual(
      { STR: 999, CRT: 44 },
    );

  });

  it("keeps the full replacement group and marks the selected item", () => {
    const before = result();
    const group = before.equivalentGear!["weapon-group"]!;
    const replacementKey = equivalentGearKey(group[1]!);
    const after = replaceEquivalentGear(before, "weapon", replacementKey);
    expect(after.gear[0]?.id).toBe(2);
    expect(after.equivalentGear?.["weapon-group"]?.map(({ id }) => id)).toEqual([
      1, 2, 3,
    ]);
    expect(after.equivalentGear?.["weapon-group"]).toBe(group);
    expect(before.gear[0]?.id).toBe(1);
    expect(before.equivalentGear?.["weapon-group"]?.map(({ id }) => id)).toEqual([
      1, 2, 3,
    ]);
    expect(after.stats).toBe(before.stats);
    expect(after.durationMs).toBe(before.durationMs);
    const row = buildResultGearTableRows(
      after,
      { jobId: "PLD" } as OptimizationConfig,
      { onReplacementSelect: () => undefined },
    ).find((candidate) => candidate.item.kind === "gear");
    expect(row?.item.kind).toBe("gear");
    if (row?.item.kind === "gear" && "replacements" in row) {
      expect(row.replacements?.map(({ itemId }) => itemId)).toEqual([1, 2, 3]);
      expect(
        row.replacements?.filter(({ replacementSelected }) => replacementSelected)
          .map(({ itemId }) => itemId),
      ).toEqual([2]);
    } else {
      throw new Error("没有生成可替换装备行。");
    }
    // Keep the logical row mounted so the replacement trigger can regain focus.
    const config = { jobId: "PLD", syncLevel: 700 } as OptimizationConfig;
    expect(buildResultGearTableRows(after, config)[0]?.key).toBe(
      buildResultGearTableRows(before, config)[0]?.key,
    );
  });

  it("rejects a key that is not in the requested slot replacement list", () => {
    expect(() => replaceEquivalentGear(result(), "weapon", "unknown")).toThrow(
      "无法在 武器 槽位选择该等价装备",
    );
  });

  it("uses the complete ring group and disables an already equipped unique ring", () => {
    const makeRing = (id: number, unique: boolean, crt: number) => ({
      ...gear(id, crt),
      slot: "ring" as const,
      unique,
      replacementGroupKey: "all-rings",
      uniqueReplacementGroupKey: "unique-rings",
    });
    const first = makeRing(10, false, 10);
    const second = makeRing(11, false, 11);
    const unique = makeRing(12, true, 12);
    const anotherUnique = makeRing(13, true, 13);
    const before: OptimizationResultWithEquivalentGear = {
      ...result(),
      gear: [
        first,
        { ...second, slot: "ring2" },
      ],
      equivalentGear: {
        "all-rings": [first, second, unique, anotherUnique],
        "unique-rings": [unique, anotherUnique],
      },
    };

    const after = replaceEquivalentGear(
      before,
      "ring",
      equivalentGearKey(unique),
    );
    expect(after.gear[0]).toMatchObject({
      id: unique.id,
      slot: "ring",
      replacementGroupKey: "all-rings",
      uniqueReplacementGroupKey: "unique-rings",
    });
    expect(after.equivalentGear).toBe(before.equivalentGear);

    const rows = buildResultGearTableRows(
      after,
      { jobId: "PLD" } as OptimizationConfig,
      { onReplacementSelect: () => undefined },
    );
    const secondRingRow = rows.find((row) => row.key === "gear-ring2");
    expect(secondRingRow?.item.kind).toBe("gear");
    if (secondRingRow?.item.kind === "gear" && "replacements" in secondRingRow) {
      expect(secondRingRow.replacements?.map(({ itemId, slot }) => [itemId, slot])).toEqual([
        [10, "ring2"],
        [11, "ring2"],
        [12, "ring2"],
        [13, "ring2"],
      ]);
      expect(
        secondRingRow.replacements?.find(({ itemId }) => itemId === unique.id),
      ).toMatchObject({ replacementDisabled: true, replacementSelected: false });
      expect(
        secondRingRow.replacements?.find(({ itemId }) => itemId === second.id),
      ).toMatchObject({ replacementSelected: true });
    } else {
      throw new Error("没有生成第二戒指的可替换装备行。");
    }

    expect(() =>
      replaceEquivalentGear(after, "ring2", equivalentGearKey({ ...unique, slot: "ring2" })),
    ).toThrow("该唯一戒指已装备在另一戒指槽位");
  });

  it("keeps UI snapshot gear variants distinct in replacement identity", () => {
    const base = gear(42, 10);
    const variants = [
      { ...base, variantKey: "materia-a" },
      { ...base, variantKey: "materia-b" },
      { ...base, stats: { CRT: 10, DET: 25 } },
      { ...base, weaponDamage: 120 },
      { ...base, hq: true },
    ];
    expect(new Set(variants.map(equivalentGearKey)).size).toBe(variants.length);
  });
});

describe("materia slot display", () => {
  it("preserves original order and marks entries beyond the safe slots without sorting by grade", () => {
    const item = gear(10, 0);
    item.melds = [
      { stat: "CRT", value: 54, grade: 12 },
      { stat: "CRT", value: 18, grade: 11 },
      { stat: "DET", value: 54, grade: 12 },
      { stat: "DHT", value: 18, grade: 11 },
      { stat: "DET", value: 18, grade: 11 },
    ];
    const output = buildGearTableGearItem(item);
    expect(output.melds.map(({ stat, value }) => ({ stat, value }))).toEqual(
      item.melds.map(({ stat, value }) => ({ stat, value })),
    );
    expect(output.melds.map((meld) => meld.isOvermeld)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(item.melds[1]!.grade).toBe(11);
  });
  it("does not label grade-zero custom parameter allocations as overmelds", () => {
    const item = gear(11, 0);
    item.materiaSlots = 0;
    item.melds = [{ stat: "CRT", value: 100, grade: 0 }];
    expect(buildGearTableGearItem(item).melds[0]!.isOvermeld).toBe(false);
  });
});

it("uses the complete domain food-effect snapshot", () => {
  const calculated = result();
  calculated.food = {
    ...calculated.food,
    actualStats: { DET: 7 },
    utilization: 35,
  };
  const row = buildResultGearTableRows(calculated, {
    jobId: "PLD",
  } as OptimizationConfig).find((row) => row.item.kind === "food")!;
  expect(row.item).toMatchObject({
    stats: { DET: 20 },
    actualStats: { DET: 7 },
    utilization: 35,
    statsMeaning: "actual-gain",
  });
});
