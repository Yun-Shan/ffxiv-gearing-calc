import type {
  Effects,
  FoodResult,
  GearSlot,
  JointOptimizationConfig,
  OptimizationConfig,
  OptimizationResult,
  ResultGear,
  Stats,
  Materia,
} from "../domain/types.ts";

export const MAX_LINK_CHARS = 32768;
/** Absolute allocation ceiling; each actual link also reserves its location prefix. */
export const MAX_RAW_BYTES = Math.floor((MAX_LINK_CHARS * 3) / 4);
export const STAT_CODES = [
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
  "STR",
  "DEX",
  "INT",
  "VIT",
  "MND",
  "PDMG",
  "MDMG",
  "DLY",
] as const;
export const SLOT_CODES: readonly GearSlot[] = [
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
  "ring",
  "ring2",
];
export const SHARED_SLOTS = SLOT_CODES.slice(2);
export interface UnknownSourceRef {
  unknownSourceId: number;
}
export type ShareSource = string | UnknownSourceRef;
export type ShareConfig = Omit<
  OptimizationConfig,
  "excludedSources" | "maxSearchMs"
> & { syncDuty?: string; excludedSources?: ShareSource[] };
export type ShareJointConfig = Omit<
  JointOptimizationConfig,
  "jobs" | "cacheLimit" | "maxSearchMs"
> & { jobs: ShareConfig[] };
export type ShareMeld = Pick<Materia, "stat" | "grade"> & { value?: number };
export type SharePattern = (ShareMeld | null)[] | { choice: number };
export interface ShareIdentity {
  itemId: number;
  pattern: SharePattern;
}
export interface ShareChoice {
  slot: GearSlot;
  identity: number;
}
export interface ShareRow {
  gear: ShareChoice[];
  foodId: number;
}

/** Wire semantics contain no derived attributes, replacement pools or proof. */
export interface ShareDocument {
  mode: "single" | "joint";
  dataVersion: string;
  elapsedMs: number;
  identities: ShareIdentity[];
  configs: ShareConfig[];
  commonSlots: GearSlot[];
  foodStrategy: "shared" | "independent";
  rows: ShareRow[];
  baselines: number[];
  jointValue?: number;
}

export interface ShareResult {
  calculationLevel: number;
  gear: ResultGear[];
  equivalentGear?: OptimizationResult["equivalentGear"];
  food: FoodResult;
  stats: Stats;
  effects: Effects;
  score: number;
  objective: "damage" | "dps";
  damagePerSecond: number;
  gcdTier: number;
  statistics: { elapsedMs: number };
}
export interface ShareView {
  document: ShareDocument;
  results: ShareResult[];
  unknownSourceIds: number[];
}
export interface ShareInput {
  mode: "single" | "joint";
  config: ShareConfig | ShareJointConfig;
  results: readonly ShareResult[];
  dataVersion: string;
  elapsedMs: number;
  baselines?: number[];
  jointValue?: number;
}
export function isUnknownSource(value: ShareSource): value is UnknownSourceRef {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger(value.unknownSourceId) &&
    value.unknownSourceId >= 0 &&
    Object.keys(value).length === 1
  );
}
