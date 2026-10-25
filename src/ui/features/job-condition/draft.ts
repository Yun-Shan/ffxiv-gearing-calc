import type { UiOptimizationConfig as OptimizationConfig } from "@/ui/services/search-config";
import type { FoodDraft, GcdDraft, JobConditionDraft } from "./types";

export function createJobConditionRuntime() {
  return { gcdAnalysis: { status: "idle" as const } };
}

export function jobConditionDraftFromConfig(
  config: OptimizationConfig,
): JobConditionDraft {
  const gcd: GcdDraft =
    config.speedMin !== undefined || config.speedMax !== undefined
      ? { mode: "speed", min: config.speedMin, max: config.speedMax }
      : config.gcdChoices !== undefined
        ? { mode: "tiers", tiers: [...config.gcdChoices] }
        : { mode: "any" };
  const food: FoodDraft =
    config.foodId === 0
      ? { mode: "auto" }
      : { mode: "specific", foodId: config.foodId };

  return {
    range: {
      minItemLevel: config.minItemLevel,
      maxItemLevel: config.maxItemLevel,
      sync: config.sync,
      syncDuty: config.syncDuty,
      clanIndex: config.clanIndex,
    },
    gcd,
    food,
    tank:
      config.minTenacity !== undefined
        ? { strategy: "tenacity", minimumTenacity: config.minTenacity }
        : config.toughnessMinPercent !== undefined
          ? {
              strategy: "reduction",
              minimumDamageReductionPercent: config.toughnessMinPercent,
            }
          : { strategy: config.maximizeTenacity ? "maximize" : "any" },
  };
}
