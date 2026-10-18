import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeGeneratedData, decodeGeneratedData } from "../../src/data/binary-format.mjs";

// Isolated codec fixtures; these objects are never imported by production code.
const gear = {
  id: 1, name: "codec fixture", slot: "body", rawSlot: 4,
  level: 1, equipLevel: 1, roleId: 1, jobCategory: 1,
  stats: { STR: 1, main: 2, secondary: 3 }, materiaSlots: 0, jobs: ["SAM"],
  sourceFile: "codec fixture", dataSources: [{ kind: "test" }],
};
const payloadFor = (flags) => ({
  jobSchemas: { SAM: { mainStat: "STR" } },
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
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true), 6);
    const decoded = await decodeGeneratedData(bytes);
    const actual = decoded.getGearById(1);
    assert.equal(actual.equipLevelVariable === true, flags.equipLevelVariable === true);
    assert.equal(actual.unique === true, flags.unique === true);
    assert.equal(actual.materiaAdvanced === true, flags.materiaAdvanced === true);
    assert.equal(actual.stats.main, 2);
    assert.equal(actual.stats.secondary, 3);
  }
});

test("ItemSpecialBonus metadata and its separate Special attributes survive the binary catalog", async () => {
  const item = {
    ...gear,
    itemSpecialBonus: 11,
    itemSpecialBonusParam: 64,
    specialStats: { secondary: 20, DET: 30 },
  };
  const { bytes } = await encodeGeneratedData({
    jobSchemas: { SAM: { mainStat: "STR" } },
    gears: [item],
  });
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
