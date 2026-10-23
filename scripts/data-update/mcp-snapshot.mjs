import { acceptsVersionWarning, allowsGenericQueries } from "../mcp-query-validation.mjs";
import { classJobReturnFields, itemReturnFields } from "../mcp-lumina/query-presets.mjs";
import {
  normalizeMcpClassJobRow,
  normalizeMcpItemName,
  rowMap,
  statByBaseParam,
  supportedItemSpecialBonusIds,
  supportedJobIds,
  mcpSource,
} from "../mcp-lumina-import.mjs";
import {
  itemSpecialBonusReturnFields,
  resistanceWeaponAdjustReturnFields,
} from "../mcp-lumina/query-presets.mjs";

export const supportedJobs = supportedJobIds;
const supportedPrimaryStatIds = new Set([1, 2, 4, 5]);
const supportedJobTypeIds = new Set([1, 2, 3, 4, 5, 6]);
const requiredClassJobPrimaryStatFields = ["PrimaryStat", "JobType"];
export const itemCoreReturnFields = itemReturnFields.filter((field) =>
  !["SubStatCategory", "ItemSpecialBonus", "ItemSpecialBonusParam"].includes(field),
);
export const resistanceWeaponAdjustFields = resistanceWeaponAdjustReturnFields;
const resistanceWeaponAdjustStats = new Set(["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"]);

function isUInt32(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}

export function validateMcpVariableEquipLevelInput(snapshot) {
  const check = snapshot.sourceCapabilityChecks?.equipLevelVariable;
  const itemSchema = check?.item;
  const itemRows = snapshot.rows?.Item;
  const expectedItemIds = [...new Set([
    ...(snapshot.queryPlan?.gearItemIds ?? []),
    ...(snapshot.queryPlan?.foodItemIds ?? []),
  ])];
  const fieldQueries = snapshot.queries?.filter((query) =>
    query.sheet === "Item" &&
    ["get_rows", "list_rows"].includes(query.method) &&
    query.fields?.includes("SubStatCategory"),
  ) ?? [];
  const queriedItemIds = new Set(fieldQueries.flatMap((query) => query.rowIds ?? []));
  const itemById = new Map((Array.isArray(itemRows) ? itemRows : []).map((row) => [row?.rowId, row]));
  if (
    check?.status !== "available-via-item-sub-stat-category" ||
    check.gameVersion !== snapshot.gameVersion ||
    !Array.isArray(itemSchema?.fields) || !itemSchema.fields.includes("SubStatCategory") ||
    !Number.isSafeInteger(itemSchema.rowCount) || itemSchema.rowCount < 1 ||
    itemSchema.gameVersion !== snapshot.gameVersion || !itemSchema.queriedAt ||
    !itemRows?.length || itemById.size !== itemRows.length ||
    expectedItemIds.length !== itemRows.length ||
    check.item.persistedItemRows !== expectedItemIds.length ||
    expectedItemIds.some((id) => !queriedItemIds.has(id) || !itemById.has(id)) ||
    fieldQueries.some((query) =>
      query.gameVersion !== snapshot.gameVersion || !query.queriedAt ||
      !Array.isArray(query.rowIds) ||
      query.rowIds.some((id) => !Number.isSafeInteger(id) || id < 0) ||
      new Set(query.rowIds).size !== query.rowIds.length ||
      query.returnedRows !== query.rowIds.length ||
      (query.method === "list_rows" && query.limit !== -1),
    ) ||
    !Array.isArray(snapshot.missing?.ItemSubStatCategory) ||
    snapshot.missing.ItemSubStatCategory.length > 0
  )
    throw new Error("MCP 快照缺少可复现的 Item.SubStatCategory 装备等级标志数据");
  for (const itemId of expectedItemIds) {
    const row = itemById.get(itemId);
    if (!Number.isSafeInteger(row?.fields?.SubStatCategory) || row.fields.SubStatCategory < 0)
      throw new Error(`MCP Item 行 ${itemId} 缺少有效 SubStatCategory`);
  }
}

