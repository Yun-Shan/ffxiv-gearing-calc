import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { syncLevelDutiesFromSnapshot } from "../sync-level-duties.mjs";

const snapshot = JSON.parse(await readFile(new URL("../data/mcp-lumina.snapshot.json", import.meta.url), "utf8"));

test("bin duties project exact ItemLevelSync matches with nonzero JournalGenre in rowId order", () => {
  const generated = syncLevelDutiesFromSnapshot({
    ...snapshot,
    rows: {
      ...snapshot.rows,
      ContentFinderCondition: [...snapshot.rows.ContentFinderCondition].reverse(),
    },
  });
  const expected = {};
  for (const row of [...snapshot.rows.ContentFinderCondition].sort((a, b) => a.rowId - b.rowId)) {
    const { ItemLevelSync: level, JournalGenre: journalGenre, Name: name } = row.fields;
    if (level > 0 && journalGenre !== 0) (expected[level] ??= []).push({ id: row.rowId, name });
  }
  assert.deepEqual(generated, expected);
  for (const level of [795, 735, 700, 695, 665, 635, 605, 475, 375, 345, 300, 135, 120, 100])
    assert.deepEqual(generated[level], expected[level]);
});

test("bin duty projection rejects missing fields, duplicate IDs, incomplete scans and mixed versions", () => {
  for (const mutate of [
    (data) => { delete data.rows.ContentFinderCondition[0].fields.Name; },
    (data) => { delete data.rows.ContentFinderCondition[0].fields.JournalGenre; },
    (data) => { data.rows.ContentFinderCondition[0].fields.JournalGenre = -1; },
    (data) => { data.rows.ContentFinderCondition[1].rowId = data.rows.ContentFinderCondition[0].rowId; },
    (data) => { data.rows.ContentFinderCondition.pop(); },
    (data) => { data.rows.ContentFinderCondition[0].gameVersion = "wrong"; },
    (data) => { data.queries.find((query) => query.sheet === "ContentFinderCondition" && query.method === "list_rows").fields = ["ItemLevelSync"]; },
  ]) {
    const broken = structuredClone(snapshot);
    mutate(broken);
    assert.throws(() => syncLevelDutiesFromSnapshot(broken));
  }
});
