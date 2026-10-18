import type { OptimizationConfig } from "@/domain";
import type { FoodDraft, GcdDraft, JobConditionDraft } from "./types";

export function createInitialJobConditionRuntime() {
  return { gcdAnalysis: { status: "idle" as const } };
}

export const createJobConditionRuntime = createInitialJobConditionRuntime;

export function jobConditionDraftFromConfig(
  config: OptimizationConfig,
): JobConditionDraft {
  const gcd: GcdDraft =
    config.speedMin !== undefined || config.speedMax !== undefined
      ? { mode: "speed", min: config.speedMin, max: config.speedMax }
      : config.gcdChoices !== undefined
        ? { mode: "tiers", tiers: [...config.gcdChoices] }
        : config.gcdTarget !== undefined
          ? { mode: "tiers", tiers: [config.gcdTarget] }
          : { mode: "any" };
  const food: FoodDraft =
    config.foodId === 0
      ? { mode: "auto" }
      : { mode: "specific", foodId: config.foodId };

  return {
    range: {
      minItemLevel: config.minItemLevel,
      maxItemLevel: config.maxItemLevel,
      sync:
        config.syncLevel === undefined
          ? { mode: "disabled" }
          : { mode: "enabled", itemLevel: config.syncLevel },
      clanIndex: config.clanIndex ?? 0,
    },
    gcd,
    food,
    tank: {
      minimumTenacity: config.minTenacity,
      minimumDamageReductionPercent: config.toughnessMinPercent,
      maximizeTenacity: config.maximizeTenacity,
    },
  };
}

/** Values that only existed in the editing session are intentionally normalized away. */
export function normalizeCompiledDraft(
  config: OptimizationConfig,
): JobConditionDraft {
  return jobConditionDraftFromConfig(config);
}