export function validateMcpQueryResult(snapshot) {
  if (snapshot?.server !== "ffxiv-mcp-lumina" || snapshot?.schemaVersion !== 1)
    throw new Error("MCP 查询结果格式不受支持");
  if (!snapshot.gameVersion || !snapshot.validatedVersion || !snapshot.queriedAt)
    throw new Error("MCP 查询结果缺少游戏版本或查询时间");
  const health = snapshot.health;
  if (!health || health.gameVersion !== snapshot.gameVersion ||
      health.validatedVersion !== snapshot.validatedVersion || !health.schemaAvailable ||
      !health.timestamp || !snapshot.genericQueryValidation ||
      snapshot.genericQueryValidation.allowed !== true ||
      !allowsGenericQueries(health))
    throw new Error("MCP 查询结果缺少完整的 health 可用性来源");
  if (snapshot.gameVersion !== snapshot.validatedVersion) {
    const validation = snapshot.genericQueryValidation;
    if (validation?.allowed !== true || !acceptsVersionWarning(validation.warnings))
      throw new Error(`MCP 通用查询缺少版本警告可用性声明：${snapshot.gameVersion} !== ${snapshot.validatedVersion}`);
  }
  if (!snapshot.rows?.ClassJob?.length || !snapshot.queryPlan?.classJobIds)
    throw new Error("MCP 查询结果缺少 ClassJob 职业行");
  const queriedJobIds = Object.keys(snapshot.queryPlan.classJobIds).sort();
  if (JSON.stringify(queriedJobIds) !== JSON.stringify([...supportedJobs].sort()))
    throw new Error("MCP 查询结果 ClassJob 行集合与当前支持职业不一致");
  validateMcpClassJobPrimaryStatInput(snapshot);
  validateBluMcpAbsence(snapshot);
  validateMcpItemRows(snapshot);
  validateMcpItemHqInput(snapshot);
  validateMcpItemSpecialBonusInput(snapshot);
  validateMcpVariableEquipLevelInput(snapshot);
  validateMcpResistanceWeaponAdjustInput(snapshot);
  return snapshot;
}

