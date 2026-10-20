import {
  defaultDataVersion,
  dataProvenance,
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

/** Identity for calculations, persisted results and cross-version comparisons. */
export const currentDataVersion = defaultDataVersion;
/** Game asset version, also used to validate the independently generated icon catalogs. */
export const displayedDataVersion =
  dataProvenance.sources?.find(source => source.kind === "mcp" && source.gameVersion)?.gameVersion ?? dataProvenance.commit.slice(0, 12);

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

// Asvel 常用同步品级，加上已确认提供的 50 级旧内容档位。
const popularSyncLevels = [
  795, 735, 700, 695, 665, 635, 605, 475, 375, 345, 300, 135, 120, 100,
] as const;
export const selectableSyncLevels = popularSyncLevels.filter((level) =>
  gameData.levelCaps.level.includes(level),
);

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
    syncLevel: undefined,
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
