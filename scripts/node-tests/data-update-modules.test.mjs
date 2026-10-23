import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeFood,
  normalizeGear,
  normalizeJobSchemas,
  parseGameConstants,
} from "../data-update/upstream-reference.mjs";
import {
  mergeMcpGearData,
  mergeMcpFoodData,
} from "../data-update/mcp-merge.mjs";
import { classJobReturnFields, mandervilleReturnFields } from "../mcp-lumina-import.mjs";
import {
  resistanceWeaponAdjustFields,
  supportedJobs,
  validateMcpClassJobPrimaryStatInput,
  validateMcpResistanceWeaponAdjustInput,
} from "../data-update/mcp-snapshot.mjs";

const classJobFixtureByJob = {
  PLD: { primaryStat: 1, jobType: 1, mainStat: "STR", role: "tank" },
  WAR: { primaryStat: 1, jobType: 1, mainStat: "STR", role: "tank" },
  DRK: { primaryStat: 1, jobType: 1, mainStat: "STR", role: "tank" },
  GNB: { primaryStat: 1, jobType: 1, mainStat: "STR", role: "tank" },
  WHM: { primaryStat: 5, jobType: 2, mainStat: "MND", role: "healer" },
  AST: { primaryStat: 5, jobType: 2, mainStat: "MND", role: "healer" },
  SCH: { primaryStat: 5, jobType: 6, mainStat: "MND", role: "healer" },
  SGE: { primaryStat: 5, jobType: 6, mainStat: "MND", role: "healer" },
  MNK: { primaryStat: 1, jobType: 3, mainStat: "STR", role: "str" },
  DRG: { primaryStat: 1, jobType: 3, mainStat: "STR", role: "str" },
  NIN: { primaryStat: 2, jobType: 3, mainStat: "DEX", role: "dex" },
  SAM: { primaryStat: 1, jobType: 3, mainStat: "STR", role: "str" },
  RPR: { primaryStat: 1, jobType: 3, mainStat: "STR", role: "str" },
  VPR: { primaryStat: 1, jobType: 3, mainStat: "STR", role: "str" },
  BST: { primaryStat: 1, jobType: 3, mainStat: "STR", role: "str" },
  BRD: { primaryStat: 2, jobType: 4, mainStat: "DEX", role: "dex" },
  MCH: { primaryStat: 2, jobType: 4, mainStat: "DEX", role: "dex" },
  DNC: { primaryStat: 2, jobType: 4, mainStat: "DEX", role: "dex" },
  BLM: { primaryStat: 4, jobType: 5, mainStat: "INT", role: "int" },
  SMN: { primaryStat: 4, jobType: 5, mainStat: "INT", role: "int" },
  RDM: { primaryStat: 4, jobType: 5, mainStat: "INT", role: "int" },
  PCT: { primaryStat: 4, jobType: 5, mainStat: "INT", role: "int" },
  BLU: { primaryStat: 4, jobType: 5, mainStat: "INT", role: "int" },
};

function makeClassJobPrimaryStatSnapshot() {
  const gameVersion = "classjob-fixture-version";
  const queriedAt = "classjob-fixture-time";
  const classJobIds = Object.fromEntries(supportedJobs.map((job, index) => [job, index + 101]));
  const rowIds = Object.values(classJobIds);
  const rows = supportedJobs.map((job, index) => ({
    rowId: classJobIds[job],
    gameVersion,
    timestamp: queriedAt,
    fields: {
      Name: `MCP ${job}`,
      Abbreviation: job,
      PrimaryStat: classJobFixtureByJob[job].primaryStat,
      JobType: classJobFixtureByJob[job].jobType,
      ModifierHitPoints: 100,
      ModifierStrength: 100,
      ModifierVitality: 100,
      ModifierDexterity: 100,
      ModifierIntelligence: 100,
      ModifierMind: 100,
      ModifierPiety: 100,
      IsLimitedJob: job === "BLU" || job === "BST",
      CanWearShield: job === "PLD",
    },
  }));
  return {
    gameVersion,
    validatedVersion: gameVersion,
    queriedAt,
    queryPlan: { classJobIds },
    sourceCapabilityChecks: {
      bluMdmgAdditions: {
        classJob: {
          gameVersion,
          queriedAt,
          rowCount: rows.length,
          fields: [...classJobReturnFields],
        },
      },
    },
    rows: { ClassJob: rows },
    queries: [
      {
        method: "describe_sheet",
        sheet: "ClassJob",
        fields: [...classJobReturnFields],
        returnedRows: rows.length,
        gameVersion,
        queriedAt,
      },
      {
        method: "get_rows",
        sheet: "ClassJob",
        fields: [...classJobReturnFields],
        rowIds,
        returnedRows: rowIds.length,
        gameVersion,
        queriedAt,
      },
    ],
  };
}

