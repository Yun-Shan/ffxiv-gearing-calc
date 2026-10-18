import { decodeGeneratedData } from "../data/binary-format.mjs";
import { selectFoodCandidates } from "./food-candidates.ts";
import type {
  DataProvenance,
  Food,
  Gear,
  GearStat,
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
  syncLevels: Record<number, number[]>;
  syncLevelOfJobLevels: Record<number, number>;
  gearIndexesByMainStat: Record<"VIT" | "STR" | "DEX" | "MND" | "INT", Uint32Array>;
  gearLevelByRecordIndex: Uint16Array;
  gearPhysicalGroupRanges: Record<GearPhysicalGroup, { start: number; count: number }>;
  gearMinLevel: number;
  gearMaxLevel: number;
  gearStatNames: GearStat[];
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
    const data = await decodeGeneratedData(bytes) as GeneratedGameData;
    const isRecord = (value: unknown): value is Record<number, unknown> =>
      value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
    if (!isRecord(data.syncLevels) ||
        Object.values(data.syncLevels).some((levels) =>
          !Array.isArray(levels) || !levels.length ||
          levels.some((level) => !Number.isSafeInteger(level) || level < 1),
        ) ||
        !isRecord(data.syncLevelOfJobLevels) ||
        Object.values(data.syncLevelOfJobLevels).some((level) =>
          !Number.isSafeInteger(level) || level < 1,
        ))
      throw new Error("二进制游戏数据缺少有效的同步品级映射，请运行 npm run data:update 重新生成");
    return data;
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
/** 搜索使用的食物候选；完整目录仍保留给分享导入与固定配装计算。 */
export const searchFoods = selectFoodCandidates(foods);
export const dataProvenance = gameData.provenance;
export const defaultDataVersion = gameData.version;
export const materiaStats = Object.keys(
  gameData.materias,
) as Materia["stat"][];
export const materiaGradeRequiredLevels = gameData.materiaGradeRequiredLevels;

// 数值直接取自上游魔晶石表中等级最高的一档。
export const materiaValues = Object.fromEntries(
  materiaStats.map((stat) => {
    const values = gameData.materias[stat];
    return [stat, values!.at(-1)!];
  }),
) as Record<Materia["stat"], number>;

export type { GeneratedGameData, MateriaTable };
