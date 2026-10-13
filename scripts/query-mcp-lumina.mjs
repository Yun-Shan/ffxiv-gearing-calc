import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { allowsGenericQueries } from "./mcp-query-validation.mjs";
import {
  itemActionReturnFields,
  itemFoodReturnFields,
  itemLevelReturnFields,
  itemReturnFields,
  mandervilleReturnFields,
  classJobReturnFields,
  supportedJobIds,
} from "./mcp-lumina-import.mjs";

const root = resolve(import.meta.dirname, "..");
const upstreamRoot = resolve(
  process.env.FFXIV_GEARING_ROOT ?? resolve(root, "reference", "ffxiv-gearing"),
);
const outputPath = resolve(
  process.env.FFXIV_MCP_LUMINA_SNAPSHOT ?? resolve(root, "src", "data", "mcp-lumina.snapshot.json"),
);
const defaultCommand = "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\mcp-ffxiv-lumina\\publish\\mcp-lumina.exe";
const command = process.env.FFXIV_MCP_LUMINA_COMMAND ?? defaultCommand;
const concurrency = Math.max(1, Number(process.env.FFXIV_MCP_LUMINA_CONCURRENCY ?? 4));
const scope = process.env.FFXIV_MCP_LUMINA_SCOPE ?? "all";
const supportedJobs = supportedJobIds;
const slotIds = new Set([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13]);
const fields = (values) => values.join(",");
const categoryFields = fields(supportedJobs);
const itemFoodFields = fields(itemFoodReturnFields);
const itemActionFields = fields(itemActionReturnFields);
const itemLevelFields = fields(itemLevelReturnFields);
const itemFields = fields(itemReturnFields);
const mandervilleFields = fields(mandervilleReturnFields);
const classJobFields = fields(classJobReturnFields);

