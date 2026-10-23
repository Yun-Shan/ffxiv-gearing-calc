/**
 * Pure normalizers for query artifacts produced by the environment-provided
 * ffxiv-mcp-lumina server. The updater never guesses a field: a value is
 * accepted only when the corresponding sheet row and field are present.
 */

export const MCP_SERVER = "ffxiv-mcp-lumina";

export const supportedJobIds = [
  "PLD", "WAR", "DRK", "GNB", "WHM", "SCH", "AST", "SGE", "MNK", "DRG", "NIN",
  "SAM", "RPR", "VPR", "BRD", "MCH", "DNC", "BLM", "SMN", "RDM", "PCT", "BLU", "BST",
];

export {
  itemReturnFields,
  itemLevelReturnFields,
  itemActionReturnFields,
  itemFoodReturnFields,
  mandervilleReturnFields,
  classJobReturnFields,
} from "./mcp-lumina/query-presets.mjs";

const statByBaseParam = new Map([
  [1, "STR"],
  [2, "DEX"],
  [3, "VIT"],
  [4, "INT"],
  [5, "MND"],
  [6, "PIE"],
  [12, "PDMG"],
  [13, "MDMG"],
  [14, "DLY"],
  [19, "TEN"],
  [22, "DHT"],
  [27, "CRT"],
  [44, "DET"],
  [45, "SKS"],
  [46, "SPS"],
  [55, "main"],
  [56, "secondary"],
]);

export const supportedItemSpecialBonusIds = [11];

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fieldsOf(row) {
  return row?.fields && typeof row.fields === "object" ? row.fields : undefined;
}

export function rowMap(rows = []) {
  const map = {};
  for (const row of rows) {
    const id = Number(row?.rowId);
    if (Number.isInteger(id) && fieldsOf(row)) map[id] = row;
  }
  return map;
}

export function normalizeMcpClassJobRow(row) {
  const values = fieldsOf(row) ?? {};
  const name = typeof values.Name === "string" ? values.Name : undefined;
  const abbreviation = typeof values.Abbreviation === "string" && values.Abbreviation
    ? values.Abbreviation
    : "未知缩写";
  const rowLabel = Number.isSafeInteger(row?.rowId) ? row.rowId : "未知";

  const supportedJobTypes = new Set([1, 2, 3, 4, 5, 6]);
  const jobType = values.JobType;
  if (!Number.isSafeInteger(jobType) || !supportedJobTypes.has(jobType))
    throw new Error(`MCP ClassJob ${abbreviation} 行 ${rowLabel} 的 JobType 原值 ${String(jobType)} 无效，需要定义新的 Type 类型`);

  const mainStatByPrimaryStat = new Map([
    [1, "STR"],
    [2, "DEX"],
    [4, "INT"],
    [5, "MND"],
  ]);
  const mainStat = Number.isSafeInteger(values.PrimaryStat)
    ? mainStatByPrimaryStat.get(values.PrimaryStat)
    : undefined;
  if (!mainStat) {
    throw new Error(`MCP ClassJob ${abbreviation} 行 ${rowLabel} 的 PrimaryStat 原值 ${String(values.PrimaryStat)} 必须是受支持的 uint（1=STR、2=DEX、4=INT、5=MND）`);
  }

  const mainStatsByJobType = new Map([
    [1, ["STR"]],
    [2, ["MND"]],
    [3, ["STR", "DEX"]],
    [4, ["DEX"]],
    [5, ["INT"]],
    [6, ["MND"]],
  ]);
  const allowedMainStats = mainStatsByJobType.get(jobType);
  if (!allowedMainStats.includes(mainStat))
    throw new Error(`MCP ClassJob ${abbreviation} 行 ${rowLabel} 的 JobType 原值 ${jobType} 与 PrimaryStat 原值 ${String(values.PrimaryStat)}（${mainStat}）不兼容`);
  const role = jobType === 1
    ? "tank"
    : jobType === 2 || jobType === 6
      ? "healer"
      : jobType === 3
        ? mainStat === "STR" ? "str" : "dex"
        : jobType === 4
          ? "dex"
          : "int";

  if (!name || abbreviation === "未知缩写") return undefined;

  const modifierFields = {
    hp: "ModifierHitPoints",
    STR: "ModifierStrength",
    VIT: "ModifierVitality",
    DEX: "ModifierDexterity",
    INT: "ModifierIntelligence",
    MND: "ModifierMind",
    PIE: "ModifierPiety",
  };
  const statModifiers = {};
  for (const [stat, fieldName] of Object.entries(modifierFields)) {
    const value = values[fieldName];
    if (!Number.isSafeInteger(value) || value <= 0) return undefined;
    statModifiers[stat] = value;
  }
  if (typeof values.IsLimitedJob !== "boolean" || typeof values.CanWearShield !== "boolean")
    return undefined;

  return {
    name,
    abbreviation,
    mainStat,
    role,
    statModifiers,
    isLimitedJob: values.IsLimitedJob,
    canWearShield: values.CanWearShield,
  };
}

