import {
  normalizeMcpCustomParameters,
  normalizeMcpFoodRows,
  normalizeMcpGearRow,
  normalizeMcpItemLevel,
  normalizeMcpItemName,
  normalizeMcpMateriaRows,
} from "../mcp-lumina-import.mjs";
import {
  foodItemSourceFields,
  itemActionReturnFields,
  itemFoodReturnFields,
  itemLevelReturnFields,
  mandervilleReturnFields,
  materiaReturnFields,
} from "../mcp-lumina/query-presets.mjs";
import {
  itemCoreReturnFields,
  itemFieldSource,
  itemSpecialBonusTableSource,
  normalizeMcpResistanceWeaponAdjust,
  resistanceBaseParamSource,
  resistanceWeaponAdjustSource,
  snapshotRows,
  snapshotSource,
  supportedJobs,
} from "./mcp-snapshot.mjs";

export const combatMateriaStats = ["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"];

function resolveMandervilleIds(mandervilleRows, referenceMandervilleAliases) {
  // 自定义武器主键 = MandervilleWeaponEnhance 表内全部有效行（游戏当前版本唯一信源）。
  const mcpIds = Object.keys(mandervilleRows).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (mcpIds.length === 0)
    throw new Error("MandervilleWeaponEnhance 行集合为空，无法确认自定义武器主键");
  const mcpSet = new Set(mcpIds);
  const refSet = new Set(referenceMandervilleAliases);
  // 跨版本漂移允许：参考导出与 MCP 集合若完全无交集则报警。
  let overlap = 0;
  for (const id of mcpSet) if (refSet.has(id)) overlap++;
  if (overlap === 0)
    throw new Error(
      `MandervilleWeaponEnhance 行集合 ${mcpIds.join(",")} 与参考项目 customizable 集合 ${referenceMandervilleAliases.join(",")} 无任何交集，请检查 MCP 快照或参考版本`,
    );
  return { mandervilleIds: mcpIds };
}
export function mergeMcpGearData(gears, snapshot, jobSchemas) {
  if (!jobSchemas || typeof jobSchemas !== "object" || Array.isArray(jobSchemas))
    throw new Error("MCP 装备合并缺少职业主属性 schema");
  const itemRows = snapshotRows(snapshot, "Item");
  const categoryRows = snapshotRows(snapshot, "ClassJobCategory");
  const mandervilleRows = snapshotRows(snapshot, "MandervilleWeaponEnhance");
  const resistanceRows = snapshotRows(snapshot, "ResistanceWeaponAdjust");
  const materiaRows = snapshotRows(snapshot, "Materia");
  const specialBonusTableSource = itemSpecialBonusTableSource(snapshot);
  const referenceMandervilleAliases = gears
    .filter((gear) => gear.customizable)
    .map((gear) => gear.id);
  const { mandervilleIds } = resolveMandervilleIds(mandervilleRows, referenceMandervilleAliases);
  const usedIds = [];
  const missing = [];
  const removed = [];
  const result = gears
    .map((gear) => {
    const itemRow = itemRows[gear.id];
    if (itemRow && normalizeMcpItemName(itemRow) === undefined) {
      removed.push(gear.id);
      return undefined;
    }
    const categoryRow = itemRow && categoryRows[Number(itemRow.fields?.ClassJobCategory)];
    const merged = normalizeMcpGearRow(itemRow, gear, categoryRow, { jobSchemas });
    if (!merged) {
      missing.push(gear.id);
      // 即使参考项目有分类结果，也不能回退其职业适用性；等待 MCP 分类后再统一过滤。
      return { ...gear, jobs: [] };
    }
    if (typeof merged.unique !== "boolean")
      throw new Error(`MCP Item 行 ${gear.id} 缺少 IsUnique，请重新生成完整快照`);
    usedIds.push(gear.id);
    const source = snapshotSource(snapshot, "Item", itemCoreReturnFields, [gear.id]);
    const variableLevelSource = itemFieldSource(snapshot, gear.id, "SubStatCategory");
    const categorySource = snapshotSource(
      snapshot,
      "ClassJobCategory",
      supportedJobs,
      [Number(itemRow.fields.ClassJobCategory)],
    );
    const customRow = mandervilleRows[gear.id];
    const resistanceRow = resistanceRows[gear.id];
    if (customRow && resistanceRow)
      throw new Error(`装备 ${gear.id} 同时命中 MandervilleWeaponEnhance 与 ResistanceWeaponAdjust，不能在未确认语义时合并参数表`);
    const customParameters = customRow
      ? normalizeMcpCustomParameters(customRow, materiaRows)
      : undefined;
    if (customRow && !customParameters)
      throw new Error(`MandervilleWeaponEnhance 行 ${gear.id} 的自定义参数字段不完整`);
    const resistanceWeaponAdjust = resistanceRow
      ? normalizeMcpResistanceWeaponAdjust(resistanceRow)
      : undefined;
    if (resistanceWeaponAdjust && merged.slot !== "weapon" && merged.slot !== "offhand")
      throw new Error(`ResistanceWeaponAdjust 行 ${gear.id} 对应 Item 不是武器或盾牌槽装备`);
    return {
      ...merged,
      ...(customRow ? { customizable: true, customParameters } : {}),
      ...(resistanceWeaponAdjust ? { resistanceWeaponAdjust } : {}),
      dataSources: [
        source,
        variableLevelSource,
        itemFieldSource(snapshot, gear.id, "ItemSpecialBonus"),
        itemFieldSource(snapshot, gear.id, "ItemSpecialBonusParam"),
        categorySource,
        ...(merged.itemSpecialBonus !== undefined ? [specialBonusTableSource] : []),
        ...(customRow ? [
        snapshotSource(snapshot, "MandervilleWeaponEnhance", mandervilleReturnFields, [gear.id]),
        snapshotSource(snapshot, "Materia", materiaReturnFields, customParameters.map((parameter) => parameter.materiaId)),
        ] : []), ...(resistanceWeaponAdjust ? [
        resistanceWeaponAdjustSource(snapshot, [gear.id]),
        resistanceBaseParamSource(
          snapshot,
          [...new Set(Array.from({ length: 4 }, (_, index) => resistanceRow.fields[`BaseParam[${index}]`]))]
            .filter((id) => id > 0),
        ),
        ] : []), ...(gear.dataSources ?? []).filter((item) => item.kind === "reference"),
      ],
    };
  })
    .filter(Boolean);
  // MCP 当前版本的自定义参数武器主键（51000-51021 等）并不在参考项目导出中，需要主动合并。
  const existingIds = new Set(gears.map((gear) => gear.id));
  const categoryFieldList = supportedJobs;
  for (const mcpId of mandervilleIds) {
    if (existingIds.has(mcpId)) continue;
    const itemRow = itemRows[mcpId];
    if (!itemRow) throw new Error(`MandervilleWeaponEnhance 行 ${mcpId} 缺少对应 MCP Item 行`);
    if (normalizeMcpItemName(itemRow) === undefined) {
      removed.push(mcpId);
      continue;
    }
    const categoryRow = categoryRows[Number(itemRow.fields?.ClassJobCategory)];
    const merged = normalizeMcpGearRow(itemRow, undefined, categoryRow, { jobSchemas, isWeapon: true });
    if (!merged) continue;
    const customRow = mandervilleRows[mcpId];
    const customParameters = customRow ? normalizeMcpCustomParameters(customRow, materiaRows) : undefined;
    if (!customParameters)
      throw new Error(`MandervilleWeaponEnhance 行 ${mcpId} 的自定义参数字段不完整`);
    usedIds.push(mcpId);
    const source = snapshotSource(snapshot, "Item", itemCoreReturnFields, [mcpId]);
    const variableLevelSource = itemFieldSource(snapshot, mcpId, "SubStatCategory");
    const categorySource = snapshotSource(snapshot, "ClassJobCategory", categoryFieldList, [Number(itemRow.fields.ClassJobCategory)]);
    result.push({
      ...merged,
      customizable: true,
      customParameters,
      dataSources: [
        source,
        variableLevelSource,
        itemFieldSource(snapshot, mcpId, "ItemSpecialBonus"),
        itemFieldSource(snapshot, mcpId, "ItemSpecialBonusParam"),
        categorySource,
        ...(merged.itemSpecialBonus !== undefined ? [specialBonusTableSource] : []),
        snapshotSource(snapshot, "MandervilleWeaponEnhance", mandervilleReturnFields, [mcpId]),
        snapshotSource(snapshot, "Materia", materiaReturnFields, customParameters.map((parameter) => parameter.materiaId)),
      ],
    });
  }
  const adjustmentIds = Object.keys(resistanceRows).map(Number)
    .filter((id) => id > 0).sort((left, right) => left - right);
  const mergedIds = new Set(result.filter((gear) => gear.jobs.length > 0).map((gear) => gear.id));
  const removedIds = new Set(removed);
  const missingAdjustmentGearIds = adjustmentIds.filter((id) => !mergedIds.has(id) && !removedIds.has(id));
  if (missingAdjustmentGearIds.length)
    throw new Error(`ResistanceWeaponAdjust 行未能合并到有效装备：${missingAdjustmentGearIds.join(",")}`);
  return { result: result.filter((gear) => gear.jobs.length > 0), usedIds, missing, removed };
}

