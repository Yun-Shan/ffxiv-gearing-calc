import {
  ByteReader,
  ByteWriter,
  assertUInt,
  fail,
} from "../../shared/bytes.ts";
import type { StringPool } from "../../shared/strings.ts";

export type GearIndexWidth = 1 | 2 | 4;

/** References are sized from dictionary cardinality, so count 256 still fits u8. */
export function gearIndexWidth(count: number, label: string): GearIndexWidth {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0x1_0000_0000)
    fail(`${label} 数量超出可引用范围`);
  if (count <= 256) return 1;
  if (count <= 65_536) return 2;
  return 4;
}

export function writeGearIndex(
  writer: ByteWriter,
  index: number,
  count: number,
  label: string,
): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= count)
    fail(`${label} 引用越界：${index}/${count}`);
  const width = gearIndexWidth(count, label);
  if (width === 1) writer.u8(index, label);
  else if (width === 2) writer.u16(index, label);
  else writer.u32(index, label);
}

export function readGearIndex(
  reader: ByteReader,
  count: number,
  label: string,
): number {
  const width = gearIndexWidth(count, label);
  const index =
    width === 1 ? reader.u8() : width === 2 ? reader.u16() : reader.u32();
  if (index >= count) fail(`${label} 引用越界：${index}/${count}`);
  return index;
}

export function mainStatIndexWidth(recordCount: number): 2 | 4 {
  if (!Number.isSafeInteger(recordCount) || recordCount < 0)
    fail("主属性索引装备数量无效");
  return recordCount <= 65_536 ? 2 : 4;
}

export function writeGearStringPool(
  writer: ByteWriter,
  values: readonly string[],
  label: string,
): void {
  const encoder = new TextEncoder();
  const encoded = values.map((value) => encoder.encode(value));
  let byteLength = 0;
  for (const bytes of encoded) {
    byteLength += bytes.byteLength;
    assertUInt(byteLength, 32, `${label} UTF-8 长度`);
  }
  writer.varUint(values.length, `${label} 数量`);
  for (const bytes of encoded)
    writer.varUint(bytes.byteLength, `${label} 字节长度`);
  for (const bytes of encoded) writer.append(bytes);
}

export function readGearStringPool(
  reader: ByteReader,
  label: string,
): StringPool {
  const count = reader.varUint();
  if (count > reader.bytes.byteLength - reader.offset)
    fail(`${label} 长度表被截断`);
  const offsets = new Uint32Array(count + 1);
  let byteLength = 0;
  for (let index = 0; index < count; index++) {
    byteLength += reader.varUint();
    assertUInt(byteLength, 32, `${label} UTF-8 长度`);
    offsets[index + 1] = byteLength;
  }
  if (byteLength > reader.bytes.byteLength - reader.offset)
    fail(`${label} UTF-8 字符串区长度无效`);
  const stringBytes = reader.slice(byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cache = new Array<string | undefined>(count);
  return {
    length: count,
    get(index) {
      if (!Number.isInteger(index) || index < 0 || index >= count)
        fail(`${label} 字符串引用越界：${index}`);
      const cached = cache[index];
      if (cached !== undefined) return cached;
      try {
        const decoded = decoder.decode(
          stringBytes.subarray(offsets[index], offsets[index + 1]),
        );
        cache[index] = decoded;
        return decoded;
      } catch (error) {
        throw new Error(`${label} UTF-8 解码失败`, { cause: error });
      }
    },
  };
}