export function validateMcpClassJobPrimaryStatInput(snapshot) {
  const description = snapshot.queries?.find((query) =>
    query.method === "describe_sheet" && query.sheet === "ClassJob",
  );
  const capability = snapshot.sourceCapabilityChecks?.bluMdmgAdditions?.classJob;
  const plan = snapshot.queryPlan?.classJobIds;
  const plannedJobs = isPlainRecord(plan) ? Object.entries(plan) : [];
  if (
    !description || description.gameVersion !== snapshot.gameVersion || !description.queriedAt ||
    !Array.isArray(description.fields) ||
    requiredClassJobPrimaryStatFields.some((field) => !description.fields.includes(field)) ||
    classJobReturnFields.some((field) => !description.fields.includes(field)) ||
    !capability || capability.gameVersion !== snapshot.gameVersion ||
    capability.queriedAt !== description.queriedAt ||
    !Number.isSafeInteger(capability.rowCount) || capability.rowCount < 1 ||
    description.returnedRows !== capability.rowCount ||
    !Array.isArray(capability.fields) ||
    requiredClassJobPrimaryStatFields.some((field) => !capability.fields.includes(field)) ||
    classJobReturnFields.some((field) => !capability.fields.includes(field)) ||
    !isPlainRecord(plan) ||
    JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify([...supportedJobs].sort())
  )
    throw new Error("MCP 快照缺少完整的同版本 ClassJob.PrimaryStat Schema 来源");

  const plannedRowIds = new Set();
  for (const [job, rowId] of plannedJobs) {
    if (!supportedJobs.includes(job) || !isUInt32(rowId) || rowId === 0 || plannedRowIds.has(rowId))
      throw new Error(`MCP ClassJob 查询计划中的 ${job} rowId 无效或重复`);
    plannedRowIds.add(rowId);
  }

  const rows = snapshot.rows?.ClassJob;
  if (!Array.isArray(rows) || rows.length !== plannedJobs.length)
    throw new Error("MCP 快照 ClassJob 行集合与查询计划不一致");
  const rowsById = new Map();
  for (const row of rows) {
    if (!row || !isUInt32(row.rowId) || rowsById.has(row.rowId))
      throw new Error("MCP ClassJob 行包含无效或重复 rowId");
    rowsById.set(row.rowId, row);
  }

  const fieldQueries = (snapshot.queries ?? []).filter((query) =>
    ["get_rows", "list_rows"].includes(query.method) &&
    query.sheet === "ClassJob" &&
    requiredClassJobPrimaryStatFields.some((field) => query.fields?.includes(field)),
  );
  const coveredRowIds = new Set();
  for (const query of fieldQueries) {
    if (query.gameVersion !== snapshot.gameVersion || !query.queriedAt ||
        !Array.isArray(query.fields) ||
        requiredClassJobPrimaryStatFields.some((field) => !query.fields.includes(field)) ||
        classJobReturnFields.some((field) => !query.fields.includes(field)) || !Array.isArray(query.rowIds) ||
        query.rowIds.some((id) => !isUInt32(id)) ||
        new Set(query.rowIds).size !== query.rowIds.length ||
        query.rowIds.some((id) => !plannedRowIds.has(id)) ||
        query.returnedRows !== query.rowIds.length ||
        (query.method === "list_rows" && query.limit !== -1))
      throw new Error("MCP ClassJob.PrimaryStat 行查询缺少同版本字段、行 ID 或完整返回范围");
    for (const rowId of query.rowIds) {
      if (plannedRowIds.has(rowId)) coveredRowIds.add(rowId);
    }
  }

  for (const [job, rowId] of plannedJobs) {
    const row = rowsById.get(rowId);
    if (!row || row.gameVersion !== snapshot.gameVersion || !row.timestamp)
      throw new Error(`MCP ClassJob 行 ${rowId} 缺少同版本时间来源：${job}`);
    if (!Number.isSafeInteger(row.fields?.JobType) || !supportedJobTypeIds.has(row.fields.JobType))
      throw new Error(`MCP ClassJob ${job} 行 ${rowId} 的 JobType 原值 ${String(row.fields?.JobType)} 无效，需要定义新的 Type 类型`);
    if (row.fields?.Abbreviation !== job)
      throw new Error(`MCP ClassJob 行 ${rowId} 的职业缩写与查询计划不匹配：${job}`);
    if (!Number.isSafeInteger(row.fields?.PrimaryStat) ||
        !supportedPrimaryStatIds.has(row.fields.PrimaryStat))
      throw new Error(`MCP ClassJob 行 ${rowId} 的 PrimaryStat 未查询或不受支持`);
    if (!normalizeMcpClassJobRow(row))
      throw new Error(`MCP ClassJob ${job} 行 ${rowId} 缺少完整职业字段，无法核验 JobType 与 PrimaryStat`);
    if (!coveredRowIds.has(rowId))
      throw new Error(`MCP ClassJob 行 ${rowId} 缺少同版本 PrimaryStat/JobType 查询字段与行 ID 覆盖`);
  }
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateMcpResistanceWeaponAdjustInput(snapshot) {
  const check = snapshot.sourceCapabilityChecks?.resistanceWeaponAdjust;
  const rows = snapshot.rows?.ResistanceWeaponAdjust;
  const descriptionQuery = snapshot.queries?.find((query) =>
    query.method === "describe_sheet" && query.sheet === "ResistanceWeaponAdjust",
  );
  const rowQuery = snapshot.queries?.find((query) =>
    query.method === "list_rows" && query.sheet === "ResistanceWeaponAdjust",
  );
  const expectedFields = resistanceWeaponAdjustFields;
  if (check?.status !== "available" || check.gameVersion !== snapshot.gameVersion ||
      !Number.isSafeInteger(check.rowCount) || check.rowCount < 1 ||
      !Array.isArray(check.fields) || expectedFields.some((field) => !check.fields.includes(field)) ||
      !check.schemaQueriedAt ||
      !descriptionQuery || descriptionQuery.gameVersion !== snapshot.gameVersion ||
      descriptionQuery.queriedAt !== check.schemaQueriedAt ||
      !expectedFields.every((field) => descriptionQuery.fields?.includes(field)) ||
      descriptionQuery.returnedRows !== check.rowCount)
    throw new Error("MCP 快照缺少 ResistanceWeaponAdjust Schema 与版本来源核验");
  if (!Array.isArray(rows) || rows.length !== check.rowCount ||
      !Array.isArray(snapshot.missing?.ResistanceWeaponAdjust) || snapshot.missing.ResistanceWeaponAdjust.length ||
      !rowQuery || rowQuery.gameVersion !== snapshot.gameVersion || !rowQuery.queriedAt ||
      rowQuery.returnedRows !== check.rowCount || !Array.isArray(rowQuery.rowIds) ||
      rowQuery.rowIds.length !== check.rowCount ||
      !expectedFields.every((field) => rowQuery.fields?.includes(field)))
    throw new Error("MCP ResistanceWeaponAdjust 全量行查询缺失、截断或来源不完整");

  const rowIds = new Set();
  const baseParamIds = new Set();
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.rowId) || row.rowId < 0 || rowIds.has(row.rowId) ||
        row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
        !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
      throw new Error("MCP ResistanceWeaponAdjust 行包含无效 ID、字段或版本来源");
    rowIds.add(row.rowId);
    for (const field of expectedFields) {
      const value = row.fields[field];
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
        throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 的 ${field} 不是有效 uint`);
    }
    if (row.rowId === 0 && expectedFields.some((field) => row.fields[field] !== 0))
      throw new Error("MCP ResistanceWeaponAdjust 行 0 应全部为零");
    if (row.rowId > 0 && ![0, 1, 2, 3].some((index) => row.fields[`BaseParam[${index}]`] > 0))
      throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 没有可调整属性`);
    for (let index = 0; index < 4; index++) {
      const baseParam = row.fields[`BaseParam[${index}]`];
      if (baseParam !== 0) baseParamIds.add(baseParam);
    }
  }
  if (!rowIds.has(0) || rowQuery.rowIds.some((id) => !rowIds.has(id)) ||
      rows.some((row) => !rowQuery.rowIds.includes(row.rowId)))
    throw new Error("MCP ResistanceWeaponAdjust 行目录与全量查询范围不一致");

  const expectedItemIds = [...rowIds].filter((id) => id > 0).sort((left, right) => left - right);
  const plannedIds = snapshot.queryPlan?.resistanceWeaponAdjustItemIds;
  const gearQueryIds = snapshot.queryPlan?.gearItemIds;
  if (!Array.isArray(plannedIds) || JSON.stringify(plannedIds) !== JSON.stringify(expectedItemIds) ||
      !Array.isArray(gearQueryIds) || expectedItemIds.some((id) => !gearQueryIds.includes(id)))
    throw new Error("MCP 快照 Item 查询范围未覆盖所有 ResistanceWeaponAdjust 主键");
  const itemRows = snapshotRows(snapshot, "Item");
  const missingItems = snapshot.missing?.Item;
  for (const id of expectedItemIds) {
    const row = itemRows[id];
    if (!row || missingItems?.includes(id) || row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
        typeof row.fields?.Name !== "string")
      throw new Error(`ResistanceWeaponAdjust 行 ${id} 缺少同版本 MCP Item 行或有效 Name`);
    const hasItemQuery = snapshot.queries.some((query) =>
      ["get_rows", "list_rows"].includes(query.method) && query.sheet === "Item" &&
      query.fields?.includes("Name") && query.rowIds?.includes(id) &&
      query.gameVersion === snapshot.gameVersion && query.queriedAt,
    );
    if (!hasItemQuery)
      throw new Error(`ResistanceWeaponAdjust 行 ${id} 缺少 MCP Item.Name 查询范围`);
  }
  const baseParamRows = snapshotRows(snapshot, "BaseParam");
  for (const id of baseParamIds) {
    const stat = statByBaseParam.get(id);
    const queryCoversId = snapshot.queries.some((query) =>
      ["get_rows", "list_rows"].includes(query.method) && query.sheet === "BaseParam" &&
      query.rowIds?.includes(id) && query.gameVersion === snapshot.gameVersion && query.queriedAt,
    );
    if (!resistanceWeaponAdjustStats.has(stat) || !baseParamRows[id] ||
        baseParamRows[id].gameVersion !== snapshot.gameVersion || !baseParamRows[id].timestamp ||
        !queryCoversId)
      throw new Error(`ResistanceWeaponAdjust 引用了缺少 MCP BaseParam 来源或不支持的属性 ID ${id}`);
  }
}