function field(row, name) {
  return fieldsOf(row)?.[name];
}

export function normalizeMcpItemName(row) {
  const itemFields = fieldsOf(row);
  const name = itemFields?.Name;
  if (typeof name !== "string") {
    const rowId = Number.isSafeInteger(row?.rowId) ? ` ${row.rowId}` : "";
    throw new Error(`MCP Item 行${rowId} 缺少有效 Name 字段`);
  }
  return name.trim() ? name : undefined;
}

function requiredNonNegativeInteger(row, name) {
  const value = field(row, name);
  if (!Number.isSafeInteger(value) || value < 0) {
    const rowId = Number.isSafeInteger(row?.rowId) ? ` ${row.rowId}` : "";
    throw new Error(`MCP Item 行${rowId} 的 ${name} 必须是非负安全整数`);
  }
  return value;
}

function requiredUInt32(row, name) {
  const value = requiredNonNegativeInteger(row, name);
  if (value > 0xffffffff) {
    const rowId = Number.isSafeInteger(row?.rowId) ? ` ${row.rowId}` : "";
    throw new Error(`MCP Item 行${rowId} 的 ${name} 超出 uint32 范围`);
  }
  return value;
}

function hasDamageParameters(row, special = false) {
  const suffix = special ? "Special" : "";
  for (let index = 0; index < 6; index++) {
    const stat = statByBaseParam.get(field(row, `BaseParam${suffix}[${index}]`));
    if ((stat === "PDMG" || stat === "MDMG") &&
        numberOrUndefined(field(row, `BaseParamValue${suffix}[${index}]`)) > 0)
      return true;
  }
  return false;
}

function damageStatForJobs(row, jobs, jobSchemas, required) {
  if (!jobSchemas || typeof jobSchemas !== "object" || Array.isArray(jobSchemas))
    throw new Error("MCP 装备归一化缺少职业主属性 schema");
  const damageStats = new Set();
  for (const job of jobs) {
    const mainStat = jobSchemas[job]?.mainStat;
    if (mainStat === "INT" || mainStat === "MND") damageStats.add("MDMG");
    else if (mainStat === "STR" || mainStat === "DEX") damageStats.add("PDMG");
    else
      throw new Error(`MCP Item 行 ${row.rowId} 的适用职业 ${job} 缺少有效主属性，无法确定武器伤害类型`);
  }
  if (!required) return undefined;
  if (damageStats.size !== 1)
    throw new Error(`MCP Item 行 ${row.rowId} 的适用职业 ${jobs.join(", ")} 跨物理和魔法伤害，必须为该物品硬编码伤害类型映射`);
  return [...damageStats][0];
}

