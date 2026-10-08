import { decodeGeneratedData } from "../data/binary-format.mjs";
import type {
  DataProvenance,
  Food,
  Gear,
  JobId,
  JobSchema,
  LevelModifier,
  Materia,
  Stat,
} from "./types";

type MateriaTable = Partial<Record<Materia["stat"], number[]>>;
type GearPhysicalGroup = "VIT" | "STR" | "DEX" | "MND" | "INT" | "SHARED";

interface GeneratedGameData {
  version: string;
  provenance: DataProvenance;
  gears: Gear[];
  foods: Food[];
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
  gearIndexesByMainStat: Record<"VIT" | "STR" | "DEX" | "MND" | "INT", Uint32Array>;
  gearLevelByRecordIndex: Uint16Array;
  gearPhysicalGroupRanges: Record<GearPhysicalGroup, { start: number; count: number }>;
  gearMinLevel: number;
  gearMaxLevel: number;
  gearStatNames: Stat[];
  getGearAtRecordIndex(index: number): Gear;
  getGearById(id: number): Gear | undefined;
}

async function loadGeneratedGameData(): Promise<GeneratedGameData> {
  const injectedBytes = (globalThis as typeof globalThis & {
    __FFXIV_GENERATED_DATA_BINARY__?: Uint8Array;
  }).__FFXIV_GENERATED_DATA_BINARY__;
  let bytes = injectedBytes;
  if (!bytes) {
    const asset = await import("../data/generated-data.bin?url");
    const response = await fetch(asset.default);
    if (!response.ok)
      throw new Error(`无法读取二进制游戏数据：HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  try {
    return await decodeGeneratedData(bytes);
  } catch (error) {
    throw new Error("二进制游戏数据载入失败，请运行 npm run data:update 重新生成", {
      cause: error,
    });
  }
}

export const gameData = await loadGeneratedGameData();

export const gears = gameData.gears;
export const getGearAtRecordIndex = gameData.getGearAtRecordIndex;
export const getGearById = gameData.getGearById;
export const foods = gameData.foods;
export const dataProvenance = gameData.provenance;
export const defaultDataVersion = gameData.version;
export const materiaStats = Object.keys(
  gameData.materias,
) as Materia["stat"][];
export const materiaGradeRequiredLevels = gameData.materiaGradeRequiredLevels;

// The value comes directly from the strongest grade in the upstream materia table.
export const materiaValues = Object.fromEntries(
  materiaStats.map((stat) => {
    const values = gameData.materias[stat];
    return [stat, values!.at(-1)!];
  }),
) as Record<Materia["stat"], number>;

export type { GeneratedGameData, MateriaTable };
