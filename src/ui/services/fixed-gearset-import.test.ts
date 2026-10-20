import { describe, expect, it } from "vitest";
import {
  defaultDataVersion,
  foods,
  gears,
  type OptimizationConfig,
} from "@/domain";
import { gearOptionsFor, slotsForJob } from "@/domain/gear-options";
import { runOptimizationLocally } from "@/domain/optimizer/single-search";
import {
  resultReferenceUrl,
  stringifyReferenceGearset,
} from "./reference-gearset-share";
import { currentDataVersion } from "./app-config";
import { resolveImportedGearset } from "./fixed-gearset-import";

function configFor(weaponId?: number): OptimizationConfig {
  const config: OptimizationConfig = {
    jobId: "SAM",
    minItemLevel: weaponId ? 1 : 780,
    maxItemLevel: 795,
    syncLevel: 475,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: foods.find((f) => f.id !== 0)!.id,
  };
  const rings = new Set<number>();
  for (const slot of slotsForJob(config.jobId)) {
    const candidate = gearOptionsFor(config, slot)
      .toSorted((a, b) => b.level - a.level)
      .find((g) =>
        slot === "weapon" && weaponId !== undefined
          ? g.id === weaponId
          : !g.customParameters &&
            !g.resistanceWeaponAdjust &&
            ((slot !== "ring" && slot !== "ring2") || !rings.has(g.id)),
      );
    if (!candidate) throw new Error(`Missing real fixture: ${slot}`);
    config.forcedGear[slot] = candidate.id;
    if (slot === "ring" || slot === "ring2") rings.add(candidate.id);
  }
  return config;
}

describe("fixed gearset import adapter", () => {
  it.each([2228, 59999])(
    "rejects unknown gear %i as an empty slot",
    async (id) => {
      expect(gears.some((gear) => gear.id === id)).toBe(false);
      const config = configFor();
      const complete = Object.values(config.forcedGear).map((gearId) => ({
        id: gearId as number,
        materias: [],
      }));
      for (const entries of [
        [{ id, materias: [] }, ...complete.slice(1)],
        [...complete, { id, materias: [] }],
        complete.slice(1),
      ]) {
        const payload = stringifyReferenceGearset({
          job: "SAM",
          role: "str",
          jobLevel: 100,
          foodId: config.foodId,
          gears: entries,
        })!;
        await expect(resolveImportedGearset(payload)).rejects.toThrow(
          "配装槽位不完整",
        );
      }
    },
  );
  it.each([42177, 52439])(
    "uses the job cap for gear %i when formula level is lower",
    async (itemId) => {
      const item = gears.find((g) => g.id === itemId)!;
      const config = configFor();
      config.minItemLevel = 1;
      config.syncLevel = 665;
      config.forcedGear[item.slot] = item.id;
      const result = (await runOptimizationLocally(config))!;
      expect(result.calculationLevel).toBe(90);
      const originalMelds = structuredClone(result.gear.map((g) => g.melds));
      const imported = await resolveImportedGearset(
        resultReferenceUrl(result, config)!,
      );
      expect(result.gear.map((g) => g.melds)).toEqual(originalMelds);
      expect(imported.snapshot.stats).toEqual(result.stats);
      expect(imported.snapshot.effects).toEqual(result.effects);
      expect(imported.snapshot.food).toEqual(result.food);
    },
    30_000,
  );

  it.each(["ordinary", "Manderville", "Resistance"])(
    "round-trips a real synced %s search result",
    async (kind) => {
      const weaponId =
        kind === "ordinary"
          ? undefined
          : gears.find(
              (g) =>
                g.jobs.includes("SAM") &&
                (kind === "Manderville"
                  ? g.customParameters?.length === 4
                  : g.resistanceWeaponAdjust !== undefined),
            )!.id;
      const config = configFor(weaponId);
      const result = (await runOptimizationLocally(config))!;
      expect(result).toBeDefined();
      const imported = await resolveImportedGearset(
        resultReferenceUrl(result, config)!,
      );
      expect(imported.dataVersion).toBe(defaultDataVersion);
      expect(imported.dataVersion).toBe(currentDataVersion);
      expect(imported.snapshot.calculationLevel).toBe(result.calculationLevel);
      expect(imported.snapshot.stats).toEqual(result.stats);
      expect(imported.snapshot.effects).toEqual(result.effects);
      expect(imported.snapshot.food).toEqual(result.food);
      expect(imported.snapshot.damagePerPotency).toBe(result.effects.damage);
      expect(imported.snapshot.damagePerSecond).toBe(result.damagePerSecond);
      expect(imported.snapshot).not.toHaveProperty("equivalentGear");
    },
    30_000,
  );

  it("rejects a link without food before calculation", async () => {
    const payload = stringifyReferenceGearset({
      job: "SAM",
      role: "str",
      jobLevel: 100,
      gears: [{ id: 42001, materias: [] }],
    })!;
    await expect(resolveImportedGearset(payload)).rejects.toThrow("食物");
  });
});
