import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { binUiMetadataFromSnapshot } from "../bin-ui-metadata.mjs";
import { syncDataFromSnapshot } from "../sync-level-duties.mjs";
import { excludeReferenceGearSource, includeGearInCatalog } from "../gear-catalog-policy.mjs";
import {
  classJobReturnFields,
  contentFinderConditionReturnFields,
  contentTypeReturnFields,
  contentUICategoryReturnFields,
  itemActionReturnFields,
  itemFoodReturnFields,
  itemLevelReturnFields,
  materiaReturnFields,
  paramGrowReturnFields,
} from "../mcp-lumina/query-presets.mjs";
import {
  mcpSource,
} from "../mcp-lumina-import.mjs";
import {
  itemCoreReturnFields,
  itemFieldQuerySources,
  itemSpecialBonusTableSource,
  resistanceWeaponAdjustSource,
  snapshotRows,
  snapshotSource,
  supportedJobs,
} from "./mcp-snapshot.mjs";
import {
  combatMateriaStats,
  mergeMcpFoodData,
  mergeMcpGearData,
  mergeMcpLevelCaps,
  mergeMcpMaterias,
  mergeMcpSlotCaps,
} from "./mcp-merge.mjs";
import {
  importDefault,
  normalizeFood,
  normalizeGear,
  normalizeJobSchemas,
  parseGameConstants,
  validateBluMdmgAdditions,
} from "./upstream-reference.mjs";

