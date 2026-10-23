import { ByteReader, fail } from "./bytes.ts";
import { optionalMaskKind, type Schema } from "./schema.ts";
import { readStrings, type StringPool } from "./strings.ts";

export function readValue(
  reader: ByteReader,
  schema: Schema,
  strings: StringPool,
): unknown {
  switch (schema.kind) {
    case "string":
      return strings.get(reader.varUint());
    case "bool": {
      const value = reader.u8();
      if (value > 1) fail(`${reader.label} 布尔值无效`);
      return value === 1;
    }
    case "u8":
    case "u16":
    case "u32":
    case "i16":
    case "i32":
    case "f64":
      return reader[schema.kind]();
    case "uint":
      return reader.varUint();
    case "enum": {
      const value = schema.values[reader.u8()];
      if (value === undefined) fail(`${reader.label} 枚举代码无效`);
      return value;
    }
    case "baseStat": {
      const tag = reader.u8();
      if (tag === 0) return "main";
      if (tag === 1) return "sub";
      if (tag === 2) return reader.f64();
      return fail(`${reader.label} 基础属性类型无效`);
    }
    case "array": {
      const count = reader.varUint();
      if (count > reader.bytes.length - reader.offset)
        fail(`${reader.label} 数组数量越界`);
      return Array.from({ length: count }, () =>
        readValue(reader, schema.item, strings),
      );
    }
    case "struct": {
      const optionals = schema.fields.filter(
        ([, field]) => field.kind === "optional",
      );
      if (optionals.length > 32) fail(`${reader.label} 可选字段超过 32`);
      const mask = optionals.length ? reader[optionalMaskKind(optionals.length)]() : 0;
      if (optionals.length < 32 && mask >= 2 ** optionals.length)
        fail(`${reader.label} 可选字段含保留位`);
      const record: Record<string, unknown> = {};
      let optionalIndex = 0;
      for (const [name, field] of schema.fields) {
        if (field.kind === "optional") {
          if (mask & (1 << optionalIndex))
            record[name] = readValue(reader, field.value, strings);
          optionalIndex++;
        } else record[name] = readValue(reader, field, strings);
      }
      return record;
    }
    case "map": {
      const count = reader.varUint();
      if (count > reader.bytes.length - reader.offset)
        fail(`${reader.label} 索引数量越界`);
      const entries: [string, unknown][] = [];
      const keys = new Set<string>();
      for (let index = 0; index < count; index++) {
        const key = String(readValue(reader, schema.key, strings));
        if (keys.has(key)) fail(`${reader.label} 索引重复`);
        keys.add(key);
        entries.push([key, readValue(reader, schema.value, strings)]);
      }
      return Object.fromEntries(entries);
    }
    case "optional":
      return fail(`${reader.label} 可选值必须属于明确字段`);
  }
}

export function decodeSection<T>(
  schema: Schema,
  bytes: Uint8Array,
  label: string,
): T {
  const reader = new ByteReader(bytes, label);
  const result = readValue(reader, schema, readStrings(reader));
  reader.finish();
  return result as T;
}
