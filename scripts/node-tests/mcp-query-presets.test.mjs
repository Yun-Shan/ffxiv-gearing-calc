import assert from "node:assert/strict";
import test from "node:test";
import * as presets from "../mcp-lumina/query-presets.mjs";
import {
  itemActionReturnFields as importedItemActionReturnFields,
  itemFoodReturnFields as importedItemFoodReturnFields,
  itemLevelReturnFields as importedItemLevelReturnFields,
  itemReturnFields as importedItemReturnFields,
  mandervilleReturnFields as importedMandervilleReturnFields,
} from "../mcp-lumina-import.mjs";
import { createMcpQueryHelpers } from "../mcp-lumina/query-helpers.mjs";
import { mergeMcpGearData } from "../data-update/mcp-merge.mjs";
import {
  normalizeMcpClassJobRow,
  normalizeMcpCustomParameters,
  normalizeMcpFoodRows,
  normalizeMcpGearRow,
} from "../mcp-lumina-import.mjs";
import {
  itemCoreReturnFields,
  resistanceWeaponAdjustFields,
  validateMcpItemHqInput,
} from "../data-update/mcp-snapshot.mjs";

const expectedItemFields = [
  "Name",
  "DamagePhys",
  "DamageMag",
  "Delayms",
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
  "ItemSpecialBonus",
  "ItemSpecialBonusParam",
  "MateriaSlotCount",
  "IsAdvancedMeldingPermitted",
  "IsUnique",
  "SubStatCategory",
  "LevelItem",
  "EquipSlotCategory",
  "CanBeHq",
  "Icon",
  "Rarity",
  "ItemAction",
];

