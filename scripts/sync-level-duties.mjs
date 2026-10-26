import {
  contentFinderConditionReturnFields,
  contentTypeReturnFields,
  contentUICategoryReturnFields,
  paramGrowReturnFields,
} from "./mcp-lumina/query-presets.mjs";

const EXPLORATION_LINK_TYPE = 3;
const BEASTMASTER_CONTENT_TYPE = "●XBM";
const GROUP_ORDER = [
  "讨伐歼灭战", "大型任务", "绝境战", "特殊迷宫探索", "特殊场景探索", "斗兽奇弈", "诛灭战",
];

function queryFor(snapshot, sheet, requiredFields) {
  return snapshot?.queries?.find((entry) =>
    entry.method === "list_rows" && entry.sheet === sheet && entry.limit === -1 &&
    requiredFields.every((field) => entry.fields?.includes(field)),
  );
}

function rowsFromSnapshot(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return undefined;
}

function validateRows(snapshot, sheet, fields) {
  const gameVersion = snapshot.gameVersion;
  const description = snapshot.sourceCapabilityChecks?.syncLevels?.[sheet === "ContentFinderCondition"
    ? "contentFinderCondition" : sheet === "ContentType" ? "contentType" : "contentUICategory"];
  const rows = rowsFromSnapshot(snapshot.rows?.[sheet]);
  const query = queryFor(snapshot, sheet, fields);
  if (!description || description.gameVersion !== gameVersion || !description.queriedAt ||
      !Number.isSafeInteger(description.rowCount) || description.rowCount < 1 ||
      fields.some((field) => !description.fields?.includes(field)) ||
      !Array.isArray(rows) || rows.length !== description.rowCount || !query ||
      query.gameVersion !== gameVersion || !query.queriedAt || query.returnedRows !== description.rowCount ||
      !Array.isArray(query.rowIds) || query.rowIds.length !== description.rowCount)
    throw new Error(`同步数据缺少同版本完整 MCP ${sheet} 查询来源`);
  const expectedIds = new Set(query.rowIds);
  const seenIds = new Set();
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.rowId) || row.rowId < 0 || seenIds.has(row.rowId) ||
        row.gameVersion !== gameVersion || !row.timestamp || !expectedIds.has(row.rowId))
      throw new Error(`MCP ${sheet} 行目录含无效、重复、缺失或跨版本行`);
    seenIds.add(row.rowId);
  }
  if (seenIds.size !== description.rowCount || query.rowIds.some((id) => !seenIds.has(id)))
    throw new Error(`MCP ${sheet} 行目录与全表查询范围不一致`);
  return { rows, query, description };
}

function targetKey(target) {
  return `${target.kind}:${target.value}`;
}

export const dutyIdentityKey = duty => JSON.stringify([duty.name, duty.target.kind, duty.target.value]);

function firstWord(name) {
  return name.split(" ", 1)[0];
}

