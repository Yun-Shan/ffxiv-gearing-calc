import assert from "node:assert/strict";
import { test } from "vitest";
import { gameData } from "./data";
import { gearOptionsFor, runOptimizationLocally, slotsForJob } from "./optimizer";
import type { GearSlot, OptimizationConfig } from "./types";

test("real BLU default-level search accepts an unrestricted zero-materia weapon", async () => {
  const defaultItemLevel = gameData.jobSchemas.BLU.defaultItemLevel;
  assert.ok(defaultItemLevel);
  const base: OptimizationConfig = {
    jobId: "BLU",
    minItemLevel: defaultItemLevel[0],
    maxItemLevel: defaultItemLevel[1],
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
  };

  const zeroMateriaWeapon = gearOptionsFor(base, "weapon").find((gear) =>
    gear.materiaSlots === 0 && gear.customParameters === undefined);
  assert.ok(zeroMateriaWeapon, "the production BLU pool includes a zero-materia weapon");
  const nonUniqueRing = gearOptionsFor(base, "ring").find((gear) => gear.unique === false);
  assert.ok(nonUniqueRing, "the production BLU pool includes a repeatable ring");

  const forcedGear: Partial<Record<GearSlot, number>> = { weapon: zeroMateriaWeapon.id };
  for (const slot of slotsForJob("BLU")) {
    if (slot === "weapon" || slot === "ring" || slot === "ring2") continue;
    const candidate = gearOptionsFor(base, slot).find((gear) => gear.customParameters === undefined);
    assert.ok(candidate, `production gear exists for ${slot}`);
    forcedGear[slot] = candidate.id;
  }
  forcedGear.ring = nonUniqueRing.id;
  forcedGear.ring2 = nonUniqueRing.id;

  const result = await runOptimizationLocally({ ...base, forcedGear });
  assert.ok(result);
  assert.equal(result.gear.length, 11);
  const weapon = result.gear.find((gear) => gear.slot === "weapon");
  assert.ok(weapon);
  assert.equal(weapon.id, zeroMateriaWeapon.id);
  assert.equal(weapon.materiaSlots, 0);
  assert.deepEqual(weapon.melds, []);
  assert.ok(result.effects.damage > 0);
  assert.ok(result.food);
});
