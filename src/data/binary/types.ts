import type {
  DataProvenance,
  GeneratedFood,
  GeneratedGear,
  GeneratedJob,
  GearStat,
  JobId,
  JobSchema,
  LevelModifier,
  Materia,
  Stat,
  SyncData,
} from "../../domain/types.ts";

export type MateriaTable = Partial<Record<Materia["stat"], number[]>>;
export type GearPhysicalGroup =
  "VIT" | "STR" | "DEX" | "MND" | "INT" | "SHARED";

export interface GeneratedGameData {
  version: string;
  provenance: DataProvenance;
  gears: GeneratedGear[];
  foods: GeneratedFood[];
  jobs: Record<JobId, GeneratedJob>;
  sync: SyncData;
  materias: MateriaTable;
  materiaGradeRequiredLevels: number[];
  materiaGradeIsRestricted: boolean[];
  bluMdmgAdditions: number[];
  levelCaps: Record<string, number[]>;
  slotCaps: Record<string, number[]>;
  roleCaps: Record<string, number[]>;
  baseStats: Partial<Record<Stat, "main" | "sub" | number>>;
  clanStats: Partial<Record<Stat, number[]>>;
  jobSchemas: Record<JobId, JobSchema>;
  jobLevelModifiers: Record<number, LevelModifier>;
  gearIndexesByMainStat: Record<
    "VIT" | "STR" | "DEX" | "MND" | "INT",
    Uint32Array
  >;
  gearLevelByRecordIndex: Uint16Array;
  gearPhysicalGroupRanges: Record<
    GearPhysicalGroup,
    { start: number; count: number }
  >;
  gearMinLevel: number;
  gearMaxLevel: number;
  gearStatNames: GearStat[];
  getGearAtRecordIndex(index: number): GeneratedGear;
  getGearById(id: number): GeneratedGear | undefined;
}

export type MainStat = "VIT" | "STR" | "DEX" | "MND" | "INT";
export type PhysicalGearGroup = MainStat | "SHARED";
export interface GearPhysicalGroupRange {
  start: number;
  count: number;
}
export type GeneratedDataInput = Omit<
  GeneratedGameData,
  | "gearIndexesByMainStat"
  | "gearLevelByRecordIndex"
  | "gearMinLevel"
  | "gearMaxLevel"
  | "gearStatNames"
  | "gearPhysicalGroupRanges"
  | "getGearAtRecordIndex"
  | "getGearById"
>;
export type DecodedGeneratedData = GeneratedGameData;
