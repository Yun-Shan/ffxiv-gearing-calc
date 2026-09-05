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
  | "SMN"
  | "RDM"
  | "PCT";
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
  source?: string;
  jobs: JobId[];
  weaponDamage?: number;
  sourceFile: string;
}

export interface Food {
  id: number;
  name: string;
  level: number;
  stats: Stats;
  statRates: Stats;
  best?: true;
  sourceFile: string;
}

export interface Materia {
  stat: Exclude<Stat, "STR" | "DEX" | "INT" | "MND" | "VIT" | "PDMG" | "MDMG" | "DLY">;
  value: number;
  grade: number;
}

export interface JobSchema {
  id: JobId;
  name: string;
  role: "tank" | "healer" | "str" | "dex" | "int";
  mainStat: "STR" | "DEX" | "INT" | "MND" | "VIT";
  secondaryStat: "SKS" | "SPS" | "TEN" | "PIE" | "DHT";
  attackStat: "STR" | "DEX" | "INT" | "MND";
  stats: Stat[];
  statModifiers: Partial<Record<Stat | "hp" | "gcd", number>>;
  partyBonus?: number;
  gcdModifier: number;
  traitDamageMultiplier: number;
}

export interface DataProvenance {
  repository: string;
  commit: string;
  importedAt: string;
  sourceFiles: string[];
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
  gcdTarget?: number;
  minTenacity?: number;
  maximizeTenacity: boolean;
  excludedSources: string[];
  forcedGear: Partial<Record<GearSlot, number>>;
  sharedSlots: GearSlot[];
  foodId: number;
}

export interface OptimizationResult {
  gear: MeldedGear[];
  food: Food;
  stats: Stats;
  effects: Effects;
  score: number;
  gcdTier: number;
  searchedCandidates: number;
  durationMs: number;
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