function readSpecialStats(row, { damageStat, requireComplete = false } = {}) {
  const stats = {};
  for (let index = 0; index < 6; index++) {
    const baseParamField = `BaseParamSpecial[${index}]`;
    const valueField = `BaseParamValueSpecial[${index}]`;
    const baseParam = numberOrUndefined(field(row, baseParamField));
    const value = numberOrUndefined(field(row, valueField));
    if (requireComplete && (!Number.isSafeInteger(baseParam) || baseParam < 0 ||
        !Number.isSafeInteger(value) || value < 0 || value > 32767)) {
      const rowId = Number.isSafeInteger(row?.rowId) ? ` ${row.rowId}` : "";
      throw new Error(`MCP Item 行${rowId} 的 ${baseParamField}/${valueField} 超出支持范围`);
    }
    const stat = statByBaseParam.get(baseParam);
    if (requireComplete && baseParam !== 0 && !stat) {
      const rowId = Number.isSafeInteger(row?.rowId) ? ` ${row.rowId}` : "";
      throw new Error(`MCP Item 行${rowId} 的 ${baseParamField} 不支持 BaseParam ${baseParam}`);
    }
    const isWeaponDamage = stat === "PDMG" || stat === "MDMG";
    if (stat && value !== undefined && value > 0 &&
        (!isWeaponDamage || stat === damageStat))
      stats[stat] = (stats[stat] ?? 0) + value;
  }
  return stats;
}

function readStats(row, { hq = false, damageStat, isWeapon = false } = {}) {
  const stats = {};
  for (let index = 0; index < 6; index++) {
    const baseParam = numberOrUndefined(field(row, `BaseParam[${index}]`));
    const value = numberOrUndefined(field(row, `BaseParamValue[${index}]`));
    const stat = statByBaseParam.get(baseParam);
    const isWeaponDamage = stat === "PDMG" || stat === "MDMG";
    if (stat && value !== undefined && value > 0 &&
        (!isWeaponDamage || stat === damageStat)) stats[stat] = value;
  }
  if (isWeapon) {
    const physical = requiredNonNegativeInteger(row, "DamagePhys");
    const magical = requiredNonNegativeInteger(row, "DamageMag");
    if (damageStat === "PDMG") stats.PDMG = physical;
    if (damageStat === "MDMG") stats.MDMG = magical;
  }
  const delay = isWeapon
    ? requiredNonNegativeInteger(row, "Delayms")
    : numberOrUndefined(field(row, "Delayms"));
  if (delay !== undefined && delay > 0) stats.DLY = delay;
  if (hq) {
    for (const [stat, value] of Object.entries(readSpecialStats(row, { damageStat })))
      stats[stat] = (stats[stat] ?? 0) + value;
  }
  return stats;
}