export function validateMcpItemRows(snapshot) {
  const source = snapshot.rows?.Item ?? snapshot.Item;
  const rows = Array.isArray(source)
    ? source
    : source && typeof source === "object"
      ? Object.values(source)
      : [];
  if (!rows.length) throw new Error("MCP 快照缺少 Item 行，请重新运行 npm run data:update");
  for (const row of rows) {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.rowId))
      throw new Error("MCP Item 行缺少有效 rowId，快照格式无效");
    if (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
      throw new Error(`MCP Item 行 ${row.rowId} 缺少有效 fields，无法校验 Name`);
    normalizeMcpItemName(row);
    for (const name of ["ItemSpecialBonus", "ItemSpecialBonusParam"]) {
      const value = row.fields[name];
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
        throw new Error(`MCP Item 行 ${row.rowId} 的 ${name} 未查询或不是有效 uint`);
    }
    if (typeof row.fields.CanBeHq !== "boolean")
      throw new Error(`MCP Item 行 ${row.rowId} 的 CanBeHq 未查询或不是有效布尔值`);
  }
}

export function validateMcpItemHqInput(snapshot) {
  const description = snapshot.queries?.find((query) =>
    query.method === "describe_sheet" && query.sheet === "Item",
  );
  if (!description?.fields?.includes("CanBeHq") ||
      description.gameVersion !== snapshot.gameVersion || !description.queriedAt)
    throw new Error("MCP 快照缺少同版本 Item.CanBeHq Schema 来源");
  const itemRows = snapshotRows(snapshot, "Item");
  for (const id of snapshot.queryPlan?.gearItemIds ?? []) {
    const row = itemRows[id];
    if (!row || typeof row.fields?.CanBeHq !== "boolean" ||
        row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
        !itemFieldQuery(snapshot, id, "CanBeHq"))
      throw new Error(`MCP Item 行 ${id} 缺少同版本 CanBeHq 布尔值或来源查询`);
  }
}

