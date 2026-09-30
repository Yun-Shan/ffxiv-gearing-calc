import generatedData from "../data/generated-data.json" with { type: "json" };
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
  materiaGradeIsRestricted: boolean[];
  bluMdmgAdditions: number[];
  levelCaps: Record<string, number[]>;
  slotCaps: Record<string, number[]>;
  roleCaps: Record<string, number[]>;
  baseStats: Partial<Record<Stat, "main" | "sub" | number>>;
  clanStats: Partial<Record<Stat, number[]>>;
  jobSchemas: Record<JobId, JobSchema>;
  jobLevelModifiers: Record<number, LevelModifier>;
}

export const gameData = generatedData as unknown as GeneratedGameData;

function assertGameData(data: GeneratedGameData): void {
  if (!data.provenance?.commit)
    throw new Error("游戏数据缺少上游 commit 信息，请运行 npm run data:update");
  if (!data.gears?.length)
    throw new Error("装备数据为空，请运行 npm run data:update");
  if (!data.foods?.length)
    throw new Error("食物数据为空，请运行 npm run data:update");
  if (data.gears.some((gear) => typeof gear.name !== "string" || !gear.name.trim()))
    throw new Error("装备数据包含空名称或无效名称，请运行 npm run data:update");
  if (data.foods.some((food) => typeof food.name !== "string" || !food.name.trim()))
    throw new Error("食物数据包含空名称或无效名称，请运行 npm run data:update");
  if (!Object.keys(data.jobSchemas ?? {}).length)
    throw new Error("职业数据为空，请运行 npm run data:update");
  const supportedLevels = new Set(Object.keys(data.jobLevelModifiers).map(Number));
  for (const [jobId, schema] of Object.entries(data.jobSchemas)) {
    if (schema.id !== jobId || !Array.isArray(schema.dataSources) || schema.dataSources.length < 2)
      throw new Error(`职业 ${jobId} 缺少有效结构或逐职业来源信息，请运行 npm run data:update`);
    if (
      !Array.isArray(schema.defaultItemLevel) ||
      schema.defaultItemLevel.length !== 2 ||
      schema.defaultItemLevel.some((level) => !Number.isSafeInteger(level) || level < 0) ||
      schema.defaultItemLevel[0] > schema.defaultItemLevel[1] ||
      typeof schema.maxJobLevel !== "number" ||
      !Number.isSafeInteger(schema.maxJobLevel) ||
      !supportedLevels.has(schema.maxJobLevel) ||
      typeof schema.ignoreWeaponItemLevel !== "boolean"
    )
      throw new Error(`职业 ${jobId} 的等级或默认品级 metadata 无效，请运行 npm run data:update`);
  }
  const blueMage = data.jobSchemas.BLU;
  if (
    !blueMage ||
    blueMage.maxJobLevel === undefined ||
    !blueMage.ignoreWeaponItemLevel ||
    blueMage.mainStat !== "INT" ||
    blueMage.attackStat !== "INT" ||
    data.baseStats?.INT !== "main" ||
    !Array.isArray(blueMage.stats) ||
    ["INT", "CRT", "DET", "DHT", "SPS", "VIT"].some((stat) =>
      !blueMage.stats.includes(stat as Stat),
    ) ||
    blueMage.stats.includes("SKS") ||
    !["STR", "VIT", "DEX", "INT", "MND", "PIE", "hp"].every((stat) => {
      const value = blueMage.statModifiers?.[stat as Stat | "hp"];
      return Number.isSafeInteger(value) && value! > 0;
    }) ||
    typeof blueMage.traitDamageMultiplier !== "number" ||
    !Number.isFinite(blueMage.traitDamageMultiplier) ||
    blueMage.traitDamageMultiplier <= 0 ||
    typeof blueMage.partyBonus !== "number" ||
    !Number.isFinite(blueMage.partyBonus) ||
    blueMage.partyBonus <= 0
  )
    throw new Error("青魔法师职业数据不完整，请运行 npm run data:update");
  if (
    !Array.isArray(data.bluMdmgAdditions) ||
    data.bluMdmgAdditions.length === 0 ||
    !data.bluMdmgAdditions.every((value) => Number.isSafeInteger(value) && value >= 0)
  )
    throw new Error("青魔法师武器伤害映射为空或包含无效数值，请运行 npm run data:update");
  const bluMappingSource = data.provenance.sources?.find(
    (source) =>
      source.kind === "reference" &&
      source.sourceFiles?.includes("data/out/bluMdmgAdditions.js") &&
      source.note?.includes("MCP "),
  );
  if (!bluMappingSource)
    throw new Error("青魔法师武器伤害映射缺少 MCP 查询缺失与参考来源记录，请运行 npm run data:update");
  for (const gear of data.gears) {
    if (gear.slot !== "weapon") continue;
    if (!Array.isArray(gear.jobs) || gear.jobs.length === 0)
      throw new Error(`武器 ${gear.id} 缺少有效适用职业，请运行 npm run data:update`);
    for (const jobId of gear.jobs) {
      const schema = data.jobSchemas[jobId];
      if (!schema)
        throw new Error(`武器 ${gear.id} 的适用职业 ${jobId} 缺少职业数据，请运行 npm run data:update`);
      if (!["STR", "DEX", "INT", "MND", "VIT"].includes(schema.mainStat))
        throw new Error(`武器 ${gear.id} 的适用职业 ${jobId} 缺少有效主属性，请运行 npm run data:update`);
      const damageStat =
        schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
      const value = gear.stats?.[damageStat];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error(
          `武器 ${gear.id} 缺少职业 ${jobId} 所需的有效 ${damageStat} 数据，请运行 npm run data:update`,
        );
    }
  }
  if (!Object.keys(data.materias ?? {}).length)
    throw new Error("魔晶石数据为空，请运行 npm run data:update");
  if (!data.materiaGradeRequiredLevels?.length)
    throw new Error("魔晶石等级数据为空，请运行 npm run data:update");
  if (
    data.materiaGradeIsRestricted?.length !==
      data.materiaGradeRequiredLevels.length + 1 ||
    data.materiaGradeIsRestricted[0] !== false ||
    data.materiaGradeIsRestricted.slice(1).some((restricted) => typeof restricted !== "boolean")
  )
    throw new Error("魔晶石禁断等级数据与等级要求数据不一致，请运行 npm run data:update");
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
