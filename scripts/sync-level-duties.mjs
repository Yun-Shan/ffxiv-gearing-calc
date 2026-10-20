export function syncLevelDutiesFromSnapshot(snapshot) {
  const gameVersion = snapshot?.gameVersion;
  const capability = snapshot?.sourceCapabilityChecks?.syncLevels;
  const description = capability?.contentFinderCondition;
  const requiredFields = ["Name", "ItemLevelSync", "JournalGenre"];
  const rows = snapshot?.rows?.ContentFinderCondition;
  const query = snapshot?.queries?.find((entry) =>
    entry.method === "list_rows" && entry.sheet === "ContentFinderCondition" &&
    entry.limit === -1 && requiredFields.every((field) => entry.fields?.includes(field)),
  );
  if (snapshot?.schemaVersion !== 1 || snapshot?.server !== "ffxiv-mcp-lumina" ||
      typeof gameVersion !== "string" || !gameVersion ||
      capability?.status !== "available-via-content-finder-condition" ||
      capability.gameVersion !== gameVersion ||
      !description || description.gameVersion !== gameVersion || !description.queriedAt ||
      !Number.isSafeInteger(description.rowCount) || description.rowCount < 1 ||
      !requiredFields.every((field) => description.fields?.includes(field)) ||
      !Array.isArray(rows) || rows.length !== description.rowCount || !query ||
      query.gameVersion !== gameVersion || !query.queriedAt ||
      query.returnedRows !== description.rowCount || !Array.isArray(query.rowIds) ||
      query.rowIds.length !== description.rowCount)
    throw new Error("同步品级副本缺少同版本的完整 MCP CFC 查询来源");

  const expectedRowIds = new Set(query.rowIds);
  if (expectedRowIds.size !== description.rowCount ||
      rows.some((row) => !expectedRowIds.has(row?.rowId)) ||
      query.rowIds.some((rowId) => !rows.some((row) => row?.rowId === rowId)))
    throw new Error("MCP ContentFinderCondition 行目录与全表查询范围不一致");

  const seen = new Set();
  const duties = {};
  for (const row of [...rows].sort((a, b) => a.rowId - b.rowId)) {
    const level = row.fields?.ItemLevelSync;
    const name = row.fields?.Name;
    const journalGenre = row.fields?.JournalGenre;
    if (!Number.isSafeInteger(row.rowId) || row.rowId < 0 || seen.has(row.rowId) ||
      row.gameVersion !== gameVersion || !row.timestamp ||
      !Number.isSafeInteger(level) || level < 0 || typeof name !== "string" ||
      !Number.isSafeInteger(journalGenre) || journalGenre < 0)
      throw new Error("同步品级副本含无效、重复或跨版本行");
    seen.add(row.rowId);
    if (level > 0 && journalGenre !== 0) {
      if (!name.trim()) throw new Error(`同步品级副本行 ${row.rowId} 缺少 Name`);
      (duties[level] ??= []).push({ id: row.rowId, name });
    }
  }
  return duties;
}
