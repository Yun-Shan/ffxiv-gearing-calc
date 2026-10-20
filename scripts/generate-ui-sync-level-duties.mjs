import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function syncLevelDutiesFromSnapshot(snapshot) {
  if (snapshot.schemaVersion !== 1 || snapshot.server !== "ffxiv-mcp-lumina" ||
    snapshot.sheet !== "ContentFinderCondition" || !snapshot.gameVersion || !snapshot.queriedAt ||
    snapshot.query?.method !== "list_rows" || snapshot.query.limit !== -1 ||
    !["Name", "ItemLevelSync", "JournalGenre"].every(field => snapshot.query.fields?.includes(field)) ||
    !Array.isArray(snapshot.rows) || snapshot.rows.length !== snapshot.rowCount || snapshot.rowCount < 1)
    throw new Error("同步品级说明缺少完整的 MCP 全表查询来源");
  const seen = new Set();
  const duties = {};
  for (const row of [...snapshot.rows].sort((a, b) => a.rowId - b.rowId)) {
    const level = row.fields?.ItemLevelSync;
    const name = row.fields?.Name;
    const journalGenre = row.fields?.JournalGenre;
    if (!Number.isSafeInteger(row.rowId) || row.rowId < 0 || seen.has(row.rowId) ||
      row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
      !Number.isSafeInteger(level) || level < 0 || typeof name !== "string" ||
      !Number.isSafeInteger(journalGenre) || journalGenre < 0)
      throw new Error("同步品级说明含无效、重复或跨版本行");
    seen.add(row.rowId);
    if (level > 0 && journalGenre !== 0) (duties[level] ??= []).push({ id: row.rowId, name });
  }
  return {
    generatedBy: "scripts/generate-ui-sync-level-duties.mjs",
    source: "src/data/mcp-sync-level-duties.snapshot.json",
    server: snapshot.server, sheet: snapshot.sheet,
    gameVersion: snapshot.gameVersion, queriedAt: snapshot.queriedAt,
    fields: snapshot.query.fields, rowCount: snapshot.rowCount, duties,
  };
}

export async function generateUiSyncLevelDuties() {
  const root = resolve(import.meta.dirname, "..");
  const snapshot = JSON.parse(await readFile(resolve(root, "src/data/mcp-sync-level-duties.snapshot.json"), "utf8"));
  const data = syncLevelDutiesFromSnapshot(snapshot);
  await writeFile(resolve(root, "src/ui/services/generated/sync-level-duties.json"), `${JSON.stringify(data)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await generateUiSyncLevelDuties();
