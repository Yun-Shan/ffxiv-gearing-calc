import {
  defaultDataVersion,
  foods,
  gameData,
  jobSchemas,
  searchFoods,
  type GearSlot,
  type JobId,
  type OptimizationConfig,
} from "@/domain";
import type { SingleGcdMode } from "./types";

export type CommonSlot = GearSlot;

/** Game version embedded in the generated game-data binary; result display metadata only. */
export const currentDataVersion = defaultDataVersion;

export const bounds = [gameData.gearMinLevel, gameData.gearMaxLevel] as const;
export const availableFoods = searchFoods.filter(
  (food) => food.best && food.stats.VIT,
);
/** Keep a saved, valid selection visible even when it is outside current recommendations. */
export function foodOptionsFor(foodId?: number) {
  const selected =
    foodId === undefined ? undefined : foods.find((food) => food.id === foodId);
  return selected && !availableFoods.some((food) => food.id === selected.id)
    ? [selected, ...availableFoods]
    : availableFoods;
}
export const defaultJobLevel = 100;

export const defaultCommonSlots: CommonSlot[] = [
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "ring2",
];

export function makeConfig(jobId: JobId): OptimizationConfig {
  return {
    jobId,
    minItemLevel:
      jobSchemas[jobId].defaultItemLevel?.[0] ??
      Math.max(bounds[0], bounds[1] - 15),
    maxItemLevel: jobSchemas[jobId].defaultItemLevel?.[1] ?? bounds[1],
    sync: undefined,
    gcdTarget: undefined,
    gcdChoices: [],
    speedMin: undefined,
    speedMax: undefined,
    minTenacity: undefined,
    toughnessMinPercent: undefined,
    maximizeTenacity: false,
    objective: "damage",
    excludedSources: [],
    excludedGearIds: [],
    forcedGear: {},
    sharedSlots: [],
    foodId: 0,
  };
}

export function singleGcdModeForConfig(
  config: OptimizationConfig,
): SingleGcdMode {
  if (config.speedMin !== undefined || config.speedMax !== undefined)
    return "speed";
  if (config.gcdChoices !== undefined) return "tiers";
  return "any";
}
