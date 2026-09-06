import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  itemActionReturnFields,
  itemFoodReturnFields,
  itemLevelReturnFields,
  itemReturnFields,
  mandervilleReturnFields,
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
const supportedJobs = [
  "PLD", "WAR", "DRK", "GNB", "WHM", "SCH", "AST", "SGE", "MNK", "DRG", "NIN", "SAM", "RPR", "VPR",
  "BRD", "MCH", "DNC", "BLM", "SMN", "RDM", "PCT",
];
const slotIds = new Set([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13]);
const fields = (values) => values.join(",");
const categoryFields = fields(supportedJobs);
const itemFoodFields = fields(itemFoodReturnFields);
const itemActionFields = fields(itemActionReturnFields);
const itemLevelFields = fields(itemLevelReturnFields);
const itemFields = fields(itemReturnFields);
const mandervilleFields = fields(mandervilleReturnFields);

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

const client = new McpClient();
try {
  if (!(await fileExists(command)) && command.includes("\\"))
    throw new Error(`找不到 Lumina MCP 可执行文件：${command}。请设置 FFXIV_MCP_LUMINA_COMMAND。`);
  const initialization = await client.initialize();
  const health = (await client.callTool("health", {})).value;
  if (health.status !== "ok" || health.gameVersion !== health.validatedVersion)
    throw new Error(`Lumina MCP 版本校验失败：${JSON.stringify(health)}`);

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
  const itemRowsResult = await queryRows(client, "Item", [...gearIds, ...foodIds], itemFields, []);
  const itemRows = itemRowsResult.rows;
  const categoryIds = [...new Set(itemRows.map((row) => Number(row.fields?.ClassJobCategory)).filter((id) => Number.isInteger(id) && id > 0))];
  const categoryQueries = [];
  const categoryRowsResult = await queryRows(client, "ClassJobCategory", categoryIds, categoryFields, categoryQueries);
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
  if (missingReferenceCustomIds.length || unexpectedCustomIds.length)
    throw new Error(`MCP MandervilleWeaponEnhance 行集合与参考项目不一致：缺少 ${missingReferenceCustomIds.join(",") || "无"}；新增 ${unexpectedCustomIds.join(",") || "无"}`);
  const materiaQueries = [];
  const materiaRowsResult = await queryRows(client, "Materia", Array.from({ length: 1417 }, (_, index) => index), fields(Array.from({ length: 16 }, (_, index) => `Value[${index}]`).concat("BaseParam")), materiaQueries);
  const queriedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    server: "ffxiv-mcp-lumina",
    gameVersion: health.gameVersion,
    validatedVersion: health.validatedVersion,
    queriedAt,
    scope,
    client: initialization?.serverInfo ?? initialization,
    reference: { repository: "https://github.com/Asvel/ffxiv-gearing.git", sourceRoot: upstreamRoot },
    queryPlan: {
      gearItemIds: gearIds,
      foodItemIds: foodIds,
      itemLevelIds: levelCaps.level,
      customWeaponIds: customIds,
    },
    rows: {
      Item: itemRows,
      ClassJobCategory: categoryRowsResult.rows,
      ItemAction: actionRowsResult.rows,
      ItemFood: foodRowsResult.rows,
      ItemLevel: levelRowsResult.rows,
      BaseParam: baseRowsResult.rows,
      MandervilleWeaponEnhance: mandRowsResult.rows,
      Materia: materiaRowsResult.rows,
    },
    queries: [
      { method: "health", gameVersion: health.gameVersion, validatedVersion: health.validatedVersion, queriedAt: health.timestamp },
      ...itemRowsResult.rows.length ? [{ method: "get_rows", sheet: "Item", rowIds: [...new Set([...gearIds, ...foodIds])], fields: itemReturnFields, returnedRows: itemRowsResult.rows.length, missingRowIds: itemRowsResult.missingRowIds }] : [],
      ...categoryQueries, ...actionQueries, ...foodQueries, ...levelQueries, ...baseQueries, ...mandQueries, ...materiaQueries,
    ],
    missing: {
      Item: itemRowsResult.missingRowIds,
      ClassJobCategory: categoryRowsResult.missingRowIds,
      ItemAction: actionRowsResult.missingRowIds,
      ItemFood: foodRowsResult.missingRowIds,
      ItemLevel: levelRowsResult.missingRowIds,
      BaseParam: baseRowsResult.missingRowIds,
      MandervilleWeaponEnhance: mandRowsResult.missingRowIds,
      Materia: materiaRowsResult.missingRowIds,
    },
  };
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, scope, itemRows: itemRows.length, categoryRows: categoryRowsResult.rows.length, actionRows: actionRowsResult.rows.length, foodRows: foodRowsResult.rows.length, itemLevelRows: levelRowsResult.rows.length, baseParamRows: baseRowsResult.rows.length, mandervilleRows: mandRowsResult.rows.length, materiaRows: materiaRowsResult.rows.length, missing: snapshot.missing }));
} finally {
  client.close();
}

