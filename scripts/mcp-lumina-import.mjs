/**
 * Pure normalizers for query artifacts produced by the environment-provided
 * ffxiv-mcp-lumina server. The updater never guesses a field: a value is
 * accepted only when the corresponding sheet row and field are present.
 */

export const MCP_SERVER = "ffxiv-mcp-lumina";

export const itemReturnFields = [
  "Name",
  "DamagePhys",
  "DamageMag",
  "Delayms",
  "DefensePhys",
  "DefenseMag",
  "BaseParamValue[0]",
  "BaseParamValue[1]",
  "BaseParamValue[2]",
  "BaseParamValue[3]",
  "BaseParamValue[4]",
  "BaseParamValue[5]",
  "BaseParamValueSpecial[0]",
  "BaseParamValueSpecial[1]",
  "BaseParamValueSpecial[2]",
  "BaseParamValueSpecial[3]",
  "BaseParamValueSpecial[4]",
  "BaseParamValueSpecial[5]",
  "LevelEquip",
  "ClassJobCategory",
  "BaseParam[0]",
  "BaseParam[1]",
  "BaseParam[2]",
  "BaseParam[3]",
  "BaseParam[4]",
  "BaseParam[5]",
  "BaseParamSpecial[0]",
  "BaseParamSpecial[1]",
  "BaseParamSpecial[2]",
  "BaseParamSpecial[3]",
  "BaseParamSpecial[4]",
  "BaseParamSpecial[5]",
  "MateriaSlotCount",
  "IsAdvancedMeldingPermitted",
  "LevelItem",
  "EquipSlotCategory",
  "CanBeHq",
  "Icon",
  "Rarity",
  "ItemAction",
  "ItemUICategory",
  "FilterGroup",
];

export const itemLevelReturnFields = [
  "Strength",
  "Dexterity",
  "Vitality",
  "Intelligence",
  "Mind",
  "Piety",
  "PhysicalDamage",
  "MagicalDamage",
  "Delay",
  "Tenacity",
  "DirectHitRate",
  "CriticalHit",
  "Determination",
  "SkillSpeed",
  "SpellSpeed",
];

export const itemActionReturnFields = [
  "Action",
  "Data[0]",
  "Data[1]",
  "Data[2]",
  "Data[3]",
  "Data[4]",
  "Data[5]",
  "Data[6]",
  "Data[7]",
  "Data[8]",
];

export const itemFoodReturnFields = [
  "Max[0]",
  "Max[1]",
  "Max[2]",
  "MaxHQ[0]",
  "MaxHQ[1]",
  "MaxHQ[2]",
  "BaseParam[0]",
  "BaseParam[1]",
  "BaseParam[2]",
  "Value[0]",
  "Value[1]",
  "Value[2]",
  "ValueHQ[0]",
  "ValueHQ[1]",
  "ValueHQ[2]",
  "IsRelative[0]",
  "IsRelative[1]",
  "IsRelative[2]",
];

export const mandervilleReturnFields = [
  "Materia[0]",
  "Materia[1]",
  "Materia[2]",
  "Materia[3]",
  "UpgradeItem",
  "Image",
  "UpgradeCost",
  "Unknown7",
  "MateriaBigValueIndex[0]",
  "MateriaBigValueIndex[1]",
  "MateriaBigValueIndex[2]",
  "MateriaBigValueIndex[3]",
  "MateriaSmallValueIndex[0]",
  "MateriaSmallValueIndex[1]",
  "MateriaSmallValueIndex[2]",
  "MateriaSmallValueIndex[3]",
];

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
]);

const classJobFields = [
  "PLD", "MNK", "WAR", "DRG", "BRD", "WHM", "BLM", "SMN", "SCH", "NIN",
  "MCH", "DRK", "AST", "SAM", "RDM", "GNB", "DNC", "RPR", "SGE", "VPR", "PCT",
];

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

function field(row, name) {
  return fieldsOf(row)?.[name];
}

function readStats(row, { hq = false, damageStat } = {}) {
  const stats = {};
  for (let index = 0; index < 6; index++) {
    const baseParam = numberOrUndefined(field(row, `BaseParam[${index}]`));
    const value = numberOrUndefined(field(row, `BaseParamValue[${index}]`));
    const stat = statByBaseParam.get(baseParam);
    if (stat && value !== undefined && value > 0) stats[stat] = value;
  }
  const physical = numberOrUndefined(field(row, "DamagePhys"));
  const magical = numberOrUndefined(field(row, "DamageMag"));
  const delay = numberOrUndefined(field(row, "Delayms"));
  if (damageStat === "PDMG" && physical !== undefined && physical > 0) stats.PDMG = physical;
  if (damageStat === "MDMG" && magical !== undefined && magical > 0) stats.MDMG = magical;
  if (delay !== undefined && delay > 0) stats.DLY = delay;
  if (hq) {
    for (let index = 0; index < 6; index++) {
      const baseParam = numberOrUndefined(field(row, `BaseParamSpecial[${index}]`));
      const value = numberOrUndefined(field(row, `BaseParamValueSpecial[${index}]`));
      const stat = statByBaseParam.get(baseParam);
      if (stat && value !== undefined && value > 0 &&
          (!(["PDMG", "MDMG"].includes(stat)) || stat === damageStat))
        stats[stat] = (stats[stat] ?? 0) + value;
    }
  }
  return stats;
}

export function normalizeMcpGearRow(row, fallback, categoryRow, { hq = false } = {}) {
  const itemFields = fieldsOf(row);
  if (!itemFields) return undefined;
  const categoryFields = fieldsOf(categoryRow);
  const required = ["Name", "LevelItem", "LevelEquip", "ClassJobCategory", "EquipSlotCategory"];
  if (required.some((name) => itemFields[name] === undefined)) return undefined;
  const jobs = categoryFields
    ? classJobFields.filter((job) => categoryFields[job] === true)
    : [];
  if (!jobs.length) return undefined;
  const rawSlot = numberOrUndefined(itemFields.EquipSlotCategory);
  const level = numberOrUndefined(itemFields.LevelItem);
  const equipLevel = numberOrUndefined(itemFields.LevelEquip);
  const materiaSlots = numberOrUndefined(itemFields.MateriaSlotCount);
  if (rawSlot === undefined || level === undefined || equipLevel === undefined || materiaSlots === undefined)
    return undefined;
  const damageStat = fallback.stats?.PDMG !== undefined
    ? "PDMG"
    : fallback.stats?.MDMG !== undefined
      ? "MDMG"
      : undefined;
  const stats = readStats(row, { hq, damageStat });
  return {
    ...fallback,
    name: String(itemFields.Name),
    rawSlot,
    level,
    equipLevel,
    jobCategory: numberOrUndefined(itemFields.ClassJobCategory) ?? fallback.jobCategory,
    stats,
    materiaSlots,
    ...(itemFields.IsAdvancedMeldingPermitted === true ? { materiaAdvanced: true } : {}),
    ...(itemFields.Rarity !== undefined ? { rarity: Number(itemFields.Rarity) } : {}),
    weaponDamage: stats.PDMG ?? stats.MDMG,
    jobs,
  };
}

export function normalizeMcpFoodRows(itemRow, actionRow, foodRows, fallback) {
  const itemFields = fieldsOf(itemRow);
  const actionFields = fieldsOf(actionRow);
  if (!itemFields || !actionFields) return undefined;
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
    name: String(itemFields.Name),
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