export function mergeMcpFoodData(foods, snapshot) {
  const itemRows = snapshotRows(snapshot, "Item");
  const actionRows = snapshotRows(snapshot, "ItemAction");
  const foodRows = snapshotRows(snapshot, "ItemFood");
  const usedIds = [];
  const usedActionIds = [];
  const missing = [];
  const removed = [];
  const result = foods.map((food) => {
    const itemRow = itemRows[food.id];
    if (itemRow && normalizeMcpItemName(itemRow) === undefined) {
      removed.push(food.id);
      return undefined;
    }
    const actionId = Number(itemRow?.fields?.ItemAction ?? 0);
    const merged = normalizeMcpFoodRows(itemRow, actionRows[actionId], foodRows, food);
    if (!merged) {
      missing.push(food.id);
      return food;
    }
    usedIds.push(food.id);
    usedActionIds.push(actionId);
    const actionRow = actionRows[actionId];
    const foodIds = [];
    for (let index = 0; index < 9; index++) {
      const id = Number(actionRow?.fields?.[`Data[${index}]`] ?? 0);
      if (id) foodIds.push(id);
    }
    const missingFoodIds = foodIds.filter((id) => !foodRows[id]);
    return {
      ...merged,
      dataSources: [
        snapshotSource(snapshot, "Item", foodItemSourceFields, [food.id]),
        snapshotSource(snapshot, "ItemAction", itemActionReturnFields, [actionId]),
        snapshotSource(
          snapshot,
          "ItemFood",
          itemFoodReturnFields,
          foodIds,
          missingFoodIds.length
            ? `MCP 缺少 ItemFood 行：${missingFoodIds.join(",")}；其余效果字段由 MCP 提供`
            : undefined,
        ),
        ...(food.dataSources ?? []).filter((item) => item.kind === "reference"),
      ],
    };
  });
  return { result: result.filter(Boolean), usedIds, usedActionIds, missing, removed };
}