test("upstream AST parsing keeps supported schema values and derives restricted materia grades", () => {
  const parsed = parseGameConstants(`
    export const jobLevelModifiers = { 90: 100, 100: 120 } as const;
    export const jobSchemas = { };
    export const materias = { CRT: [1, 2] } as const;
    export const materiaGradeRequiredLevels = [10, 20] as const;
    export const baseStats = { INT: "main" } as const;
    export const clanStats = [{ STR: 1 }] as const;
    for (const grade of [2]) materiaGradeIsRestricted[grade] = true;
  `);

  assert.deepEqual(parsed.jobLevelModifiers, { 90: 100, 100: 120 });
  assert.deepEqual(parsed.jobSchemas, {});
  assert.deepEqual(parsed.materias, { CRT: [1, 2] });
  assert.deepEqual(parsed.materiaGradeRequiredLevels, [10, 20]);
  assert.deepEqual(parsed.materiaGradeIsRestricted, [false, false, true]);
  assert.deepEqual(parsed.baseStats, { INT: "main" });
  assert.deepEqual(parsed.clanStats, [{ STR: 1 }]);
});

test("ClassJob PrimaryStat and JobType validation requires complete same-version source coverage", () => {
  assert.doesNotThrow(() => validateMcpClassJobPrimaryStatInput(makeClassJobPrimaryStatSnapshot()));

  const schemaCases = [
    (snapshot) => { snapshot.queries.shift(); },
    (snapshot) => { snapshot.queries[0].fields = snapshot.queries[0].fields.filter((field) => field !== "PrimaryStat"); },
    (snapshot) => { snapshot.queries[0].fields = snapshot.queries[0].fields.filter((field) => field !== "JobType"); },
    (snapshot) => { snapshot.queries[0].gameVersion = "older-version"; },
    (snapshot) => { delete snapshot.queries[0].queriedAt; },
    (snapshot) => { snapshot.sourceCapabilityChecks.bluMdmgAdditions.classJob.fields = []; },
    (snapshot) => { snapshot.sourceCapabilityChecks.bluMdmgAdditions.classJob.gameVersion = "older-version"; },
    (snapshot) => { snapshot.sourceCapabilityChecks.bluMdmgAdditions.classJob.queriedAt = "other-time"; },
  ];
  for (const mutate of schemaCases) {
    const snapshot = makeClassJobPrimaryStatSnapshot();
    mutate(snapshot);
    assert.throws(() => validateMcpClassJobPrimaryStatInput(snapshot), /ClassJob.*Schema 来源/);
  }

  const queryCases = [
    (snapshot) => { snapshot.queries[1].fields = snapshot.queries[1].fields.filter((field) => field !== "PrimaryStat"); },
    (snapshot) => { snapshot.queries[1].fields = snapshot.queries[1].fields.filter((field) => field !== "JobType"); },
    (snapshot) => { snapshot.queries[1].fields = ["PrimaryStat", "JobType"]; },
    (snapshot) => { snapshot.queries[1].gameVersion = "older-version"; },
    (snapshot) => { delete snapshot.queries[1].queriedAt; },
    (snapshot) => { snapshot.queries[1].rowIds.pop(); snapshot.queries[1].returnedRows--; },
    (snapshot) => { snapshot.queries[1].rowIds[1] = snapshot.queries[1].rowIds[0]; },
    (snapshot) => { snapshot.queries[1].rowIds[0] = 0; },
  ];
  for (const mutate of queryCases) {
    const snapshot = makeClassJobPrimaryStatSnapshot();
    mutate(snapshot);
    assert.throws(() => validateMcpClassJobPrimaryStatInput(snapshot), /ClassJob|PrimaryStat|JobType/);
  }

  const rowCases = [
    (snapshot) => { snapshot.rows.ClassJob[0].gameVersion = "older-version"; },
    (snapshot) => { delete snapshot.rows.ClassJob[0].timestamp; },
    (snapshot) => { snapshot.rows.ClassJob[0].fields.Abbreviation = "WAR"; },
    ...[undefined, 0, 3, 6, -1, 1.5, "1"].map((primaryStat) => (snapshot) => {
      if (primaryStat === undefined) delete snapshot.rows.ClassJob[0].fields.PrimaryStat;
      else snapshot.rows.ClassJob[0].fields.PrimaryStat = primaryStat;
    }),
    ...[undefined, 0, 7, -1, 1.5, Number.NaN, "1"].map((jobType) => (snapshot) => {
      if (jobType === undefined) delete snapshot.rows.ClassJob[0].fields.JobType;
      else snapshot.rows.ClassJob[0].fields.JobType = jobType;
    }),
    (snapshot) => { snapshot.rows.ClassJob[0].fields.PrimaryStat = 2; },
  ];
  for (const mutate of rowCases) {
    const snapshot = makeClassJobPrimaryStatSnapshot();
    mutate(snapshot);
    assert.throws(() => validateMcpClassJobPrimaryStatInput(snapshot), /ClassJob|PrimaryStat/);
  }

  for (const jobType of [undefined, 0, 7, -1, 1.5, Number.NaN, "1"]) {
    const snapshot = makeClassJobPrimaryStatSnapshot();
    if (jobType === undefined) delete snapshot.rows.ClassJob[0].fields.JobType;
    else snapshot.rows.ClassJob[0].fields.JobType = jobType;
    assert.throws(
      () => validateMcpClassJobPrimaryStatInput(snapshot),
      (error) => error.message.includes("PLD") &&
        error.message.includes("101") &&
        error.message.includes("JobType") &&
        error.message.includes(String(jobType)) &&
        error.message.includes("需要定义新的 Type 类型"),
      `ClassJob JobType=${String(jobType)} must fail with row, job, value, and Type guidance`,
    );
  }

  for (const mutate of [
    (snapshot) => { snapshot.queryPlan.classJobIds.PLD = 0; },
    (snapshot) => { snapshot.queryPlan.classJobIds.WAR = snapshot.queryPlan.classJobIds.PLD; },
    (snapshot) => { delete snapshot.queryPlan.classJobIds.PLD; },
  ]) {
    const snapshot = makeClassJobPrimaryStatSnapshot();
    mutate(snapshot);
    assert.throws(() => validateMcpClassJobPrimaryStatInput(snapshot), /ClassJob|rowId/);
  }
});

