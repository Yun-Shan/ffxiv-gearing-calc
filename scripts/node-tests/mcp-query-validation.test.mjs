import { test } from "node:test";
import assert from "node:assert/strict";
import { allowsGenericQueries, acceptsVersionWarning } from "../mcp-query-validation.mjs";
import { normalizeMcpGearRow, itemReturnFields } from "../mcp-lumina-import.mjs";

test("通用查询仅接受有明确可用性声明的版本滞后", () => {
  const healthy = { status: "ok", gameVersion: "a", validatedVersion: "a", schemaAvailable: true };
  const warning = { code: "GameVersionMismatch", message: "Generic tools (get_row, search_rows, etc.) are unaffected." };
  assert.equal(allowsGenericQueries(healthy), true);
  assert.equal(allowsGenericQueries({ ...healthy, validatedVersion: "b" }), false);
  assert.equal(allowsGenericQueries({ ...healthy, status: "degraded", validatedVersion: "b", warnings: [warning] }), true);
  assert.equal(allowsGenericQueries({ ...healthy, status: "degraded", warnings: [warning, { code: "BrokenSchema" }] }), false);
  assert.equal(allowsGenericQueries({ ...healthy, schemaAvailable: false }), false);
  assert.equal(allowsGenericQueries(undefined), false);
  assert.equal(acceptsVersionWarning([]), false);
  assert.equal(acceptsVersionWarning([{ code: "GameVersionMismatch", message: "unknown" }]), false);
});

test("装备唯一性保留真实布尔值，查询字段含 IsUnique", () => {
  const fields = { Name: "测试装备", LevelItem: 1, LevelEquip: 1, ClassJobCategory: 1, EquipSlotCategory: 12, MateriaSlotCount: 0, SubStatCategory: 0 };
  const fallback = { stats: {}, jobCategory: 1 };
  const category = { fields: { SAM: true } };
  assert.equal(itemReturnFields.includes("IsUnique"), true);
  assert.equal(normalizeMcpGearRow({ fields: { ...fields, IsUnique: false } }, fallback, category).unique, false);
  assert.equal(normalizeMcpGearRow({ fields: { ...fields, IsUnique: true } }, fallback, category).unique, true);
  assert.equal(normalizeMcpGearRow({ fields }, fallback, category).unique, undefined);
});

test("刷新后的职业分类行会将 BST 标记为可穿戴职业", () => {
  const item = {
    fields: {
      Name: "参考测试装备",
      LevelItem: 130,
      LevelEquip: 50,
      ClassJobCategory: 30,
      EquipSlotCategory: 4,
      MateriaSlotCount: 2,
      SubStatCategory: 0,
    },
  };
  const normalized = normalizeMcpGearRow(
    item,
    { slot: "body", stats: {}, jobCategory: 30 },
    { rowId: 30, fields: { BST: true } },
  );

  assert.deepEqual(normalized.jobs, ["BST"]);
});

test("仅 Item.SubStatCategory 为 2 的装备标记为可变穿戴等级", () => {
  const fallback = { slot: "body", stats: {}, jobCategory: 30, equipLevelVariable: true };
  const category = { rowId: 30, fields: { SAM: true } };
  const item = (SubStatCategory) => ({ rowId: 123, fields: {
    Name: "查询装备", LevelItem: 130, LevelEquip: 50, ClassJobCategory: 30,
    EquipSlotCategory: 4, MateriaSlotCount: 2, SubStatCategory,
  } });

  assert.equal(itemReturnFields.includes("SubStatCategory"), true);
  assert.equal(normalizeMcpGearRow(item(2), fallback, category).equipLevelVariable, true);
  assert.equal(normalizeMcpGearRow(item(0), fallback, category).equipLevelVariable, undefined);
  assert.equal(normalizeMcpGearRow(item(1), fallback, category).equipLevelVariable, undefined);
  assert.throws(
    () => normalizeMcpGearRow({ ...item(2), fields: { ...item(2).fields, SubStatCategory: undefined } }, fallback, category),
    /SubStatCategory/,
  );
});

test("Item BaseParam 55/56 保留为按职业解析的 main/secondary 属性", () => {
  const item = {
    rowId: 52439,
    fields: {
      Name: "哈罗妮耳坠", LevelItem: 690, LevelEquip: 1,
      ClassJobCategory: 1, EquipSlotCategory: 9, MateriaSlotCount: 0,
      SubStatCategory: 2,
      "BaseParam[0]": 55, "BaseParamValue[0]": 212,
      "BaseParam[1]": 3, "BaseParamValue[1]": 214,
      "BaseParam[2]": 56, "BaseParamValue[2]": 162,
      "BaseParam[3]": 44, "BaseParamValue[3]": 162,
    },
  };
  const normalized = normalizeMcpGearRow(
    item,
    { slot: "earrings", stats: {}, jobCategory: 1 },
    { fields: { SAM: true } },
  );
  assert.deepEqual(normalized.stats, {
    main: 212, VIT: 214, secondary: 162, DET: 162,
  });
  assert.equal(normalized.equipLevelVariable, true);
});
