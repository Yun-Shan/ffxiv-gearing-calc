import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemReturnFields,
  normalizeMcpFoodRows,
  normalizeMcpGearRow,
  normalizeMcpItemName,
} from "../mcp-lumina-import.mjs";

const snapshot = JSON.parse(
  readFileSync(new URL("../../src/data/mcp-lumina.snapshot.json", import.meta.url), "utf8"),
);
const itemRow = snapshot.rows.Item.find((row) => row.rowId === 33146);
assert.ok(itemRow, "the reproducible MCP snapshot must contain Item 33146");
const categoryRow = snapshot.rows.ClassJobCategory.find(
  (row) => row.rowId === itemRow.fields.ClassJobCategory,
);
assert.ok(categoryRow, "the MCP snapshot must contain the item's job category");

// The reference fallback carries no PDMG/MDMG primary-stat hint.
const fallback = {
  id: 900001,
  slot: "weapon",
  rawSlot: 1,
  jobCategory: 1,
  stats: {},
};
// Unit-test-only named row derived from the MCP source's confirmed native zero
// values. Production Item 33146 itself is removed because its Name is blank.
const syntheticNamedZeroWeaponRow = {
  ...itemRow,
  rowId: fallback.id,
  fields: { ...itemRow.fields, Name: "合成零伤害测试武器" },
};

test("blank-name MCP Item 33146 is excluded from gear and food normalization", () => {
  assert.equal(itemRow.fields.Name, "");
  assert.equal(normalizeMcpItemName(itemRow), undefined);
  assert.equal(normalizeMcpGearRow(itemRow, { ...fallback, id: 33146 }, categoryRow), undefined);
  assert.equal(normalizeMcpFoodRows(itemRow, undefined, {}, {}), undefined);
  const whitespaceNameRow = {
    ...syntheticNamedZeroWeaponRow,
    fields: { ...syntheticNamedZeroWeaponRow.fields, Name: " \t " },
  };
  assert.equal(normalizeMcpGearRow(whitespaceNameRow, fallback, categoryRow), undefined);
  assert.equal(normalizeMcpFoodRows(whitespaceNameRow, undefined, {}, {}), undefined);
});

test("weapon normalization preserves confirmed zero damage in an isolated synthetic fixture", () => {
  for (const field of ["DamagePhys", "DamageMag", "Delayms"])
    assert.ok(itemReturnFields.includes(field), `MCP Item query requests ${field}`);
  assert.equal(itemRow.fields.DamagePhys, 0);
  assert.equal(itemRow.fields.DamageMag, 0);
  assert.equal(itemRow.fields.Delayms, 2240);

  const normalized = normalizeMcpGearRow(syntheticNamedZeroWeaponRow, fallback, categoryRow);
  assert.equal(normalized.stats.PDMG, 0);
  assert.equal(normalized.stats.MDMG, 0);
  assert.equal(normalized.stats.DLY, 2240);
  assert.equal(normalized.weaponDamage, 0);
});

test("weapon normalization retains an explicitly selected zero primary damage stat", () => {
  const normalized = normalizeMcpGearRow(
    syntheticNamedZeroWeaponRow,
    { ...fallback, stats: { PDMG: 9 } },
    categoryRow,
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
    const fields = { ...syntheticNamedZeroWeaponRow.fields };
    mutate(fields);
    assert.throws(
      () => normalizeMcpGearRow({ ...syntheticNamedZeroWeaponRow, fields }, fallback, categoryRow),
      /必须是非负安全整数/,
      label,
    );
  }
});

test("Item rows with a missing Name field fail explicitly", () => {
  const fields = { ...syntheticNamedZeroWeaponRow.fields };
  delete fields.Name;
  const malformedRow = { ...syntheticNamedZeroWeaponRow, fields };
  assert.throws(
    () => normalizeMcpGearRow(malformedRow, fallback, categoryRow),
    /缺少有效 Name 字段/,
  );
  assert.throws(
    () => normalizeMcpFoodRows(malformedRow, undefined, {}, {}),
    /缺少有效 Name 字段/,
  );
});

test("present Item rows with missing fields or a non-string Name fail explicitly", () => {
  assert.equal(normalizeMcpGearRow(undefined, fallback, categoryRow), undefined);
  assert.equal(normalizeMcpFoodRows(undefined, undefined, {}, {}), undefined);

  const malformedRows = [
    ["missing fields", { ...syntheticNamedZeroWeaponRow, fields: undefined }],
    ["null fields", { ...syntheticNamedZeroWeaponRow, fields: null }],
    ["non-string Name", {
      ...syntheticNamedZeroWeaponRow,
      fields: { ...syntheticNamedZeroWeaponRow.fields, Name: 33146 },
    }],
  ];
  for (const [label, row] of malformedRows) {
    assert.throws(
      () => normalizeMcpGearRow(row, fallback, categoryRow),
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
