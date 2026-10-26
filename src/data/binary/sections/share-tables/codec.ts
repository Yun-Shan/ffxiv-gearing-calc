import { ByteReader, ByteWriter, fail } from "../../shared/bytes.ts";
import type { ShareTables } from "../../types.ts";
import { referenceWidth } from "./schema.ts";
export { referenceWidth } from "./schema.ts";

/** Include the natural out-of-range index N for removed historical entries. */
export function writeShareTables(
  tables: ShareTables,
  sourceCount: number,
  dutyCount: number,
): Uint8Array {
  const writer = new ByteWriter();
  for (const [refs, count] of [
    [tables.sourceRefs, sourceCount],
    [tables.dutyRefs, dutyCount],
  ] as const) {
    const width = referenceWidth(count);
    writer.varUint(refs.length);
    for (const ref of refs) {
      if (!Number.isSafeInteger(ref) || ref < 0 || ref > count)
        fail("分享映射序号无效");
      if (width === 1) writer.u8(ref);
      else if (width === 2) writer.u16(ref);
      else writer.u32(ref);
    }
  }
  if (
    !tables.dataVersions.length ||
    new Set(tables.dataVersions).size !== tables.dataVersions.length
  )
    fail("分享版本表为空或重复");
  writer.varUint(tables.dataVersions.length);
  for (const version of tables.dataVersions) {
    if (typeof version !== "string" || !version.trim())
      fail("分享版本文字无效");
    const bytes = new TextEncoder().encode(version);
    writer.varUint(bytes.length);
    writer.append(bytes);
  }
  return writer.finish();
}

export function readShareTables(
  bytes: Uint8Array,
  sourceCount: number,
  dutyCount: number,
): ShareTables {
  const reader = new ByteReader(bytes, "SHARE_TABLES");
  const readRefs = (count: number): number[] => {
    const width = referenceWidth(count),
      length = reader.varUint();
    reader.require(length * width);
    return Array.from({ length }, () => {
      const ref =
        width === 1 ? reader.u8() : width === 2 ? reader.u16() : reader.u32();
      if (ref > count) fail("分享映射序号越界");
      return ref;
    });
  };
  const sourceRefs = readRefs(sourceCount),
    dutyRefs = readRefs(dutyCount);
  const count = reader.varUint();
  if (!count || count > reader.bytes.length - reader.offset)
    fail("分享版本表数量无效");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const dataVersions = Array.from({ length: count }, () => {
    const text = decoder.decode(reader.slice(reader.varUint()));
    if (!text.trim()) fail("分享版本文字为空");
    return text;
  });
  if (new Set(dataVersions).size !== count) fail("分享版本表重复");
  reader.finish();
  return { sourceRefs, dutyRefs, dataVersions };
}
