import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { decodeGeneratedData } from "../../src/data/binary/decode.ts";
import { binUiMetadataFromSnapshot } from "../bin-ui-metadata.mjs";
import { supportedJobIds } from "../mcp-lumina-import.mjs";

function smallQueryResult() {
  const gameVersion = "fixture-version";
  const query = (sheet, fields, rowIds) => ({
    method: "get_rows", sheet, fields, rowIds, gameVersion, queriedAt: "fixture-time",
  });
  return {
    server: "ffxiv-mcp-lumina",
    schemaVersion: 1,
    gameVersion,
    queryPlan: {
      gearItemIds: [101],
      foodItemIds: [202],
      classJobIds: { PLD: 19, WAR: 21 },
    },
    rows: {
      Item: [
        { rowId: 101, gameVersion, timestamp: "fixture-time", fields: { Icon: 30301 } },
        { rowId: 202, gameVersion, timestamp: "fixture-time", fields: { Icon: 30302 } },
      ],
      ClassJob: [
        { rowId: 19, gameVersion, timestamp: "fixture-time", fields: { Name: "骑士", Abbreviation: "PLD" } },
        { rowId: 21, gameVersion, timestamp: "fixture-time", fields: { Name: "战士", Abbreviation: "WAR" } },
      ],
    },
    queries: [
      query("Item", ["Icon"], [101, 202]),
      query("ClassJob", ["Name", "Abbreviation"], [19, 21]),
    ],
  };
}

test("bin metadata uses planned Item.Icon fields and ClassJob IDs/names/abbreviations", () => {
  const queryResult = smallQueryResult();
  const metadata = binUiMetadataFromSnapshot(queryResult, ["PLD", "WAR"]);

  assert.deepEqual(metadata.itemIcons, { 101: 30301, 202: 30302 });
  assert.deepEqual(metadata.jobs, {
    PLD: { id: 19, name: "骑士", abbreviation: "PLD" },
    WAR: { id: 21, name: "战士", abbreviation: "WAR" },
  });
});

test("bin metadata rejects missing, malformed or cross-version icon and ClassJob sources", () => {
  const brokenCases = [
    (data) => { data.rows.Item[0].fields.Icon = -1; },
    (data) => { data.rows.Item[0].gameVersion = "other"; },
    (data) => { data.queries[0].fields = []; },
    (data) => { data.rows.ClassJob[0].fields.Abbreviation = "WAR"; },
    (data) => { data.rows.ClassJob[0].gameVersion = "other"; },
    (data) => { data.queries[1].fields = ["Name"]; },
    (data) => { data.queryPlan.classJobIds.PLD = 20; },
  ];
  for (const mutate of brokenCases) {
    const broken = structuredClone(smallQueryResult());
    mutate(broken);
    assert.throws(() => binUiMetadataFromSnapshot(broken, ["PLD", "WAR"]));
  }
});

test("the final generated bin retains valid icons for every gear and food and all supported jobs", async () => {
  const bytes = new Uint8Array(await readFile(new URL("../../src/data/generated-data.bin", import.meta.url)));
  const data = await decodeGeneratedData(bytes);

  assert.ok(data.version);
  assert.equal(Object.keys(data.jobs).length, supportedJobIds.length);
  assert.ok(data.gears.length > 1000);
  assert.ok(data.foods.length > 100);
  for (const item of [...data.gears, ...data.foods])
    assert.ok(Number.isSafeInteger(item.icon) && item.icon >= 0 && item.icon <= 0xffffffff);
});

test("the final generated bin keeps provenance summary and excludes per-item audit details", async () => {
  const bytes = new Uint8Array(await readFile(new URL("../../src/data/generated-data.bin", import.meta.url)));
  const data = await decodeGeneratedData(bytes);

  assert.deepEqual(Object.keys(data.provenance).sort(), ["commit", "importedAt", "repository"]);
  for (const field of ["sources", "sourceFiles", "queryEvidence"])
    assert.equal(Object.hasOwn(data.provenance, field), false);
  for (const gear of data.gears) {
    assert.equal(Object.hasOwn(gear, "sourceFile"), false);
    assert.equal(Object.hasOwn(gear, "dataSources"), false);
  }
  for (const food of data.foods) {
    assert.equal(Object.hasOwn(food, "sourceFile"), false);
    assert.equal(Object.hasOwn(food, "dataSources"), false);
  }
  for (const schema of Object.values(data.jobSchemas))
    assert.equal(Object.hasOwn(schema, "dataSources"), false);
});