export function validateMcpItemSpecialBonusInput(snapshot) {
  const check = snapshot.sourceCapabilityChecks?.itemSpecialBonus;
  const description = snapshot.queries?.find((query) =>
    query.method === "describe_sheet" && query.sheet === "ItemSpecialBonus",
  );
  const itemDescription = snapshot.queries?.find((query) =>
    query.method === "describe_sheet" && query.sheet === "Item",
  );
  const bonusRows = snapshot.rows?.ItemSpecialBonus;
  const bonusQuery = snapshot.queries?.find((query) =>
    ["get_rows", "list_rows"].includes(query.method) && query.sheet === "ItemSpecialBonus" &&
    supportedItemSpecialBonusIds.every((id) => query.rowIds?.includes(id)),
  );
  const requiredItemFields = ["ItemSpecialBonus", "ItemSpecialBonusParam"];
  const requiredSpecialFields = Array.from({ length: 6 }, (_, index) => [
    `BaseParamSpecial[${index}]`, `BaseParamValueSpecial[${index}]`,
  ]).flat();
  if (check?.status !== "available" || check.gameVersion !== snapshot.gameVersion ||
      JSON.stringify(check.supportedIds) !== JSON.stringify(supportedItemSpecialBonusIds) ||
      !Array.isArray(check.item?.fields) || !Array.isArray(check.itemSpecialBonus?.fields) ||
      requiredItemFields.some((field) => !check.item.fields.includes(field)) ||
      !itemSpecialBonusReturnFields.every((field) => check.itemSpecialBonus.fields.includes(field)) ||
      check.item.gameVersion !== snapshot.gameVersion || check.itemSpecialBonus.gameVersion !== snapshot.gameVersion ||
      !check.item.queriedAt || !check.itemSpecialBonus.queriedAt ||
      !itemDescription || itemDescription.gameVersion !== snapshot.gameVersion ||
      itemDescription.queriedAt !== check.item.queriedAt ||
      requiredItemFields.concat(requiredSpecialFields).some((field) => !itemDescription.fields?.includes(field)) ||
      !description || description.gameVersion !== snapshot.gameVersion ||
      description.queriedAt !== check.itemSpecialBonus.queriedAt ||
      !itemSpecialBonusReturnFields.every((field) => description.fields?.includes(field)) ||
      !Array.isArray(bonusRows) || bonusRows.length !== supportedItemSpecialBonusIds.length ||
      !Array.isArray(snapshot.missing?.ItemSpecialBonus) || snapshot.missing.ItemSpecialBonus.length ||
      !bonusQuery || bonusQuery.gameVersion !== snapshot.gameVersion || !bonusQuery.queriedAt ||
      !itemSpecialBonusReturnFields.every((field) => bonusQuery.fields?.includes(field)) ||
      bonusQuery.returnedRows !== supportedItemSpecialBonusIds.length)
    throw new Error("MCP 快照缺少 ItemSpecialBonus 支持范围、Schema 或同版本行来源");

  const bonusRowIds = new Set();
  for (const row of bonusRows) {
    if (!row || !Number.isSafeInteger(row.rowId) || !supportedItemSpecialBonusIds.includes(row.rowId) ||
        bonusRowIds.has(row.rowId) || row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
        typeof row.fields?.Name !== "string" || typeof row.fields?.RequirementText !== "string")
      throw new Error("MCP ItemSpecialBonus 行包含无效 ID、字段或版本来源");
    bonusRowIds.add(row.rowId);
  }
  if (supportedItemSpecialBonusIds.some((id) => !bonusRowIds.has(id)) ||
      bonusQuery.rowIds.length !== supportedItemSpecialBonusIds.length ||
      bonusQuery.rowIds.some((id) => !bonusRowIds.has(id)))
    throw new Error("MCP ItemSpecialBonus 支持 ID 与查询目录不一致");

  const plannedIds = [...new Set([
    ...(snapshot.queryPlan?.gearItemIds ?? []),
    ...(snapshot.queryPlan?.foodItemIds ?? []),
  ])];
  const itemRows = snapshotRows(snapshot, "Item");
  for (const itemId of plannedIds) {
    if (snapshot.missing?.Item?.includes(itemId)) continue;
    const row = itemRows[itemId];
    const hasQuery = snapshot.queries.some((query) =>
      ["get_rows", "list_rows"].includes(query.method) && query.sheet === "Item" &&
      requiredItemFields.every((field) => query.fields?.includes(field)) &&
      query.rowIds?.includes(itemId) && query.gameVersion === snapshot.gameVersion && query.queriedAt,
    );
    if (!row || !hasQuery || row.gameVersion !== snapshot.gameVersion || !row.timestamp)
      throw new Error(`MCP Item 行 ${itemId} 的 ItemSpecialBonus 来源查询不完整`);
    for (const field of requiredSpecialFields) {
      const value = row.fields?.[field];
      if (!Number.isSafeInteger(value))
        throw new Error(`MCP Item 行 ${itemId} 的 ${field} 未查询或不是有效整数`);
    }
  }
}

