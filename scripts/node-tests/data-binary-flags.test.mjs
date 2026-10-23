import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeGeneratedData, decodeGeneratedData } from "../../src/data/binary-format.mjs";

// Isolated codec fixtures; these objects are never imported by production code.
const levelCapStats = [
  "STR", "DEX", "VIT", "INT", "MND", "PIE", "GP", "CP", "PDMG", "MDMG",
  "TEN", "DHT", "CRT", "DET", "SKS", "SPS", "CMS", "CRL", "GTH", "PCP",
];
const levelCaps = Object.fromEntries([
  ["level", [90, 130]],
  ...levelCapStats.map((stat) => [stat, [1, 1]]),
]);
const gear = {
  id: 1, name: "codec fixture", slot: "body", rawSlot: 4,
  icon: 45678,
  level: 1, equipLevel: 1, roleId: 1, jobCategory: 1,
  stats: { STR: 1, main: 2, secondary: 3 }, materiaSlots: 0, jobs: ["SAM"],
  sourceFile: "codec fixture", dataSources: [{ kind: "test" }],
};
const payloadFor = (flags) => ({
  version: "2026.10.06.0000.0000",
  provenance: { repository: "fixture", commit: "fixture", importedAt: "fixture", sourceFiles: [] },
  jobSchemas: { SAM: { id: "SAM", name: "武士", mainStat: "STR" } },
  jobs: { SAM: { id: 34, name: "武士", abbreviation: "SAM" } },
  foods: [{ id: 10, icon: 65432, name: "codec food" }],
  jobLevelModifiers: { 50: { main: 1 } },
  levelCaps: structuredClone(levelCaps),
  sync: {
    levels: [{ jobLevel: 50, minItemLevel: 90, defaultItemLevel: 130 }],
    groups: [{
      name: "讨伐歼灭战",
      options: [{ name: "codec duty", target: { kind: "itemLevel", value: 130 } }],
    }],
  },
  gears: [{ ...gear, ...flags }],
});

test("variable gear flags and raw main/secondary attributes survive the binary catalog", async () => {
  for (const flags of [
    {},
    { equipLevelVariable: true },
    { equipLevelVariable: true, unique: true, materiaAdvanced: true },
    { unique: true, materiaAdvanced: true },
  ]) {
    const { bytes } = await encodeGeneratedData(payloadFor(flags));
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true), 9);
    const decoded = await decodeGeneratedData(bytes);
    const actual = decoded.getGearById(1);
    assert.equal(actual.equipLevelVariable === true, flags.equipLevelVariable === true);
    assert.equal(actual.unique === true, flags.unique === true);
    assert.equal(actual.materiaAdvanced === true, flags.materiaAdvanced === true);
    assert.equal(actual.stats.main, 2);
    assert.equal(actual.stats.secondary, 3);
    assert.equal(actual.icon, gear.icon);
    assert.equal(decoded.foods[0].icon, 65432);
    assert.deepEqual(decoded.jobs.SAM, { id: 34, name: "武士", abbreviation: "SAM" });
    assert.deepEqual(decoded.sync, {
      levels: [{ jobLevel: 50, minItemLevel: 90, defaultItemLevel: 130 }],
      groups: [{
        name: "讨伐歼灭战",
        options: [{ name: "codec duty", target: { kind: "itemLevel", value: 130 } }],
      }],
    });
  }
});

test("ItemSpecialBonus metadata and its separate Special attributes survive the binary catalog", async () => {
  const item = {
    ...gear,
    itemSpecialBonus: 11,
    itemSpecialBonusParam: 64,
    specialStats: { secondary: 20, DET: 30 },
  };
  const payload = payloadFor({});
  payload.gears = [item];
  const { bytes } = await encodeGeneratedData(payload);
  const decoded = await decodeGeneratedData(bytes);
  const actual = decoded.getGearById(1);
  assert.equal(actual.itemSpecialBonus, 11);
  assert.equal(actual.itemSpecialBonusParam, 64);
  assert.deepEqual(actual.specialStats, { DET: 30, secondary: 20 });
  assert.deepEqual(actual.stats, gear.stats);
});

