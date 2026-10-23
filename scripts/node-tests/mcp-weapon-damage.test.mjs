import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemReturnFields,
  normalizeMcpFoodRows,
  normalizeMcpGearRow,
  normalizeMcpItemName,
} from "../mcp-lumina-import.mjs";

// Regression vector copied from the ffxiv-mcp-lumina Item 33146 row for game
// version 2026.09.15.0000.0000. Its empty Name means production excludes it;
// the renamed copy below isolates native zero-damage normalization behavior.
const itemRow = {
  sheet: "Item",
  rowId: 33146,
  gameVersion: "2026.09.15.0000.0000",
  timestamp: "2026-10-23T03:46:22.5414337+00:00",
  fields: {
    Name: "",
    DamagePhys: 0,
    DamageMag: 0,
    Delayms: 2240,
    LevelEquip: 1,
    ClassJobCategory: 1,
    "BaseParam[0]": 1,
    "BaseParam[1]": 3,
    "BaseParam[2]": 0,
    "BaseParam[3]": 0,
    "BaseParam[4]": 0,
    "BaseParam[5]": 0,
    "BaseParamValue[0]": 0,
    "BaseParamValue[1]": 0,
    "BaseParamValue[2]": 0,
    "BaseParamValue[3]": 0,
    "BaseParamValue[4]": 0,
    "BaseParamValue[5]": 0,
    ItemSpecialBonus: 0,
    ItemSpecialBonusParam: 0,
    CanBeHq: false,
    MateriaSlotCount: 0,
    SubStatCategory: 0,
    LevelItem: 1,
    EquipSlotCategory: 1,
  },
};
const categoryRow = {
  sheet: "ClassJobCategory",
  rowId: 1,
  gameVersion: itemRow.gameVersion,
  timestamp: "2026-10-23T03:46:22.7376978+00:00",
  fields: { PLD: true },
};
const fallback = {
  id: 900001,
  slot: "weapon",
  rawSlot: 1,
  jobCategory: 1,
  stats: {},
};
const jobSchemas = { PLD: { mainStat: "STR" } };
const normalizeOptions = { jobSchemas };
const namedZeroDamageFixture = {
  ...itemRow,
  rowId: fallback.id,
  fields: { ...itemRow.fields, Name: "隔离的零伤害测试武器" },
};

test("blank-name MCP Item 33146 is excluded from gear and food normalization", () => {
  assert.equal(itemRow.fields.Name, "");
  assert.equal(normalizeMcpItemName(itemRow), undefined);
  assert.equal(normalizeMcpGearRow(itemRow, { ...fallback, id: 33146 }, categoryRow, normalizeOptions), undefined);
  assert.equal(normalizeMcpFoodRows(itemRow, undefined, {}, {}), undefined);
  const whitespaceNameRow = {
    ...namedZeroDamageFixture,
    fields: { ...namedZeroDamageFixture.fields, Name: " \t " },
  };
  assert.equal(normalizeMcpGearRow(whitespaceNameRow, fallback, categoryRow, normalizeOptions), undefined);
  assert.equal(normalizeMcpFoodRows(whitespaceNameRow, undefined, {}, {}), undefined);
});

test("weapon normalization preserves selected native zero damage in an isolated fixture", () => {
  for (const field of ["DamagePhys", "DamageMag", "Delayms"])
    assert.ok(itemReturnFields.includes(field), `MCP Item query requests ${field}`);
  assert.equal(itemRow.fields.DamagePhys, 0);
  assert.equal(itemRow.fields.DamageMag, 0);
  assert.equal(itemRow.fields.Delayms, 2240);

  const normalized = normalizeMcpGearRow(namedZeroDamageFixture, fallback, categoryRow, normalizeOptions);
  assert.equal(normalized.stats.PDMG, 0);
  assert.equal(normalized.stats.MDMG, undefined);
  assert.equal(normalized.stats.DLY, 2240);
  assert.equal(normalized.weaponDamage, 0);
});

test("weapon normalization retains an explicitly selected zero primary damage stat", () => {
  const normalized = normalizeMcpGearRow(
    namedZeroDamageFixture,
    { ...fallback, stats: { MDMG: 9 } },
    categoryRow,
    normalizeOptions,
  );
  assert.equal(normalized.stats.PDMG, 0);
  assert.equal(normalized.weaponDamage, 0);
});

test("weapon normalization rejects absent, malformed, or negative native fields", () => {
  const malformedRows = [
    ["missing DamagePhys", (fields) => delete fields.DamagePhys],
    ["string DamageMag", (fields) => { fields.DamageMag = "0"; }],
    ["fractional Delayms", (fields) => { fields.Delayms = 2240.5; }],
    ["negative DamagePhys", (fields) => { fields.DamagePhys = -1; }],
  ];
  for (const [label, mutate] of malformedRows) {
    const fields = { ...namedZeroDamageFixture.fields };
    mutate(fields);
    assert.throws(
      () => normalizeMcpGearRow({ ...namedZeroDamageFixture, fields }, fallback, categoryRow, normalizeOptions),
      /必须是非负安全整数/,
      label,
    );
  }
});

test("Item rows with a missing Name field fail explicitly", () => {
  const fields = { ...namedZeroDamageFixture.fields };
  delete fields.Name;
  const malformedRow = { ...namedZeroDamageFixture, fields };
  assert.throws(
    () => normalizeMcpGearRow(malformedRow, fallback, categoryRow, normalizeOptions),
    /缺少有效 Name 字段/,
  );
  assert.throws(
    () => normalizeMcpFoodRows(malformedRow, undefined, {}, {}),
    /缺少有效 Name 字段/,
  );
});

test("present Item rows with missing fields or a non-string Name fail explicitly", () => {
  assert.equal(normalizeMcpGearRow(undefined, fallback, categoryRow, normalizeOptions), undefined);
  assert.equal(normalizeMcpFoodRows(undefined, undefined, {}, {}), undefined);

  const malformedRows = [
    ["missing fields", { ...namedZeroDamageFixture, fields: undefined }],
    ["null fields", { ...namedZeroDamageFixture, fields: null }],
    ["non-string Name", {
      ...namedZeroDamageFixture,
      fields: { ...namedZeroDamageFixture.fields, Name: 33146 },
    }],
  ];
  for (const [label, row] of malformedRows) {
    assert.throws(
      () => normalizeMcpGearRow(row, fallback, categoryRow, normalizeOptions),
      /缺少 ?(?:fields|有效 Name 字段)/,
      label,
    );
    assert.throws(
      () => normalizeMcpFoodRows(row, undefined, {}, {}),
      /缺少 ?(?:fields|有效 Name 字段)/,
      label,
    );
  }
});
