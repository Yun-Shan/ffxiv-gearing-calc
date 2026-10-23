import assert from "node:assert/strict";
import { test } from "node:test";
import { syncDataFromSnapshot } from "../sync-level-duties.mjs";

const version = "fixture-version";
const cfcFields = [
  "Name", "ItemLevelSync", "ClassJobLevelSync", "JournalGenre", "ContentType",
  "ContentUICategory", "HighEndDuty", "AllowUndersized", "ContentLinkType",
];
const caps = { level: [90, 100, 120, 130, 250, 260, 270, 300, 310, 350, 400] };
for (const stat of ["STR", "DEX", "VIT", "INT", "MND", "PIE", "GP", "CP", "PDMG", "MDMG", "TEN", "DHT", "CRT", "DET", "SKS", "SPS", "CMS", "CRL", "GTH", "PCP"])
  caps[stat] = caps.level.map(() => 1);

const makeRow = (rowId, fields) => ({ rowId, fields, gameVersion: version, timestamp: "fixture-time" });
const duty = (rowId, name, overrides = {}) => makeRow(rowId, {
  Name: name,
  ItemLevelSync: 0,
  ClassJobLevelSync: 50,
  JournalGenre: 1,
  ContentType: 1,
  ContentUICategory: 0,
  HighEndDuty: false,
  AllowUndersized: false,
  ContentLinkType: 0,
  ...overrides,
});

function makeSnapshot() {
  const contentTypes = [
    makeRow(1, { Name: "讨伐歼灭战" }),
    makeRow(2, { Name: "大型任务" }),
    makeRow(3, { Name: "特殊迷宫探索" }),
    makeRow(4, { Name: "绝境战" }),
    makeRow(5, { Name: "●XBM" }),
    makeRow(6, { Name: "优雷卡内容" }),
    makeRow(7, { Name: "诛灭战" }),
  ];
  const uiCategories = [
    makeRow(0, { Name: "一般" }),
    makeRow(1, { Name: "高难度任务" }),
    makeRow(2, { Name: "大型任务：零式" }),
    makeRow(3, { Name: "幻巧任务" }),
  ];
  const contentRows = [
    duty(1, "普通讨伐", { ItemLevelSync: 130, ContentType: 1 }),
    duty(2, "高难讨伐", { ItemLevelSync: 100, ContentType: 1, ContentUICategory: 1, HighEndDuty: true, AllowUndersized: true }),
    duty(3, "幻巧讨伐", { ItemLevelSync: 120, ContentType: 1, ContentUICategory: 3 }),
    duty(4, "低于支持下限", { ItemLevelSync: 89, ContentType: 1, ContentUICategory: 1, HighEndDuty: true }),
    duty(5, "Level Sync Trial A", { ContentType: 1, HighEndDuty: true }),
    duty(6, "Level Sync Trial B", { ContentType: 1, HighEndDuty: true }),
    duty(7, "Level Sync Trial C", { ClassJobLevelSync: 60, ContentType: 1, HighEndDuty: true }),
    duty(10, "Arcadion Savage A", { ItemLevelSync: 250, ClassJobLevelSync: 60, ContentType: 2, ContentUICategory: 2 }),
    duty(11, "Arcadion Savage B", { ItemLevelSync: 250, ClassJobLevelSync: 60, ContentType: 2, ContentUICategory: 2 }),
    duty(12, "Arcadion Savage C", { ItemLevelSync: 260, ClassJobLevelSync: 60, ContentType: 2, ContentUICategory: 2 }),
    duty(13, "Another Savage", { ItemLevelSync: 250, ClassJobLevelSync: 60, ContentType: 2, ContentUICategory: 2 }),
    duty(14, "Ordinary raid", { ItemLevelSync: 250, ClassJobLevelSync: 60, ContentType: 2 }),
    duty(20, "Criterion First", { ItemLevelSync: 250, ClassJobLevelSync: 60, ContentType: 3 }),
    duty(21, "Criterion Second", { ItemLevelSync: 250, ClassJobLevelSync: 60, ContentType: 3 }),
    duty(22, "Criterion Undersized", { ItemLevelSync: 250, ClassJobLevelSync: 60, ContentType: 3, AllowUndersized: true }),
    duty(30, "Eureka first instance", { ItemLevelSync: 300, ClassJobLevelSync: 70, ContentType: 6, ContentLinkType: 3 }),
    duty(31, "Eureka second instance", { ItemLevelSync: 300, ClassJobLevelSync: 70, ContentType: 6, ContentLinkType: 3 }),
    duty(32, "Eureka another sync", { ItemLevelSync: 310, ClassJobLevelSync: 70, ContentType: 6, ContentLinkType: 3 }),
    duty(33, "Bozja instance", { ItemLevelSync: 300, ClassJobLevelSync: 70, ContentType: 7, ContentLinkType: 3, AllowUndersized: true }),
    duty(40, "Ultimate", { ClassJobLevelSync: 70, ContentType: 4 }),
    duty(41, "Beastmaster", { ItemLevelSync: 120, ContentType: 5 }),
    duty(42, "An unsupported level", { ItemLevelSync: 180, ClassJobLevelSync: 55, ContentType: 1, HighEndDuty: true }),
    duty(43, "No journal genre", { ItemLevelSync: 180, ContentType: 1, HighEndDuty: true, JournalGenre: 0 }),
    duty(44, "Doom", { ItemLevelSync: 310, ClassJobLevelSync: 70, ContentType: 7 }),
  ];
  const paramRows = [
    makeRow(0, { ItemLevelSync: 0 }),
    makeRow(50, { ItemLevelSync: 130 }),
    makeRow(60, { ItemLevelSync: 270 }),
    makeRow(70, { ItemLevelSync: 400 }),
  ];
  const rowSets = {
    ContentFinderCondition: { rows: contentRows, fields: cfcFields },
    ContentType: { rows: contentTypes, fields: ["Name"] },
    ContentUICategory: { rows: uiCategories, fields: ["Name"] },
    ParamGrow: { rows: paramRows, fields: ["ItemLevelSync"] },
  };
  const queries = [];
  const descriptions = {};
  for (const [sheet, { rows, fields }] of Object.entries(rowSets)) {
    queries.push({
      method: "list_rows", sheet, limit: -1, fields,
      rowIds: rows.map((row) => row.rowId), returnedRows: rows.length,
      gameVersion: version, queriedAt: "fixture-time",
    });
    descriptions[sheet] = {
      rowCount: rows.length, fields, gameVersion: version, queriedAt: "fixture-time",
    };
  }
  return {
    schemaVersion: 1,
    server: "ffxiv-mcp-lumina",
    gameVersion: version,
    rows: Object.fromEntries(Object.entries(rowSets).map(([sheet, value]) => [sheet, value.rows])),
    queries,
    missing: { ParamGrow: [] },
    sourceCapabilityChecks: {
      syncLevels: {
        gameVersion: version,
        contentFinderCondition: descriptions.ContentFinderCondition,
        contentType: descriptions.ContentType,
        contentUICategory: descriptions.ContentUICategory,
        paramGrow: descriptions.ParamGrow,
      },
    },
  };
}

