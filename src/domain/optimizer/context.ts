import { gameData } from "../data.ts";
import { jobSchemas } from "../jobs.ts";
import { jobLevelFor, slotsForJob } from "../gear-options.ts";
import type { ExactMipOptions } from "../search/loadout-finder-exact-mip.ts";
import type {
  Food,
  JobId,
  MeldedGear,
  CustomizableStat,
  ResistanceWeaponAdjust,
  Stat,
} from "../types.ts";

export { jobLevelFor, slotsForJob };

export type SolverParam = { baseParamId: number; value: number };
export type SolverFoodParam = {
  baseValue?: number;
  baseParamId: number;
  multiplier: number;
  maxValue: number;
};
export type SolverFood = {
  itemId: number;
  itemLevel: number;
  key: string;
  physicalKey?: string;
  baseParams: SolverFoodParam[];
};
export type SolverGear = {
  itemId: number;
  itemLevel: number;
  /** 区分具体的魔晶石分配，即使属性封顶后总属性相同也能保留不同方案。 */
  variantKey?: string;
  key: string;
  baseParams: SolverParam[];
  PDMG: number;
  MDMG: number;
  DLY: number;
  resistanceWeaponAdjust?: ResistanceWeaponAdjust & {
    /** 当前品级同步上限对各项属性造成的削减值。 */
    statMaximums?: Partial<Record<CustomizableStat, number>>;
  };
  ringEquips?: readonly [SolverGear, SolverGear];
};
export type GearCandidate = { equipment: SolverGear; gear: MeldedGear };
export type SearchSlot = {
  name: string;
  candidates: SolverGear[];
};
export type PreparedSearch = {
  jobId: JobId;
  jobLevel: number;
  jobSchema: (typeof jobSchemas)[JobId];
  /** 族群基础属性索引；结果还原与摘要使用同一值。 */
  clanIndex: number;
  objective: "damage" | "dps";
  slots: SearchSlot[];
  foods: SolverFood[];
  gearsByIdentity: Map<string, MeldedGear>;
  foodsByIdentity: Map<string, Food>;
  searchedCandidates: number;
  options: ExactMipOptions;
};

const combatStatSet = new Set<Stat>([
  "STR",
  "DEX",
  "INT",
  "MND",
  "VIT",
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
  "PDMG",
  "MDMG",
  "DLY",
]);

// 这些是优化器内部的向量坐标，由生成数据中的 Stat 名称派生，绝不是 Lumina BaseParam 行 ID。
export const attributeStats: Stat[] = (() => {
  const stats = new Set<Stat>(["PDMG", "MDMG", "DLY"]);
  for (const stat of gameData.gearStatNames) {
    if (stat !== "main" && stat !== "secondary" && combatStatSet.has(stat))
      stats.add(stat);
  }
  for (const food of gameData.foods) {
    for (const stat of Object.keys(food.stats) as Stat[]) {
      if (combatStatSet.has(stat)) stats.add(stat);
    }
  }
  for (const schema of Object.values(gameData.jobSchemas)) {
    for (const stat of schema.stats) stats.add(stat);
  }
  return [...stats].sort();
})();
export const attributeIndex = new Map<Stat, number>(
  attributeStats.map((stat, index) => [stat, index]),
);
export const attributeIds = attributeStats.map((_, index) => index);
export const statIndexes = new Map<Stat, number>(attributeIndex);

function abortError(reason?: unknown): Error {
  const error = reason instanceof Error ? reason : new Error("搜索已取消");
  if (error.name !== "AbortError") error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

export function jobSlots(jobId: JobId): string[] {
  return [...slotsForJob(jobId).filter((slot) => slot !== "ring" && slot !== "ring2"), "rings"];
}
