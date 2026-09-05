import generatedData from "../data/generated-data.json";
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

interface GeneratedGameData {
  version: string;
  provenance: DataProvenance;
  gears: Gear[];
  foods: Food[];
  materias: MateriaTable;
  materiaGradeRequiredLevels: number[];
  levelCaps: Record<string, number[]>;
  slotCaps: Record<string, number[]>;
  roleCaps: Record<string, number[]>;
  baseStats: Partial<Record<Stat, "main" | "sub" | number>>;
  clanStats: Partial<Record<Stat, number[]>>;
  jobSchemas: Record<JobId, JobSchema>;
  jobLevelModifiers: Record<number, LevelModifier>;
}

export const gameData = generatedData as GeneratedGameData;

function assertGameData(data: GeneratedGameData): void {
  if (!data.provenance?.commit)
    throw new Error("游戏数据缺少上游 commit 信息，请运行 npm run data:update");
  if (!data.gears?.length)
    throw new Error("装备数据为空，请运行 npm run data:update");
  if (!data.foods?.length)
    throw new Error("食物数据为空，请运行 npm run data:update");
  if (!Object.keys(data.jobSchemas ?? {}).length)
    throw new Error("职业数据为空，请运行 npm run data:update");
  if (!Object.keys(data.materias ?? {}).length)
    throw new Error("魔晶石数据为空，请运行 npm run data:update");
  if (!data.materiaGradeRequiredLevels?.length)
    throw new Error("魔晶石等级数据为空，请运行 npm run data:update");
  if (!data.levelCaps?.level?.length || !data.slotCaps || !data.roleCaps)
    throw new Error("装备属性上限数据为空，请运行 npm run data:update");
}

assertGameData(gameData);

export const gears = gameData.gears;
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
    if (!values?.length) throw new Error(`魔晶石 ${stat} 没有数值`);
    return [stat, values.at(-1)];
  }),
) as Record<Materia["stat"], number>;

export type { GeneratedGameData, MateriaTable };