async function load(path) {
  return (await import(`${pathToFileURL(path).href}?query=${Date.now()}-${Math.random()}`)).default;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseJsonRpcBuffer(state) {
  const messages = [];
  while (state.buffer.length) {
    const contentLength = /^\s*Content-Length:\s*(\d+)\s*\r?\n\r?\n/i.exec(state.buffer);
    if (contentLength) {
      const length = Number(contentLength[1]);
      const start = contentLength[0].length;
      if (Buffer.byteLength(state.buffer.slice(start), "utf8") < length) break;
      const bodyBuffer = Buffer.from(state.buffer.slice(start), "utf8").subarray(0, length);
      state.buffer = Buffer.from(state.buffer.slice(start), "utf8").subarray(length).toString("utf8");
      messages.push(JSON.parse(bodyBuffer.toString("utf8")));
      continue;
    }
    const newline = state.buffer.indexOf("\n");
    if (newline < 0) break;
    const line = state.buffer.slice(0, newline).trim();
    state.buffer = state.buffer.slice(newline + 1);
    if (line) messages.push(JSON.parse(line));
  }
  return messages;
}

class McpClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.state = { buffer: "" };
    this.process = spawn(command, [], {
      cwd: root,
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        McpLumina__GamePath: process.env.McpLumina__GamePath ?? "F:\\Game\\FF14\\最终幻想XIV",
        McpLumina__LanguageDefault: process.env.McpLumina__LanguageDefault ?? "chs",
        McpLumina__SchemaPath: process.env.McpLumina__SchemaPath ?? "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\EXDSchema",
      },
    });
    this.process.on("error", (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    this.process.stdout.on("data", (chunk) => {
      this.state.buffer += chunk.toString("utf8");
      let messages;
      try {
        messages = parseJsonRpcBuffer(this.state);
      } catch (error) {
        this.fail(new Error(`Lumina MCP 返回了无效 JSON-RPC：${error.message}`, { cause: error }));
        return;
      }
      for (const message of messages) {
        if (message.id === undefined) continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.code ?? "MCP"}: ${message.error.message}`));
        else pending.resolve(message.result);
      }
    });
  }

  fail(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ffxiv-gearing-calc-data-import", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  async callTool(name, args) {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = result?.content?.find((entry) => entry.type === "text")?.text;
    if (!text) throw new Error(`MCP 工具 ${name} 未返回文本 JSON`);
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`MCP 工具 ${name} 返回了无法解析的 JSON：${text.slice(0, 200)}`, { cause: error });
    }
    return { value, raw: result };
  }

  close() {
    this.process.stdin.end();
    this.process.kill();
  }
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function queryRows(client, sheet, rowIds, returnFields, queries) {
  const uniqueIds = [...new Set(rowIds.map(Number).filter(Number.isInteger))];
  const batches = chunks(uniqueIds);
  const rows = [];
  const missingRowIds = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= batches.length) return;
      const batch = batches[index];
      let response;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await client.callTool("get_rows", {
            sheet,
            rowIds: batch,
            returnFields,
            languages: "chs",
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
        }
      }
      if (!response) throw new Error(`MCP ${sheet} 批次 ${index + 1}/${batches.length} 失败`, { cause: lastError });
      const value = response.value;
      rows.push(...(value.rows ?? []));
      missingRowIds.push(...(value.missingRowIds ?? []));
      queries.push({
        method: "get_rows",
        sheet,
        rowIds: batch,
        ...(returnFields ? { fields: returnFields.split(",") } : {}),
        returnedRows: value.rows?.length ?? 0,
        missingRowIds: value.missingRowIds ?? [],
        gameVersion: value.gameVersion,
        queriedAt: value.timestamp,
      });
      if (batches.length > 1) console.error(`MCP ${sheet}: ${Math.min((index + 1) * 100, uniqueIds.length)}/${uniqueIds.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return { rows, missingRowIds };
}

async function queryAllRows(client, sheet, returnFields, queries) {
  let response;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await client.callTool("list_rows", {
        sheet,
        returnFields,
        limit: -1,
        languages: "chs",
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
    }
  }
  if (!response) throw new Error(`MCP ${sheet} 全量行查询失败`, { cause: lastError });
  const value = response.value;
  if (!Array.isArray(value.rows) || !Array.isArray(value.rowIds) ||
      value.rows.length !== value.rowIds.length)
    throw new Error(`MCP ${sheet} 全量行查询返回了不完整的行目录`);
  queries.push({
    method: "list_rows",
    sheet,
    limit: -1,
    fields: returnFields.split(","),
    rowIds: value.rowIds,
    returnedRows: value.rows.length,
    gameVersion: value.gameVersion,
    queriedAt: value.timestamp,
  });
  return { rows: value.rows, missingRowIds: value.missingRowIds ?? [] };
}

function describeQuery(sheet, description) {
  return {
    method: "describe_sheet",
    sheet,
    fields: description.columns.map((column) => column.name),
    returnedRows: description.rowCount,
    gameVersion: description.gameVersion,
    queriedAt: description.timestamp,
  };
}

function validateSyncLevelSchema(sheet, description, requiredFields) {
  if (!Array.isArray(description?.columns))
    throw new Error(`MCP ${sheet} Schema 不可用，无法核验同步品级来源`);
  const availableFields = new Set(description.columns.map((column) => column.name));
  const missing = requiredFields.filter((field) => !availableFields.has(field));
  if (missing.length)
    throw new Error(`MCP ${sheet} 缺少同步品级核验字段：${missing.join(", ")}`);
}

async function searchClassJobs(client, jobs, queries) {
  const found = new Array(jobs.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      let response;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await client.callTool("search_rows", {
            sheet: "ClassJob",
            query: job,
            textFields: "Abbreviation",
            returnFields: "Name,Abbreviation",
            limit: 200,
            languages: "chs",
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
        }
      }
      if (!response) throw new Error(`MCP ClassJob 缩写 ${job} 查询失败`, { cause: lastError });
      const matches = (response.value.results ?? []).filter((row) => row.fields?.Abbreviation === job);
      if (matches.length !== 1)
        throw new Error(`MCP ClassJob 缩写 ${job} 应精确匹配一行，实际 ${matches.length} 行`);
      const row = matches[0];
      found[index] = { job, rowId: Number(row.rowId) };
      queries.push({
        method: "search_rows",
        sheet: "ClassJob",
        query: job,
        textFields: ["Abbreviation"],
        fields: ["Name", "Abbreviation"],
        returnedRows: matches.length,
        rowIds: [Number(row.rowId)],
        gameVersion: response.value.gameVersion,
        queriedAt: response.value.timestamp,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return found;
}

async function refreshLevelBasisData(client, health) {
  if (!(await fileExists(outputPath)))
    throw new Error(`同步品级增量查询需要已有 MCP 快照：${outputPath}`);
  const snapshot = JSON.parse(await readFile(outputPath, "utf8"));
  if (snapshot.server !== "ffxiv-mcp-lumina" || snapshot.gameVersion !== health.gameVersion)
    throw new Error(`同步品级查询版本 ${health.gameVersion} 与现有快照 ${snapshot.gameVersion} 不一致；拒绝混合版本`);

  const [sheetInventoryResult, itemDescriptionResult, cfcDescriptionResult, itemLevelDescriptionResult, paramGrowDescriptionResult] =
    await Promise.all([
      client.callTool("list_sheets", {}),
      client.callTool("describe_sheet", { sheet: "Item" }),
      client.callTool("describe_sheet", { sheet: "ContentFinderCondition" }),
      client.callTool("describe_sheet", { sheet: "ItemLevel" }),
      client.callTool("describe_sheet", { sheet: "ParamGrow" }),
    ]);
  const sheetInventory = sheetInventoryResult.value;
  const itemDescription = itemDescriptionResult.value;
  const cfcDescription = cfcDescriptionResult.value;
  const itemLevelDescription = itemLevelDescriptionResult.value;
  const paramGrowDescription = paramGrowDescriptionResult.value;
  if (!Array.isArray(sheetInventory.sheets) ||
      !sheetInventory.sheets.includes("ContentFinderCondition") ||
      !sheetInventory.sheets.includes("Item") ||
      !sheetInventory.sheets.includes("ItemLevel") ||
      !sheetInventory.sheets.includes("ParamGrow"))
    throw new Error("MCP Sheet 清单缺少同步品级核验所需表");
  for (const [sheet, description] of [
    ["Item", itemDescription],
    ["ContentFinderCondition", cfcDescription],
    ["ItemLevel", itemLevelDescription],
    ["ParamGrow", paramGrowDescription],
  ]) {
    if (!Array.isArray(description.columns) || description.gameVersion !== health.gameVersion)
      throw new Error(`MCP ${sheet} Schema 缺失或游戏版本与 health 不一致`);
  }
  validateSyncLevelSchema("Item", itemDescription, ["SubStatCategory"]);
  validateSyncLevelSchema("ContentFinderCondition", cfcDescription, [
    "ClassJobLevelRequired", "ItemLevelRequired", "ItemLevelSync",
  ]);
  validateSyncLevelSchema("ItemLevel", itemLevelDescription, ["Strength", "CriticalHit"]);
  validateSyncLevelSchema("ParamGrow", paramGrowDescription, ["ItemLevelSync"]);

  const queries = [
    {
      method: "health",
      gameVersion: health.gameVersion,
      validatedVersion: health.validatedVersion,
      queriedAt: health.timestamp,
    },
    {
      method: "list_sheets",
      gameVersion: sheetInventory.gameVersion,
      queriedAt: sheetInventory.timestamp,
      returnedRows: sheetInventory.sheets.length,
    },
    describeQuery("ContentFinderCondition", cfcDescription),
    describeQuery("ItemLevel", itemLevelDescription),
    describeQuery("ParamGrow", paramGrowDescription),
    describeQuery("Item", itemDescription),
  ];
  const cfcRows = await queryAllRows(
    client,
    "ContentFinderCondition",
    "ClassJobLevelRequired,ItemLevelRequired,ItemLevelSync",
    queries,
  );
  const paramGrowRows = await queryRows(
    client,
    "ParamGrow",
    [50, 60, 70, 80, 90, 100],
    "ItemLevelSync",
    queries,
  );
  const expectedItemIds = [...new Set([
    ...(snapshot.queryPlan?.gearItemIds ?? []),
    ...(snapshot.queryPlan?.foodItemIds ?? []),
  ])].sort((left, right) => left - right);
  const itemQueries = [];
  const subStatRows = await queryRows(client, "Item", expectedItemIds, "SubStatCategory", itemQueries);
  if (subStatRows.missingRowIds.length || subStatRows.rows.length !== expectedItemIds.length)
    throw new Error(`MCP Item.SubStatCategory 查询行数不完整：${subStatRows.rows.length}/${expectedItemIds.length}`);
  const subStatById = new Map(subStatRows.rows.map((row) => [row.rowId, row]));
  if (expectedItemIds.some((id) => {
    const row = subStatById.get(id);
    return !Number.isSafeInteger(row?.fields?.SubStatCategory) ||
      row.fields.SubStatCategory < 0 || row.gameVersion !== health.gameVersion || !row.timestamp;
  }))
    throw new Error("MCP Item.SubStatCategory 查询返回了无效或跨版本行");
  if (cfcRows.rows.length !== cfcDescription.rowCount || cfcRows.missingRowIds.length)
    throw new Error(`MCP ContentFinderCondition 查询行数不完整：${cfcRows.rows.length}/${cfcDescription.rowCount}`);
  if (paramGrowRows.missingRowIds.length)
    throw new Error(`MCP ParamGrow 缺少行：${paramGrowRows.missingRowIds.join(", ")}`);
  if ([...queries, ...itemQueries].some((query) => query.gameVersion !== health.gameVersion))
    throw new Error("MCP 同步品级查询批次游戏版本不一致");

  const syncLevelCapabilityCheck = {
    status: "available-via-content-finder-condition",
    checkedAt: new Date().toISOString(),
    gameVersion: health.gameVersion,
    listSheets: {
      count: sheetInventory.count,
      syncRelatedSheets: sheetInventory.sheets.filter((sheet) => /sync/i.test(String(sheet))),
      gameVersion: sheetInventory.gameVersion,
      queriedAt: sheetInventory.timestamp,
    },
    contentFinderCondition: {
      rowCount: cfcDescription.rowCount,
      fields: cfcDescription.columns.map((column) => column.name),
      gameVersion: cfcDescription.gameVersion,
      queriedAt: cfcDescription.timestamp,
    },
    itemLevel: {
      rowCount: itemLevelDescription.rowCount,
      fields: itemLevelDescription.columns.map((column) => column.name),
      gameVersion: itemLevelDescription.gameVersion,
      queriedAt: itemLevelDescription.timestamp,
    },
    paramGrow: {
      rowCount: paramGrowDescription.rowCount,
      fields: paramGrowDescription.columns.map((column) => column.name),
      gameVersion: paramGrowDescription.gameVersion,
      queriedAt: paramGrowDescription.timestamp,
      usedForSyncLevelGrouping: false,
    },
  };
  const variableEquipLevelCapabilityCheck = {
    status: "available-via-item-sub-stat-category",
    checkedAt: new Date().toISOString(),
    gameVersion: health.gameVersion,
    item: {
      rowCount: itemDescription.rowCount,
      fields: itemDescription.columns.map((column) => column.name),
      gameVersion: itemDescription.gameVersion,
      queriedAt: itemDescription.timestamp,
      flagField: "SubStatCategory",
      variableValue: 2,
      persistedItemRows: expectedItemIds.length,
    },
  };
  const allQueries = [...(snapshot.queries ?? []), ...queries, ...itemQueries];
  if (allQueries.some((query) => query.gameVersion !== snapshot.gameVersion))
    throw new Error("增量查询会造成 MCP 快照数据版本不一致");

  snapshot.sourceCapabilityChecks ??= {};
  snapshot.sourceCapabilityChecks.syncLevels = syncLevelCapabilityCheck;
  snapshot.sourceCapabilityChecks.equipLevelVariable = variableEquipLevelCapabilityCheck;
  snapshot.rows ??= {};
  snapshot.rows.ContentFinderCondition = cfcRows.rows.sort((left, right) => left.rowId - right.rowId);
  snapshot.rows.ParamGrow = paramGrowRows.rows.sort((left, right) => left.rowId - right.rowId);
  const itemRows = snapshot.rows.Item;
  const itemById = new Map(itemRows.map((row) => [row.rowId, row]));
  for (const itemId of expectedItemIds) {
    const itemRow = itemById.get(itemId);
    if (!itemRow) throw new Error(`现有 MCP 快照缺少 Item 行 ${itemId}`);
    itemRow.fields.SubStatCategory = subStatById.get(itemId).fields.SubStatCategory;
  }
  snapshot.queries = [
    ...(snapshot.queries ?? []).filter((query) =>
      !(query.method === "list_rows" && query.sheet === "ContentFinderCondition") &&
      !(query.method === "get_rows" && query.sheet === "ParamGrow") &&
      !(query.method === "get_rows" && query.sheet === "Item" &&
        query.fields?.length === 1 && query.fields[0] === "SubStatCategory") &&
      !(query.method === "describe_sheet" && ["ContentFinderCondition", "ItemLevel", "ParamGrow", "Item"].includes(query.sheet)),
    ),
    ...queries,
    ...itemQueries,
  ];
  snapshot.missing ??= {};
  snapshot.missing.ContentFinderCondition = cfcRows.missingRowIds;
  snapshot.missing.ParamGrow = paramGrowRows.missingRowIds;
  snapshot.missing.ItemSubStatCategory = subStatRows.missingRowIds;
  await writeFile(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, syncLevelRows: cfcRows.rows.length, paramGrowRows: paramGrowRows.rows.length, itemRowsWithSubStatCategory: expectedItemIds.length, gameVersion: snapshot.gameVersion }));
}

const client = new McpClient();
try {
  if (!(await fileExists(command)) && command.includes("\\"))
    throw new Error(`找不到 Lumina MCP 可执行文件：${command}。请设置 FFXIV_MCP_LUMINA_COMMAND。`);
  const initialization = await client.initialize();
  const health = (await client.callTool("health", {})).value;
  const genericQueriesAvailable = allowsGenericQueries(health);
  if (!genericQueriesAvailable)
    throw new Error(`Lumina MCP 通用查询不可用：${JSON.stringify(health)}`);

  if (process.argv.includes("--level-basis-data-only")) {
    await refreshLevelBasisData(client, health);
  } else {

  const [
    sheetInventoryResult,
    classJobDescriptionResult,
    itemDescriptionResult,
    contentFinderConditionDescriptionResult,
    itemLevelDescriptionResult,
    paramGrowDescriptionResult,
  ] = await Promise.all([
    client.callTool("list_sheets", {}),
    client.callTool("describe_sheet", { sheet: "ClassJob" }),
    client.callTool("describe_sheet", { sheet: "Item" }),
    client.callTool("describe_sheet", { sheet: "ContentFinderCondition" }),
    client.callTool("describe_sheet", { sheet: "ItemLevel" }),
    client.callTool("describe_sheet", { sheet: "ParamGrow" }),
  ]);
  const sheetInventory = sheetInventoryResult.value;
  const classJobDescription = classJobDescriptionResult.value;
  const itemDescription = itemDescriptionResult.value;
  const contentFinderConditionDescription = contentFinderConditionDescriptionResult.value;
  const itemLevelDescription = itemLevelDescriptionResult.value;
  const paramGrowDescription = paramGrowDescriptionResult.value;
  if (!Array.isArray(sheetInventory.sheets) || !Array.isArray(classJobDescription.columns))
    throw new Error("Lumina MCP 未能提供 Sheet 清单或 ClassJob 字段描述，无法核对青魔法师伤害数据来源");
  for (const [sheet, description] of [
    ["ContentFinderCondition", contentFinderConditionDescription],
    ["ItemLevel", itemLevelDescription],
    ["ParamGrow", paramGrowDescription],
    ["Item", itemDescription],
  ]) {
    if (!Array.isArray(description.columns) || description.gameVersion !== health.gameVersion)
      throw new Error(`MCP ${sheet} Schema 缺失或游戏版本与 health 不一致`);
  }
  validateSyncLevelSchema("ContentFinderCondition", contentFinderConditionDescription, [
    "ClassJobLevelRequired", "ItemLevelRequired", "ItemLevelSync",
  ]);
  validateSyncLevelSchema("ItemLevel", itemLevelDescription, ["Strength", "CriticalHit"]);
  validateSyncLevelSchema("ParamGrow", paramGrowDescription, ["ItemLevelSync"]);
  validateSyncLevelSchema("Item", itemDescription, ["SubStatCategory"]);
  const bluDamageSheetCandidates = sheetInventory.sheets.filter((sheet) =>
    /blu.*(?:mdmg|magic.*damage)|(?:mdmg|magic.*damage).*blu/i.test(String(sheet)),
  );
  const bluDamageClassJobFields = classJobDescription.columns
    .map((column) => column.name)
    .filter((name) => /blu.*(?:mdmg|magic.*damage)|(?:mdmg|magic.*damage).*blu/i.test(String(name)));
  if (bluDamageSheetCandidates.length || bluDamageClassJobFields.length)
    throw new Error(`发现可能提供青魔法师武器伤害映射的 MCP 资料，需先查询并导入：${JSON.stringify({ bluDamageSheetCandidates, bluDamageClassJobFields })}`);
  const capabilityQueries = [
    {
      method: "list_sheets",
      gameVersion: sheetInventory.gameVersion,
      queriedAt: sheetInventory.timestamp,
      returnedRows: sheetInventory.sheets.length,
    },
    {
      method: "describe_sheet",
      sheet: "ClassJob",
      fields: classJobDescription.columns.map((column) => column.name),
      returnedRows: classJobDescription.rowCount,
      gameVersion: classJobDescription.gameVersion,
      queriedAt: classJobDescription.timestamp,
    },
    describeQuery("ContentFinderCondition", contentFinderConditionDescription),
    describeQuery("ItemLevel", itemLevelDescription),
    describeQuery("ParamGrow", paramGrowDescription),
    describeQuery("Item", itemDescription),
  ];
  const syncLevelCapabilityCheck = {
    status: "available-via-content-finder-condition",
    checkedAt: new Date().toISOString(),
    gameVersion: health.gameVersion,
    listSheets: {
      count: sheetInventory.count,
      syncRelatedSheets: sheetInventory.sheets.filter((sheet) => /sync/i.test(String(sheet))),
      gameVersion: sheetInventory.gameVersion,
      queriedAt: sheetInventory.timestamp,
    },
    contentFinderCondition: {
      rowCount: contentFinderConditionDescription.rowCount,
      fields: contentFinderConditionDescription.columns.map((column) => column.name),
      gameVersion: contentFinderConditionDescription.gameVersion,
      queriedAt: contentFinderConditionDescription.timestamp,
    },
    itemLevel: {
      rowCount: itemLevelDescription.rowCount,
      fields: itemLevelDescription.columns.map((column) => column.name),
      gameVersion: itemLevelDescription.gameVersion,
      queriedAt: itemLevelDescription.timestamp,
    },
    paramGrow: {
      rowCount: paramGrowDescription.rowCount,
      fields: paramGrowDescription.columns.map((column) => column.name),
      gameVersion: paramGrowDescription.gameVersion,
      queriedAt: paramGrowDescription.timestamp,
      usedForSyncLevelGrouping: false,
    },
  };
  const variableEquipLevelCapabilityCheck = {
    status: "available-via-item-sub-stat-category",
    checkedAt: new Date().toISOString(),
    gameVersion: health.gameVersion,
    item: {
      rowCount: itemDescription.rowCount,
      fields: itemDescription.columns.map((column) => column.name),
      gameVersion: itemDescription.gameVersion,
      queriedAt: itemDescription.timestamp,
      flagField: "SubStatCategory",
      variableValue: 2,
    },
  };

  const outDir = resolve(upstreamRoot, "data", "out");
  const gearFiles = (await (await import("node:fs/promises")).readdir(outDir)).filter((file) => file.startsWith("gears-") && file.endsWith(".js"));
  const gearGroups = await Promise.all(gearFiles.map(async (file) => ({ file, items: await load(resolve(outDir, file)) })));
  const allGears = gearGroups.flatMap(({ items }) => items);
  const rawFoods = await load(resolve(outDir, "foods.js"));
  const foods = rawFoods.filter((food) => food.slot === -1);
  const levelCaps = await load(resolve(outDir, "levelCaps.js"));
  // Query the complete custom-parameter-weapon sheet against every MCP-visible gear item.
  // The reference list is used only for the later consistency check; it never
  // determines which custom-weapon rows enter the snapshot.
  const referenceCustomIds = allGears.filter((gear) => gear.customizable && gear.source === "幻境武器").map((gear) => gear.id);
  const selectedGearIds = allGears
    .filter((gear) => scope === "all" || (slotIds.has(gear.slot) && gear.level >= 780))
    .map((gear) => gear.id);
  const gearIds = [...new Set(selectedGearIds)];
  const foodIds = foods.map((food) => food.id);
  const itemQueries = [];
  const itemRowsResult = await queryRows(client, "Item", [...gearIds, ...foodIds], itemFields, itemQueries);
  const itemRows = itemRowsResult.rows;
  variableEquipLevelCapabilityCheck.item.persistedItemRows = itemRows.length;
  const categoryIds = [...new Set(itemRows.map((row) => Number(row.fields?.ClassJobCategory)).filter((id) => Number.isInteger(id) && id > 0))];
  const categoryQueries = [];
  const categoryRowsResult = await queryRows(client, "ClassJobCategory", categoryIds, categoryFields, categoryQueries);
  const classJobSearchQueries = [];
  const discoveredClassJobs = await searchClassJobs(client, supportedJobs, classJobSearchQueries);
  const classJobQueries = [];
  const classJobRowsResult = await queryRows(
    client,
    "ClassJob",
    discoveredClassJobs.map((entry) => entry.rowId),
    classJobFields,
    classJobQueries,
  );
  const actionIds = [...new Set(itemRows.filter((row) => foodIds.includes(row.rowId)).map((row) => Number(row.fields?.ItemAction)).filter((id) => Number.isInteger(id) && id > 0))];
  const actionQueries = [];
  const actionRowsResult = await queryRows(client, "ItemAction", actionIds, itemActionFields, actionQueries);
  const foodEffectIds = [...new Set(actionRowsResult.rows.flatMap((row) => Array.from({ length: 9 }, (_, index) => Number(row.fields?.[`Data[${index}]`])).filter((id) => Number.isInteger(id) && id > 0)))];
  const foodQueries = [];
  const foodRowsResult = await queryRows(client, "ItemFood", foodEffectIds, itemFoodFields, foodQueries);
  const levelQueries = [];
  const levelRowsResult = await queryRows(client, "ItemLevel", levelCaps.level, itemLevelFields, levelQueries);
  const baseQueries = [];
  const baseRowsResult = await queryRows(client, "BaseParam", [1, 2, 3, 4, 5, 6, 19, 22, 27, 44, 45, 46], undefined, baseQueries);
  const mandQueries = [];
  const mandRowsResult = await queryRows(
    client,
    "MandervilleWeaponEnhance",
    allGears.map((gear) => gear.id),
    mandervilleFields,
    mandQueries,
  );
  const customIds = [...new Set(mandRowsResult.rows.map((row) => Number(row.rowId)).filter(Number.isInteger))].sort((a, b) => a - b);
  const missingReferenceCustomIds = referenceCustomIds.filter((id) => !customIds.includes(id));
  const unexpectedCustomIds = customIds.filter((id) => !referenceCustomIds.includes(id));
  if (!customIds.length || !referenceCustomIds.some((id) => customIds.includes(id)))
    throw new Error("MCP 自定义武器集合为空或与参考主键完全无交集，请核对版本与参数表");
  const materiaQueries = [];
  const materiaRowsResult = await queryRows(client, "Materia", Array.from({ length: 1417 }, (_, index) => index), fields(Array.from({ length: 16 }, (_, index) => `Value[${index}]`).concat("BaseParam")), materiaQueries);
  const syncLevelQueries = [];
  const contentFinderConditionRowsResult = await queryAllRows(
    client,
    "ContentFinderCondition",
    "ClassJobLevelRequired,ItemLevelRequired,ItemLevelSync",
    syncLevelQueries,
  );
  const paramGrowRowsResult = await queryRows(
    client,
    "ParamGrow",
    [50, 60, 70, 80, 90, 100],
    "ItemLevelSync",
    syncLevelQueries,
  );
  if (contentFinderConditionRowsResult.rows.length !== contentFinderConditionDescription.rowCount)
    throw new Error(`MCP ContentFinderCondition 查询行数不一致：${contentFinderConditionRowsResult.rows.length} !== ${contentFinderConditionDescription.rowCount}`);
  if (paramGrowRowsResult.missingRowIds.length)
    throw new Error(`MCP ParamGrow 缺少行：${paramGrowRowsResult.missingRowIds.join(", ")}`);
  const queriedAt = new Date().toISOString();
  const allQueries = [...capabilityQueries, ...classJobSearchQueries, ...classJobQueries, ...itemQueries, ...categoryQueries, ...actionQueries, ...foodQueries, ...levelQueries, ...baseQueries, ...mandQueries, ...materiaQueries, ...syncLevelQueries];
  if (allQueries.some((query) => query.gameVersion !== health.gameVersion))
    throw new Error("MCP 查询批次游戏版本不一致，拒绝生成混合快照");
  const snapshot = {
    schemaVersion: 1,
    server: "ffxiv-mcp-lumina",
    gameVersion: health.gameVersion,
    validatedVersion: health.validatedVersion,
    genericQueryValidation: { allowed: genericQueriesAvailable, warnings: health.warnings ?? [] },
    queriedAt,
    scope,
    client: initialization?.serverInfo ?? initialization,
    reference: { repository: "https://github.com/Asvel/ffxiv-gearing.git", sourceRoot: upstreamRoot },
    queryPlan: {
      gearItemIds: gearIds,
      foodItemIds: foodIds,
      itemLevelIds: levelCaps.level,
      customWeaponIds: customIds,
      classJobIds: Object.fromEntries(discoveredClassJobs.map((entry) => [entry.job, entry.rowId])),
      referenceCustomWeaponDifferences: { missing: missingReferenceCustomIds, added: unexpectedCustomIds },
    },
    sourceCapabilityChecks: {
      syncLevels: syncLevelCapabilityCheck,
      equipLevelVariable: variableEquipLevelCapabilityCheck,
      bluMdmgAdditions: {
        status: "missing-from-mcp",
        checkedAt: queriedAt,
        gameVersion: health.gameVersion,
        listSheets: {
          count: sheetInventory.count,
          sheets: sheetInventory.sheets,
          gameVersion: sheetInventory.gameVersion,
          queriedAt: sheetInventory.timestamp,
        },
        classJob: {
          rowCount: classJobDescription.rowCount,
          fields: classJobDescription.columns.map((column) => column.name),
          gameVersion: classJobDescription.gameVersion,
          queriedAt: classJobDescription.timestamp,
        },
      },
    },
    rows: {
      Item: itemRows,
      ClassJobCategory: categoryRowsResult.rows,
      ClassJob: classJobRowsResult.rows,
      ItemAction: actionRowsResult.rows,
      ItemFood: foodRowsResult.rows,
      ItemLevel: levelRowsResult.rows,
      BaseParam: baseRowsResult.rows,
      MandervilleWeaponEnhance: mandRowsResult.rows,
      Materia: materiaRowsResult.rows,
      ContentFinderCondition: contentFinderConditionRowsResult.rows,
      ParamGrow: paramGrowRowsResult.rows,
    },
    queries: [
      { method: "health", gameVersion: health.gameVersion, validatedVersion: health.validatedVersion, queriedAt: health.timestamp },
      ...itemQueries,
      ...capabilityQueries, ...classJobSearchQueries, ...classJobQueries,
      ...categoryQueries, ...actionQueries, ...foodQueries, ...levelQueries, ...baseQueries, ...mandQueries, ...materiaQueries,
      ...syncLevelQueries,
    ],
    missing: {
      Item: itemRowsResult.missingRowIds,
      ItemSubStatCategory: itemRowsResult.missingRowIds,
      ClassJobCategory: categoryRowsResult.missingRowIds,
      ClassJob: classJobRowsResult.missingRowIds,
      ItemAction: actionRowsResult.missingRowIds,
      ItemFood: foodRowsResult.missingRowIds,
      ItemLevel: levelRowsResult.missingRowIds,
      BaseParam: baseRowsResult.missingRowIds,
      MandervilleWeaponEnhance: mandRowsResult.missingRowIds,
      Materia: materiaRowsResult.missingRowIds,
      ContentFinderCondition: contentFinderConditionRowsResult.missingRowIds,
      ParamGrow: paramGrowRowsResult.missingRowIds,
      bluMdmgAdditions: "Lumina MCP list_sheets and ClassJob describe_sheet do not expose a per-INT BLU magical-weapon-damage addition table or field; see sourceCapabilityChecks.bluMdmgAdditions.",
    },
  };
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, scope, itemRows: itemRows.length, categoryRows: categoryRowsResult.rows.length, classJobRows: classJobRowsResult.rows.length, actionRows: actionRowsResult.rows.length, foodRows: foodRowsResult.rows.length, itemLevelRows: levelRowsResult.rows.length, baseParamRows: baseRowsResult.rows.length, mandervilleRows: mandRowsResult.rows.length, materiaRows: materiaRowsResult.rows.length, missing: snapshot.missing }));
  }
} finally {
  client.close();
}

