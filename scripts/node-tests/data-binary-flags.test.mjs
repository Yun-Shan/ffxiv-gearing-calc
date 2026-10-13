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
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true), 5);
    const decoded = await decodeGeneratedData(bytes);
    const actual = decoded.getGearById(1);
    assert.equal(actual.equipLevelVariable === true, flags.equipLevelVariable === true);
    assert.equal(actual.unique === true, flags.unique === true);
    assert.equal(actual.materiaAdvanced === true, flags.materiaAdvanced === true);
    assert.equal(actual.stats.main, 2);
    assert.equal(actual.stats.secondary, 3);
  }
});

test("variable-level flags reject malformed values instead of silently dropping them", async () => {
  await assert.rejects(encodeGeneratedData(payloadFor({ equipLevelVariable: "true" })), /equipLevelVariable/);
});
