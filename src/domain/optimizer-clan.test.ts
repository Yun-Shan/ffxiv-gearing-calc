import { expect, test } from "vitest";
import { gears } from "./data";
import { runOptimizationLocally } from "./optimizer";
import type { OptimizationConfig } from "./types";

const maxLevel = Math.max(...gears.map((gear) => gear.level));
const base: OptimizationConfig = {
  jobId: "SAM",
  minItemLevel: maxLevel - 15,
  maxItemLevel: maxLevel,
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  sharedSlots: [],
  foodId: 0,
  objective: "damage",
};

test("searcher uses the configured clan base attributes", async () => {
  const defaultClan = await runOptimizationLocally(base);
  const otherClan = await runOptimizationLocally({ ...base, clanIndex: 4 });
  expect(defaultClan?.stats.STR).toBe(6501);
  expect(otherClan?.stats.STR).toBe(6498);
  expect(otherClan!.effects.damage).toBeLessThan(defaultClan!.effects.damage);
}, 120_000);
