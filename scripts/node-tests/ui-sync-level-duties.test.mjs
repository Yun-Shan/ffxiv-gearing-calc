import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { syncLevelDutiesFromSnapshot } from "../generate-ui-sync-level-duties.mjs";

const snapshot = JSON.parse(await readFile(new URL("../../src/data/mcp-sync-level-duties.snapshot.json", import.meta.url), "utf8"));
test("UI duties preserve every exact ItemLevelSync match in ascending row ID order", () => {
  const generated = syncLevelDutiesFromSnapshot({ ...snapshot, rows: [...snapshot.rows].reverse() });
  for (const level of [795,735,700,695,665,635,605,475,375,345,300,135,120,100]) {
    const expected = snapshot.rows.filter(row => row.fields.ItemLevelSync === level && row.fields.JournalGenre !== 0)
      .sort((a,b)=>a.rowId-b.rowId).map(row=>({id:row.rowId,name:row.fields.Name}));
    assert.deepEqual(generated.duties[level] ?? [], expected);
  }
});
test("UI duty generation rejects missing names, duplicate IDs, incomplete scans and mixed versions", () => {
  for (const mutate of [
    data => {delete data.rows[0].fields.Name;},
    data => {delete data.rows[0].fields.JournalGenre;},
    data => {data.rows[0].fields.JournalGenre=-1;},
    data => {data.rows[1].rowId=data.rows[0].rowId;},
    data => {data.rows.pop();},
    data => {data.rows[0].gameVersion="wrong";},
  ]) {
    const broken=structuredClone(snapshot); mutate(broken);
    assert.throws(()=>syncLevelDutiesFromSnapshot(broken));
  }
});