test("sync projection derives thresholds and filters, merges, groups, and sorts duties from complete MCP rows", () => {
  const snapshot = makeSnapshot();
  snapshot.rows.ContentFinderCondition.reverse();
  const generated = syncDataFromSnapshot(snapshot, caps, [50, 60, 70]);
  assert.deepEqual(generated.levels, [
    { jobLevel: 50, minItemLevel: 90, defaultItemLevel: 130 },
    { jobLevel: 60, minItemLevel: 250, defaultItemLevel: 270 },
    { jobLevel: 70, minItemLevel: 300, defaultItemLevel: 400 },
  ]);
  assert.deepEqual(generated.groups.map((group) => group.name), [
    "讨伐歼灭战", "大型任务", "绝境战", "特殊迷宫探索", "特殊场景探索", "斗兽奇弈", "诛灭战",
  ]);
  const trials = generated.groups[0].options;
  assert.equal(trials.some((option) => option.name === "普通讨伐"), false);
  assert.equal(trials.some((option) => option.name === "低于支持下限"), false);
  assert.equal(trials.some((option) => option.name === "高难讨伐"), true);
  assert.deepEqual(trials.find((option) => option.name === "Ultimate"), undefined);
  assert.deepEqual(trials.map((option) => [option.name, option.target.kind, option.target.value]), [
    ["60级极神", "jobLevel", 60],
    ["50级极神", "jobLevel", 50],
    ["幻巧讨伐", "itemLevel", 120],
    ["高难讨伐", "itemLevel", 100],
  ]);
  const raids = generated.groups.find((group) => group.name === "大型任务").options;
  assert.deepEqual(raids.map((option) => [option.name, option.target.value]), [
    ["Another", 250], ["Arcadion", 260], ["Arcadion", 250],
  ]);
  assert.deepEqual(generated.groups.find((group) => group.name === "特殊迷宫探索").options, [
    { name: "Criterion Second", target: { kind: "itemLevel", value: 250 } },
    { name: "Criterion First", target: { kind: "itemLevel", value: 250 } },
  ]);
  const exploratory = generated.groups.find((group) => group.name === "特殊场景探索").options;
  assert.deepEqual(exploratory.map((option) => [option.name, option.target.value]), [
    ["诛灭战", 300], ["优雷卡内容", 310], ["优雷卡内容", 300],
  ]);
  assert.equal(exploratory.some((option) => option.name.includes("instance")), false);
  assert.deepEqual(generated.groups.find((group) => group.name === "绝境战").options[0], {
    name: "Ultimate", target: { kind: "jobLevel", value: 70 },
  });
  assert.deepEqual(generated.groups.find((group) => group.name === "斗兽奇弈").options[0], {
    name: "Beastmaster", target: { kind: "itemLevel", value: 120 },
  });
});