export async function createPayload(mcpSnapshot, context) {
  const outDir = resolve(context.upstreamRoot, "data", "out");
  const gearFiles = (await readdir(outDir)).filter((file) => /^gears-.*\.js$/i.test(file)).sort();
  if (!gearFiles.length) throw new Error("参考项目没有装备导出文件");

  const [rawFoods, gameSource, bluMdmgAdditionsExport, bluMdmgAdditionsText] = await Promise.all([
    importDefault(resolve(outDir, "foods.js")),
    readFile(resolve(context.upstreamRoot, "src", "game.ts"), "utf8"),
    importDefault(resolve(outDir, "bluMdmgAdditions.js")),
    readFile(resolve(context.upstreamRoot, "data", "in", "bluMdmgAdditions.txt"), "utf8"),
  ]);
  const bluMdmgAdditions = validateBluMdmgAdditions(bluMdmgAdditionsExport, bluMdmgAdditionsText);
  const [levelCaps, slotCaps, roleCaps] = await Promise.all([
    importDefault(resolve(outDir, "levelCaps.js")),
    importDefault(resolve(outDir, "slotCaps.js")),
    importDefault(resolve(outDir, "roleCaps.js")),
  ]);
  const constants = parseGameConstants(gameSource);
  const normalizedJobSchemas = normalizeJobSchemas(constants.jobSchemas, mcpSnapshot, context);
  const gearGroups = await Promise.all(
    gearFiles.map(async (file) => ({ file, items: await importDefault(resolve(outDir, file)) })),
  );
  const excludedReferenceGearIds = new Set(
    gearGroups.flatMap(({ items }) => items.filter(excludeReferenceGearSource).map(({ id }) => id)),
  );
  const gears = gearGroups.flatMap(({ file, items }) =>
    items.map((item) => normalizeGear(item, `data/out/${file}`, context)).filter(Boolean),
  );
  const referenceSourceFiles = [
    ...gearFiles.map((file) => `data/out/${file}`),
    "data/out/foods.js",
    "data/out/levelCaps.js",
    "data/out/slotCaps.js",
    "data/out/roleCaps.js",
    "src/game.ts",
    "data/out/bluMdmgAdditions.js",
    "data/in/bluMdmgAdditions.txt",
    "data/convert.ts",
  ];
  const referenceSource = {
    kind: "reference",
    repository: context.repository,
    commit: context.commit,
    importedAt: context.importedAt,
    sourceFiles: referenceSourceFiles,
    note: "参考装备 obsolete=true 的来源统一映射为已废弃；否则以→诗学或/诗学结尾映射为点数/诗学，以→战利品、→兵团、→同盟结尾分别映射为怪物狩猎战利品、兵团徽章、同盟徽章。以→雇员探险结尾映射为雇员探险；完整来源点数/哲学→无限城古迹、日影地修炼所、野营地映射为迷宫挑战/无限城古迹、日影地修炼所、野营地。其余保留原始来源。生成目录排除原始来源包含古董系列或军票的装备，此判断先于来源映射。",
  };
  let foods = rawFoods.filter((food) => food.slot === -1).map((food) => normalizeFood(food, context));
  let effectiveLevelCaps = levelCaps;
  let effectiveSlotCaps = slotCaps;
  let effectiveSyncData;
  let materias = Object.fromEntries(
    combatMateriaStats.map((stat) => [stat, constants.materias[stat]]),
  );
  const sourceRecords = [referenceSource];

  const binUiMetadata = binUiMetadataFromSnapshot(mcpSnapshot, supportedJobs);
  let mcpSummary = "";
    const gearMerge = mergeMcpGearData(gears, mcpSnapshot, normalizedJobSchemas);
    gears.splice(0, gears.length, ...gearMerge.result);
    const foodMerge = mergeMcpFoodData(foods, mcpSnapshot);
    foods = foodMerge.result;
    const levelMerge = mergeMcpLevelCaps(levelCaps, mcpSnapshot);
    effectiveLevelCaps = levelMerge.value;
    const slotMerge = mergeMcpSlotCaps(slotCaps, mcpSnapshot);
    effectiveSlotCaps = slotMerge.value;
    const materiaMerge = mergeMcpMaterias(materias, mcpSnapshot);
    materias = materiaMerge.value;
    const supportedSyncLevels = Object.keys(constants.jobLevelModifiers)
      .map(Number)
      .filter((level) => Number.isSafeInteger(level) && level >= 50)
      .sort((left, right) => left - right);
    effectiveSyncData = syncDataFromSnapshot(mcpSnapshot, effectiveLevelCaps, supportedSyncLevels);
    const classJobRowIds = Object.values(mcpSnapshot.queryPlan.classJobIds).map(Number);
    const syncLevelQuery = mcpSnapshot.queries.find((query) =>
      query.method === "list_rows" && query.sheet === "ContentFinderCondition",
    );
    const contentTypeQuery = mcpSnapshot.queries.find((query) =>
      query.method === "list_rows" && query.sheet === "ContentType",
    );
    const contentUICategoryQuery = mcpSnapshot.queries.find((query) =>
      query.method === "list_rows" && query.sheet === "ContentUICategory",
    );
    const paramGrowQuery = mcpSnapshot.queries.find((query) =>
      query.method === "list_rows" && query.sheet === "ParamGrow" && query.limit === -1,
    );
    const bluDamageReferenceSource = {
      kind: "reference",
      repository: context.repository,
      commit: context.commit,
      importedAt: context.importedAt,
      sourceFiles: [
        "data/out/bluMdmgAdditions.js",
        "data/in/bluMdmgAdditions.txt",
        "data/convert.ts",
      ],
      note: `MCP ${mcpSnapshot.gameVersion} 的 list_sheets 与 ClassJob describe_sheet 均未提供青魔法师按 INT 索引的魔法武器伤害加值表或字段；使用参考项目原始测量映射，并与输入文本逐值校验。`,
    };
    if (!syncLevelQuery || !contentTypeQuery || !contentUICategoryQuery || !paramGrowQuery)
      throw new Error("MCP 同步等级目录缺少完整查询来源");
    const variableItemLevelReferenceSource = {
      kind: "reference",
      repository: context.repository,
      commit: context.commit,
      importedAt: context.importedAt,
      sourceFiles: ["data/convert.ts"],
      note: "参考项目 data/convert.ts:140 将 Item.SubStatCategory 为 2 的装备映射为 equipLevelVariable；当前装备标志原值由同版本 MCP Item.SubStatCategory 查询提供。",
    };
    sourceRecords.push(
      snapshotSource(mcpSnapshot, "Item", itemCoreReturnFields, gearMerge.usedIds),
      ...itemFieldQuerySources(mcpSnapshot, "Icon", [
        ...mcpSnapshot.queryPlan.gearItemIds,
        ...mcpSnapshot.queryPlan.foodItemIds,
      ]),
      ...itemFieldQuerySources(mcpSnapshot, "SubStatCategory", gearMerge.usedIds),
      ...itemFieldQuerySources(mcpSnapshot, "ItemSpecialBonus", gearMerge.usedIds),
      ...itemFieldQuerySources(mcpSnapshot, "ItemSpecialBonusParam", gearMerge.usedIds),
      itemSpecialBonusTableSource(mcpSnapshot),
      snapshotSource(mcpSnapshot, "ItemAction", itemActionReturnFields, foodMerge.usedActionIds),
      snapshotSource(mcpSnapshot, "ItemFood", itemFoodReturnFields, undefined, mcpSnapshot.missing?.ItemFood?.length
        ? `MCP 缺少 ItemFood 行：${mcpSnapshot.missing.ItemFood.join(",")}`
        : undefined),
      snapshotSource(mcpSnapshot, "ItemLevel", itemLevelReturnFields, levelMerge.usedIds),
      snapshotSource(mcpSnapshot, "BaseParam", undefined, slotMerge.usedIds),
      snapshotSource(mcpSnapshot, "Materia", materiaReturnFields, Object.keys(snapshotRows(mcpSnapshot, "Materia")).map(Number)),
      snapshotSource(mcpSnapshot, "ClassJob", classJobReturnFields, classJobRowIds),
      resistanceWeaponAdjustSource(
        mcpSnapshot,
        mcpSnapshot.queries.find((query) =>
          query.method === "list_rows" && query.sheet === "ResistanceWeaponAdjust",
        ).rowIds,
      ),
      mcpSource({
        sheet: "ContentFinderCondition",
        fields: contentFinderConditionReturnFields,
        rowIds: syncLevelQuery.rowIds,
        gameVersion: mcpSnapshot.gameVersion,
        validatedVersion: mcpSnapshot.validatedVersion,
        queriedAt: syncLevelQuery.queriedAt,
        note: "同版本完整 CFC 查询用于生成同步等级下界与副本目录；仅保存生成完成后的等级和分组目录。",
      }),
      mcpSource({
        sheet: "ContentType",
        fields: contentTypeReturnFields,
        rowIds: contentTypeQuery.rowIds,
        gameVersion: mcpSnapshot.gameVersion,
        validatedVersion: mcpSnapshot.validatedVersion,
        queriedAt: contentTypeQuery.queriedAt,
        note: "ContentType.Name 用于识别并生成副本目录名称。",
      }),
      mcpSource({
        sheet: "ContentUICategory",
        fields: contentUICategoryReturnFields,
        rowIds: contentUICategoryQuery.rowIds,
        gameVersion: mcpSnapshot.gameVersion,
        validatedVersion: mcpSnapshot.validatedVersion,
        queriedAt: contentUICategoryQuery.queriedAt,
        note: "ContentUICategory.Name 用于识别副本高难/零式目录类别。",
      }),
      mcpSource({
        sheet: "ParamGrow",
        fields: paramGrowReturnFields,
        rowIds: paramGrowQuery.rowIds,
        gameVersion: mcpSnapshot.gameVersion,
        validatedVersion: mcpSnapshot.validatedVersion,
        queriedAt: paramGrowQuery.queriedAt,
        note: "ParamGrow.ItemLevelSync 提供仅同步等级默认品级及各等级区间边界依据。",
      }),
      variableItemLevelReferenceSource,
      bluDamageReferenceSource,
    );
    const fallbackCount = gearMerge.missing.length + foodMerge.missing.length;
    const removedNameCount = gearMerge.removed.length + foodMerge.removed.length;
    mcpSummary = `MCP 优先：覆盖 ${gearMerge.usedIds.length}/${gears.length} 件装备（含 ${gearMerge.result.filter((gear) => gear.resistanceWeaponAdjust).length} 件 ResistanceWeaponAdjust 武器）、${foodMerge.usedIds.length}/${foods.length} 种食物，${fallbackCount} 项回退参考项目；剔除 ${removedNameCount} 项空名称物品`;

  const levelFilteredGears = gears.filter(includeGearInCatalog);
  const catalogGears = levelFilteredGears.filter(({ id }) => !excludedReferenceGearIds.has(id));
  for (const gear of catalogGears) gear.icon = binUiMetadata.itemIcons[gear.id];
  for (const food of foods) food.icon = binUiMetadata.itemIcons[food.id];
  const excludedGearCounts = { belowLevelAndItemLevel: gears.length - levelFilteredGears.length, referenceSources: levelFilteredGears.length - catalogGears.length };
  const payload = {
    version: mcpSnapshot?.gameVersion ?? (() => { throw new Error("缺少生成游戏数据的游戏版本号"); })(),
    provenance: {
      repository: context.repository,
      commit: context.commit,
      importedAt: context.importedAt,
      sourceFiles: referenceSourceFiles,
      sources: sourceRecords,
    },
    gears: catalogGears,
    foods,
    jobs: binUiMetadata.jobs,
    sync: effectiveSyncData,
    materias,
    bluMdmgAdditions,
    materiaGradeRequiredLevels: constants.materiaGradeRequiredLevels,
    materiaGradeIsRestricted: constants.materiaGradeIsRestricted,
    levelCaps: effectiveLevelCaps,
    slotCaps: effectiveSlotCaps,
    roleCaps,
    baseStats: constants.baseStats,
    clanStats: constants.clanStats,
    jobSchemas: normalizedJobSchemas,
    jobLevelModifiers: constants.jobLevelModifiers,
  };
  return { payload, mcpSummary, excludedGearCounts };
}
