import { supportedJobs } from "./mcp-snapshot.mjs";
import { combatMateriaStats } from "./mcp-merge.mjs";

const dataSourceStringFields = [
  "server", "repository", "commit", "sheet", "gameVersion", "validatedVersion",
  "queriedAt", "importedAt", "note", "sourceId", "queryMethod",
];
const dataSourceFields = new Set([
  "kind", ...dataSourceStringFields, "fields", "rowIds", "sourceFiles", "queryScope",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUInt32(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}

function validateGenerationSource(source, label) {
  if (!isRecord(source) || !["mcp", "reference"].includes(source.kind) ||
      Object.keys(source).some((field) => !dataSourceFields.has(field)))
    throw new Error(`${label} 结构无效`);
  for (const field of dataSourceStringFields)
    if (Object.hasOwn(source, field) && source[field] !== undefined && typeof source[field] !== "string")
      throw new Error(`${label} 的 ${field} 无效`);
  if (Object.hasOwn(source, "fields") && source.fields !== undefined &&
      (!Array.isArray(source.fields) || source.fields.some((field) => typeof field !== "string")))
    throw new Error(`${label} 的 fields 无效`);
  if (Object.hasOwn(source, "rowIds") &&
      (!Array.isArray(source.rowIds) || source.rowIds.some((rowId) => !isUInt32(rowId))))
    throw new Error(`${label} 的 rowIds 无效`);
  if (Object.hasOwn(source, "sourceFiles") &&
      (!Array.isArray(source.sourceFiles) || source.sourceFiles.some((file) => typeof file !== "string")))
    throw new Error(`${label} 的 sourceFiles 无效`);

  if (Object.hasOwn(source, "queryScope") && source.queryScope !== undefined) {
    const scope = source.queryScope;
    if (!isRecord(scope) ||
        Object.keys(scope).some((field) => !["kind", "rowIds", "returnedRows"].includes(field)) ||
        !["row-ids", "all-rows"].includes(scope.kind) || !isUInt32(scope.returnedRows) ||
        (Object.hasOwn(scope, "rowIds") && scope.rowIds !== undefined &&
          (!Array.isArray(scope.rowIds) || scope.rowIds.some((rowId) => !isUInt32(rowId)))))
      throw new Error(`${label} 的 queryScope 无效`);
  }
}

function validateGenerationSources(sources, label, minimum = 1) {
  if (!Array.isArray(sources) || sources.length < minimum)
    throw new Error(`${label} 缺少来源记录`);
  sources.forEach((source, index) => validateGenerationSource(source, `${label} 来源 ${index}`));
}

function validateGenerationProvenance(provenance) {
  if (!isRecord(provenance) ||
      ["repository", "commit", "importedAt"].some((field) =>
        typeof provenance[field] !== "string" || !provenance[field].trim()) ||
      !Array.isArray(provenance.sourceFiles) || !provenance.sourceFiles.length ||
      provenance.sourceFiles.some((file) => typeof file !== "string" || !file.trim()))
    throw new Error("生成快照缺少有效的上游来源摘要或 sourceFiles 文件清单");
  validateGenerationSources(provenance.sources, "生成快照 provenance");
}

function validateGenerationRecordSources(sourceFile, sources, label) {
  if (typeof sourceFile !== "string" || !sourceFile.trim() ||
      !Array.isArray(sources) || !sources.length)
    throw new Error(`${label} 缺少逐件来源记录`);
  try {
    validateGenerationSources(sources, label);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes("缺少来源记录")) throw new Error(`${label} 缺少逐件来源记录`);
    throw new Error(`${label} 含无效逐件来源记录：${text}`);
  }
}

export function validateGenerationData(payload) {
  validateGenerationProvenance(payload.provenance);
  if (!payload.sync?.levels?.length || !payload.sync?.groups?.length)
    throw new Error("同步数据缺少等级规则或副本目录");
  if (!payload.provenance.sources?.some((source) =>
    source.kind === "mcp" && source.sheet === "ContentFinderCondition" &&
    ["Name", "ItemLevelSync", "ClassJobLevelSync", "JournalGenre", "ContentType", "ContentUICategory", "HighEndDuty", "AllowUndersized", "ContentLinkType"].every((field) => source.fields?.includes(field)) &&
    source.rowIds?.length,
  ) || !payload.provenance.sources?.some((source) =>
    source.kind === "mcp" && source.sheet === "ContentType" &&
    source.fields?.includes("Name") && source.rowIds?.length,
  ) || !payload.provenance.sources?.some((source) =>
    source.kind === "mcp" && source.sheet === "ContentUICategory" &&
    source.fields?.includes("Name") && source.rowIds?.length,
  ) || !payload.provenance.sources?.some((source) =>
    source.kind === "mcp" && source.sheet === "ParamGrow" &&
    source.fields?.includes("ItemLevelSync") && source.rowIds?.length > 0,
  )) throw new Error("同步数据缺少完整的同版本 MCP 来源记录");
  if (!payload.provenance.sources?.some((source) =>
    source.kind === "mcp" && source.sheet === "Item" &&
    source.fields?.includes("Icon") && source.rowIds?.length,
  ))
    throw new Error("物品图标缺少 MCP Item.Icon 来源记录");
  if (payload.gears.length < 1000) throw new Error(`装备数量异常：${payload.gears.length}`);
  if (payload.foods.length < 100) throw new Error(`食物数量异常：${payload.foods.length}`);
  if (Object.keys(payload.jobSchemas).length !== supportedJobs.length)
    throw new Error("职业数量异常");
  const supportedLevels = new Set(Object.keys(payload.jobLevelModifiers).map(Number));
  const classJobRowIds = new Set();
  for (const [id, schema] of Object.entries(payload.jobSchemas)) {
    if (schema.id !== id ||
        !Number.isSafeInteger(schema.maxJobLevel) || schema.maxJobLevel < 1 ||
        !supportedLevels.has(schema.maxJobLevel) ||
        !Array.isArray(schema.defaultItemLevel) || schema.defaultItemLevel.length !== 2 ||
        schema.defaultItemLevel.some((value) => !Number.isSafeInteger(value) || value < 1) ||
        schema.defaultItemLevel[0] > schema.defaultItemLevel[1] ||
        typeof schema.isLimitedJob !== "boolean" ||
        typeof schema.ignoreWeaponItemLevel !== "boolean" ||
        !["tank", "healer", "str", "dex", "int"].includes(schema.role) ||
        !["STR", "DEX", "INT", "MND"].includes(schema.mainStat))
      throw new Error(`职业 ${id} 缺少合法等级上限或默认品级范围`);
    try {
      validateGenerationSources(schema.dataSources, `职业 ${id}`, 2);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      throw new Error(`职业 ${id} 缺少或包含无效字段来源记录：${text}`);
    }
    const job = payload.jobs?.[id];
    if (!job || job.abbreviation !== id || !isUInt32(job.id) || job.id === 0 || classJobRowIds.has(job.id) ||
        !schema.dataSources.some((source) =>
          source.kind === "mcp" && source.server === "ffxiv-mcp-lumina" && source.sheet === "ClassJob" &&
          source.fields?.includes("PrimaryStat") && source.fields?.includes("JobType") &&
          Array.isArray(source.rowIds) &&
          source.rowIds.length === 1 && source.rowIds[0] === job.id &&
          source.gameVersion === payload.version &&
          typeof source.queriedAt === "string" && source.queriedAt.trim(),
        ))
      throw new Error(`职业 ${id} 缺少与 MCP ClassJob.PrimaryStat 对应的同版本来源记录`);
    classJobRowIds.add(job.id);
  }
  const blueMage = payload.jobSchemas.BLU;
  if (
    !blueMage || blueMage.isLimitedJob !== true || !blueMage.ignoreWeaponItemLevel ||
    blueMage.mainStat !== "INT" ||
    payload.baseStats?.INT !== "main" || !Array.isArray(blueMage.stats) ||
    ["INT", "CRT", "DET", "DHT", "SPS", "VIT"].some((stat) => !blueMage.stats.includes(stat)) ||
    blueMage.stats.includes("SKS") ||
    !["STR", "VIT", "DEX", "INT", "MND", "PIE", "hp"].every((stat) => {
      const value = blueMage.statModifiers?.[stat];
      return Number.isSafeInteger(value) && value > 0;
    }) ||
    !Number.isFinite(blueMage.traitDamageMultiplier) || blueMage.traitDamageMultiplier <= 0 ||
    !Number.isFinite(blueMage.partyBonus) || blueMage.partyBonus <= 0
  )
    throw new Error("青魔法师职业数据不完整");
  const beastmaster = payload.jobSchemas.BST;
  if (
    !beastmaster || beastmaster.isLimitedJob !== true || beastmaster.maxJobLevel !== 50 ||
    beastmaster.role !== "str" || beastmaster.mainStat !== "STR" ||
    !beastmaster.stats.includes("SKS") || beastmaster.stats.includes("SPS") ||
    !payload.gears.some((gear) => gear.jobs.includes("BST") && gear.slot === "weapon") ||
    !payload.gears.some((gear) => gear.jobs.includes("BST") && gear.slot === "offhand")
  )
    throw new Error("驯兽师职业或武器/盾牌装备数据不完整");
  if (!Array.isArray(payload.bluMdmgAdditions) || payload.bluMdmgAdditions.length === 0 ||
      !payload.bluMdmgAdditions.every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error("青魔法师武器伤害映射必须包含完整的非负安全整数数据");
  const bluMappingSource = payload.provenance.sources?.find((source) =>
    source.kind === "reference" &&
    source.sourceFiles?.includes("data/out/bluMdmgAdditions.js") &&
    source.note?.includes("MCP "),
  );
  if (!bluMappingSource)
    throw new Error("青魔法师武器伤害映射缺少 MCP 缺失核验与参考来源记录");
  for (const gear of payload.gears) {
    if (gear.slot !== "weapon") continue;
    if (!Array.isArray(gear.jobs) || !gear.jobs.length)
      throw new Error(`武器 ${gear.id} 缺少有效适用职业`);
    for (const jobId of gear.jobs) {
      const schema = payload.jobSchemas[jobId];
      if (!schema) throw new Error(`武器 ${gear.id} 引用了未知职业 ${jobId}`);
      const damageStat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
      const value = gear.stats?.[damageStat];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error(`武器 ${gear.id} 缺少有效 ${damageStat} 数据`);
    }
  }
  if (Object.keys(payload.materias).length !== combatMateriaStats.length)
    throw new Error("魔晶石数据不完整");
  if (!payload.materiaGradeRequiredLevels?.length)
    throw new Error("魔晶石等级要求数据为空");
  if (
    payload.materiaGradeIsRestricted?.length !== payload.materiaGradeRequiredLevels.length + 1 ||
    payload.materiaGradeIsRestricted[0] !== false ||
    payload.materiaGradeIsRestricted.slice(1).some((restricted) => typeof restricted !== "boolean")
  )
    throw new Error("魔晶石禁断等级数据与等级要求数据不一致");
  if (!payload.levelCaps.level?.length || !payload.slotCaps.CRT?.length || !payload.roleCaps.CRT?.length)
    throw new Error("装备属性上限数据不完整");
  if (payload.gears.some((gear) => typeof gear.name !== "string" || !gear.name.trim()))
    throw new Error("装备数据包含空名称或无效名称");
  if (payload.foods.some((food) => typeof food.name !== "string" || !food.name.trim()))
    throw new Error("食物数据包含空名称或无效名称");
  for (const food of payload.foods)
    validateGenerationRecordSources(food.sourceFile, food.dataSources, `食物 ${food.id}`);
  const ids = new Set();
  for (const gear of payload.gears) {
    if (!Number.isSafeInteger(gear.id) || gear.id <= 0 || ids.has(gear.id))
      throw new Error(`装备 ID 无效或重复：${gear.id}`);
    ids.add(gear.id);
    if (!Array.isArray(gear.jobs) || !gear.jobs.length || !gear.stats ||
        gear.jobs.some((jobId) => !payload.jobSchemas[jobId]))
      throw new Error(`装备记录不完整：${gear.id}`);
    validateGenerationRecordSources(gear.sourceFile, gear.dataSources, `装备 ${gear.id}`);
    if (!gear.dataSources.some((source) =>
      source.kind === "mcp" && source.sheet === "Item" &&
      source.fields?.includes("CanBeHq") && source.rowIds?.includes(gear.id) &&
      source.gameVersion === payload.version && source.queriedAt,
    ))
      throw new Error(`装备 ${gear.id} 缺少同版本 MCP Item.CanBeHq 来源记录`);
  }
}
