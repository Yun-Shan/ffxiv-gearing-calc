import { describe, expect, it } from "vitest";
import { gameData, gears } from "../data";
import { gearOptionsFor, slotsForJob } from "../gear-options";
import { runOptimizationLocally } from "./single-search";
import type { JobId, MeldedGear, OptimizationConfig, OptimizationResult, Stats } from "../types";
import { makeGearCandidates } from "./equipment-candidates";
import { equipmentIdentity } from "../search/equipment-identity";
import { candidateGearFromInfo } from "./result-assembly";
import { attachEquivalentGear } from "./equivalent-gear";

function fixed(jobId: JobId, weaponId?: number): OptimizationConfig {
  const config: OptimizationConfig = {
    jobId,
    minItemLevel: 780,
    maxItemLevel: 795,
    syncLevel: 475,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
  };
  if (weaponId !== undefined) config.minItemLevel = 1;
  const rings = new Set<number>();
  for (const slot of slotsForJob(jobId)) {
    const pool = gearOptionsFor(config, slot).toSorted(
      (a, b) => b.level - a.level,
    );
    const item =
      slot === "weapon" && weaponId !== undefined
        ? pool.find((g) => g.id === weaponId)
        : pool.find(
            (g) =>
              !g.customParameters &&
              !g.resistanceWeaponAdjust &&
              ((slot !== "ring" && slot !== "ring2") || !rings.has(g.id)),
          );
    if (!item) throw new Error(`no real fixture for ${slot}`);
    config.forcedGear[slot] = item.id;
    if (slot === "ring" || slot === "ring2") rings.add(item.id);
  }
  return config;
}
function normalized(stats: Stats) {
  return Object.fromEntries(
    Object.entries(stats)
      .filter(([, v]) => v !== 0 && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
function choices(
  result: NonNullable<Awaited<ReturnType<typeof runOptimizationLocally>>>,
  gear: MeldedGear & {
    replacementGroupKey?: string;
    uniqueReplacementGroupKey?: string;
  },
) {
  if (!gear.replacementGroupKey && !gear.uniqueReplacementGroupKey)
    return [gear];
  return [
    ...(result.equivalentGear?.[gear.replacementGroupKey!] ?? []),

  ];
}

describe("real synced single replacement results", () => {
  it("isolates unforced ring results from the forced copy canonical layout", () => {
    const ring = gears.find((gear) => gear.id === 35241)!;
    expect(ring.unique).toBe(false);
    const config: OptimizationConfig = {
      jobId: "SAM", minItemLevel: 600, maxItemLevel: 600, syncLevel: 665,
      maximizeTenacity: false, excludedSources: [], foodId: 0,
      forcedGear: { ring2: { id: ring.id, melds: [null, null] } },
    };
    const gearsByIdentity = new Map<string, MeldedGear>();
    const numeric = makeGearCandidates(ring, "ring", config, gearsByIdentity)[0]!;
    const locked = makeGearCandidates(ring, "ring2", config, gearsByIdentity);
    expect(locked.some(({ equipment }) => equipmentIdentity(equipment) === equipmentIdentity(numeric.equipment))).toBe(true);
    const selected = candidateGearFromInfo(numeric.equipment, "ring", { gearsByIdentity, forcedGear: config.forcedGear });
    expect(selected.melds.every((meld) => meld.slotIndex === undefined)).toBe(true);
    const forced = candidateGearFromInfo(numeric.equipment, "ring2", { gearsByIdentity, forcedGear: config.forcedGear });
    expect(forced.melds.map((meld) => meld.slotIndex)).toEqual([0, 1]);
    expect([...gearsByIdentity.values()].some((gear) => gear.melds.some((meld) => meld.slotIndex !== undefined))).toBe(true);
    // This boundary only reads gear; search metrics are deliberately outside the fixture.
    const next = attachEquivalentGear({ gear: [selected] } as OptimizationResult, config);
    expect(next.gear[0]!.id).toBe(ring.id);
  });
  it("returns complete legal groups, preserves selected plans and observes exclusions / locks", async () => {
    const config = fixed("PLD");
    delete config.forcedGear.head;
    delete config.forcedGear.ring;
    delete config.forcedGear.ring2;
    const excluded = gearOptionsFor(config, "head")[0]!;
    config.excludedGearIds = [excluded.id];
    const result = (await runOptimizationLocally(config))!;
    expect(result).toBeDefined();
    for (const selected of result.gear) {
      const alternatives = choices(result, selected);
      expect(
        alternatives.some(
          (g) =>
            g.id === selected.id &&
            JSON.stringify(g.melds) === JSON.stringify(selected.melds),
        ),
      ).toBe(true);
      const allowed = gearOptionsFor(config, selected.slot).filter(
        (g) =>
          config.forcedGear[selected.slot] === undefined ||
          g.id === config.forcedGear[selected.slot],
      );
      for (const candidate of alternatives) {
        expect(allowed.some((g) => g.id === candidate.id)).toBe(true);
        expect(normalized(candidate.finalStats)).toEqual(
          normalized(selected.finalStats),
        );
        expect(candidate.weaponDamage).toBe(selected.weaponDamage);
        expect(candidate.id).not.toBe(excluded.id);
      }
      if (selected.uniqueReplacementGroupKey) {
        expect(
          result.equivalentGear![selected.uniqueReplacementGroupKey]!.every(
            (g) => g.unique,
          ),
        ).toBe(true);
      }
    }
    expect(
      choices(
        result,
        result.gear.find((g) => g.slot === "head")!,
      ).length,
    ).toBeGreaterThan(1);
    const unsynced = (await runOptimizationLocally({
      ...fixed("PLD"),
      syncLevel: undefined,
    }))!;
    expect(unsynced.equivalentGear).toBeUndefined();
    expect(
      unsynced.gear.every((g) => g.replacementGroupKey === undefined),
    ).toBe(true);
  }, 30_000);
  it("round-trips a real bounded resistance weapon allocation in its group", async () => {
    const weapon = gears.find(
      (g) => g.jobs.includes("SAM") && g.resistanceWeaponAdjust,
    )!;
    expect(weapon).toBeDefined();
    const result = (await runOptimizationLocally(fixed("SAM", weapon.id)))!;
    const selected = result.gear.find((g) => g.slot === "weapon")!;
    expect(selected.replacementGroupKey).toBeUndefined();
    const saved = choices(result, selected).find(
      (g) =>
        g.id === weapon.id &&
        JSON.stringify(g.melds) === JSON.stringify(selected.melds),
    );
    expect(saved).toBeDefined();
    expect(saved!.finalStats).toEqual(selected.finalStats);
    expect(saved!.melds.every((m) => m.grade === 0)).toBe(true);
  }, 30_000);
  it("does not offer equal-after-sync parameter alternatives for a forced Manderville weapon", async () => {
    const weapon = gears.find(
      (g) => g.jobs.includes("SAM") && g.customParameters?.length === 4,
    )!;
    const config = fixed("SAM", weapon.id);
    config.syncLevel = gameData.syncLevels[50]![0]!;
    const result = (await runOptimizationLocally(config))!;
    const selected = result.gear.find((g) => g.slot === "weapon")!;
    const plans = choices(result, selected).filter((g) => g.id === weapon.id);
    expect(plans).toHaveLength(1);
    expect(selected.replacementGroupKey).toBeUndefined();
    expect(new Set(plans.map((g) => JSON.stringify(g.melds))).size).toBe(
      plans.length,
    );
    expect(
      plans.every(
        (g) => g.melds.length === 3 && g.melds.every((m) => m.grade === 0),
      ),
    ).toBe(true);
    for (const plan of plans)
      expect(normalized(plan.finalStats)).toEqual(
        normalized(selected.finalStats),
      );
  }, 30_000);
});
