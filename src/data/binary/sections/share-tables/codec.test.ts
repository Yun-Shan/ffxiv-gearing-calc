import { describe, expect, it } from "vitest";
import { gameData } from "../../../../domain/data.ts";
import { readShareTables, referenceWidth, writeShareTables } from "./codec.ts";

describe("permanent sharing references in bin format 14", () => {
  it("writes the complete current 272 byte segment and keeps zero-based raw references", () => {
    const sources = gameData.gearSources.length,
      duties = gameData.sync.groups.flatMap((g) => g.options).length;
    expect(sources).toBe(216);
    expect(duties).toBe(31);
    const bytes = writeShareTables(gameData.shareTables, sources, duties);
    expect(bytes.length).toBe(272);
    expect(gameData.shareTables.dataVersions).toEqual(["2026.10.06.0000.0000"]);
    expect(readShareTables(bytes, sources, duties)).toEqual(
      gameData.shareTables,
    );
    expect(gameData.shareTables.sourceRefs).toContain(0);
    expect(gameData.shareTables.dutyRefs).toContain(0);
  });
  it.each([
    [255, 1],
    [256, 2],
    [65535, 2],
    [65536, 4],
    [0xffffffff, 4],
  ])("reserves natural missing index %s within %s bytes", (count, width) => {
    expect(referenceWidth(count)).toBe(width);
    const tables = {
      sourceRefs: [0, count],
      dutyRefs: [count],
      dataVersions: ["v1"],
    };
    const encoded = writeShareTables(tables, count, count);
    expect(readShareTables(encoded, count, count)).toEqual(tables);
  });
  it("rejects truncation, empty versions, duplicate versions and invalid references", () => {
    const encoded = writeShareTables(
      { sourceRefs: [0], dutyRefs: [0], dataVersions: ["v1"] },
      1,
      1,
    );
    for (let i = 0; i < encoded.length; i++)
      expect(() => readShareTables(encoded.slice(0, i), 1, 1)).toThrow();
    expect(() =>
      writeShareTables(
        { sourceRefs: [], dutyRefs: [], dataVersions: [] },
        0,
        0,
      ),
    ).toThrow();
    expect(() => readShareTables(Uint8Array.of(0, 0, 0), 0, 0)).toThrow();
    expect(() =>
      writeShareTables(
        { sourceRefs: [2], dutyRefs: [], dataVersions: ["v"] },
        1,
        0,
      ),
    ).toThrow();
    expect(() =>
      writeShareTables(
        { sourceRefs: [], dutyRefs: [], dataVersions: ["v", "v"] },
        0,
        0,
      ),
    ).toThrow();
    expect(() => referenceWidth(2 ** 32)).toThrow();
  });
  it("round-trips multibyte UTF-8 version text", () => {
    const tables = { sourceRefs: [], dutyRefs: [], dataVersions: ["v1", "v2🪷"] };
    expect(readShareTables(writeShareTables(tables, 0, 0), 0, 0)).toEqual(tables);
  });
});
