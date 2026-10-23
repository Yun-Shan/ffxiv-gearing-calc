import { access, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { allowsGenericQueries } from "./mcp-query-validation.mjs";
import {
  itemActionReturnFields,
  itemFoodReturnFields,
  itemLevelReturnFields,
  itemReturnFields,
  supportedItemSpecialBonusIds,
  mandervilleReturnFields,
  classJobReturnFields,
  supportedJobIds,
} from "./mcp-lumina-import.mjs";

const defaultCommand = "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\mcp-ffxiv-lumina\\publish\\mcp-lumina.exe";
export async function queryMcpLumina({ upstreamRoot: upstreamRootOption, command: commandOption, concurrency: concurrencyOption } = {}) {
  const root = resolve(import.meta.dirname, "..");
  const upstreamRoot = resolve(
    upstreamRootOption ?? process.env.FFXIV_GEARING_ROOT ?? resolve(root, "reference", "ffxiv-gearing"),
  );
  const command = commandOption ?? process.env.FFXIV_MCP_LUMINA_COMMAND ?? defaultCommand;
  const concurrency = Math.max(1, Number(concurrencyOption ?? process.env.FFXIV_MCP_LUMINA_CONCURRENCY ?? 4));
  const supportedJobs = supportedJobIds;
  const fields = (values) => values.join(",");
  const categoryFields = fields(supportedJobs);
  const itemFoodFields = fields(itemFoodReturnFields);
  const itemActionFields = fields(itemActionReturnFields);
  const itemLevelFields = fields(itemLevelReturnFields);
  const itemFields = fields(itemReturnFields);
  const mandervilleFields = fields(mandervilleReturnFields);
  const resistanceWeaponAdjustReturnFields = [
    "Image",
    "MaxTotalStats",
    "MaxEachStat",
    "BaseParam[0]",
    "BaseParam[1]",
    "BaseParam[2]",
    "BaseParam[3]",
    "Unknown0",
  ];
  const classJobFields = fields(classJobReturnFields);
  const syncDutyFields = "Name,ItemLevelSync,ClassJobLevelSync,JournalGenre,ContentType,ContentUICategory,HighEndDuty,AllowUndersized,ContentLinkType";

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
    constructor({ command, cwd, environment }) {
      this.nextId = 1;
      this.pending = new Map();
      this.state = { buffer: "" };
      this.process = spawn(command, [], {
        cwd,
        stdio: ["pipe", "pipe", "inherit"],
        env: {
          ...environment,
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

  function validateResistanceWeaponAdjustRows(rows, missingRowIds, description, gameVersion, queriedRowIds) {
    if (!Array.isArray(rows) || rows.length !== description.rowCount || missingRowIds.length)
      throw new Error(`MCP ResistanceWeaponAdjust 全量查询不完整：${rows?.length ?? 0}/${description.rowCount}`);
    if (!Array.isArray(queriedRowIds) || queriedRowIds.length !== rows.length)
      throw new Error("MCP ResistanceWeaponAdjust 全量查询范围不完整");
    const seenIds = new Set();
    const nonzeroItemIds = [];
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.rowId) || row.rowId < 0 || seenIds.has(row.rowId))
        throw new Error("MCP ResistanceWeaponAdjust 返回了无效或重复 rowId");
      seenIds.add(row.rowId);
      if (row.gameVersion !== gameVersion || !row.timestamp ||
          !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
        throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 缺少同版本字段或查询时间`);
      for (const fieldName of resistanceWeaponAdjustReturnFields) {
        const value = row.fields[fieldName];
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
          throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 的 ${fieldName} 不是有效 uint`);
      }
      if (row.rowId === 0 && resistanceWeaponAdjustReturnFields.some((fieldName) => row.fields[fieldName] !== 0))
        throw new Error("MCP ResistanceWeaponAdjust 行 0 应全部为零");
      if (row.rowId > 0 && ![0, 1, 2, 3].some((index) => row.fields[`BaseParam[${index}]`] > 0))
        throw new Error(`MCP ResistanceWeaponAdjust 行 ${row.rowId} 没有可调整属性`);
      if (row.rowId > 0) nonzeroItemIds.push(row.rowId);
    }
    if (!seenIds.has(0) || queriedRowIds.some((id) => !seenIds.has(id)) ||
        rows.some((row) => !queriedRowIds.includes(row.rowId)))
      throw new Error("MCP ResistanceWeaponAdjust 全量查询缺少空行 0 或行目录与查询范围不一致");
    return nonzeroItemIds.sort((left, right) => left - right);
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

  const client = new McpClient({ command, cwd: root, environment: process.env });
  try {
    if (!(await fileExists(command)) && command.includes("\\"))
      throw new Error(`找不到 Lumina MCP 可执行文件：${command}。请设置 FFXIV_MCP_LUMINA_COMMAND。`);
    const initialization = await client.initialize();
    const health = (await client.callTool("health", {})).value;
    const genericQueriesAvailable = allowsGenericQueries(health);
    if (!genericQueriesAvailable)
      throw new Error(`Lumina MCP 通用查询不可用：${JSON.stringify(health)}`);


    const [
      sheetInventoryResult,
      classJobDescriptionResult,
      itemDescriptionResult,
      itemSpecialBonusDescriptionResult,
      contentFinderConditionDescriptionResult,
      contentTypeDescriptionResult,
      contentUICategoryDescriptionResult,
      itemLevelDescriptionResult,
      paramGrowDescriptionResult,
      resistanceWeaponAdjustDescriptionResult,
    ] = await Promise.all([
      client.callTool("list_sheets", {}),
      client.callTool("describe_sheet", { sheet: "ClassJob" }),
      client.callTool("describe_sheet", { sheet: "Item" }),
      client.callTool("describe_sheet", { sheet: "ItemSpecialBonus" }),
      client.callTool("describe_sheet", { sheet: "ContentFinderCondition" }),
      client.callTool("describe_sheet", { sheet: "ContentType" }),
      client.callTool("describe_sheet", { sheet: "ContentUICategory" }),
      client.callTool("describe_sheet", { sheet: "ItemLevel" }),
      client.callTool("describe_sheet", { sheet: "ParamGrow" }),
      client.callTool("describe_sheet", { sheet: "ResistanceWeaponAdjust" }),
    ]);
    const sheetInventory = sheetInventoryResult.value;
    const classJobDescription = classJobDescriptionResult.value;
    const itemDescription = itemDescriptionResult.value;
    const itemSpecialBonusDescription = itemSpecialBonusDescriptionResult.value;
    const contentFinderConditionDescription = contentFinderConditionDescriptionResult.value;
    const contentTypeDescription = contentTypeDescriptionResult.value;
    const contentUICategoryDescription = contentUICategoryDescriptionResult.value;
    const itemLevelDescription = itemLevelDescriptionResult.value;
    const paramGrowDescription = paramGrowDescriptionResult.value;
    const resistanceWeaponAdjustDescription = resistanceWeaponAdjustDescriptionResult.value;
    if (!Array.isArray(sheetInventory.sheets) || !Array.isArray(classJobDescription.columns))
      throw new Error("Lumina MCP 未能提供 Sheet 清单或 ClassJob 字段描述，无法核对青魔法师伤害数据来源");
    if (!sheetInventory.sheets.includes("ResistanceWeaponAdjust"))
      throw new Error("Lumina MCP Sheet 清单缺少 ResistanceWeaponAdjust");
    if (!sheetInventory.sheets.includes("ItemSpecialBonus"))
      throw new Error("Lumina MCP Sheet 清单缺少 ItemSpecialBonus");
    if (!sheetInventory.sheets.includes("ContentType"))
      throw new Error("MCP sheet inventory lacks ContentType");
    if (!sheetInventory.sheets.includes("ContentUICategory"))
      throw new Error("MCP sheet inventory lacks ContentUICategory");
    for (const [sheet, description] of [
      ["ContentFinderCondition", contentFinderConditionDescription],
      ["ContentType", contentTypeDescription],
      ["ContentUICategory", contentUICategoryDescription],
      ["ItemLevel", itemLevelDescription],
      ["ParamGrow", paramGrowDescription],
      ["Item", itemDescription],
      ["ItemSpecialBonus", itemSpecialBonusDescription],
      ["ResistanceWeaponAdjust", resistanceWeaponAdjustDescription],
    ]) {
      if (!Array.isArray(description.columns) || description.gameVersion !== health.gameVersion)
        throw new Error(`MCP ${sheet} Schema 缺失或游戏版本与 health 不一致`);
    }
    validateSyncLevelSchema("ContentFinderCondition", contentFinderConditionDescription, syncDutyFields.split(","));
    validateSyncLevelSchema("ContentType", contentTypeDescription, ["Name"]);
    validateSyncLevelSchema("ContentUICategory", contentUICategoryDescription, ["Name"]);
    validateSyncLevelSchema("ItemLevel", itemLevelDescription, itemLevelReturnFields);
    validateSyncLevelSchema("ParamGrow", paramGrowDescription, ["ItemLevelSync"]);
    validateSyncLevelSchema("Item", itemDescription, [
      "SubStatCategory", "ItemSpecialBonus", "ItemSpecialBonusParam",
      ...Array.from({ length: 6 }, (_, index) => `BaseParamSpecial[${index}]`),
      ...Array.from({ length: 6 }, (_, index) => `BaseParamValueSpecial[${index}]`),
    ]);
    validateSyncLevelSchema("ItemSpecialBonus", itemSpecialBonusDescription, ["Name", "RequirementText"]);
    const resistanceFields = new Set(resistanceWeaponAdjustDescription.columns.map((column) => column.name));
    const missingResistanceFields = resistanceWeaponAdjustReturnFields.filter((field) => !resistanceFields.has(field));
    if (!Number.isSafeInteger(resistanceWeaponAdjustDescription.rowCount) ||
        resistanceWeaponAdjustDescription.rowCount < 1 || missingResistanceFields.length)
      throw new Error(`MCP ResistanceWeaponAdjust Schema 缺少字段或有效行数：${missingResistanceFields.join(", ")}`);
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
      describeQuery("ContentType", contentTypeDescription),
      describeQuery("ContentUICategory", contentUICategoryDescription),
      describeQuery("ItemLevel", itemLevelDescription),
      describeQuery("ParamGrow", paramGrowDescription),
      describeQuery("Item", itemDescription),
      describeQuery("ItemSpecialBonus", itemSpecialBonusDescription),
      describeQuery("ResistanceWeaponAdjust", resistanceWeaponAdjustDescription),
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
      contentType: {
        rowCount: contentTypeDescription.rowCount,
        fields: contentTypeDescription.columns.map((column) => column.name),
        gameVersion: contentTypeDescription.gameVersion,
        queriedAt: contentTypeDescription.timestamp,
      },
      contentUICategory: {
        rowCount: contentUICategoryDescription.rowCount,
        fields: contentUICategoryDescription.columns.map((column) => column.name),
        gameVersion: contentUICategoryDescription.gameVersion,
        queriedAt: contentUICategoryDescription.timestamp,
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
        usedForSyncLevelGrouping: true,
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
    const resistanceQueries = [];
    const resistanceRowsResult = await queryAllRows(
      client,
      "ResistanceWeaponAdjust",
      fields(resistanceWeaponAdjustReturnFields),
      resistanceQueries,
    );
    const resistanceListQuery = resistanceQueries.find((query) =>
      query.method === "list_rows" && query.sheet === "ResistanceWeaponAdjust",
    );
    const resistanceWeaponAdjustItemIds = validateResistanceWeaponAdjustRows(
      resistanceRowsResult.rows,
      resistanceRowsResult.missingRowIds,
      resistanceWeaponAdjustDescription,
      health.gameVersion,
      resistanceListQuery?.rowIds,
    );
    const rawFoods = await load(resolve(outDir, "foods.js"));
    const foods = rawFoods.filter((food) => food.slot === -1);
    // Query the complete custom-parameter-weapon sheet against every MCP-visible gear item.
    // The reference list is used only for the later consistency check; it never
    // determines which custom-weapon rows enter the snapshot.
    const referenceCustomIds = allGears.filter((gear) => gear.customizable && gear.source === "幻境武器").map((gear) => gear.id);
    const selectedGearIds = allGears.map((gear) => gear.id);
    const gearIds = [...new Set([...selectedGearIds, ...resistanceWeaponAdjustItemIds])]
      .sort((left, right) => left - right);
    const foodIds = foods.map((food) => food.id);
    const itemQueries = [];
    const itemRowsResult = await queryRows(client, "Item", [...gearIds, ...foodIds], itemFields, itemQueries);
    const itemRows = itemRowsResult.rows;
    const itemSpecialBonusQueries = [];
    const itemSpecialBonusRowsResult = await queryRows(
      client,
      "ItemSpecialBonus",
      supportedItemSpecialBonusIds,
      "Name,RequirementText",
      itemSpecialBonusQueries,
    );
    if (itemSpecialBonusRowsResult.missingRowIds.length ||
        itemSpecialBonusRowsResult.rows.length !== supportedItemSpecialBonusIds.length ||
        itemSpecialBonusRowsResult.rows.some((row) => typeof row.fields?.Name !== "string" ||
          row.gameVersion !== health.gameVersion || !row.timestamp))
      throw new Error("MCP ItemSpecialBonus 支持行查询缺失、字段无效或跨版本");
    const queriedItemIds = new Set(itemRows.map((row) => row.rowId));
    const missingResistanceItems = resistanceWeaponAdjustItemIds.filter((id) => !queriedItemIds.has(id));
    if (missingResistanceItems.length)
      throw new Error(`ResistanceWeaponAdjust 行缺少对应 MCP Item 行：${missingResistanceItems.join(",")}`);
    const itemById = new Map(itemRows.map((row) => [row.rowId, row]));
    for (const id of resistanceWeaponAdjustItemIds) {
      const row = itemById.get(id);
      if (row.gameVersion !== health.gameVersion || !row.timestamp || typeof row.fields?.Name !== "string")
        throw new Error(`ResistanceWeaponAdjust 行 ${id} 对应 MCP Item 行缺少字段、游戏版本或查询时间`);
    }
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
      syncDutyFields,
      syncLevelQueries,
    );
    const contentTypeRowsResult = await queryAllRows(
      client,
      "ContentType",
      "Name",
      syncLevelQueries,
    );
    const contentUICategoryRowsResult = await queryAllRows(
      client,
      "ContentUICategory",
      "Name",
      syncLevelQueries,
    );
    const paramGrowRowsResult = await queryAllRows(
      client,
      "ParamGrow",
      "ItemLevelSync",
      syncLevelQueries,
    );
    if (contentFinderConditionRowsResult.rows.length !== contentFinderConditionDescription.rowCount || contentFinderConditionRowsResult.missingRowIds.length)
      throw new Error(`MCP ContentFinderCondition 查询行数不一致：${contentFinderConditionRowsResult.rows.length} !== ${contentFinderConditionDescription.rowCount}`);
    if (contentTypeRowsResult.rows.length !== contentTypeDescription.rowCount || contentTypeRowsResult.missingRowIds.length)
      throw new Error(`MCP ContentType 查询行数不一致：${contentTypeRowsResult.rows.length} !== ${contentTypeDescription.rowCount}`);
    if (contentUICategoryRowsResult.rows.length !== contentUICategoryDescription.rowCount || contentUICategoryRowsResult.missingRowIds.length)
      throw new Error(`MCP ContentUICategory 查询行数不一致：${contentUICategoryRowsResult.rows.length} !== ${contentUICategoryDescription.rowCount}`);
    if (paramGrowRowsResult.rows.length !== paramGrowDescription.rowCount || paramGrowRowsResult.missingRowIds.length)
      throw new Error(`MCP ParamGrow 全量行查询不完整：${paramGrowRowsResult.rows.length}/${paramGrowDescription.rowCount}`);
    const levelRowsResult = await queryAllRows(client, "ItemLevel", itemLevelFields, levelQueries);
    if (levelRowsResult.rows.length !== itemLevelDescription.rowCount || levelRowsResult.missingRowIds.length)
      throw new Error(`MCP ItemLevel 全量行查询不完整：${levelRowsResult.rows.length}/${itemLevelDescription.rowCount}`);
    const queriedAt = new Date().toISOString();
    const allQueries = [...capabilityQueries, ...resistanceQueries, ...classJobSearchQueries, ...classJobQueries, ...itemQueries, ...itemSpecialBonusQueries, ...categoryQueries, ...actionQueries, ...foodQueries, ...levelQueries, ...baseQueries, ...mandQueries, ...materiaQueries, ...syncLevelQueries];
    if (allQueries.some((query) => query.gameVersion !== health.gameVersion))
      throw new Error("MCP 查询批次游戏版本不一致，拒绝生成混合快照");
    const snapshot = {
      schemaVersion: 1,
      server: "ffxiv-mcp-lumina",
      gameVersion: health.gameVersion,
      validatedVersion: health.validatedVersion,
      health,
      genericQueryValidation: { allowed: genericQueriesAvailable, warnings: health.warnings ?? [] },
      queriedAt,
      client: initialization?.serverInfo ?? initialization,
      reference: { repository: "https://github.com/Asvel/ffxiv-gearing.git", sourceRoot: upstreamRoot },
      queryPlan: {
        gearItemIds: gearIds,
        foodItemIds: foodIds,
        resistanceWeaponAdjustItemIds,
        itemLevelIds: levelRowsResult.rows.map((row) => row.rowId).sort((left, right) => left - right),
        customWeaponIds: customIds,
        classJobIds: Object.fromEntries(discoveredClassJobs.map((entry) => [entry.job, entry.rowId])),
        referenceCustomWeaponDifferences: { missing: missingReferenceCustomIds, added: unexpectedCustomIds },
      },
      sourceCapabilityChecks: {
        syncLevels: syncLevelCapabilityCheck,
        equipLevelVariable: variableEquipLevelCapabilityCheck,
        resistanceWeaponAdjust: {
          status: "available",
          checkedAt: new Date().toISOString(),
          gameVersion: health.gameVersion,
          rowCount: resistanceWeaponAdjustDescription.rowCount,
          fields: resistanceWeaponAdjustDescription.columns.map((column) => column.name),
          schemaQueriedAt: resistanceWeaponAdjustDescription.timestamp,
        },
        itemSpecialBonus: {
          status: "available",
          checkedAt: new Date().toISOString(),
          gameVersion: health.gameVersion,
          supportedIds: supportedItemSpecialBonusIds,
          item: {
            rowCount: itemDescription.rowCount,
            fields: itemDescription.columns.map((column) => column.name),
            gameVersion: itemDescription.gameVersion,
            queriedAt: itemDescription.timestamp,
            persistedItemRows: itemRows.length,
          },
          itemSpecialBonus: {
            rowCount: itemSpecialBonusDescription.rowCount,
            fields: itemSpecialBonusDescription.columns.map((column) => column.name),
            gameVersion: itemSpecialBonusDescription.gameVersion,
            queriedAt: itemSpecialBonusDescription.timestamp,
            persistedRows: itemSpecialBonusRowsResult.rows.length,
          },
        },
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
        ItemSpecialBonus: itemSpecialBonusRowsResult.rows,
        ResistanceWeaponAdjust: resistanceRowsResult.rows,
        ClassJobCategory: categoryRowsResult.rows,
        ClassJob: classJobRowsResult.rows,
        ItemAction: actionRowsResult.rows,
        ItemFood: foodRowsResult.rows,
        ItemLevel: levelRowsResult.rows,
        BaseParam: baseRowsResult.rows,
        MandervilleWeaponEnhance: mandRowsResult.rows,
        Materia: materiaRowsResult.rows,
        ContentFinderCondition: contentFinderConditionRowsResult.rows,
        ContentType: contentTypeRowsResult.rows,
        ContentUICategory: contentUICategoryRowsResult.rows,
        ParamGrow: paramGrowRowsResult.rows,
      },
      queries: [
        { method: "health", gameVersion: health.gameVersion, validatedVersion: health.validatedVersion, queriedAt: health.timestamp },
        ...allQueries,
      ],
      missing: {
        Item: itemRowsResult.missingRowIds,
        ItemSpecialBonus: itemSpecialBonusRowsResult.missingRowIds,
        ResistanceWeaponAdjust: resistanceRowsResult.missingRowIds,
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
        ContentType: contentTypeRowsResult.missingRowIds,
        ContentUICategory: contentUICategoryRowsResult.missingRowIds,
        ParamGrow: paramGrowRowsResult.missingRowIds,
        bluMdmgAdditions: "Lumina MCP list_sheets and ClassJob describe_sheet do not expose a per-INT BLU magical-weapon-damage addition table or field; see sourceCapabilityChecks.bluMdmgAdditions.",
      },
    };
    return snapshot;
  } finally {
    client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const removedOptions = process.argv.slice(2).filter((argument) =>
    argument === "--offline" || argument === "--item-special-bonus-data-only" ||
    argument === "--snapshot" || argument.startsWith("--snapshot=") ||
    argument === "--scope" || argument.startsWith("--scope=") ||
    argument === "--mcp-snapshot" || argument.startsWith("--mcp-snapshot="),
  );
  if (removedOptions.length)
    throw new Error(`已移除独立 MCP 查询选项：${removedOptions.join(", ")}；请运行 npm run data:update`);
  throw new Error("此模块仅供完整数据更新流程调用；请运行 npm run data:update");
}

