import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { allowsGenericQueries } from "../mcp-query-validation.mjs";
import { createMcpQueryHelpers } from "./query-helpers.mjs";
import { McpClient } from "./transport.mjs";
import {
  classJobCategoryReturnFields,
  classJobReturnFields,
  contentFinderConditionReturnFields,
  contentTypeReturnFields,
  contentUICategoryReturnFields,
  itemActionReturnFields,
  itemFoodReturnFields,
  itemLevelReturnFields,
  itemReturnFields,
  itemSpecialBonusReturnFields,
  mandervilleReturnFields,
  materiaReturnFields,
  paramGrowReturnFields,
  resistanceWeaponAdjustReturnFields,
} from "./query-presets.mjs";
import {
  supportedItemSpecialBonusIds,
  supportedJobIds,
} from "../mcp-lumina-import.mjs";

const defaultCommand = "F:\\Workspace\\VisualStudio\\ffxiv\\mcp\\mcp-ffxiv-lumina\\publish\\mcp-lumina.exe";
export async function queryMcpLumina({ upstreamRoot: upstreamRootOption, command: commandOption, concurrency: concurrencyOption } = {}) {
  const root = resolve(import.meta.dirname, "../..");
  const upstreamRoot = resolve(
    upstreamRootOption ?? process.env.FFXIV_GEARING_ROOT ?? resolve(root, "reference", "ffxiv-gearing"),
  );
  const command = commandOption ?? process.env.FFXIV_MCP_LUMINA_COMMAND ?? defaultCommand;
  const concurrency = Math.max(1, Number(concurrencyOption ?? process.env.FFXIV_MCP_LUMINA_CONCURRENCY ?? 4));
  const supportedJobs = supportedJobIds;
  const fields = (values) => values.join(",");
  const itemFoodFields = fields(itemFoodReturnFields);
  const itemActionFields = fields(itemActionReturnFields);
  const itemLevelFields = fields(itemLevelReturnFields);
  const itemFields = fields(itemReturnFields);
  const mandervilleFields = fields(mandervilleReturnFields);
  const classJobFields = fields(classJobReturnFields);
  const syncDutyFields = fields(contentFinderConditionReturnFields);

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

  const { queryRows, queryAllRows, validateResistanceWeaponAdjustRows, describeQuery, validateSyncLevelSchema, searchClassJobs } = createMcpQueryHelpers({ concurrency });

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
    if (classJobDescription.gameVersion !== health.gameVersion ||
        !classJobDescription.timestamp ||
        !Number.isSafeInteger(classJobDescription.rowCount) || classJobDescription.rowCount < 1)
      throw new Error("MCP ClassJob Schema 缺少同版本、时间或有效行数来源");
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
    validateSyncLevelSchema("ClassJob", classJobDescription, classJobReturnFields);
    validateSyncLevelSchema("ContentFinderCondition", contentFinderConditionDescription, contentFinderConditionReturnFields);
    validateSyncLevelSchema("ContentType", contentTypeDescription, contentTypeReturnFields);
    validateSyncLevelSchema("ContentUICategory", contentUICategoryDescription, contentUICategoryReturnFields);
    validateSyncLevelSchema("ItemLevel", itemLevelDescription, itemLevelReturnFields);
    validateSyncLevelSchema("ParamGrow", paramGrowDescription, paramGrowReturnFields);
    validateSyncLevelSchema("Item", itemDescription, [
      "CanBeHq", "SubStatCategory", "ItemSpecialBonus", "ItemSpecialBonusParam",
      ...Array.from({ length: 6 }, (_, index) => `BaseParamSpecial[${index}]`),
      ...Array.from({ length: 6 }, (_, index) => `BaseParamValueSpecial[${index}]`),
    ]);
    validateSyncLevelSchema("ItemSpecialBonus", itemSpecialBonusDescription, itemSpecialBonusReturnFields);
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
    const gearFiles = (await readdir(outDir)).filter((file) => file.startsWith("gears-") && file.endsWith(".js"));
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
      resistanceWeaponAdjustReturnFields,
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
      fields(itemSpecialBonusReturnFields),
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
    const categoryFields = fields(classJobCategoryReturnFields(supportedJobs));
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
    const materiaRowsResult = await queryRows(client, "Materia", Array.from({ length: 1417 }, (_, index) => index), fields(materiaReturnFields), materiaQueries);
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
      fields(contentTypeReturnFields),
      syncLevelQueries,
    );
    const contentUICategoryRowsResult = await queryAllRows(
      client,
      "ContentUICategory",
      fields(contentUICategoryReturnFields),
      syncLevelQueries,
    );
    const paramGrowRowsResult = await queryAllRows(
      client,
      "ParamGrow",
      fields(paramGrowReturnFields),
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
