import { describe, expect, it } from "vitest";
import { Reader, Writer } from "./binary.ts";
import { readSource, sourceById, writeSource } from "./tables.ts";
import type { ShareSource } from "./types.ts";

function encode(source: ShareSource): Uint8Array {
  const writer = new Writer();
  writeSource(writer, source);
  return writer.finish();
}

function decode(bytes: Uint8Array): ShareSource {
  const reader = new Reader(bytes);
  const source = readSource(reader);
  reader.finish();
  return source;
}

describe("source identity offsets", () => {
  it.each([
    { id: 0, bytes: [1] },
    { id: 1, bytes: [2] },
    { id: 2, bytes: [3] },
    { id: 63, bytes: [64] },
    { id: 64, bytes: [65] },
    { id: 126, bytes: [127] },
    { id: 127, bytes: [128, 1] },
    { id: 128, bytes: [129, 1] },
    { id: 215, bytes: [216, 1] },
  ])("writes identity $id as its offset without a parity tag", ({ id, bytes }) => {
    const source = sourceById(id);
    expect(typeof source).toBe("string");
    expect([...encode(source)]).toEqual(bytes);
    expect(decode(Uint8Array.from(bytes))).toEqual(source);
  });

  it.each([
    { text: "", bytes: [0, 0] },
    { text: "source", bytes: [0, 6, 115, 111, 117, 114, 99, 101] },
    { text: "源", bytes: [0, 3, 230, 186, 144] },
  ])("uses zero for literal content '$text'", ({ text, bytes }) => {
    expect([...encode(text)]).toEqual(bytes);
    expect(decode(Uint8Array.from(bytes))).toBe(text);
  });

  it("preserves unknown identities and the largest supported offset", () => {
    expect([...encode({ unknownSourceId: 6000 })]).toEqual([241, 46]);
    expect(decode(Uint8Array.of(241, 46))).toEqual({ unknownSourceId: 6000 });
    for (const id of [2 ** 52, Number.MAX_SAFE_INTEGER - 1]) {
      const source = { unknownSourceId: id };
      expect(decode(encode(source))).toEqual(source);
    }
    expect([...encode({ unknownSourceId: Number.MAX_SAFE_INTEGER - 1 })]).toEqual([
      255, 255, 255, 255, 255, 255, 255, 15,
    ]);
    expect(() => encode({ unknownSourceId: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  it.each([[0], [0, 1], [0, 2, 65], [0, 1, 255]].map((bytes) => ({ bytes })))(
    "rejects a missing, truncated or invalid literal payload $bytes",
    ({ bytes }) => {
      expect(() => decode(Uint8Array.from(bytes))).toThrow();
    },
  );
});