export function syncDataFromSnapshot(snapshot, levelCaps, supportedSyncLevels) {
  const gameVersion = snapshot?.gameVersion;
  const capability = snapshot?.sourceCapabilityChecks?.syncLevels;
  if (snapshot?.schemaVersion !== 1 || snapshot?.server !== "ffxiv-mcp-lumina" ||
      typeof gameVersion !== "string" || !gameVersion || capability?.gameVersion !== gameVersion)
    throw new Error("同步数据缺少有效的 MCP 来源版本");

  const cfc = validateRows(snapshot, "ContentFinderCondition", contentFinderConditionReturnFields);
  const contentTypes = validateRows(snapshot, "ContentType", contentTypeReturnFields);
  const uiCategories = validateRows(snapshot, "ContentUICategory", contentUICategoryReturnFields);
  const paramRows = rowsFromSnapshot(snapshot.rows?.ParamGrow);
  const paramQuery = queryFor(snapshot, "ParamGrow", paramGrowReturnFields);
  const paramDescription = capability.paramGrow;
  const supportedLevels = [...new Set(supportedSyncLevels ?? [])].sort((left, right) => left - right);
  if (!supportedLevels.length || supportedLevels.some((level) => !Number.isSafeInteger(level) || level < 50 || level % 10 !== 0) ||
      !Array.isArray(paramRows) || paramRows.length !== paramDescription?.rowCount ||
      !paramDescription || paramDescription.gameVersion !== gameVersion || !paramDescription.queriedAt ||
      !paramDescription.fields?.includes("ItemLevelSync") || !paramQuery ||
      paramQuery.gameVersion !== gameVersion || !paramQuery.queriedAt ||
      paramQuery.returnedRows !== paramDescription.rowCount ||
      !Array.isArray(paramQuery.rowIds) || paramQuery.rowIds.length !== paramDescription.rowCount ||
      !Array.isArray(snapshot.missing?.ParamGrow))
    throw new Error("MCP ParamGrow 同步等级数据不完整");

  const validateLookup = (rows, sheet) => {
    const map = new Map();
    for (const row of rows) {
      const name = row.fields?.Name;
      if (!Number.isSafeInteger(row.rowId) || typeof name !== "string" || map.has(row.rowId))
        throw new Error(`MCP ${sheet} 行 ${row.rowId} 缺少有效 ID/Name 或 ID 重复`);
      map.set(row.rowId, name);
    }
    return map;
  };
  const typeById = validateLookup(contentTypes.rows, "ContentType");
  const uiCategoryById = validateLookup(uiCategories.rows, "ContentUICategory");
  const paramByLevel = new Map();
  const expectedParamRowIds = new Set(paramQuery.rowIds);
  for (const row of paramRows) {
    const value = row.fields?.ItemLevelSync;
    if (!Number.isSafeInteger(row.rowId) || row.rowId < 0 || paramByLevel.has(row.rowId) ||
        !expectedParamRowIds.has(row.rowId) || !Number.isSafeInteger(value) || value < 0 ||
        row.gameVersion !== gameVersion || !row.timestamp)
      throw new Error(`MCP ParamGrow 行 ${row.rowId} 缺少有效同步品级值`);
    paramByLevel.set(row.rowId, value);
  }
  if (paramByLevel.size !== paramDescription.rowCount ||
      paramQuery.rowIds.some((rowId) => !paramByLevel.has(rowId)) ||
      snapshot.missing.ParamGrow.length)
    throw new Error("MCP ParamGrow 行目录与全量查询范围不一致");
  if (supportedLevels.some((level) => !paramByLevel.has(level)))
    throw new Error("MCP ParamGrow 缺少项目支持的同步等级行");
  if (supportedLevels.some((level) => paramByLevel.get(level) < 90))
    throw new Error("MCP ParamGrow 支持等级同步品级低于支持下限 90");

  const owners = new Map();
  for (const row of cfc.rows) {
    const fields = row.fields;
    if (!fields || typeof fields.Name !== "string" ||
        !Number.isSafeInteger(fields.ItemLevelSync) || fields.ItemLevelSync < 0 ||
        !Number.isSafeInteger(fields.ClassJobLevelSync) || fields.ClassJobLevelSync < 0 ||
        !Number.isSafeInteger(fields.JournalGenre) || fields.JournalGenre < 0 ||
        !Number.isSafeInteger(fields.ContentType) || !typeById.has(fields.ContentType) ||
        !Number.isSafeInteger(fields.ContentUICategory) || !uiCategoryById.has(fields.ContentUICategory) ||
        typeof fields.HighEndDuty !== "boolean" || typeof fields.AllowUndersized !== "boolean" ||
        !Number.isSafeInteger(fields.ContentLinkType) || fields.ContentLinkType < 0)
      throw new Error(`MCP ContentFinderCondition 行 ${row.rowId} 缺少有效同步、筛选字段或外键`);
    const level = fields.ClassJobLevelSync;
    const itemLevel = fields.ItemLevelSync;
    if (itemLevel > 0 && itemLevel >= 90 && supportedLevels.includes(level)) {
      const previous = owners.get(itemLevel);
      if (previous !== undefined && previous !== level)
        throw new Error(`同步品级 ${itemLevel} 同时归属 ${previous} 级和 ${level} 级`);
      owners.set(itemLevel, level);
    }
  }

  for (const level of supportedLevels) {
    const itemLevel = paramByLevel.get(level);
    const previous = owners.get(itemLevel);
    if (previous !== undefined && previous !== level)
      throw new Error(`ParamGrow 同步品级 ${itemLevel} 同时归属 ${previous} 级和 ${level} 级`);
    owners.set(itemLevel, level);
  }

  const levels = supportedLevels.map((jobLevel) => {
    const values = [...owners].filter(([, owner]) => owner === jobLevel).map(([itemLevel]) => itemLevel);
    if (!values.length) throw new Error(`同步等级 ${jobLevel} 没有 Lumina 品级依据`);
    const minItemLevel = jobLevel === 50 ? 90 : Math.min(...values);
    if (!levelCaps?.level?.includes(minItemLevel))
      throw new Error(`同步等级 ${jobLevel} 下界 ${minItemLevel} 缺少完整 ItemLevel 属性上限`);
    return { jobLevel, minItemLevel, defaultItemLevel: paramByLevel.get(jobLevel) };
  });
  for (let index = 1; index < levels.length; index++) {
    if (levels[index - 1].jobLevel >= levels[index].jobLevel ||
        levels[index - 1].minItemLevel >= levels[index].minItemLevel)
      throw new Error("同步等级下界必须按等级严格递增且不重叠");
  }
  const ownerAtBoundary = (itemLevel) => levels.filter((entry) => entry.minItemLevel <= itemLevel).at(-1)?.jobLevel;
  for (const [itemLevel, sourceLevel] of owners) {
    if (ownerAtBoundary(itemLevel) !== sourceLevel)
      throw new Error(`同步品级 ${itemLevel} 的观测等级 ${sourceLevel} 与生成区间所属等级 ${ownerAtBoundary(itemLevel)} 不一致`);
  }

  const categories = new Map();
  const hasHighEndCategory = (uiName) => /高难度|幻巧/.test(uiName);
  const isSavageCategory = (uiName) => /大型任务：零式/.test(uiName);
  for (const row of cfc.rows) {
    const fields = row.fields;
    const type = typeById.get(fields.ContentType);
    const uiName = uiCategoryById.get(fields.ContentUICategory);
    const level = fields.ClassJobLevelSync;
    if (!fields.Name.trim() || fields.JournalGenre === 0 || !supportedLevels.includes(level)) continue;
    const exploration = fields.ContentLinkType === EXPLORATION_LINK_TYPE && fields.ItemLevelSync > 0;
    if (type === "特殊迷宫探索" && fields.AllowUndersized) continue;
    if (fields.ItemLevelSync > 0 && fields.ItemLevelSync < 90) continue;

    const trial = type === "讨伐歼灭战" && (fields.HighEndDuty || hasHighEndCategory(uiName));
    const raid = type === "大型任务" && (fields.HighEndDuty || isSavageCategory(uiName));
    const contentTypeAllowed = ["绝境战", "诛灭战", "特殊迷宫探索"].includes(type) || type === BEASTMASTER_CONTENT_TYPE;
    if (!(exploration || trial || raid || contentTypeAllowed)) continue;

    const target = fields.ItemLevelSync > 0
      ? { kind: "itemLevel", value: fields.ItemLevelSync }
      : { kind: "jobLevel", value: level };
    const specialDungeon = type === "特殊迷宫探索";
    const hasSavagePrefix = specialDungeon && fields.Name.startsWith("零式");
    const specialDungeonName = hasSavagePrefix ? fields.Name.slice(2).trimStart() : fields.Name;
    const mergeByPrefix = type === "大型任务";
    const mergeTrialByJobLevel = type === "讨伐歼灭战" && target.kind === "jobLevel";
    const outputGroupName = exploration ? "特殊场景探索" : type === BEASTMASTER_CONTENT_TYPE ? "斗兽奇弈" : type;
    const optionName = mergeTrialByJobLevel ? `${level}级极神`
      : exploration ? type : specialDungeon ? specialDungeonName
      : mergeByPrefix ? firstWord(fields.Name) : fields.Name;
    const mergeIdentity = mergeTrialByJobLevel ? `jobLevel:${level}`
      : exploration ? type : `${type}:${optionName}`;
    const canMerge = mergeTrialByJobLevel || exploration || specialDungeon || mergeByPrefix;
    const key = canMerge ? `${outputGroupName}\0${mergeIdentity}\0${targetKey(target)}` : `${outputGroupName}\0${row.rowId}`;
    const entry = categories.get(key) ?? {
      groupName: outputGroupName,
      option: { name: optionName, target },
      representativeId: row.rowId,
    };
    if (hasSavagePrefix) entry.option.name = `(零式)${optionName}`;
    entry.representativeId = Math.max(entry.representativeId, row.rowId);
    categories.set(key, entry);
  }

  const orderedGroups = [];
  for (const name of GROUP_ORDER) {
    const options = [...categories.values()]
      .filter((entry) => entry.groupName === name)
      .sort((left, right) => right.representativeId - left.representativeId)
      .map((entry) => entry.option);
    if (options.length) orderedGroups.push({ name, options });
  }
  if (!orderedGroups.length) throw new Error("同步副本目录为空");
  const availableGroupNames = new Set(orderedGroups.map((group) => group.name));
  if ([...categories.values()].some((entry) => !availableGroupNames.has(entry.groupName)))
    throw new Error("同步副本目录出现未声明的大分类");

  for (const group of orderedGroups) {
    for (const option of group.options) {
      if (!option.name.trim() || !Number.isSafeInteger(option.target.value))
        throw new Error(`生成的同步副本选项无效：${option.name}`);
      if (option.target.kind === "jobLevel" && !supportedLevels.includes(option.target.value))
        throw new Error(`同步副本 ${option.name} 引用了未支持的职业等级`);
      if (option.target.kind === "itemLevel" && option.target.value < 90)
        throw new Error(`同步副本 ${option.name} 的品级低于支持下限 90`);
      if (option.target.kind === "itemLevel" && !levelCaps.level.includes(option.target.value))
        throw new Error(`同步副本 ${option.name} 的品级 ${option.target.value} 缺少完整 ItemLevel 属性上限`);
      if (!["jobLevel", "itemLevel"].includes(option.target.kind))
        throw new Error(`同步副本 ${option.name} 的目标类型无效`);
    }
  }
  return {
    levels,
    groups: orderedGroups,
    dutyMaxIds: new Map([...categories.values()].map(entry => [dutyIdentityKey(entry.option), entry.representativeId])),
  };
}
