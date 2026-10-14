import {
  dataProvenance,
  foods,
  gameData,
  jobSchemas,
  type GearSlot,
  type JobId,
  type OptimizationConfig,
} from "@/domain";
import type { SingleGcdMode } from "./types";

export type CommonSlot = GearSlot;

export const displayedDataVersion =
  dataProvenance.sources?.find((source) => source.kind === "mcp" && source.gameVersion)?.gameVersion ??
  dataProvenance.commit.slice(0, 12);

export const bounds = [gameData.gearMinLevel, gameData.gearMaxLevel] as const;
export const availableFoods = foods.filter((food) => food.best && food.stats.VIT);
export const defaultJobLevel = 100;

// 与 Asvel 同步品级选择器中标记为常用的选项保持一致。
const popularSyncLevels = [795, 735, 700, 695, 665, 635, 605, 475, 375, 345, 300] as const;
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
    minItemLevel: jobSchemas[jobId].defaultItemLevel?.[0] ?? Math.max(bounds[0], bounds[1] - 15),
    maxItemLevel: jobSchemas[jobId].defaultItemLevel?.[1] ?? bounds[1],
    jobLevel: jobSchemas[jobId].maxJobLevel ?? defaultJobLevel,
    syncLevel: undefined,
    gcdTarget: undefined,
    gcdChoices: undefined,
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

export function singleGcdModeForConfig(config: OptimizationConfig): SingleGcdMode {
  if (config.speedMin !== undefined || config.speedMax !== undefined) return "speed";
  if (config.gcdChoices !== undefined) return "tiers";
  return "any";
}