test("special dungeons merge leading savage names only for identical targets and retain their highest row order", () => {
  const snapshot = makeSnapshot();
  const extraRows = [
    duty(101, "异闻甲", { ContentType: 3, ClassJobLevelSync: 60, ItemLevelSync: 250 }),
    duty(102, "零式异闻甲", { ContentType: 3, ClassJobLevelSync: 60, ItemLevelSync: 250 }),
    duty(103, "异闻乙", { ContentType: 3, ClassJobLevelSync: 60, ItemLevelSync: 250 }),
    duty(104, "零式异闻甲", { ContentType: 3, ClassJobLevelSync: 60, ItemLevelSync: 260 }),
    duty(105, "异闻 丙", { ContentType: 3, ClassJobLevelSync: 60, ItemLevelSync: 250 }),
    duty(106, "零式异闻 丙", { ContentType: 3, ClassJobLevelSync: 60, ItemLevelSync: 250 }),
    duty(107, "零式异闻丁", { ContentType: 3, ClassJobLevelSync: 60, ItemLevelSync: 250 }),
    duty(108, "异闻甲", { ContentType: 3, ClassJobLevelSync: 60 }),
  ];
  snapshot.rows.ContentFinderCondition.push(...extraRows);
  const query = snapshot.queries.find(({ sheet }) => sheet === "ContentFinderCondition");
  query.rowIds.push(...extraRows.map(({ rowId }) => rowId));
  query.returnedRows += extraRows.length;
  snapshot.sourceCapabilityChecks.syncLevels.contentFinderCondition.rowCount += extraRows.length;

  const project = () => syncDataFromSnapshot(snapshot, caps, [50, 60, 70])
    .groups.find(({ name }) => name === "特殊迷宫探索").options;
  const expected = [
    { name: "异闻甲", target: { kind: "jobLevel", value: 60 } },
    { name: "(零式)异闻丁", target: { kind: "itemLevel", value: 250 } },
    { name: "(零式)异闻 丙", target: { kind: "itemLevel", value: 250 } },
    { name: "(零式)异闻甲", target: { kind: "itemLevel", value: 260 } },
    { name: "异闻乙", target: { kind: "itemLevel", value: 250 } },
    { name: "(零式)异闻甲", target: { kind: "itemLevel", value: 250 } },
    { name: "Criterion Second", target: { kind: "itemLevel", value: 250 } },
    { name: "Criterion First", target: { kind: "itemLevel", value: 250 } },
  ];
  assert.deepEqual(project(), expected);
  snapshot.rows.ContentFinderCondition.reverse();
  assert.deepEqual(project(), expected);
});

test("sync projection rejects incomplete sources, cross-level ambiguity, and conflicting owners", () => {
  const invalidMutations = [
    (snapshot) => { delete snapshot.rows.ContentFinderCondition[0].fields.Name; },
    (snapshot) => { snapshot.rows.ContentFinderCondition[0].fields.ContentType = 999; },
    (snapshot) => { snapshot.rows.ContentFinderCondition[1].rowId = snapshot.rows.ContentFinderCondition[0].rowId; },
    (snapshot) => { snapshot.rows.ContentUICategory.pop(); },
    (snapshot) => { snapshot.queries.find((query) => query.sheet === "ContentFinderCondition").fields = ["ItemLevelSync"]; },
    (snapshot) => { snapshot.rows.ParamGrow[0].gameVersion = "other-version"; },
  ];
  for (const mutate of invalidMutations) {
    const snapshot = makeSnapshot();
    mutate(snapshot);
    assert.throws(() => syncDataFromSnapshot(snapshot, caps, [50, 60, 70]));
  }

  const conflictingOwner = makeSnapshot();
  conflictingOwner.rows.ContentFinderCondition.push(
    duty(99, "Conflicting owner", { ItemLevelSync: 250, ClassJobLevelSync: 70, ContentType: 1, HighEndDuty: true }),
  );
  conflictingOwner.queries.find((query) => query.sheet === "ContentFinderCondition").rowIds.push(99);
  conflictingOwner.queries.find((query) => query.sheet === "ContentFinderCondition").returnedRows++;
  conflictingOwner.sourceCapabilityChecks.syncLevels.contentFinderCondition.rowCount++;
  assert.throws(() => syncDataFromSnapshot(conflictingOwner, caps, [50, 60, 70]), /同时归属/);

  const overlappingOwner = makeSnapshot();
  overlappingOwner.rows.ContentFinderCondition.push(
    duty(100, "Ambiguous range", { ItemLevelSync: 350, ClassJobLevelSync: 50, ContentType: 1, HighEndDuty: true }),
  );
  overlappingOwner.queries.find((query) => query.sheet === "ContentFinderCondition").rowIds.push(100);
  overlappingOwner.queries.find((query) => query.sheet === "ContentFinderCondition").returnedRows++;
  overlappingOwner.sourceCapabilityChecks.syncLevels.contentFinderCondition.rowCount++;
  assert.throws(() => syncDataFromSnapshot(overlappingOwner, caps, [50, 60, 70]), /观测等级/);
});
