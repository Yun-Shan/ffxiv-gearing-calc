import { gameData } from "../data.ts";
import { currentLevel, jobSchemas } from "../jobs.ts";
import type { ExactMipOptions } from "../search/loadout-finder-exact-mip.ts";
import type {
  Food,
  GearSlot,
  JobId,
  MeldedGear,
  OptimizationConfig,
  Stat,
} from "../types.ts";

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
  /** Distinguishes the concrete materia assignment even when caps clip totals to the same stats. */
  variantKey?: string;
  key: string;
  baseParams: SolverParam[];
  PDMG: number;
  MDMG: number;
  DLY: number;
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

// These are vector coordinates internal to the optimizer. They are derived from
// the generated data's Stat names and are never Lumina BaseParam row IDs.
export const attributeStats: Stat[] = (() => {
  const stats = new Set<Stat>(["PDMG", "MDMG", "DLY"]);
  for (const gear of gameData.gears) {
    for (const stat of Object.keys(gear.stats) as Stat[]) {
      if (combatStatSet.has(stat)) stats.add(stat);
    }
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

const nonRingSlotOrder: GearSlot[] = [
  "weapon",
  "offhand",
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
];

function abortError(reason?: unknown): Error {
  const error = reason instanceof Error ? reason : new Error("搜索已取消");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

export function jobLevelFor(config: OptimizationConfig): number {
  const schema = jobSchemas[config.jobId];
  if (schema === undefined)
    throw new RangeError(`缺少职业 ${config.jobId} 的领域规则`);
  const maxJobLevel = schema.maxJobLevel ?? currentLevel;
  const level = config.jobLevel ?? Math.min(currentLevel, maxJobLevel);
  if (
    !Number.isSafeInteger(level) ||
    level > maxJobLevel ||
    !Object.hasOwn(gameData.jobLevelModifiers, level)
  ) {
    throw new RangeError(`不支持的职业等级：${level}`);
  }
  return level;
}

function nonRingSlotsForJob(jobId: JobId): GearSlot[] {
  return nonRingSlotOrder.filter(
    (slot) => slot !== "offhand" || jobId === "PLD" || jobId === "BST",
  );
}

export function jobSlots(jobId: JobId): string[] {
  return [...nonRingSlotsForJob(jobId), "rings"];
}

export function slotsForJob(jobId: JobId): GearSlot[] {
  return [...nonRingSlotsForJob(jobId), "ring", "ring2"];
}
