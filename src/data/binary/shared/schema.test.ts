import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "./bytes.ts";
import { readValue } from "./schema-read.ts";
import { writeValue } from "./schema-write.ts";
import { wire } from "./schema.ts";

const noStrings = { length: 0, get: (): never => { throw new Error("unexpected string"); } };

describe("compact optional-field masks", () => {
  it.each([[0, 0], [1, 1], [8, 1], [9, 2], [16, 2], [17, 4], [32, 4]])(
    "roundtrips %i optional fields using %i mask bytes",
    (count, maskBytes) => {
      const schema = wire.struct(Array.from({ length: count }, (_, index) => [
        `field${index}`, wire.optional(wire.u8),
      ] as const));
      const value = count ? { [`field${count - 1}`]: 255 } : {};
      const writer = new ByteWriter();
      writeValue(writer, schema, value, () => { throw new Error("unexpected string"); }, "fixture");
      expect(writer.finish()).toHaveLength(maskBytes + (count ? 1 : 0));
      const reader = new ByteReader(writer.finish(), "fixture");
      expect(readValue(reader, schema, noStrings)).toEqual(value);
      reader.finish();
    },
  );

  it.each([[1, [2]], [9, [0, 2]], [17, [0, 0, 2, 0]]])(
    "rejects reserved bits in a %i-field mask",
    (count, bytes) => {
      const schema = wire.struct(Array.from({ length: count }, (_, index) => [
        `field${index}`, wire.optional(wire.u8),
      ] as const));
      expect(() => readValue(new ByteReader(new Uint8Array(bytes), "fixture"), schema, noStrings))
        .toThrow(/保留位/);
    },
  );
});