test("normalized job mainStat and role come from MCP while reference formulas remain", () => {
  const snapshot = makeClassJobPrimaryStatSnapshot();
  assert.deepEqual(Object.keys(classJobFixtureByJob).sort(), [...supportedJobs].sort());
  const rawSchemas = Object.fromEntries(supportedJobs.map((job) => [job, {
    mainStat: "VIT",
    attackStat: "MDMG",
    secondaryStat: "TEN",
    stats: job === "WHM" ? ["TEN"] : job === "SAM" ? ["PIE"] : [],
    statModifiers: { gcd: 100 },
    defaultItemLevel: [700, 790],
    jobLevel: 100,
    slots: [],
    traitDamageMultiplier: 1,
  }]));
  const context = {
    repository: "https://fixture.example.test/reference.git",
    commit: "fixture-commit",
    importedAt: "fixture-import-time",
  };

  const jobSchemas = normalizeJobSchemas(rawSchemas, snapshot, context);

  assert.deepEqual(
    Object.fromEntries(supportedJobs.map((job) => [job, jobSchemas[job].mainStat])),
    Object.fromEntries(supportedJobs.map((job) => [job, classJobFixtureByJob[job].mainStat])),
  );
  assert.deepEqual(
    Object.fromEntries(supportedJobs.map((job) => [job, jobSchemas[job].role])),
    Object.fromEntries(supportedJobs.map((job) => [job, classJobFixtureByJob[job].role])),
  );
  assert.equal(jobSchemas.PLD.mainStat, "STR", "reference VIT must not override MCP PrimaryStat=1");
  assert.equal(jobSchemas.PLD.role, "tank", "MCP Tank remains tank despite reference stats omitting TEN/PIE");
  assert.equal(jobSchemas.WHM.role, "healer", "MCP PureHealer remains healer despite reference TEN stat");
  assert.equal(jobSchemas.SAM.role, "str", "MCP Melee role uses PrimaryStat despite reference PIE stat");
  assert.equal(jobSchemas.BLU.role, "int");
  assert.equal(jobSchemas.BST.role, "str");
  assert.equal(jobSchemas.PLD.secondaryStat, "TEN");
  assert.equal(Object.hasOwn(jobSchemas.PLD, "attackStat"), false);
  const classJobSource = jobSchemas.PLD.dataSources.find((source) => source.kind === "mcp");
  assert.deepEqual(classJobSource.fields, classJobReturnFields);
  assert.deepEqual(classJobSource.rowIds, [snapshot.queryPlan.classJobIds.PLD]);
  assert.match(classJobSource.note, /PrimaryStat 映射至 mainStat/);
  assert.match(classJobSource.note, /JobType 映射至 role/);
});