test("ItemSpecialBonus records reject incomplete or unsupported metadata", async () => {
  await assert.rejects(
    encodeGeneratedData(payloadFor({ itemSpecialBonus: 11 })),
    /ItemSpecialBonus 字段不完整/,
  );
  await assert.rejects(
    encodeGeneratedData(payloadFor({ itemSpecialBonus: 12, itemSpecialBonusParam: 0, specialStats: {} })),
    /只支持 11/,
  );
});

test("variable-level flags reject malformed values instead of silently dropping them", async () => {
  await assert.rejects(encodeGeneratedData(payloadFor({ equipLevelVariable: "true" })), /equipLevelVariable/);
});

test("gear and food icons are required positive u32 values", async () => {
  await assert.rejects(encodeGeneratedData(payloadFor({ icon: undefined })), /缺少有效 icon/);
  const payloadWithoutFoodIcon = payloadFor({});
  delete payloadWithoutFoodIcon.foods[0].icon;
  await assert.rejects(encodeGeneratedData(payloadWithoutFoodIcon), /食物缺少有效 icon/);
});

test("sync metadata rejects unsupported thresholds, targets, and legacy structures", async () => {
  const payload = payloadFor({});
  payload.sync.levels[0].minItemLevel = 89;
  await assert.rejects(encodeGeneratedData(payload), /同步等级下界/);

  const unsupportedTarget = payloadFor({});
  unsupportedTarget.sync.groups[0].options[0].target.value = 89;
  await assert.rejects(encodeGeneratedData(unsupportedTarget), /低于 90/);

  const unknownTarget = payloadFor({});
  unknownTarget.sync.groups[0].options[0].target.value = 120;
  await assert.rejects(encodeGeneratedData(unknownTarget), /缺少属性上限/);

  const legacy = payloadFor({});
  legacy.syncLevelDuties = {};
  await assert.rejects(encodeGeneratedData(legacy), /旧同步数据字段/);
});

test("ItemLevel caps reject missing columns, truncated arrays, and negative values", async () => {
  const missingColumn = payloadFor({});
  delete missingColumn.levelCaps.CRT;
  await assert.rejects(encodeGeneratedData(missingColumn), /缺少 ItemLevel 属性上限列 CRT/);

  const truncatedColumn = payloadFor({});
  truncatedColumn.levelCaps.CRT.pop();
  await assert.rejects(encodeGeneratedData(truncatedColumn), /属性上限列 CRT 缺失、截断/);

  const negativeCap = payloadFor({});
  negativeCap.levelCaps.CRT[0] = -1;
  await assert.rejects(encodeGeneratedData(negativeCap), /属性上限列 CRT 缺失、截断或包含无效值/);

  const sparseColumn = payloadFor({});
  delete sparseColumn.levelCaps.CRT[0];
  await assert.rejects(encodeGeneratedData(sparseColumn), /属性上限列 CRT 缺失、截断或包含无效值/);
});

test("sync codec validates category structure without owning generated category order", async () => {
  const payload = payloadFor({});
  payload.sync.groups = [
    { name: "新生成分类", options: [{ name: "first", target: { kind: "itemLevel", value: 130 } }] },
    { name: "讨伐歼灭战", options: [{ name: "second", target: { kind: "jobLevel", value: 50 } }] },
  ];
  const { bytes } = await encodeGeneratedData(payload);
  const decoded = await decodeGeneratedData(bytes);
  assert.deepEqual(decoded.sync.groups, payload.sync.groups);

  const duplicateGroups = payloadFor({});
  duplicateGroups.sync.groups.push(structuredClone(duplicateGroups.sync.groups[0]));
  await assert.rejects(encodeGeneratedData(duplicateGroups), /大分类结构无效或重复/);
});
