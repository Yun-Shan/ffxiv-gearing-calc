import { ByteReader, ByteWriter, fail } from "./bytes.ts";

export interface StringPool {
  readonly length: number;
  get(index: number): string;
}
export function readStrings(reader: ByteReader): StringPool {
  const count = reader.varUint();
  if (count > reader.bytes.length - reader.offset)
    fail(`${reader.label} 字符串数量越界`);
  const values: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index++) {
    try {
      values.push(decoder.decode(reader.slice(reader.varUint())));
    } catch (error) {
      throw new Error(`${reader.label} UTF-8 字符串无效`, { cause: error });
    }
  }
  return {
    length: values.length,
    get(index) {
      if (!Number.isInteger(index) || index < 0 || index >= values.length)
        return fail(`${reader.label} 字符串引用越界`);
      return values[index];
    },
  };
}
export function writeStrings(
  writer: ByteWriter,
  values: readonly string[],
): void {
  writer.varUint(values.length);
  const encoder = new TextEncoder();
  for (const value of values) {
    const bytes = encoder.encode(value);
    writer.varUint(bytes.length);
    writer.append(bytes);
  }
}