const expectedItemLevelFields = [
  "Strength",
  "Dexterity",
  "Vitality",
  "Intelligence",
  "Mind",
  "Piety",
  "GP",
  "CP",
  "Craftsmanship",
  "Control",
  "Gathering",
  "Perception",
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

const expectedItemActionFields = [
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

const expectedItemFoodFields = [
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

const expectedMandervilleFields = [
  "Materia[0]",
  "Materia[1]",
  "Materia[2]",
  "Materia[3]",
  "MateriaBigValueIndex[0]",
  "MateriaBigValueIndex[1]",
  "MateriaBigValueIndex[2]",
  "MateriaBigValueIndex[3]",
  "MateriaSmallValueIndex[0]",
  "MateriaSmallValueIndex[1]",
  "MateriaSmallValueIndex[2]",
  "MateriaSmallValueIndex[3]",
];

const expectedClassJobFields = [
  "Name",
  "Abbreviation",
  "ModifierHitPoints",
  "ModifierStrength",
  "ModifierVitality",
  "ModifierDexterity",
  "ModifierIntelligence",
  "ModifierMind",
  "ModifierPiety",
  "IsLimitedJob",
  "CanWearShield",
  "PrimaryStat",
  "JobType",
];

const expectedResistanceWeaponAdjustFields = [
  "Image",
  "MaxTotalStats",
  "MaxEachStat",
  "BaseParam[0]",
  "BaseParam[1]",
  "BaseParam[2]",
  "BaseParam[3]",
  "Unknown0",
];

const expectedContentFinderConditionFields = [
  "Name",
  "ItemLevelSync",
  "ClassJobLevelSync",
  "JournalGenre",
  "ContentType",
  "ContentUICategory",
  "HighEndDuty",
  "AllowUndersized",
  "ContentLinkType",
];

const expectedMateriaFields = [
  "Value[0]",
  "Value[1]",
  "Value[2]",
  "Value[3]",
  "Value[4]",
  "Value[5]",
  "Value[6]",
  "Value[7]",
  "Value[8]",
  "Value[9]",
  "Value[10]",
  "Value[11]",
  "Value[12]",
  "Value[13]",
  "Value[14]",
  "Value[15]",
  "BaseParam",
];

const expectedItemSpecialBonusFields = ["Name", "RequirementText"];
const expectedFoodItemSourceFields = ["Name", "LevelItem", "ItemAction", "Icon"];
const fixtureJobSchemas = { SAM: { mainStat: "STR" } };
const removedFieldsBySheet = {
  Item: ["DefensePhys", "DefenseMag", "ItemUICategory", "FilterGroup"],
  ItemAction: ["Action"],
  MandervilleWeaponEnhance: ["UpgradeItem", "Image", "UpgradeCost", "Unknown7"],
};

function assertNoDuplicates(label, fields) {
  assert.equal(new Set(fields).size, fields.length, `${label} 含重复字段`);
}

function project(fields, selectedFields) {
  return Object.fromEntries(selectedFields.map((name) => [name, fields[name]]));
}

function makeItemFields(overrides = {}) {
  const fields = Object.fromEntries(expectedItemFields.map((name) => [name, 0]));
  Object.assign(fields, {
    Name: "MCP 测试装备",
    DamagePhys: 0,
    DamageMag: 0,
    Delayms: 0,
    LevelEquip: 99,
    ClassJobCategory: 1,
    "BaseParam[0]": 55,
    "BaseParam[1]": 3,
    "BaseParam[2]": 56,
    "BaseParam[3]": 44,
    "BaseParamValue[0]": 212,
    "BaseParamValue[1]": 214,
    "BaseParamValue[2]": 162,
    "BaseParamValue[3]": 162,
    ItemSpecialBonus: 0,
    ItemSpecialBonusParam: 0,
    MateriaSlotCount: 2,
    IsAdvancedMeldingPermitted: true,
    IsUnique: true,
    SubStatCategory: 2,
    LevelItem: 690,
    EquipSlotCategory: 4,
    CanBeHq: false,
    Icon: 1001,
    Rarity: 3,
    ItemAction: 404,
    ...overrides,
  });
  return fields;
}

function makeGearMergeScenario(options) {
  const { canBeHq, itemSpecialBonus = 0, referenceHq } = options;
  const ordinaryId = 9101;
  const customId = 9102;
  const categoryId = 30;
  const gameVersion = "test-version";
  const queriedAt = "2026-10-23T00:00:00.000Z";
  const ordinaryItemFields = makeItemFields({
    Name: "MCP 依据 HQ 的装备",
    ClassJobCategory: categoryId,
    "BaseParam[0]": 55,
    "BaseParamValue[0]": 100,
    ItemSpecialBonus: itemSpecialBonus,
    ItemSpecialBonusParam: itemSpecialBonus === 11 ? 64 : 0,
    CanBeHq: canBeHq,
    "BaseParamSpecial[0]": itemSpecialBonus === 11 ? 56 : 27,
    "BaseParamValueSpecial[0]": 20,
    "BaseParamSpecial[1]": itemSpecialBonus === 11 ? 44 : 0,
    "BaseParamValueSpecial[1]": itemSpecialBonus === 11 ? 30 : 0,
  });
  if (canBeHq === "missing") delete ordinaryItemFields.CanBeHq;
  const customItemFields = makeItemFields({
    Name: "自定义武器别名",
    DamagePhys: 100,
    DamageMag: 100,
    Delayms: 2400,
    ClassJobCategory: categoryId,
    EquipSlotCategory: 1,
    CanBeHq: false,
  });
  const mandervilleFields = {
    "Materia[0]": 101,
    "Materia[1]": 102,
    "Materia[2]": 103,
    "Materia[3]": 104,
    "MateriaBigValueIndex[0]": 3,
    "MateriaBigValueIndex[1]": 3,
    "MateriaBigValueIndex[2]": 3,
    "MateriaBigValueIndex[3]": 3,
    "MateriaSmallValueIndex[0]": 1,
    "MateriaSmallValueIndex[1]": 1,
    "MateriaSmallValueIndex[2]": 1,
    "MateriaSmallValueIndex[3]": 1,
  };
  const materiaStats = [27, 44, 22, 45];
  const materiaRows = materiaStats.map((baseParam, index) => ({
    rowId: 101 + index,
    fields: Object.fromEntries([
      ["BaseParam", baseParam],
      ...expectedMateriaFields.filter((field) => field.startsWith("Value[")).map((field) => [field, 0]),
      ["Value[1]", 5 + index],
      ["Value[3]", 15 + index],
    ]),
    gameVersion,
    timestamp: queriedAt,
  }));
  const itemRows = [
    { rowId: ordinaryId, fields: ordinaryItemFields, gameVersion, timestamp: queriedAt },
    { rowId: customId, fields: customItemFields, gameVersion, timestamp: queriedAt },
  ];
  const snapshot = {
    schemaVersion: 1,
    gameVersion,
    validatedVersion: gameVersion,
    queriedAt,
    rows: {
      Item: itemRows,
      ClassJobCategory: [{ rowId: categoryId, fields: { SAM: true }, gameVersion, timestamp: queriedAt }],
      MandervilleWeaponEnhance: [{ rowId: customId, fields: mandervilleFields, gameVersion, timestamp: queriedAt }],
      ResistanceWeaponAdjust: [],
      Materia: materiaRows,
      ItemSpecialBonus: [{ rowId: 11, fields: { Name: "测试特性", RequirementText: "测试说明" }, gameVersion, timestamp: queriedAt }],
    },
    queries: [
      {
        method: "get_rows",
        sheet: "Item",
        fields: [...presets.itemReturnFields],
        rowIds: [ordinaryId, customId],
        returnedRows: 2,
        gameVersion,
        queriedAt,
      },
      {
        method: "get_rows",
        sheet: "ItemSpecialBonus",
        fields: [...presets.itemSpecialBonusReturnFields],
        rowIds: [11],
        returnedRows: 1,
        gameVersion,
        queriedAt,
      },
    ],
  };
  const ordinaryGear = { id: ordinaryId, slot: "body", stats: {}, jobCategory: categoryId };
  if (Object.hasOwn(options, "referenceHq")) ordinaryGear.hq = referenceHq;
  const customGear = {
    id: customId,
    slot: "weapon",
    stats: { MDMG: 100 },
    jobCategory: categoryId,
    customizable: true,
  };
  const merged = mergeMcpGearData([ordinaryGear, customGear], snapshot, fixtureJobSchemas);
  return {
    ordinaryGear: merged.result.find((gear) => gear.id === ordinaryId),
    customGear: merged.result.find((gear) => gear.id === customId),
    ordinaryItemFields,
  };
}

function makeItemHqValidationSnapshot() {
  const gameVersion = "test-version";
  const queriedAt = "2026-10-23T00:00:00.000Z";
  return {
    gameVersion,
    queryPlan: { gearItemIds: [9101] },
    rows: {
      Item: [{
        rowId: 9101,
        fields: { CanBeHq: true },
        gameVersion,
        timestamp: queriedAt,
      }],
    },
    queries: [
      {
        method: "describe_sheet",
        sheet: "Item",
        fields: ["CanBeHq"],
        gameVersion,
        queriedAt,
      },
      {
        method: "get_rows",
        sheet: "Item",
        fields: ["CanBeHq"],
        rowIds: [9101],
        returnedRows: 1,
        gameVersion,
        queriedAt,
      },
    ],
  };
}

test("MCP query presets exactly preserve the intended names, order, and uniqueness", () => {
  assert.deepEqual(presets.itemReturnFields, expectedItemFields);
  assert.equal(presets.itemReturnFields.length, 42);
  assert.deepEqual(presets.itemLevelReturnFields, expectedItemLevelFields);
  assert.equal(presets.itemLevelReturnFields.length, 21);
  assert.deepEqual(presets.itemActionReturnFields, expectedItemActionFields);
  assert.equal(presets.itemActionReturnFields.length, 9);
  assert.deepEqual(presets.itemFoodReturnFields, expectedItemFoodFields);
  assert.equal(presets.itemFoodReturnFields.length, 18);
  assert.deepEqual(presets.mandervilleReturnFields, expectedMandervilleFields);
  assert.equal(presets.mandervilleReturnFields.length, 12);
  assert.deepEqual(presets.classJobReturnFields, expectedClassJobFields);
  assert.equal(presets.classJobReturnFields.length, 13);
  assert.deepEqual(presets.resistanceWeaponAdjustReturnFields, expectedResistanceWeaponAdjustFields);
  assert.equal(presets.resistanceWeaponAdjustReturnFields.length, 8);
  assert.deepEqual(presets.contentFinderConditionReturnFields, expectedContentFinderConditionFields);
  assert.equal(presets.contentFinderConditionReturnFields.length, 9);
  assert.deepEqual(presets.contentTypeReturnFields, ["Name"]);
  assert.deepEqual(presets.contentUICategoryReturnFields, ["Name"]);
  assert.deepEqual(presets.paramGrowReturnFields, ["ItemLevelSync"]);
  assert.deepEqual(presets.itemSpecialBonusReturnFields, expectedItemSpecialBonusFields);
  assert.deepEqual(presets.classJobSearchReturnFields, ["Name", "Abbreviation"]);
  assert.deepEqual(presets.materiaReturnFields, expectedMateriaFields);
  assert.deepEqual(presets.foodItemSourceFields, expectedFoodItemSourceFields);

  for (const [name, fields] of Object.entries({
    item: presets.itemReturnFields,
    itemLevel: presets.itemLevelReturnFields,
    itemAction: presets.itemActionReturnFields,
    itemFood: presets.itemFoodReturnFields,
    manderville: presets.mandervilleReturnFields,
    classJob: presets.classJobReturnFields,
    resistanceWeaponAdjust: presets.resistanceWeaponAdjustReturnFields,
    contentFinderCondition: presets.contentFinderConditionReturnFields,
    contentType: presets.contentTypeReturnFields,
    contentUICategory: presets.contentUICategoryReturnFields,
    paramGrow: presets.paramGrowReturnFields,
    itemSpecialBonus: presets.itemSpecialBonusReturnFields,
    classJobSearch: presets.classJobSearchReturnFields,
    materia: presets.materiaReturnFields,
    foodItemSource: presets.foodItemSourceFields,
  })) assertNoDuplicates(name, fields);

  assert.deepEqual(presets.classJobCategoryReturnFields(["PLD", "SAM", "PCT"]), ["PLD", "SAM", "PCT"]);
  assertNoDuplicates("classJobCategory", presets.classJobCategoryReturnFields(["PLD", "SAM", "PCT"]));
});

test("legacy import names remain aliases of the centralized presets", () => {
  assert.deepEqual(importedItemReturnFields, expectedItemFields);
  assert.deepEqual(importedItemLevelReturnFields, expectedItemLevelFields);
  assert.deepEqual(importedItemActionReturnFields, expectedItemActionFields);
  assert.deepEqual(importedItemFoodReturnFields, expectedItemFoodFields);
  assert.deepEqual(importedMandervilleReturnFields, expectedMandervilleFields);
});

test("ClassJob.PrimaryStat and JobType map supported main stats and roles", () => {
  const fields = (abbreviation, primaryStat, jobType) => ({
    Name: `MCP ${abbreviation}`,
    Abbreviation: abbreviation,
    PrimaryStat: primaryStat,
    JobType: jobType,
    ModifierHitPoints: 100,
    ModifierStrength: 100,
    ModifierVitality: 100,
    ModifierDexterity: 100,
    ModifierIntelligence: 100,
    ModifierMind: 100,
    ModifierPiety: 100,
    IsLimitedJob: false,
    CanWearShield: false,
  });
  const validClassJobs = [
    ["PLD", 1, 1, "STR", "tank"],
    ["WHM", 5, 2, "MND", "healer"],
    ["SGE", 5, 6, "MND", "healer"],
    ["SAM", 1, 3, "STR", "str"],
    ["NIN", 2, 3, "DEX", "dex"],
    ["BRD", 2, 4, "DEX", "dex"],
    ["BLM", 4, 5, "INT", "int"],
    ["BLU", 4, 5, "INT", "int"],
    ["BST", 1, 3, "STR", "str"],
  ];
  for (const [index, [abbreviation, primaryStat, jobType, mainStat, role]] of validClassJobs.entries()) {
    const normalized = normalizeMcpClassJobRow({
      rowId: index + 100,
      fields: fields(abbreviation, primaryStat, jobType),
    });
    assert.equal(normalized.mainStat, mainStat, `${abbreviation} mainStat`);
    assert.equal(normalized.role, role, `${abbreviation} role`);
    assert.equal(Object.hasOwn(normalized, "jobType"), false, `${abbreviation} raw JobType is not projected`);
  }
  for (const primaryStat of [undefined, 0, 3, 6, -1, 1.5, "1"]) {
    const rowFields = fields("PLD", primaryStat, 1);
    if (primaryStat === undefined) delete rowFields.PrimaryStat;
    assert.throws(
      () => normalizeMcpClassJobRow({ rowId: 19, fields: rowFields }),
      /PrimaryStat/,
      `PrimaryStat=${String(primaryStat)}`,
    );
  }

  for (const jobType of [0, 7, -1, undefined, Number.NaN, "1", 1.5]) {
    const rowFields = fields("SAM", 1, jobType);
    if (jobType === undefined) delete rowFields.JobType;
    assert.throws(
      () => normalizeMcpClassJobRow({ rowId: 9201, fields: rowFields }),
      (error) => error.message.includes("SAM") &&
        error.message.includes("9201") &&
        error.message.includes(String(jobType)) &&
        error.message.includes("需要定义新的 Type 类型"),
      `JobType=${String(jobType)} must be reported with row identity and new-Type guidance`,
    );
  }

  const incompatibleTypes = [
    ["PLD", 2, 1],
    ["WHM", 4, 2],
    ["SAM", 4, 3],
    ["BRD", 1, 4],
    ["BLM", 5, 5],
    ["SGE", 2, 6],
  ];
  for (const [index, [abbreviation, primaryStat, jobType]] of incompatibleTypes.entries()) {
    assert.throws(
      () => normalizeMcpClassJobRow({
        rowId: 9300 + index,
        fields: fields(abbreviation, primaryStat, jobType),
      }),
      /JobType.*PrimaryStat/,
      `${abbreviation} rejects incompatible JobType=${jobType}/PrimaryStat=${primaryStat}`,
    );
  }
});

test("source field lists retain useful evidence and omit removed query columns", () => {
  const expectedItemCoreFields = expectedItemFields.filter((field) =>
    !["SubStatCategory", "ItemSpecialBonus", "ItemSpecialBonusParam"].includes(field),
  );
  assert.deepEqual(itemCoreReturnFields, expectedItemCoreFields);
  assert.deepEqual(resistanceWeaponAdjustFields, expectedResistanceWeaponAdjustFields);
  assert.deepEqual(presets.foodItemSourceFields, expectedFoodItemSourceFields);

  for (const field of removedFieldsBySheet.Item)
    assert.equal(itemCoreReturnFields.includes(field), false, `Item 来源仍记录已删字段 ${field}`);
  for (const field of removedFieldsBySheet.ItemAction)
    assert.equal(presets.itemActionReturnFields.includes(field), false, `ItemAction 来源仍记录已删字段 ${field}`);
  for (const field of removedFieldsBySheet.MandervilleWeaponEnhance)
    assert.equal(presets.mandervilleReturnFields.includes(field), false, `Manderville 来源仍记录已删字段 ${field}`);

  assert.ok(presets.resistanceWeaponAdjustReturnFields.includes("Image"));
  assert.ok(presets.resistanceWeaponAdjustReturnFields.includes("Unknown0"));
  assert.ok(presets.classJobReturnFields.includes("CanWearShield"));
  assert.ok(presets.classJobReturnFields.includes("JobType"));
  assert.ok(presets.itemSpecialBonusReturnFields.includes("RequirementText"));
});

test("Item.CanBeHq validation requires same-version schema, row, and query evidence", () => {
  assert.doesNotThrow(() => validateMcpItemHqInput(makeItemHqValidationSnapshot()));

  const schemaCases = [
    (snapshot) => { snapshot.queries.shift(); },
    (snapshot) => { snapshot.queries[0].fields = []; },
    (snapshot) => { snapshot.queries[0].gameVersion = "other-version"; },
    (snapshot) => { delete snapshot.queries[0].queriedAt; },
  ];
  for (const mutate of schemaCases) {
    const snapshot = makeItemHqValidationSnapshot();
    mutate(snapshot);
    assert.throws(() => validateMcpItemHqInput(snapshot), /Schema 来源/);
  }

  const rowAndQueryCases = [
    (snapshot) => { snapshot.rows.Item = []; },
    (snapshot) => { delete snapshot.rows.Item[0].fields.CanBeHq; },
    (snapshot) => { snapshot.rows.Item[0].fields.CanBeHq = 1; },
    (snapshot) => { snapshot.rows.Item[0].gameVersion = "other-version"; },
    (snapshot) => { delete snapshot.rows.Item[0].timestamp; },
    (snapshot) => { snapshot.queries[1].fields = []; },
    (snapshot) => { snapshot.queries[1].gameVersion = "other-version"; },
    (snapshot) => { delete snapshot.queries[1].queriedAt; },
    (snapshot) => { snapshot.queries[1].rowIds = [9102]; },
  ];
  for (const mutate of rowAndQueryCases) {
    const snapshot = makeItemHqValidationSnapshot();
    mutate(snapshot);
    assert.throws(() => validateMcpItemHqInput(snapshot), /CanBeHq/);
  }
});

test("RWA and CFC missing-field boundaries still reject incomplete MCP evidence", () => {
  const helpers = createMcpQueryHelpers();
  const completeCfcDescription = {
    columns: expectedContentFinderConditionFields.map((name) => ({ name })),
  };
  helpers.validateSyncLevelSchema(
    "ContentFinderCondition",
    completeCfcDescription,
    presets.contentFinderConditionReturnFields,
  );
  for (const missing of expectedContentFinderConditionFields) {
    assert.throws(() => helpers.validateSyncLevelSchema(
      "ContentFinderCondition",
      { columns: completeCfcDescription.columns.filter(({ name }) => name !== missing) },
      presets.contentFinderConditionReturnFields,
    ), new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.throws(() => helpers.validateSyncLevelSchema(
    "ContentFinderCondition",
    { columns: undefined },
    presets.contentFinderConditionReturnFields,
  ), /Schema 不可用/);

  const description = { rowCount: 2 };
  const rowFields = Object.fromEntries(expectedResistanceWeaponAdjustFields.map((name) => [name, 0]));
  const rows = [
    { rowId: 0, fields: { ...rowFields }, gameVersion: "test-version", timestamp: "time" },
    {
      rowId: 8,
      fields: { ...rowFields, Image: 4, MaxTotalStats: 300, MaxEachStat: 120, "BaseParam[0]": 27 },
      gameVersion: "test-version",
      timestamp: "time",
    },
  ];
  assert.deepEqual(
    helpers.validateResistanceWeaponAdjustRows(
      rows,
      [],
      description,
      "test-version",
      [0, 8],
      presets.resistanceWeaponAdjustReturnFields,
    ),
    [8],
  );
  for (const missing of ["Image", "Unknown0"]) {
    const incomplete = rows.map((row) => ({ ...row, fields: { ...row.fields } }));
    delete incomplete[1].fields[missing];
    assert.throws(() => helpers.validateResistanceWeaponAdjustRows(
      incomplete,
      [],
      description,
      "test-version",
      [0, 8],
      presets.resistanceWeaponAdjustReturnFields,
    ), /不是有效 uint/);
  }

  const completeBonus = { columns: expectedItemSpecialBonusFields.map((name) => ({ name })) };
  helpers.validateSyncLevelSchema("ItemSpecialBonus", completeBonus, presets.itemSpecialBonusReturnFields);
  assert.throws(() => helpers.validateSyncLevelSchema(
    "ItemSpecialBonus",
    { columns: completeBonus.columns.filter(({ name }) => name !== "RequirementText") },
    presets.itemSpecialBonusReturnFields,
  ), /RequirementText/);
  assert.equal(normalizeMcpClassJobRow({ fields: {
    Name: "骑士", Abbreviation: "PLD", ModifierHitPoints: 100, ModifierStrength: 100,
    ModifierVitality: 100, ModifierDexterity: 100, ModifierIntelligence: 100,
    ModifierMind: 100, ModifierPiety: 100, IsLimitedJob: false, PrimaryStat: 1, JobType: 1,
  } }), undefined);
});

test("lean Item query rows still normalize gear without removed columns", () => {
  const fullInputFields = {
    ...makeItemFields(),
    DefensePhys: 999,
    DefenseMag: 888,
    ItemUICategory: 123,
    FilterGroup: 456,
  };
  const fields = project(fullInputFields, presets.itemReturnFields);
  assert.deepEqual(Object.keys(fields), expectedItemFields);
  for (const deletedField of removedFieldsBySheet.Item)
    assert.equal(Object.hasOwn(fields, deletedField), false);

  const gear = normalizeMcpGearRow(
    { rowId: 9001, fields },
    { slot: "body", stats: {}, jobCategory: 1 },
    { fields: { SAM: true } },
    { jobSchemas: fixtureJobSchemas },
  );
  assert.deepEqual(gear, {
    slot: "body",
    stats: { main: 212, VIT: 214, secondary: 162, DET: 162 },
    jobCategory: 1,
    name: "MCP 测试装备",
    rawSlot: 4,
    level: 690,
    equipLevel: 99,
    materiaSlots: 2,
    equipLevelVariable: true,
    unique: true,
    materiaAdvanced: true,
    rarity: 3,
    weaponDamage: undefined,
    jobs: ["SAM"],
  });
});

test("weapon damage and HQ bonuses follow every applicable job main stat", () => {
  const makeWeaponRow = (canBeHq) => ({
    rowId: 9004,
    fields: makeItemFields({
      Name: "双伤害武器",
      DamagePhys: 100,
      DamageMag: 50,
      Delayms: 0,
      "BaseParam[0]": 12,
      "BaseParam[1]": 13,
      "BaseParam[2]": 0,
      "BaseParam[3]": 0,
      "BaseParam[4]": 0,
      "BaseParam[5]": 0,
      "BaseParamValue[0]": 100,
      "BaseParamValue[1]": 50,
      "BaseParamValue[2]": 0,
      "BaseParamValue[3]": 0,
      "BaseParamValue[4]": 0,
      "BaseParamValue[5]": 0,
      "BaseParamSpecial[0]": 12,
      "BaseParamSpecial[1]": 13,
      "BaseParamValueSpecial[0]": 10,
      "BaseParamValueSpecial[1]": 5,
      CanBeHq: canBeHq,
    }),
  });

  const normalizeForJob = (job, mainStat, { canBeHq = true, fallback } = {}) => {
    const jobSchemas = { [job]: { mainStat } };
    const categoryRow = { fields: { [job]: true } };
    return normalizeMcpGearRow(makeWeaponRow(canBeHq), fallback, categoryRow, {
      jobSchemas,
      isWeapon: true,
    });
  };

  const mainStatCases = [
    { job: "PLD", mainStat: "STR", selected: "PDMG", other: "MDMG" },
    { job: "NIN", mainStat: "DEX", selected: "PDMG", other: "MDMG" },
    { job: "BLM", mainStat: "INT", selected: "MDMG", other: "PDMG" },
    { job: "WHM", mainStat: "MND", selected: "MDMG", other: "PDMG" },
  ];
  for (const { job, mainStat, selected, other } of mainStatCases) {
    const weapon = normalizeForJob(job, mainStat);
    assert.deepEqual(weapon.stats, { [selected]: selected === "PDMG" ? 110 : 55 }, `${job}/${mainStat}`);
    assert.equal(weapon.stats[other], undefined, `${job}/${mainStat} excludes unselected damage`);

    const oppositeFallback = normalizeForJob(job, mainStat, {
      fallback: { slot: "weapon", stats: { [other]: 999 } },
    });
    assert.deepEqual(oppositeFallback.stats, weapon.stats, `${job} damage selection ignores fallback stats`);
  }

  const sameType = normalizeMcpGearRow(
    makeWeaponRow(true),
    undefined,
    { fields: { SAM: true, WAR: true } },
    { jobSchemas: { SAM: { mainStat: "STR" }, WAR: { mainStat: "STR" } }, isWeapon: true },
  );
  assert.deepEqual(sameType.stats, { PDMG: 110 });

  const assertMixedDamageConflict = (normalize, rowId) => {
    assert.throws(normalize, (error) => {
      assert.ok(error.message.includes(String(rowId)), `conflict reports Item ${rowId}`);
      assert.ok(error.message.includes("SAM"), "conflict reports SAM");
      assert.ok(error.message.includes("BLM"), "conflict reports BLM");
      assert.match(error.message, /硬编码伤害类型映射/);
      return true;
    });
  };
  assertMixedDamageConflict(() => normalizeMcpGearRow(
    makeWeaponRow(true),
    undefined,
    { fields: { SAM: true, BLM: true } },
    { jobSchemas: { SAM: { mainStat: "STR" }, BLM: { mainStat: "INT" } }, isWeapon: true },
  ), 9004);

  const makeArmorRow = (overrides = {}) => ({
    rowId: 9005,
    fields: makeItemFields({
      Name: "跨类型职业的通用防具",
      DamagePhys: 0,
      DamageMag: 0,
      Delayms: 0,
      "BaseParam[0]": 55,
      "BaseParam[1]": 3,
      "BaseParam[2]": 56,
      "BaseParam[3]": 44,
      "BaseParam[4]": 0,
      "BaseParam[5]": 0,
      "BaseParamValue[0]": 100,
      "BaseParamValue[1]": 200,
      "BaseParamValue[2]": 50,
      "BaseParamValue[3]": 30,
      "BaseParamValue[4]": 0,
      "BaseParamValue[5]": 0,
      CanBeHq: false,
      ...overrides,
    }),
  });
  const crossTypeCategory = { fields: { SAM: true, BLM: true } };
  const crossTypeJobSchemas = { SAM: { mainStat: "STR" }, BLM: { mainStat: "INT" } };
  const genericCrossTypeArmor = normalizeMcpGearRow(
    makeArmorRow(),
    undefined,
    crossTypeCategory,
    { jobSchemas: crossTypeJobSchemas },
  );
  assert.deepEqual(genericCrossTypeArmor.stats, { main: 100, VIT: 200, secondary: 50, DET: 30 });
  const inactiveSpecialStats = normalizeMcpGearRow(
    makeArmorRow({
      CanBeHq: false,
      "BaseParamSpecial[0]": 13,
      "BaseParamValueSpecial[0]": 5,
    }),
    undefined,
    crossTypeCategory,
    { jobSchemas: crossTypeJobSchemas },
  );
  assert.deepEqual(inactiveSpecialStats.stats, genericCrossTypeArmor.stats);
  assert.equal(inactiveSpecialStats.specialStats, undefined);
  assertMixedDamageConflict(() => normalizeMcpGearRow(
    makeArmorRow({
      CanBeHq: true,
      "BaseParamSpecial[0]": 13,
      "BaseParamValueSpecial[0]": 5,
    }),
    undefined,
    crossTypeCategory,
    { jobSchemas: crossTypeJobSchemas },
  ), 9005);
  assert.throws(() => normalizeMcpGearRow(
    makeArmorRow({ "BaseParam[4]": 12, "BaseParamValue[4]": 15 }),
    undefined,
    crossTypeCategory,
    { jobSchemas: crossTypeJobSchemas },
    ), /硬编码伤害类型映射/);
  assert.throws(() => normalizeMcpGearRow(
    makeArmorRow({
      ItemSpecialBonus: 11,
      ItemSpecialBonusParam: 64,
      CanBeHq: false,
      "BaseParamSpecial[0]": 13,
      "BaseParamValueSpecial[0]": 5,
    }),
    undefined,
    crossTypeCategory,
    { jobSchemas: crossTypeJobSchemas },
    ), /硬编码伤害类型映射/);
  assert.throws(() => normalizeMcpGearRow(
    makeArmorRow(),
    undefined,
    crossTypeCategory,
    { jobSchemas: { SAM: { mainStat: "LUK" }, BLM: { mainStat: "INT" } } },
  ), /mainStat|主属性/);

  for (const invalidSchemas of [
    undefined,
    {},
    { PLD: {} },
    { PLD: { mainStat: "VIT" } },
    { PLD: { mainStat: "LUK" } },
  ]) {
    assert.throws(() => normalizeMcpGearRow(
      makeWeaponRow(true),
      undefined,
      { fields: { PLD: true } },
      { jobSchemas: invalidSchemas, isWeapon: true },
    ), /职业主属性 schema|缺少有效主属性/);
  }
  assert.throws(() => normalizeMcpGearRow(
    makeWeaponRow(true),
    undefined,
    { fields: { PLD: true, WAR: true } },
    { jobSchemas: { PLD: { mainStat: "STR" } }, isWeapon: true },
  ), /缺少有效主属性/);

  const selectedZero = makeWeaponRow(true);
  Object.assign(selectedZero.fields, {
    DamagePhys: 0,
    DamageMag: 50,
    "BaseParamValue[0]": 100,
    "BaseParamValue[1]": 999,
    "BaseParamSpecial[0]": 13,
    "BaseParamValueSpecial[0]": 5,
  });
  const zeroPhysical = normalizeMcpGearRow(
    selectedZero,
    undefined,
    { fields: { PLD: true } },
    { jobSchemas: { PLD: { mainStat: "STR" } }, isWeapon: true },
  );
  assert.deepEqual(zeroPhysical.stats, { PDMG: 0 });

  for (const canBeHq of [false, true]) {
    const ordinaryHq = normalizeForJob("PLD", "STR", { canBeHq });
    assert.deepEqual(ordinaryHq.stats, { PDMG: canBeHq ? 110 : 100 });

    const specialRows = [
      { job: "PLD", mainStat: "STR", stat: "PDMG", baseValue: 100, bonusValue: 10 },
      { job: "BLM", mainStat: "INT", stat: "MDMG", baseValue: 50, bonusValue: 5 },
    ];
    for (const { job, mainStat, stat, baseValue, bonusValue } of specialRows) {
      const row = makeWeaponRow(canBeHq);
      Object.assign(row.fields, {
        ItemSpecialBonus: 11,
        ItemSpecialBonusParam: 64,
        "BaseParamSpecial[0]": stat === "PDMG" ? 12 : 13,
        "BaseParamValueSpecial[0]": bonusValue,
        "BaseParamSpecial[1]": stat === "PDMG" ? 13 : 12,
        "BaseParamValueSpecial[1]": stat === "PDMG" ? 5 : 10,
      });
      const special = normalizeMcpGearRow(
        row,
        undefined,
        { fields: { [job]: true } },
        { jobSchemas: { [job]: { mainStat } }, isWeapon: true },
      );
      assert.deepEqual(special.stats, { [stat]: baseValue }, `${job} ID 11 does not merge HQ damage`);
      assert.deepEqual(special.specialStats, { [stat]: bonusValue }, `${job} ID 11 special damage follows main stat`);
    }
  }
});

test("gear merging uses MCP CanBeHq and keeps supported special-bonus stats separate", () => {
  const referenceHqButCannotHq = makeGearMergeScenario({ canBeHq: false, referenceHq: true });
  assert.equal(Object.hasOwn(referenceHqButCannotHq.ordinaryItemFields, "CanBeHq"), true);
  assert.equal(referenceHqButCannotHq.ordinaryGear.stats.CRT, undefined);
  assert.equal(referenceHqButCannotHq.customGear.stats.PDMG, 100);
  assert.equal(referenceHqButCannotHq.customGear.stats.MDMG, undefined);

  const referenceNqButCanBeHq = makeGearMergeScenario({ canBeHq: true, referenceHq: false });
  assert.equal(referenceNqButCanBeHq.ordinaryGear.stats.CRT, 20);

  const referenceHqUnspecified = makeGearMergeScenario({ canBeHq: true });
  assert.equal(referenceHqUnspecified.ordinaryGear.stats.CRT, 20);

  for (const canBeHq of ["missing", 1, null]) {
    assert.throws(() => makeGearMergeScenario({ canBeHq }), /CanBeHq/);
  }

  for (const canBeHq of [false, true]) {
    const specialBonus = makeGearMergeScenario({ canBeHq, itemSpecialBonus: 11, referenceHq: !canBeHq });
    assert.deepEqual(specialBonus.ordinaryGear.stats, {
      main: 100,
      VIT: 214,
      secondary: 162,
      DET: 162,
    });
    assert.equal(specialBonus.ordinaryGear.itemSpecialBonus, 11);
    assert.equal(specialBonus.ordinaryGear.itemSpecialBonusParam, 64);
    assert.deepEqual(specialBonus.ordinaryGear.specialStats, { secondary: 20, DET: 30 });
  }
});

test("lean Item, ItemAction, and ItemFood query rows still normalize food", () => {
  const rawItemFields = {
    ...makeItemFields({ Name: "MCP 测试食物", LevelItem: 760, ItemAction: 404, Icon: 5001 }),
    DefensePhys: 999,
    DefenseMag: 888,
    ItemUICategory: 123,
    FilterGroup: 456,
  };
  const itemFields = project(rawItemFields, presets.itemReturnFields);
  const rawActionFields = {
    Action: 77,
    ...Object.fromEntries(expectedItemActionFields.map((field) => [field, 0])),
    "Data[0]": 9001,
  };
  const actionFields = project(rawActionFields, presets.itemActionReturnFields);
  const rawFoodFields = Object.fromEntries(expectedItemFoodFields.map((field) => [field, 0]));
  Object.assign(rawFoodFields, {
    "BaseParam[0]": 27,
    "Max[0]": 30,
    "MaxHQ[0]": 50,
    "Value[0]": 8,
    "ValueHQ[0]": 10,
    "IsRelative[0]": true,
    "BaseParam[1]": 44,
    "Max[1]": 35,
    "ValueHQ[1]": 6,
    "BaseParam[2]": 22,
    "MaxHQ[2]": 15,
    "ValueHQ[2]": 4,
    "IsRelative[2]": true,
  });
  const foodFields = project(rawFoodFields, presets.itemFoodReturnFields);
  assert.deepEqual(Object.keys(actionFields), expectedItemActionFields);
  assert.equal(Object.hasOwn(actionFields, "Action"), false);
  assert.deepEqual(Object.keys(foodFields), expectedItemFoodFields);

  const food = normalizeMcpFoodRows(
    { rowId: 9002, fields: itemFields },
    { rowId: 404, fields: actionFields },
    { 9001: { rowId: 9001, fields: foodFields } },
    { id: 9002, slot: -1 },
  );
  assert.deepEqual(food, {
    id: 9002,
    slot: -1,
    name: "MCP 测试食物",
    level: 760,
    stats: { CRT: 50, DET: 35, DHT: 15 },
    statRates: { CRT: 10, DHT: 4 },
  });
});

test("lean Manderville and Materia rows still normalize custom parameters", () => {
  const rawMandervilleFields = {
    "Materia[0]": 101,
    "Materia[1]": 102,
    "Materia[2]": 103,
    "Materia[3]": 104,
    "UpgradeItem": 9999,
    "Image": 123,
    "UpgradeCost": 100,
    "Unknown7": 88,
    "MateriaBigValueIndex[0]": 3,
    "MateriaBigValueIndex[1]": 2,
    "MateriaBigValueIndex[2]": 4,
    "MateriaBigValueIndex[3]": 5,
    "MateriaSmallValueIndex[0]": 1,
    "MateriaSmallValueIndex[1]": 0,
    "MateriaSmallValueIndex[2]": 2,
    "MateriaSmallValueIndex[3]": 3,
  };
  const mandervilleFields = project(rawMandervilleFields, presets.mandervilleReturnFields);
  const materiaRows = {
    101: { rowId: 101, fields: { BaseParam: 27, "Value[1]": 4, "Value[3]": 12 } },
    102: { rowId: 102, fields: { BaseParam: 44, "Value[0]": 2, "Value[2]": 8 } },
    103: { rowId: 103, fields: { BaseParam: 22, "Value[2]": 7, "Value[4]": 18 } },
    104: { rowId: 104, fields: { BaseParam: 45, "Value[3]": 11, "Value[5]": 25 } },
  };
  assert.deepEqual(Object.keys(mandervilleFields), expectedMandervilleFields);
  for (const deletedField of removedFieldsBySheet.MandervilleWeaponEnhance)
    assert.equal(Object.hasOwn(mandervilleFields, deletedField), false);

  assert.deepEqual(normalizeMcpCustomParameters({ rowId: 9003, fields: mandervilleFields }, materiaRows), [
    { materiaId: 101, stat: "CRT", bigValueIndex: 3, smallValueIndex: 1, bigValue: 12, smallValue: 4 },
    { materiaId: 102, stat: "DET", bigValueIndex: 2, smallValueIndex: 0, bigValue: 8, smallValue: 2 },
    { materiaId: 103, stat: "DHT", bigValueIndex: 4, smallValueIndex: 2, bigValue: 18, smallValue: 7 },
    { materiaId: 104, stat: "SKS", bigValueIndex: 5, smallValueIndex: 3, bigValue: 25, smallValue: 11 },
  ]);
});