function indexRows(value) {
  if (Array.isArray(value)) return rowMap(value);
  if (!value || typeof value !== "object") return {};
  const rows = Object.values(value);
  if (rows.every((row) => row && typeof row === "object" && row.fields)) return rowMap(rows);
  return value;
}

export function snapshotRows(snapshot, name) {
  return indexRows(snapshot?.rows?.[name] ?? snapshot?.[name]);
}

export function snapshotSource(snapshot, sheet, fields, rowIds, note) {
  return mcpSource({
    sheet,
    fields,
    rowIds,
    gameVersion: snapshot.gameVersion,
    validatedVersion: snapshot.validatedVersion,
    queriedAt: snapshot.queriedAt,
    note,
  });
}

export function resistanceWeaponAdjustSource(snapshot, rowIds) {
  const query = snapshot.queries.find((entry) =>
    entry.method === "list_rows" && entry.sheet === "ResistanceWeaponAdjust",
  );
  if (!query) throw new Error("MCP ResistanceWeaponAdjust 缺少全量查询来源记录");
  return {
    ...mcpSource({
      sheet: "ResistanceWeaponAdjust",
      fields: resistanceWeaponAdjustFields,
      rowIds,
      gameVersion: snapshot.gameVersion,
      validatedVersion: snapshot.validatedVersion,
      queriedAt: query.queriedAt,
      note: "BaseParam[0..3] 中的非零 ID 表示该武器可调整的副属性；MaxTotalStats 为属性总和上限，MaxEachStat 为单属性上限。完整全表查询范围保留在 provenance.sources 与 MCP 快照。",
    }),
    queryMethod: query.method,
    queryScope: { kind: "all-rows", rowIds: query.rowIds, returnedRows: query.returnedRows },
  };
}

