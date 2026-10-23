import assert from "node:assert/strict";
import test from "node:test";
import { createMcpQueryHelpers } from "../mcp-lumina/query-helpers.mjs";
import { parseJsonRpcBuffer } from "../mcp-lumina/transport.mjs";

test("JSON-RPC parser buffers Content-Length frames and newline messages", () => {
  const state = { buffer: "" };
  const framedMessage = { jsonrpc: "2.0", id: 17, result: { name: "魔晶石" } };
  const body = JSON.stringify(framedMessage);
  const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;

  state.buffer += frame.slice(0, 18);
  assert.deepEqual(parseJsonRpcBuffer(state), []);
  state.buffer += frame.slice(18, frame.length - 4);
  assert.deepEqual(parseJsonRpcBuffer(state), []);
  state.buffer += frame.slice(frame.length - 4);
  assert.deepEqual(parseJsonRpcBuffer(state), [framedMessage]);
  assert.equal(state.buffer, "");

  const lineMessage = { jsonrpc: "2.0", id: 18, result: "ok" };
  state.buffer += `${JSON.stringify(lineMessage)}\n`;
  assert.deepEqual(parseJsonRpcBuffer(state), [lineMessage]);
  assert.equal(state.buffer, "");
});

test("batch row queries de-duplicate IDs, retry failures, and record the requested ranges", async () => {
  const sleeps = [];
  const calls = [];
  const queries = [];
  let failFirstCall = true;
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (failFirstCall) {
        failFirstCall = false;
        throw new Error("temporary MCP failure");
      }
      return {
        value: {
          rows: args.rowIds.map((rowId) => ({ rowId, fields: { Name: `item-${rowId}` } })),
          missingRowIds: args.rowIds.includes(101) ? [101] : [],
          gameVersion: "test-version",
          timestamp: "2026-10-23T00:00:00.000Z",
        },
      };
    },
  };
  const helpers = createMcpQueryHelpers({ concurrency: 1, sleep: async (milliseconds) => sleeps.push(milliseconds) });
  const originalConsoleError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await helpers.queryRows(
      client,
      "Item",
      [...Array.from({ length: 101 }, (_, index) => index + 1), 1, "2", 0.5, "invalid"],
      "Name,Icon",
      queries,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ name }) => name), ["get_rows", "get_rows", "get_rows"]);
  assert.deepEqual(calls.map(({ args }) => args.rowIds.length), [100, 100, 1]);
  assert.deepEqual(calls[0].args, {
    sheet: "Item",
    rowIds: Array.from({ length: 100 }, (_, index) => index + 1),
    returnFields: "Name,Icon",
    languages: "chs",
  });
  assert.deepEqual(calls[2].args.rowIds, [101]);
  assert.deepEqual(sleeps, [250]);
  assert.equal(result.rows.length, 101);
  assert.deepEqual(result.missingRowIds, [101]);
  assert.deepEqual(queries.map(({ rowIds }) => rowIds.length), [100, 1]);
  assert.deepEqual(queries[0].fields, ["Name", "Icon"]);
  assert.equal(queries[0].gameVersion, "test-version");
  assert.equal(queries[1].queriedAt, "2026-10-23T00:00:00.000Z");
});

test("full-sheet and class-job helpers preserve query ranges and audit records", async () => {
  const queries = [];
  const calls = [];
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "list_rows") {
        return {
          value: {
            rows: [{ rowId: 4 }, { rowId: 9 }],
            rowIds: [4, 9],
            missingRowIds: [],
            gameVersion: "test-version",
            timestamp: "2026-10-23T01:00:00.000Z",
          },
        };
      }
      const job = args.query;
      return {
        value: {
          results: [{ rowId: job === "PLD" ? 19 : 21, fields: { Abbreviation: job } }],
          gameVersion: "test-version",
          timestamp: "2026-10-23T01:01:00.000Z",
        },
      };
    },
  };
  const helpers = createMcpQueryHelpers({ concurrency: 1, sleep: async () => {} });

  const allRows = await helpers.queryAllRows(client, "ItemLevel", "Name,Level", queries);
  const jobs = await helpers.searchClassJobs(client, ["PLD", "DRG"], queries);

  assert.deepEqual(calls[0], {
    name: "list_rows",
    args: { sheet: "ItemLevel", returnFields: "Name,Level", limit: -1, languages: "chs" },
  });
  assert.deepEqual(allRows.rows.map(({ rowId }) => rowId), [4, 9]);
  assert.deepEqual(queries[0], {
    method: "list_rows",
    sheet: "ItemLevel",
    limit: -1,
    fields: ["Name", "Level"],
    rowIds: [4, 9],
    returnedRows: 2,
    gameVersion: "test-version",
    queriedAt: "2026-10-23T01:00:00.000Z",
  });
  assert.deepEqual(calls.slice(1).map(({ args }) => args), [
    { sheet: "ClassJob", query: "PLD", textFields: "Abbreviation", returnFields: "Name,Abbreviation", limit: 200, languages: "chs" },
    { sheet: "ClassJob", query: "DRG", textFields: "Abbreviation", returnFields: "Name,Abbreviation", limit: 200, languages: "chs" },
  ]);
  assert.deepEqual(jobs, [{ job: "PLD", rowId: 19 }, { job: "DRG", rowId: 21 }]);
  assert.deepEqual(queries.slice(1).map(({ query, rowIds, gameVersion }) => ({ query, rowIds, gameVersion })), [
    { query: "PLD", rowIds: [19], gameVersion: "test-version" },
    { query: "DRG", rowIds: [21], gameVersion: "test-version" },
  ]);
});

test("ResistanceWeaponAdjust validation still checks complete same-version row scope", () => {
  const fields = ["Image", "MaxTotalStats", "MaxEachStat", "BaseParam[0]", "BaseParam[1]", "BaseParam[2]", "BaseParam[3]", "Unknown0"];
  const rowFields = (overrides = {}) => Object.fromEntries(fields.map((field) => [field, overrides[field] ?? 0]));
  const rows = [
    { rowId: 0, fields: rowFields(), gameVersion: "test-version", timestamp: "time" },
    { rowId: 8, fields: rowFields({ "BaseParam[0]": 1 }), gameVersion: "test-version", timestamp: "time" },
  ];
  const { validateResistanceWeaponAdjustRows } = createMcpQueryHelpers();

  assert.deepEqual(
    validateResistanceWeaponAdjustRows(rows, [], { rowCount: 2 }, "test-version", [0, 8], fields),
    [8],
  );
  assert.throws(
    () => validateResistanceWeaponAdjustRows(rows.slice(1), [], { rowCount: 2 }, "test-version", [8], fields),
    /全量查询不完整/,
  );
});
