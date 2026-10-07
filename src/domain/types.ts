import type { HighsCallbackTrace, LinearMipProgress } from "./search/linear-mip.ts";

export type Stat =
  | "STR"
  | "DEX"
  | "INT"
  | "MND"
  | "VIT"
  | "CRT"
  | "DET"
  | "DHT"
  | "SKS"
  | "SPS"
  | "TEN"
  | "PIE"
  | "PDMG"
  | "MDMG"
  | "DLY";
export type JobId =
  | "PLD"
  | "WAR"
  | "DRK"
  | "GNB"
  | "WHM"
  | "SCH"
  | "AST"
  | "SGE"
  | "MNK"
  | "DRG"
  | "NIN"
  | "SAM"
  | "RPR"
  | "VPR"
  | "BRD"
  | "MCH"
  | "DNC"
  | "BLM"
  | "BLU"
  | "SMN"
  | "RDM"
  | "PCT"
  | "BST";
export type GearSlot =
  | "weapon"
  | "offhand"
  | "head"
  | "body"
  | "hands"
  | "legs"
  | "feet"
  | "earrings"
  | "necklace"
  | "bracelet"
  | "ring"
  | "ring2";

export type Stats = Partial<Record<Stat, number>>;

export interface Gear {
  id: number;
  name: string;
  slot: GearSlot;
  rawSlot: number;
  level: number;
  equipLevel: number;
  roleId: number;
  jobCategory: number;
  stats: Stats;
  materiaSlots: number;
  materiaAdvanced?: true;
  /** Item-level unique flag when it is available in the generated source data. */
  unique?: boolean;
  hq?: true;
  customizable?: true;
  customParameters?: CustomWeaponParameter[];
  source?: string;
  jobs: JobId[];
  weaponDamage?: number;
  sourceFile: string;
  dataSources?: DataSourceRef[];
}

export interface CustomWeaponParameter {
  materiaId: number;
  stat: Exclude<Stat, "STR" | "DEX" | "INT" | "MND" | "VIT" | "PDMG" | "MDMG" | "DLY">;
  bigValueIndex: number;
  smallValueIndex: number;
  bigValue: number;
  smallValue: number;
}

export interface Food {
  id: number;
  name: string;
  level: number;
  stats: Stats;
  statRates: Stats;
  best?: true;
  sourceFile: string;
  dataSources?: DataSourceRef[];
}

export interface Materia {
  stat: Exclude<Stat, "STR" | "DEX" | "INT" | "MND" | "VIT" | "PDMG" | "MDMG" | "DLY">;
  value: number;
  grade: number;
}

export interface JobSchema {
  id: JobId;
  name: string;
  isLimitedJob: boolean;
  role: "tank" | "healer" | "str" | "dex" | "int";
  mainStat: "STR" | "DEX" | "INT" | "MND" | "VIT";
  secondaryStat: "SKS" | "SPS" | "TEN" | "PIE" | "DHT";
  attackStat: "STR" | "DEX" | "INT" | "MND";
  stats: Stat[];
  statModifiers: Partial<Record<Stat | "hp" | "gcd", number>>;
  partyBonus?: number;
  gcdModifier: number;
  traitDamageMultiplier: number;
  /** Maximum character level supported by this job. */
  maxJobLevel?: number;
  /** The source gives limited-job weapons zero item-level weight. */
  ignoreWeaponItemLevel?: boolean;
  /** Initial item-level range selected for this job in the optimizer. */
  defaultItemLevel?: readonly [number, number];
  dataSources?: DataSourceRef[];
}

export interface DataProvenance {
  repository: string;
  commit: string;
  importedAt: string;
  sourceFiles: string[];
  sources?: DataSourceRef[];
}

export interface DataSourceRef {
  kind: "mcp" | "reference";
  server?: string;
  repository?: string;
  commit?: string;
  sheet?: string;
  fields?: string[];
  rowIds?: number[];
  gameVersion?: string;
  validatedVersion?: string;
  queriedAt?: string;
  importedAt?: string;
  note?: string;
  sourceFiles?: string[];
}