export function resistanceBaseParamSource(snapshot, rowIds) {
  const query = snapshot.queries.find((entry) =>
    ["get_rows", "list_rows"].includes(entry.method) && entry.sheet === "BaseParam" &&
    rowIds.every((id) => entry.rowIds?.includes(id)),
  );
  if (!query) throw new Error("MCP BaseParam 缺少 ResistanceWeaponAdjust 属性来源行");
  return {
    ...mcpSource({
      sheet: "BaseParam",
      rowIds,
      gameVersion: snapshot.gameVersion,
      validatedVersion: snapshot.validatedVersion,
      queriedAt: query.queriedAt,
      note: "对应 ResistanceWeaponAdjust.BaseParam[0..3] 的 MCP BaseParam 行；用于审计所引用的属性 ID。",
    }),
    queryMethod: query.method,
    queryScope: { kind: "row-ids", rowIds: query.rowIds, returnedRows: query.returnedRows },
  };
}

export function normalizeMcpResistanceWeaponAdjust(row) {
  const stats = [];
  const seen = new Set();
  for (let index = 0; index < 4; index++) {
    const baseParam = row.fields[`BaseParam[${index}]`];
    if (baseParam === 0) continue;
    const stat = statByBaseParam.get(baseParam);
    if (!resistanceWeaponAdjustStats.has(stat))
      throw new Error(`ResistanceWeaponAdjust 行 ${row.rowId} 含不支持的 BaseParam ${baseParam}`);
    if (seen.has(stat)) throw new Error(`ResistanceWeaponAdjust 行 ${row.rowId} 重复包含属性 ${stat}`);
    seen.add(stat);
    stats.push(stat);
  }
  if (!stats.length)
    throw new Error(`ResistanceWeaponAdjust 行 ${row.rowId} 没有可调整的副属性`);
  return {
    maxTotalStats: row.fields.MaxTotalStats,
    maxEachStat: row.fields.MaxEachStat,
    stats,
  };
}

export function itemFieldQuery(snapshot, itemId, field) {
  return (snapshot.queries ?? [])
    .filter((query) =>
      query.sheet === "Item" &&
      ["get_rows", "list_rows"].includes(query.method) &&
      query.fields?.includes(field) &&
      query.rowIds?.includes(itemId) &&
      query.gameVersion === snapshot.gameVersion &&
      query.queriedAt,
    )
    .sort((left, right) => String(left.queriedAt).localeCompare(String(right.queriedAt)))
    .at(-1);
}

function itemFieldQuerySourceId(query, field) {
  const rowIds = query.rowIds ?? [];
  return `mcp:Item:${field}:${query.method}:${query.queriedAt}:${rowIds.length}:${rowIds[0] ?? ""}-${rowIds.at(-1) ?? ""}`;
}

export function itemFieldSource(snapshot, itemId, field) {
  const query = itemFieldQuery(snapshot, itemId, field);
  if (!query) throw new Error(`MCP Item 行 ${itemId} 的 ${field} 缺少精确来源查询`);
  const sourceId = itemFieldQuerySourceId(query, field);
  const fullSheet = query.method === "list_rows";
  const note = field === "SubStatCategory"
    ? `${field} 原值来自 ${query.method} Item 查询；值 2 到可变穿戴等级标志的映射遵循参考项目 data/convert.ts:140；完整查询范围见 provenance.sources 中 sourceId=${sourceId} 的来源记录。`
    : `${field} 原值来自同版本 ${query.method} Item 查询；支持的 ItemSpecialBonus ID 及其语义来自 MCP ItemSpecialBonus 行查询；完整范围见 provenance.sources 中 sourceId=${sourceId} 的来源记录。`;
  return {
    ...mcpSource({
      sheet: "Item",
      fields: [field],
      rowIds: [itemId],
      gameVersion: snapshot.gameVersion,
      validatedVersion: snapshot.validatedVersion,
      queriedAt: query.queriedAt,
      note,
    }),
    sourceId,
    queryMethod: query.method,
    queryScope: fullSheet
      ? { kind: "all-rows", returnedRows: query.returnedRows }
      : { kind: "row-ids", returnedRows: query.returnedRows },
  };
}