export function normalizeMcpGearRow(row, fallback, categoryRow, { jobSchemas, isWeapon: isWeaponOption } = {}) {
  if (!row) return undefined;
  const itemFields = fieldsOf(row);
  if (!itemFields) {
    const rowId = Number.isSafeInteger(row.rowId) ? ` ${row.rowId}` : "";
    throw new Error(`MCP Item 行${rowId} 缺少 fields，无法读取 Name`);
  }
  const name = normalizeMcpItemName(row);
  if (name === undefined) return undefined;
  const categoryFields = fieldsOf(categoryRow);
  if (!Number.isSafeInteger(itemFields.SubStatCategory) || itemFields.SubStatCategory < 0)
    throw new Error(`MCP Item 行 ${row.rowId} 缺少有效 SubStatCategory`);
  const required = ["LevelItem", "LevelEquip", "ClassJobCategory", "EquipSlotCategory"];
  if (required.some((name) => itemFields[name] === undefined)) return undefined;
  const jobs = categoryFields
    ? supportedJobIds.filter((job) => categoryFields[job] === true)
    : [];
  if (!jobs.length) return undefined;
  const rawSlot = numberOrUndefined(itemFields.EquipSlotCategory);
  const level = numberOrUndefined(itemFields.LevelItem);
  const equipLevel = numberOrUndefined(itemFields.LevelEquip);
  const materiaSlots = numberOrUndefined(itemFields.MateriaSlotCount);
  if (rawSlot === undefined || level === undefined || equipLevel === undefined || materiaSlots === undefined)
    return undefined;
  const isWeapon = isWeaponOption ?? fallback?.slot === "weapon";
  const itemSpecialBonus = requiredUInt32(row, "ItemSpecialBonus");
  const itemSpecialBonusParam = requiredUInt32(row, "ItemSpecialBonusParam");
  const hq = itemFields.CanBeHq;
  if (typeof hq !== "boolean")
    throw new Error(`MCP Item 行 ${row.rowId} 的 CanBeHq 未查询或不是有效布尔值`);
  const hasSupportedSpecialBonus = supportedItemSpecialBonusIds.includes(itemSpecialBonus);
  const requiresDamageType = isWeapon || hasDamageParameters(row) ||
    ((hq || hasSupportedSpecialBonus) && hasDamageParameters(row, true));
  const damageStat = damageStatForJobs(row, jobs, jobSchemas, requiresDamageType);
  const stats = readStats(row, { hq: hq && !hasSupportedSpecialBonus, damageStat, isWeapon });
  const specialBonusData = hasSupportedSpecialBonus
    ? {
        itemSpecialBonus,
        itemSpecialBonusParam,
        specialStats: readSpecialStats(row, { damageStat, requireComplete: true }),
      }
    : {};
  const fallbackGear = fallback ? { ...fallback } : {};
  delete fallbackGear.equipLevelVariable;
  return {
    ...fallbackGear,
    name,
    rawSlot,
    level,
    equipLevel,
    jobCategory: numberOrUndefined(itemFields.ClassJobCategory) ?? fallback?.jobCategory,
    stats,
    ...specialBonusData,
    materiaSlots,
    ...(itemFields.SubStatCategory === 2 ? { equipLevelVariable: true } : {}),
    ...(typeof itemFields.IsUnique === "boolean" ? { unique: itemFields.IsUnique } : {}),
    ...(itemFields.IsAdvancedMeldingPermitted === true ? { materiaAdvanced: true } : {}),
    ...(itemFields.Rarity !== undefined ? { rarity: Number(itemFields.Rarity) } : {}),
    weaponDamage: stats.PDMG ?? stats.MDMG,
    jobs,
  };
}

export function normalizeMcpFoodRows(itemRow, actionRow, foodRows, fallback) {
  if (!itemRow) return undefined;
  const itemFields = fieldsOf(itemRow);
  if (!itemFields) {
    const rowId = Number.isSafeInteger(itemRow.rowId) ? ` ${itemRow.rowId}` : "";
    throw new Error(`MCP Item 行${rowId} 缺少 fields，无法读取 Name`);
  }
  const name = normalizeMcpItemName(itemRow);
  if (name === undefined) return undefined;
  const actionFields = fieldsOf(actionRow);
  if (!actionFields) return undefined;
  const stats = {};
  const statRates = {};
  for (let actionIndex = 0; actionIndex < 9; actionIndex++) {
    const foodId = numberOrUndefined(actionFields[`Data[${actionIndex}]`]);
    if (!foodId) continue;
    const foodRow = foodRows?.[foodId];
    const foodFields = fieldsOf(foodRow);
    if (!foodFields) continue;
    for (let index = 0; index < 3; index++) {
      const baseParam = numberOrUndefined(foodFields[`BaseParam[${index}]`]);
      const stat = statByBaseParam.get(baseParam);
      if (!stat) continue;
      const relative = foodFields[`IsRelative[${index}]`] === true;
      const fixedCandidates = [`MaxHQ[${index}]`, `Max[${index}]`, `ValueHQ[${index}]`, `Value[${index}]`];
      const value = fixedCandidates
        .map((fieldName) => numberOrUndefined(foodFields[fieldName]))
        .find((candidate) => candidate !== undefined && candidate > 0);
      if (value === undefined || value <= 0) continue;
      stats[stat] = Math.max(stats[stat] ?? 0, value);
      if (relative) {
        const rate = [`ValueHQ[${index}]`, `Value[${index}]`]
          .map((fieldName) => numberOrUndefined(foodFields[fieldName]))
          .find((candidate) => candidate !== undefined && candidate > 0);
        if (rate !== undefined) statRates[stat] = Math.max(statRates[stat] ?? 0, rate);
      }
    }
  }
  if (!Object.keys(stats).length && !Object.keys(statRates).length) return undefined;
  const level = numberOrUndefined(itemFields.LevelItem);
  if (level === undefined) return undefined;
  return {
    ...fallback,
    name,
    level,
    stats,
    statRates,
  };
}