test("MCP snapshot validation rejects missing ResistanceWeaponAdjust source evidence", () => {
  assert.throws(
    () => validateMcpResistanceWeaponAdjustInput({}),
    /ResistanceWeaponAdjust Schema 与版本来源核验/,
  );
});

test("MCP snapshot validation rejects a cross-version ResistanceWeaponAdjust row", () => {
  const gameVersion = "fixture-version";
  const queryTime = "fixture-time";
  const snapshot = {
    gameVersion,
    sourceCapabilityChecks: {
      resistanceWeaponAdjust: {
        status: "available",
        gameVersion,
        rowCount: 1,
        fields: resistanceWeaponAdjustFields,
        schemaQueriedAt: queryTime,
      },
    },
    queries: [
      {
        method: "describe_sheet",
        sheet: "ResistanceWeaponAdjust",
        gameVersion,
        queriedAt: queryTime,
        fields: resistanceWeaponAdjustFields,
        returnedRows: 1,
      },
      {
        method: "list_rows",
        sheet: "ResistanceWeaponAdjust",
        gameVersion,
        queriedAt: queryTime,
        fields: resistanceWeaponAdjustFields,
        rowIds: [0],
        returnedRows: 1,
      },
    ],
    rows: {
      ResistanceWeaponAdjust: [{
        rowId: 0,
        gameVersion: "older-version",
        timestamp: queryTime,
        fields: Object.fromEntries(resistanceWeaponAdjustFields.map((field) => [field, 0])),
      }],
    },
    missing: { ResistanceWeaponAdjust: [] },
    queryPlan: { resistanceWeaponAdjustItemIds: [], gearItemIds: [] },
  };

  assert.throws(
    () => validateMcpResistanceWeaponAdjustInput(snapshot),
    /MCP ResistanceWeaponAdjust 行包含无效 ID、字段或版本来源/,
  );
});

test("food merge preserves the reference fallback and removes blank-name MCP items", () => {
  const fallbackFood = { id: 101, name: "Reference fallback", stats: { CRT: 10 } };
  const blankNameFood = { id: 202, name: "Old reference name", stats: { DET: 5 } };
  const merged = mergeMcpFoodData([fallbackFood, blankNameFood], {
    rows: {
      Item: [{ rowId: blankNameFood.id, fields: { Name: "   " } }],
    },
  });

  assert.deepEqual(merged.result, [fallbackFood]);
  assert.deepEqual(merged.usedIds, []);
  assert.deepEqual(merged.usedActionIds, []);
  assert.deepEqual(merged.missing, [fallbackFood.id]);
  assert.deepEqual(merged.removed, [blankNameFood.id]);
});

test("reference records keep each explicit import context across interleaved normalization", () => {
  const firstContext = {
    repository: "https://first.example.test/gearing.git",
    commit: "first-commit",
    importedAt: "first-import-time",
  };
  const secondContext = {
    repository: "https://second.example.test/gearing.git",
    commit: "second-commit",
    importedAt: "second-import-time",
  };
  const rawGear = {
    id: 301,
    slot: 4,
    name: "Fixture gear",
    stats: {},
    source: "测试来源",
  };
  const rawFood = {
    id: 302,
    name: "Fixture food",
    level: 700,
    stats: { CRT: 10 },
    statRates: {},
  };

  const firstGear = normalizeGear(rawGear, "data/out/gears-fixture.js", firstContext);
  const secondFood = normalizeFood(rawFood, secondContext);
  const secondGear = normalizeGear(rawGear, "data/out/gears-fixture.js", secondContext);
  const firstFood = normalizeFood(rawFood, firstContext);

  for (const [record, context] of [
    [firstGear, firstContext],
    [secondFood, secondContext],
    [secondGear, secondContext],
    [firstFood, firstContext],
  ]) {
    const [source] = record.dataSources;
    assert.equal(source.repository, context.repository);
    assert.equal(source.commit, context.commit);
    assert.equal(source.importedAt, context.importedAt);
  }
});