export function mergeMcpLevelCaps(levelCaps, snapshot) {
  const check = snapshot.sourceCapabilityChecks?.syncLevels?.itemLevel;
  const query = snapshot.queries?.find((entry) =>
    entry.method === "list_rows" && entry.sheet === "ItemLevel" && entry.limit === -1 &&
    itemLevelReturnFields.every((field) => entry.fields?.includes(field)),
  );
  const sourceRows = snapshot.rows?.ItemLevel;
  const rowValues = Array.isArray(sourceRows)
    ? sourceRows
    : sourceRows && typeof sourceRows === "object"
      ? Object.values(sourceRows)
      : undefined;
  const sourceFields = check?.fields;
  if (check?.gameVersion !== snapshot.gameVersion || !check.queriedAt ||
      !Number.isSafeInteger(check.rowCount) || check.rowCount < 1 ||
      !Array.isArray(sourceFields) || itemLevelReturnFields.some((field) => !sourceFields.includes(field)) ||
      !Array.isArray(rowValues) || rowValues.length !== check.rowCount ||
      !query || query.gameVersion !== snapshot.gameVersion || !query.queriedAt ||
      query.returnedRows !== check.rowCount || !Array.isArray(query.rowIds) ||
      query.rowIds.length !== check.rowCount ||
      !Array.isArray(snapshot.missing?.ItemLevel) || snapshot.missing.ItemLevel.length)
    throw new Error("MCP ItemLevel 全量查询缺失、截断或来源不完整");

  const expectedStats = Object.keys(levelCaps).filter((key) => key !== "level");
  const rows = rowValues.slice().sort((left, right) => left.rowId - right.rowId);
  const queryIds = new Set(query.rowIds);
  const seenIds = new Set();
  const value = { level: [] };
  for (const stat of expectedStats) value[stat] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.rowId) || row.rowId < 0 || seenIds.has(row.rowId) ||
        !queryIds.has(row.rowId) || row.gameVersion !== snapshot.gameVersion || !row.timestamp ||
        !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
      throw new Error("MCP ItemLevel 全量行目录包含无效、重复、缺失或跨版本行");
    const stats = normalizeMcpItemLevel(row);
    if (!stats || expectedStats.some((stat) =>
      !Number.isSafeInteger(stats[stat]) || stats[stat] < 0,
    ))
      throw new Error(`MCP ItemLevel 行 ${row.rowId} 缺少完整属性上限`);
    seenIds.add(row.rowId);
    if (row.rowId === 0) continue;
    value.level.push(row.rowId);
    for (const stat of expectedStats) value[stat].push(stats[stat]);
  }
  if (seenIds.size !== check.rowCount || query.rowIds.some((rowId) => !seenIds.has(rowId)))
    throw new Error("MCP ItemLevel 行目录与全量查询范围不一致");
  return { value, usedIds: value.level };
}

