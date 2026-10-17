import type { Effects, FoodResult, JobId, MeldedGear, Stats } from "@/domain";

/** Saved result values used by Comparison; the UI never recalculates them. */
export interface GearsetResultSnapshot {
  jobId: JobId;
  calculationLevel: number;
  syncItemLevel?: number;
  gear: readonly MeldedGear[];
  food?: FoodResult;
  stats: Stats;
  effects: Effects;
  damagePerPotency: number;
  damagePerSecond: number;
}

export type ComparisonEntrySource =
  { kind: "history"; historyId: string } | { kind: "import"; url: string };

export interface ComparisonEntry {
  /** Stable UI identity; deliberately excluded from the result snapshot. */
  entryId: string;
  snapshot: GearsetResultSnapshot;
  dataVersion: string;
  source: ComparisonEntrySource;
}

let fallbackEntryId = 0;

export function createComparisonEntryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackEntryId += 1;
  return `comparison-${Date.now()}-${fallbackEntryId}`;
}

export interface ImportedGearsetCalculation {
  snapshot: GearsetResultSnapshot;
  dataVersion: string;
}

/** UI adapter for evaluating a complete linked loadout with domain formulas. */
export type ResolveImportedGearset = (
  url: string,
) => Promise<ImportedGearsetCalculation>;
