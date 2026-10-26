import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShareTables, committedShareLedger, prepareShareTables } from "../data-update/share-tables.mjs";
import { resolve } from "node:path";
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { decodeGeneratedData } from "../../src/data/binary/decode.ts";
import { dutyIdentityKey } from "../sync-level-duties.mjs";

test("sharing ledger keeps old identities while remapping reordered, removed and growing original tables", () => {
  const a = { name: "A", target: { kind: "itemLevel", value: 90 } },
    b = { name: "B", target: { kind: "jobLevel", value: 80 } };
  const initial = buildShareTables(
    { sources: [], duties: [], dataVersions: [] },
    ["a", "b"],
    [a, b],
    "v1",
    { sourceMaxItemIds: new Map([["a", 20], ["b", 10]]), dutyMaxIds: new Map([[dutyIdentityKey(a), 20], [dutyIdentityKey(b), 10]]) },
  );
  assert.deepEqual(initial.tables, {
    sourceRefs: [0, 1],
    dutyRefs: [0, 1],
    dataVersions: ["v1"],
  });
  const reordered = buildShareTables(initial.ledger, ["b", "a"], [b, a], "v2");
  assert.deepEqual(reordered.ledger.sources, ["a", "b"]);
  assert.deepEqual(reordered.tables.sourceRefs, [1, 0]);
  assert.deepEqual(reordered.tables.dutyRefs, [1, 0]);
  const removed = buildShareTables(reordered.ledger, ["b"], [b], "v2");
  assert.deepEqual(removed.tables.sourceRefs, [1, 0]);
  assert.deepEqual(removed.tables.dutyRefs, [1, 0]);
  const changed = { name: "A", target: { kind: "itemLevel", value: 100 } };
  const growing = buildShareTables(
    removed.ledger,
    ["b", "c", "d"],
    [b, changed],
    "v3",
    { sourceMaxItemIds: new Map([["c", 300], ["d", 200]]), dutyMaxIds: new Map([[dutyIdentityKey(changed), 99]]) },
  );
  assert.deepEqual(growing.tables.sourceRefs, [3, 0, 1, 2]);
  assert.deepEqual(growing.tables.dutyRefs, [2, 0, 1]);
  assert.deepEqual(growing.ledger.duties.slice(0, 2), [a, b]);
  assert.deepEqual(growing.ledger.dataVersions, ["v1", "v2", "v3"]);
  assert.deepEqual(initial.ledger.sources, ["a", "b"]);
});

test("initial and later batches sort only new identities by their highest original ID descending", () => {
  const a = { name: "A", target: { kind: "itemLevel", value: 90 } };
  const b = { name: "B", target: { kind: "itemLevel", value: 100 } };
  const c = { name: "C", target: { kind: "itemLevel", value: 110 } };
  const d = { name: "D", target: { kind: "itemLevel", value: 120 } };
  const initial = buildShareTables({ sources: [], duties: [], dataVersions: [] }, ["group/a", "group/b"], [a, b], "v1", {
    sourceMaxItemIds: new Map([["group/a", 10], ["group/b", 30]]),
    dutyMaxIds: new Map([[dutyIdentityKey(a), 10], [dutyIdentityKey(b), 30]]),
  });
  assert.deepEqual(initial.ledger.sources, ["group/b", "group/a"]);
  assert.deepEqual(initial.ledger.duties, [b, a]);
  assert.deepEqual(initial.tables.sourceRefs, [1, 0]);
  const next = buildShareTables(initial.ledger, ["group/a", "group/c", "group/b", "group/d"], [a, c, b, d], "v2", {
    sourceMaxItemIds: new Map([["group/c", 50], ["group/d", 90]]),
    dutyMaxIds: new Map([[dutyIdentityKey(c), 50], [dutyIdentityKey(d), 90]]),
  });
  assert.deepEqual(next.ledger.sources, ["group/b", "group/a", "group/d", "group/c"]);
  assert.deepEqual(next.ledger.duties, [b, a, d, c]);
  assert.deepEqual(next.tables.sourceRefs, [2, 0, 3, 1]);
  assert.deepEqual(next.tables.dutyRefs, [2, 0, 3, 1]);
});

test("source prefixes sort lexically and every suffix sorts by highest equipment ID", () => {
  const sources = ["z/a", "a/a", "a/z", "a"];
  const result = buildShareTables({ sources: [], duties: [], dataVersions: [] }, sources, [], "current", {
    sourceMaxItemIds: new Map([["z/a", 100], ["a/a", 10], ["a/z", 30], ["a", 40]]),
  });
  assert.deepEqual(result.ledger.sources, ["a", "a/z", "a/a", "z/a"]);
  assert.deepEqual(result.ledger.dataVersions, ["current"]);
  assert.deepEqual(committedShareLedger(resolve('.tmp/share-source-prefix/uncommitted-ledger.json')), {sources:[],duties:[],dataVersions:[]});
});

test("new identities require original ID evidence", () => {
  assert.throws(() => buildShareTables({ sources: [], duties: [], dataVersions: [] }, ["a"], [], "v1"), /最高原始 ID/);
  const duty = { name: "A", target: { kind: "jobLevel", value: 80 } };
  assert.throws(() => buildShareTables({ sources: [], duties: [], dataVersions: [] }, [], [duty], "v1"), /最高原始 ID/);
});

test("generation rebuilds the uncommitted ledger instead of retaining pending IDs or versions", async () => {
  const root = resolve(".tmp/share-tables-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, "pending-"));
  const identityPath = resolve(directory, "identities.json");
  try {
    await writeFile(identityPath, JSON.stringify({ sources: ["stale"], duties: [], dataVersions: ["old"] }));
    const data = await decodeGeneratedData(new Uint8Array(await readFile(resolve("src/data/generated-data.bin"))));
    const duties = data.sync.groups.flatMap(group => group.options);
    const dutyMaxIds = new Map(duties.map((duty, index) => [dutyIdentityKey(duty), index]));
    const first = await prepareShareTables(data, identityPath, dutyMaxIds);
    await first.persist();
    const rebuilt = JSON.parse(await readFile(identityPath, "utf8"));
    assert(!rebuilt.sources.includes("stale"));
    assert.deepEqual(rebuilt.dataVersions, [data.version]);
    const second = await prepareShareTables({ ...data, version: "next" }, identityPath, new Map(duties.map((duty, index) => [dutyIdentityKey(duty), duties.length - index])));
    await second.persist();
    const again = JSON.parse(await readFile(identityPath, "utf8"));
    assert.deepEqual(again.dataVersions, ["next"]);
    assert.deepEqual(again.sources, rebuilt.sources);
    assert.deepEqual(again.duties, [...rebuilt.duties].reverse());
    assert.deepEqual(second.payload.shareTables.dataVersions, ["next"]);
  } finally {
    await unlink(identityPath).catch(() => {});
    await rmdir(directory);
  }
});

test("sharing ledger rejects duplicate identities and does not reuse deleted IDs", () => {
  assert.throws(() =>
    buildShareTables(
      { sources: ["a", "a"], duties: [], dataVersions: ["v1"] },
      ["a"],
      [],
      "v2",
    ),
  );
  const old = { sources: ["a", "b"], duties: [], dataVersions: ["v1"] };
  const removed = buildShareTables(old, ["b"], [], "v1");
  const returned = buildShareTables(removed.ledger, ["b", "a"], [], "v1");
  assert.deepEqual(returned.ledger, old);
  assert.deepEqual(returned.tables.sourceRefs, [1, 0]);
});
