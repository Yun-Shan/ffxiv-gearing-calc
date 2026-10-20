import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { binUiMetadataFromSnapshot } from "../bin-ui-metadata.mjs";

const snapshot = JSON.parse(await readFile(new URL("../data/mcp-lumina.snapshot.json", import.meta.url), "utf8"));
const supportedJobs = Object.keys(snapshot.queryPlan.classJobIds);

function smallSnapshot() {
  const gameVersion = "2026.10.06.0000.0000";
  const query = (sheet, fields, rowIds) => ({
    method: "get_rows", sheet, fields, rowIds, gameVersion, queriedAt: "2026-10-20T00:00:00Z",
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
        { rowId: 101, gameVersion, timestamp: "2026-10-20T00:00:00Z", fields: { Icon: 30301 } },
        { rowId: 202, gameVersion, timestamp: "2026-10-20T00:00:00Z", fields: { Icon: 30302 } },
      ],
      ClassJob: [
        { rowId: 19, gameVersion, timestamp: "2026-10-20T00:00:00Z", fields: { Name: "骑士", Abbreviation: "PLD" } },
        { rowId: 21, gameVersion, timestamp: "2026-10-20T00:00:00Z", fields: { Name: "战士", Abbreviation: "WAR" } },
      ],
    },
    queries: [
      query("Item", ["Icon"], [101, 202]),
      query("ClassJob", ["Name", "Abbreviation"], [19, 21]),
    ],
  };
}

test("bin metadata uses all planned Item.Icon fields and ClassJob IDs/names/abbreviations", () => {
  const metadata = binUiMetadataFromSnapshot(snapshot, supportedJobs);
  const plannedItemIds = [...snapshot.queryPlan.gearItemIds, ...snapshot.queryPlan.foodItemIds];
  const itemRows = new Map(snapshot.rows.Item.map((row) => [row.rowId, row]));
  assert.equal(Object.keys(metadata.itemIcons).length, plannedItemIds.length);
  for (const id of [plannedItemIds[0], plannedItemIds.at(-1)])
    assert.equal(metadata.itemIcons[id], itemRows.get(id).fields.Icon);
  assert.deepEqual(Object.keys(metadata.jobs).sort(), supportedJobs.slice().sort());
  for (const abbreviation of supportedJobs) {
    const id = snapshot.queryPlan.classJobIds[abbreviation];
    const row = snapshot.rows.ClassJob.find((entry) => entry.rowId === id);
    assert.deepEqual(metadata.jobs[abbreviation], {
      id,
      name: row.fields.Name,
      abbreviation,
    });
  }
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
    const broken = smallSnapshot();
    mutate(broken);
    assert.throws(() => binUiMetadataFromSnapshot(broken, ["PLD", "WAR"]));
  }
});
