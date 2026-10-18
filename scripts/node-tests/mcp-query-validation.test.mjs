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
  const fields = { Name: "测试装备", LevelItem: 1, LevelEquip: 1, ClassJobCategory: 1, EquipSlotCategory: 12, MateriaSlotCount: 0, SubStatCategory: 0, ItemSpecialBonus: 0, ItemSpecialBonusParam: 0 };
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
      ItemSpecialBonus: 0,
      ItemSpecialBonusParam: 0,
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
    ItemSpecialBonus: 0, ItemSpecialBonusParam: 0,
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
      ItemSpecialBonus: 0,
      ItemSpecialBonusParam: 0,
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

test("supported ItemSpecialBonus stores HQ Special attributes separately from base gear stats", () => {
  const item = {
    rowId: 1234,
    fields: {
      Name: "特殊效果测试装备", LevelItem: 130, LevelEquip: 50,
      ClassJobCategory: 30, EquipSlotCategory: 4, MateriaSlotCount: 2,
      SubStatCategory: 0, ItemSpecialBonus: 11, ItemSpecialBonusParam: 64,
      "BaseParam[0]": 55, "BaseParamValue[0]": 100,
      "BaseParamSpecial[0]": 56, "BaseParamValueSpecial[0]": 20,
      "BaseParamSpecial[1]": 44, "BaseParamValueSpecial[1]": 30,
      "BaseParamSpecial[2]": 0, "BaseParamValueSpecial[2]": 0,
      "BaseParamSpecial[3]": 0, "BaseParamValueSpecial[3]": 0,
      "BaseParamSpecial[4]": 0, "BaseParamValueSpecial[4]": 0,
      "BaseParamSpecial[5]": 0, "BaseParamValueSpecial[5]": 0,
    },
  };
  const normalized = normalizeMcpGearRow(
    item,
    { slot: "body", stats: {}, jobCategory: 30 },
    { fields: { BST: true } },
  );
  assert.ok(itemReturnFields.includes("ItemSpecialBonus"));
  assert.ok(itemReturnFields.includes("ItemSpecialBonusParam"));
  assert.equal(normalized.itemSpecialBonus, 11);
  assert.equal(normalized.itemSpecialBonusParam, 64);
  assert.deepEqual(normalized.specialStats, { secondary: 20, DET: 30 });
  assert.deepEqual(normalizeMcpGearRow(
    item,
    { slot: "body", stats: {}, jobCategory: 30 },
    { fields: { BST: true } },
    { hq: true },
  ).stats, { main: 100 });
});

test("Item special-bonus id and parameter are required even when no supported effect is present", () => {
  const item = {
    rowId: 1235,
    fields: {
      Name: "普通装备", LevelItem: 130, LevelEquip: 50,
      ClassJobCategory: 30, EquipSlotCategory: 4, MateriaSlotCount: 2,
      SubStatCategory: 0, ItemSpecialBonus: 0,
    },
  };
  assert.throws(
    () => normalizeMcpGearRow(item, { slot: "body", stats: {}, jobCategory: 30 }, { fields: { BST: true } }),
    /ItemSpecialBonusParam/,
  );
});