export function itemSpecialBonusTableSource(snapshot) {
  const query = snapshot.queries.find((entry) =>
    ["get_rows", "list_rows"].includes(entry.method) && entry.sheet === "ItemSpecialBonus" &&
    supportedItemSpecialBonusIds.every((id) => entry.rowIds?.includes(id)),
  );
  if (!query) throw new Error("MCP ItemSpecialBonus 缺少支持行来源查询");
  return {
    ...mcpSource({
      sheet: "ItemSpecialBonus",
      fields: itemSpecialBonusReturnFields,
      rowIds: supportedItemSpecialBonusIds,
      gameVersion: snapshot.gameVersion,
      validatedVersion: snapshot.validatedVersion,
      queriedAt: query.queriedAt,
      note: `Item.SpecialBonus 支持行描述从 MCP ItemSpecialBonus 查询；当前实现只启用 ID ${supportedItemSpecialBonusIds.join(", ")}。`,
    }),
    queryMethod: query.method,
    queryScope: { kind: "row-ids", returnedRows: query.returnedRows },
  };
}

export function itemFieldQuerySources(snapshot, field, rowIds) {
  const wanted = new Set(rowIds);
  const seen = new Set();
  return (snapshot.queries ?? [])
    .filter((query) =>
      query.sheet === "Item" &&
      ["get_rows", "list_rows"].includes(query.method) &&
      query.fields?.includes(field) &&
      query.gameVersion === snapshot.gameVersion &&
      query.queriedAt &&
      query.rowIds?.some((id) => wanted.has(id)),
    )
    .map((query) => {
      const sourceId = itemFieldQuerySourceId(query, field);
      if (seen.has(sourceId)) return undefined;
      seen.add(sourceId);
      return {
        ...mcpSource({
          sheet: "Item",
          fields: [field],
          rowIds: query.rowIds,
          gameVersion: snapshot.gameVersion,
          validatedVersion: snapshot.validatedVersion,
          queriedAt: query.queriedAt,
          note: field === "SubStatCategory"
            ? `${field} 来源的完整 MCP 查询批次；值 2 的语义映射遵循参考项目 data/convert.ts:140；原始方法、字段集合和范围保存在 snapshot.queries。`
            : `${field} 来源的完整 MCP 查询批次；支持的 ItemSpecialBonus 行语义来自 MCP ItemSpecialBonus 查询；原始方法、字段集合和范围保存在 snapshot.queries。`,
        }),
        sourceId,
        queryMethod: query.method,
        ...(query.method === "list_rows"
          ? { queryScope: { kind: "all-rows", returnedRows: query.returnedRows } }
          : { queryScope: { kind: "row-ids", returnedRows: query.returnedRows } }),
      };
    })
    .filter(Boolean);
}

export function validateBluMcpAbsence(snapshot) {
  const check = snapshot.sourceCapabilityChecks?.bluMdmgAdditions;
  const inventory = check?.listSheets;
  const classJob = check?.classJob;
  if (
    check?.status !== "missing-from-mcp" ||
    !Array.isArray(inventory?.sheets) ||
    !Array.isArray(classJob?.fields) ||
    check.gameVersion !== snapshot.gameVersion ||
    inventory.gameVersion !== snapshot.gameVersion ||
    classJob.gameVersion !== snapshot.gameVersion ||
    !inventory.queriedAt ||
    !classJob.queriedAt
  )
    throw new Error("MCP 快照缺少青魔法师武器伤害映射的来源缺失核验");
  const pattern = /blu.*(?:mdmg|magic.*damage)|(?:mdmg|magic.*damage).*blu/i;
  if (inventory.sheets.some((sheet) => pattern.test(String(sheet))))
    throw new Error("MCP 快照包含可能提供青魔法师武器伤害映射的 Sheet，禁止回退参考数据");
  if (classJob.fields.some((name) => pattern.test(String(name))))
    throw new Error("MCP ClassJob 描述包含可能提供青魔法师武器伤害映射的字段，禁止回退参考数据");
  if (!String(snapshot.missing?.bluMdmgAdditions ?? "").trim())
    throw new Error("MCP 快照未记录青魔法师武器伤害映射缺失项");
}