test("gear merge uses MCP job categories and four materia parameters, while removing blank names", () => {
  const gameVersion = "fixture-version";
  const itemId = 51001;
  const blankItemId = 51002;
  const categoryId = 7;
  const specialBonusId = 11;
  const queryTime = "fixture-time";
  const materiaIds = [62001, 62002, 62003, 62004];
  const itemFields = {
    Name: "MCP fixture gear",
    LevelItem: 700,
    LevelEquip: 100,
    ClassJobCategory: categoryId,
    EquipSlotCategory: 4,
    MateriaSlotCount: 2,
    SubStatCategory: 2,
    ItemSpecialBonus: specialBonusId,
    ItemSpecialBonusParam: 1,
    CanBeHq: false,
    IsUnique: true,
    "BaseParam[0]": 55,
    "BaseParamValue[0]": 600,
    "BaseParam[1]": 44,
    "BaseParamValue[1]": 200,
  };
  for (let index = 0; index < 6; index++) {
    itemFields[`BaseParamSpecial[${index}]`] = index === 0 ? 27 : 0;
    itemFields[`BaseParamValueSpecial[${index}]`] = index === 0 ? 50 : 0;
  }
  const mandervilleFields = Object.fromEntries(mandervilleReturnFields.map((field) => [field, 0]));
  for (let index = 0; index < materiaIds.length; index++) {
    mandervilleFields[`Materia[${index}]`] = materiaIds[index];
    mandervilleFields[`MateriaBigValueIndex[${index}]`] = 0;
    mandervilleFields[`MateriaSmallValueIndex[${index}]`] = 1;
  }
  const materiaRows = materiaIds.map((id, index) => ({
    rowId: id,
    fields: {
      BaseParam: [27, 44, 22, 45][index],
      "Value[0]": 120 + index,
      "Value[1]": 60 + index,
    },
  }));
  const itemFieldQueries = ["SubStatCategory", "ItemSpecialBonus", "ItemSpecialBonusParam"].map((field) => ({
    method: "get_rows",
    sheet: "Item",
    fields: [field],
    rowIds: [itemId],
    returnedRows: 1,
    gameVersion,
    queriedAt: `${queryTime}-${field}`,
  }));
  const snapshot = {
    gameVersion,
    validatedVersion: gameVersion,
    queriedAt: queryTime,
    rows: {
      Item: [
        { rowId: itemId, gameVersion, timestamp: queryTime, fields: itemFields },
        { rowId: blankItemId, gameVersion, timestamp: queryTime, fields: { Name: "   " } },
      ],
      ClassJobCategory: [{ rowId: categoryId, fields: { PLD: true, WAR: true, SAM: false } }],
      MandervilleWeaponEnhance: [{ rowId: itemId, fields: mandervilleFields }],
      Materia: materiaRows,
      ItemSpecialBonus: [{ rowId: specialBonusId, fields: { Name: "Fixture bonus", RequirementText: "Fixture" } }],
    },
    queries: [
      ...itemFieldQueries,
      {
        method: "get_rows",
        sheet: "ItemSpecialBonus",
        fields: ["Name", "RequirementText"],
        rowIds: [specialBonusId],
        returnedRows: 1,
        gameVersion,
        queriedAt: queryTime,
      },
    ],
  };
  const referenceGear = {
    id: itemId,
    name: "Reference gear name",
    slot: "body",
    stats: {},
    materiaSlots: 2,
    customizable: true,
    sourceFile: "data/out/gears-fixture.js",
    dataSources: [{ kind: "reference", repository: "fixture", commit: "fixture", importedAt: "fixture", sourceFiles: ["data/out/gears-fixture.js"] }],
  };
  const blankNameGear = { ...referenceGear, id: blankItemId, customizable: false };

  const merged = mergeMcpGearData([referenceGear, blankNameGear], snapshot, {
    PLD: { mainStat: "STR" },
    WAR: { mainStat: "STR" },
  });

  assert.deepEqual(merged.usedIds, [itemId]);
  assert.deepEqual(merged.missing, []);
  assert.deepEqual(merged.removed, [blankItemId]);
  assert.equal(merged.result.length, 1);
  assert.deepEqual(merged.result[0].jobs, ["PLD", "WAR"]);
  assert.equal(merged.result[0].customizable, true);
  assert.deepEqual(merged.result[0].customParameters.map(({ materiaId }) => materiaId), materiaIds);
  assert.equal(merged.result[0].itemSpecialBonus, specialBonusId);
  assert.ok(merged.result[0].dataSources.some((source) => source.sheet === "ItemSpecialBonus"));
});