export function mergeMcpSlotCaps(slotCaps, snapshot) {
  const rows = snapshotRows(snapshot, "BaseParam");
  const baseParamByStat = { STR: 1, DEX: 2, VIT: 3, INT: 4, MND: 5, PIE: 6, TEN: 19, DHT: 22, CRT: 27, DET: 44, SKS: 45, SPS: 46 };
  const fieldsBySlot = [
    undefined, "OneHandWeaponPercent", "OffHandPercent", "HeadPercent", "ChestPercent", "HandsPercent",
    "WaistPercent", "LegsPercent", "FeetPercent", "EarringPercent", "NecklacePercent", "BraceletPercent",
    "RingPercent", "TwoHandWeaponPercent", "UnderArmorPercent", "ChestHeadPercent", "ChestHeadLegsFeetPercent",
    "Unknown0", "LegsFeetPercent", "HeadChestHandsLegsFeetPercent", "ChestLegsGlovesPercent", "ChestLegsFeetPercent",
    "Unknown1", "Unknown3",
  ];
  const merged = Object.fromEntries(Object.entries(slotCaps).map(([stat, values]) => [stat, values.slice()]));
  const usedIds = [];
  const supportedSlots = new Set([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13]);
  for (const [stat, rowId] of Object.entries(baseParamByStat)) {
    const row = rows[rowId];
    if (!row?.fields) continue;
    let changed = false;
    // The project uses raw slot IDs 1..18. Newer Lumina fields after LegsFeetPercent
    // describe additional slots that this upstream data model does not represent.
    for (const slot of supportedSlots) {
      const value = row.fields[fieldsBySlot[slot]];
      if (typeof value === "number") {
        merged[stat] ??= [];
        merged[stat][slot] = value;
        changed = true;
      }
    }
    if (changed) usedIds.push(rowId);
  }
  return { value: merged, usedIds };
}

export function mergeMcpMaterias(materias, snapshot) {
  const rows = snapshotRows(snapshot, "Materia");
  const merged = normalizeMcpMateriaRows(Object.values(rows));
  const value = { ...materias };
  for (const stat of combatMateriaStats) {
    if (merged[stat]?.length === 12 && merged[stat].some((entry) => entry > 0)) {
      value[stat] = merged[stat];
    }
  }
  return { value };
}