export function normalizeMcpItemLevel(row) {
  const values = fieldsOf(row);
  if (!values) return undefined;
  const result = {};
  const mappings = {
    Strength: "STR",
    Dexterity: "DEX",
    Vitality: "VIT",
    Intelligence: "INT",
    Mind: "MND",
    Piety: "PIE",
    GP: "GP",
    CP: "CP",
    Craftsmanship: "CMS",
    Control: "CRL",
    Gathering: "GTH",
    Perception: "PCP",
    PhysicalDamage: "PDMG",
    MagicalDamage: "MDMG",
    Delay: "DLY",
    Tenacity: "TEN",
    DirectHitRate: "DHT",
    CriticalHit: "CRT",
    Determination: "DET",
    SkillSpeed: "SKS",
    SpellSpeed: "SPS",
  };
  for (const [fieldName, stat] of Object.entries(mappings)) {
    const value = numberOrUndefined(values[fieldName]);
    if (value !== undefined) result[stat] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

export function normalizeMcpMateriaRows(rows = []) {
  const values = {};
  for (const row of rows) {
    const baseParam = numberOrUndefined(field(row, "BaseParam"));
    const stat = statByBaseParam.get(baseParam);
    if (!stat || !["CRT", "DET", "DHT", "SKS", "SPS", "TEN", "PIE"].includes(stat)) continue;
    const current = Array.from({ length: 12 }, (_, i) => numberOrUndefined(field(row, `Value[${i}]`)) ?? 0);
    const nonZeroCount = current.filter((value) => value > 0).length;
    const previous = values[stat];
    if (!previous || nonZeroCount > previous.nonZeroCount ||
        (nonZeroCount === previous.nonZeroCount && Number(row?.rowId ?? Infinity) < previous.rowId))
      values[stat] = { rowId: Number(row?.rowId ?? Infinity), nonZeroCount, values: current };
  }
  return Object.fromEntries(Object.entries(values).map(([stat, entry]) => [stat, entry.values]));
}

export function normalizeMcpCustomParameters(row, materiaRows) {
  if (!fieldsOf(row)) return undefined;
  const parameters = [];
  for (let index = 0; index < 4; index++) {
    const materiaId = numberOrUndefined(field(row, `Materia[${index}]`));
    const bigValueIndex = numberOrUndefined(field(row, `MateriaBigValueIndex[${index}]`));
    const smallValueIndex = numberOrUndefined(field(row, `MateriaSmallValueIndex[${index}]`));
    const materiaRow = materiaRows?.[materiaId];
    const baseParam = numberOrUndefined(field(materiaRow, "BaseParam"));
    const stat = statByBaseParam.get(baseParam);
    if (!materiaId || bigValueIndex === undefined || smallValueIndex === undefined || !stat)
      return undefined;
    const bigValue = numberOrUndefined(field(materiaRow, `Value[${bigValueIndex}]`));
    const smallValue = numberOrUndefined(field(materiaRow, `Value[${smallValueIndex}]`));
    if (bigValue === undefined || smallValue === undefined) return undefined;
    parameters.push({ materiaId, stat, bigValueIndex, smallValueIndex, bigValue, smallValue });
  }
  return parameters.length === 4 ? parameters : undefined;
}

export function mcpSource({ sheet, fields, rowIds, gameVersion, validatedVersion, queriedAt, note } = {}) {
  return {
    kind: "mcp",
    server: MCP_SERVER,
    sheet,
    ...(fields?.length ? { fields } : {}),
    ...(rowIds?.length ? { rowIds } : {}),
    ...(gameVersion ? { gameVersion } : {}),
    ...(validatedVersion ? { validatedVersion } : {}),
    ...(queriedAt ? { queriedAt } : {}),
    ...(note ? { note } : {}),
  };
}

export { statByBaseParam };