export interface LevelModifier {
  main: number;
  sub: number;
  div: number;
  det: number;
  detTrunc: number;
  ap: number;
  apTank: number;
  hp: number;
  vit: number;
  vitTank: number;
}

export interface CalculationInput {
  stats: Stats;
  job: JobSchema;
  level: number;
  weaponDamage: number;
}

export interface Effects {
  crtChance: number;
  crtDamage: number;
  detDamage: number;
  dhtChance: number;
  tenDamage: number;
  tenMitigation: number;
  damage: number;
  gcd: number;
  hp: number;
  mp: number;
}

export interface MeldedGear extends Gear {
  melds: Materia[];
  finalStats: Stats;
}

export interface OptimizationConfig {
  jobId: JobId;
  minItemLevel: number;
  maxItemLevel: number;
  /** Character level used for base stats and damage formulas. Defaults to currentLevel. */
  jobLevel?: number;
  /** Sync item attributes and weapon damage to this item level. */
  syncLevel?: number;
  gcdTarget?: number;
  gcdChoices?: number[];
  speedMin?: number;
  speedMax?: number;
  minTenacity?: number;
  /** Minimum final Tenacity after base attributes, equipment, and food. */
  toughnessMin?: number;
  toughnessMinPercent?: number;
  maximizeTenacity: boolean;
  objective?: "damage" | "dps";
  excludedSources: string[];
  excludedGearIds?: number[];
  forcedGear: Partial<Record<GearSlot, number>>;
  sharedSlots?: GearSlot[];
  foodId: number;
  maxSearchMs?: number;
}

export type CommonGearSlot = GearSlot | "rings";

export interface JointOptimizationConfig {
  jobs: OptimizationConfig[];
  commonSlots: CommonGearSlot[];
  foodStrategy: "shared" | "independent";
  objective?: "damage" | "dps";
  maxSearchMs?: number;
  cacheLimit?: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onCandidateCounts?: (counts: SearchCandidateCounts) => void;
  onSolverProgress?: (event: LinearMipProgress) => void;
  /** Opt-in full solver callback snapshots for diagnostics. */
  onSolverCallback?: (event: HighsCallbackTrace) => void;
}

export interface SearchCandidateCounts {
  jobId: JobId;
  /** Candidate counts from the exact slot pools prepared for the solver. */
  slots: { slot: string; count: number }[];
  foodCount: number;
}

export interface OptimizationResult {
  gear: MeldedGear[];
  food: Food;
  stats: Stats;
  effects: Effects;
  score: number;
  objective: "damage" | "dps";
  damagePerSecond: number;
  gcdTier: number;
  searchedCandidates: number;
  durationMs: number;
  maximumTenacity?: number;
  statistics?: object;
}

export interface JointOptimizationResult {
  jobResults: Partial<Record<JobId, OptimizationResult>>;
  optima: Partial<Record<JobId, OptimizationResult>>;
  commonGear: Partial<Record<CommonGearSlot, MeldedGear[]>>;
  commonFood?: Food;
  objective: "damage" | "dps";
  value: { numerator: string; denominator: string; approximate: number };
  proof: {
    complete: true;
    objective: "damage" | "dps";
    optimalityScope: string;
    outerBound: string;
    innerSolverStatus: "Optimal";
    formalCertificate: false;
    numericalLimitation: string;
    terminationReason: string;
  };
  statistics: {
    elapsedMs: number;
    timeLimitMs: number;
    outerNodes: number;
    completeNodes: number;
    upperBoundPrunes: number;
    relaxedOptimaAttained: number;
    innerSolves: number;
    parentResultReuses: number;
    cacheHits: number;
    cacheMisses: number;
    cacheEntries: number;
    cacheLimit: number;
    rssBytes?: number;
    heapUsedBytes?: number;
  };
}

export const combatSlots: GearSlot[] = [
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
export const combatStats: Exclude<
  Stat,
  "STR" | "DEX" | "INT" | "MND" | "VIT" | "PDMG" | "MDMG" | "DLY"
>[] = ["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"];
