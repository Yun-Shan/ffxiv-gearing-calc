const ITEM_ICON_FIELD = "Icon";
const JOB_FIELDS = ["Name", "Abbreviation"];

function isUInt32(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}

function rowsById(rows, sheet) {
  if (!Array.isArray(rows)) throw new Error(`MCP ${sheet} 行集合缺失`);
  const result = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.rowId) || row.rowId < 0 || result.has(row.rowId))
      throw new Error(`MCP ${sheet} 行包含无效或重复 rowId`);
    result.set(row.rowId, row);
  }
  return result;
}

function queryCovers(query, sheet, fields, rowId, gameVersion) {
  return query?.sheet === sheet &&
    ["get_rows", "list_rows", "search_rows"].includes(query.method) &&
    query.gameVersion === gameVersion && typeof query.queriedAt === "string" &&
    query.queriedAt.length > 0 && fields.every((field) => query.fields?.includes(field)) &&
    query.rowIds?.includes(rowId);
}

/**
 * Extract the Item.Icon and ClassJob data stored directly in the generated
 * binary. Every value is tied to an explicitly recorded query in one snapshot
 * version so the UI never needs separate icon catalogs.
 */
export function binUiMetadataFromSnapshot(snapshot, supportedJobIds) {
  if (snapshot?.server !== "ffxiv-mcp-lumina" || snapshot.schemaVersion !== 1 ||
      typeof snapshot.gameVersion !== "string" || !snapshot.gameVersion ||
      !Array.isArray(snapshot.queries) || !snapshot.queryPlan)
    throw new Error("MCP 快照缺少生成 bin 图标与职业数据所需的版本来源");

  if (!Array.isArray(supportedJobIds) || !supportedJobIds.length ||
      new Set(supportedJobIds).size !== supportedJobIds.length ||
      supportedJobIds.some((id) => typeof id !== "string" || !id))
    throw new Error("生成 bin 职业数据需要非空且无重复的职业代码列表");

  const plannedItemIds = [
    ...(snapshot.queryPlan.gearItemIds ?? []),
    ...(snapshot.queryPlan.foodItemIds ?? []),
  ];
  if (!plannedItemIds.length || plannedItemIds.some((id) => !isUInt32(id) || id === 0) ||
      new Set(plannedItemIds).size !== plannedItemIds.length)
    throw new Error("MCP 快照 Item 查询计划缺少有效、唯一的装备与食物 ID");

  const itemRows = rowsById(snapshot.rows?.Item, "Item");
  const itemIcons = {};
  for (const id of plannedItemIds) {
    const row = itemRows.get(id);
    if (!row || row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
        !isUInt32(row.fields?.[ITEM_ICON_FIELD]))
      throw new Error(`MCP Item 行 ${id} 缺少同版本的有效 ${ITEM_ICON_FIELD} uint32`);
    if (!snapshot.queries.some((query) =>
      queryCovers(query, "Item", [ITEM_ICON_FIELD], id, snapshot.gameVersion)))
      throw new Error(`MCP Item 行 ${id} 缺少同版本 Item.Icon 查询记录`);
    itemIcons[id] = row.fields[ITEM_ICON_FIELD];
  }

  const jobPlan = snapshot.queryPlan.classJobIds;
  if (!jobPlan || typeof jobPlan !== "object" || Array.isArray(jobPlan) ||
      JSON.stringify(Object.keys(jobPlan).sort()) !== JSON.stringify([...supportedJobIds].sort()))
    throw new Error("MCP 快照 ClassJob 查询计划与当前职业集合不一致");
  const jobRows = rowsById(snapshot.rows?.ClassJob, "ClassJob");
  const jobs = {};
  const usedJobRowIds = new Set();
  for (const abbreviation of supportedJobIds) {
    const id = jobPlan[abbreviation];
    if (!isUInt32(id) || id === 0 || usedJobRowIds.has(id))
      throw new Error(`MCP ClassJob 查询计划中的 ${abbreviation} rowId 无效或重复`);
    usedJobRowIds.add(id);
    const row = jobRows.get(id);
    if (!row || row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
        typeof row.fields?.Name !== "string" || !row.fields.Name.trim() ||
        row.fields.Abbreviation !== abbreviation)
      throw new Error(`MCP ClassJob 行 ${id} 与查询计划职业 ${abbreviation} 不一致`);
    if (!snapshot.queries.some((query) =>
      queryCovers(query, "ClassJob", JOB_FIELDS, id, snapshot.gameVersion)))
      throw new Error(`MCP ClassJob 行 ${id} 缺少同版本 Name/Abbreviation 查询记录`);
    jobs[abbreviation] = { id, name: row.fields.Name, abbreviation };
  }

  return { itemIcons, jobs };
}
