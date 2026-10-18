import { describe, expect, it } from "vitest";
import { findFeasibleGcdsLocally, runOptimizationLocally } from "./optimizer";
import type { OptimizationConfig } from "./types";

const forcedGear: OptimizationConfig["forcedGear"] = {
  weapon: 42146,
  head: 42166,
  body: 42167,
  hands: 42168,
  legs: 42169,
  feet: 42170,
  earrings: 42201,
  necklace: 42206,
  bracelet: 42211,
  ring: 42216,
  ring2: 42216,
};

const config: OptimizationConfig = {
  jobId: "WAR",
  minItemLevel: 663,
  maxItemLevel: 663,
  syncLevel: 665,
  maximizeTenacity: false,
  objective: "damage",
  excludedSources: [],
  forcedGear,
  sharedSlots: [],
  foodId: 0,
  gcdChoices: [],
};

describe("sync GCD query", () => {
  it("applies the sync calculation level and only returns formally searchable tiers", async () => {
    const tiers = findFeasibleGcdsLocally(config);
    expect(tiers).toContain(2.4);
    expect(tiers).not.toContain(2.24);
    for (const tier of tiers) {
      const result = await runOptimizationLocally({
        ...config,
        gcdChoices: [tier],
      });
      expect(result?.effects.gcd, `GCD ${tier}`).toBe(tier);
    }
  }, 120_000);
});
