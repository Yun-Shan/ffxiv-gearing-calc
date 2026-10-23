import { ByteWriter, fail } from "./bytes.ts";
import { optionalMaskKind, type Schema } from "./schema.ts";
import { writeStrings } from "./strings.ts";

export function writeValue(
  writer: ByteWriter,
  schema: Schema,
  value: unknown,
  stringId: (text: string) => number,
  label: string,
): void {
  switch (schema.kind) {
    case "string":
      if (typeof value !== "string") fail(`${label} 不是字符串`);
      writer.varUint(stringId(value));
      return;
    case "bool":
      if (typeof value !== "boolean") fail(`${label} 不是布尔值`);
      writer.u8(value ? 1 : 0);
      return;
    case "u8":
    case "u16":
    case "u32":
    case "i16":
    case "i32":
    case "f64":
    case "uint":
      if (typeof value !== "number") fail(`${label} 不是数值`);
      if (schema.kind === "uint") writer.varUint(value, label);
      else writer[schema.kind](value, label);
      return;
    case "enum": {
      const code = schema.values.indexOf(value as string | number);
      if (code < 0) fail(`${label} 含未知枚举值 ${String(value)}`);
      writer.u8(code);
      return;
    }
    case "baseStat":
      if (value === "main") writer.u8(0);
      else if (value === "sub") writer.u8(1);
      else if (typeof value === "number") {
        writer.u8(2);
        writer.f64(value, label);
      } else fail(`${label} 基础属性类型无效`);
      return;
    case "array":
      if (!Array.isArray(value)) fail(`${label} 不是数组`);
      writer.varUint(value.length);
      for (const item of value)
        writeValue(writer, schema.item, item, stringId, label);
      return;
    case "struct": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail(`${label} 不是记录`);
      const record = value as Record<string, unknown>;
      const names = new Set(schema.fields.map(([name]) => name));
      for (const name of Object.keys(record))
        if (!names.has(name)) fail(`${label} 含未定义字段 ${name}`);
      const optionals = schema.fields.filter(
        ([, field]) => field.kind === "optional",
      );
      if (optionals.length > 32) fail(`${label} 可选字段超过 32`);
      let mask = 0;
      optionals.forEach(([name], index) => {
        if (record[name] !== undefined) mask = (mask | (1 << index)) >>> 0;
      });
      if (optionals.length) writer[optionalMaskKind(optionals.length)](mask);
      for (const [name, field] of schema.fields) {
        if (field.kind === "optional") {
          if (record[name] !== undefined)
            writeValue(
              writer,
              field.value,
              record[name],
              stringId,
              `${label}.${name}`,
            );
        } else
          writeValue(writer, field, record[name], stringId, `${label}.${name}`);
      }
      return;
    }
    case "map": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail(`${label} 不是索引表`);
      const entries = Object.entries(value);
      writer.varUint(entries.length);
      for (const [key, item] of entries) {
        const wireKey = schema.key.kind === "uint" ? Number(key) : key;
        if (schema.key.kind === "uint" && String(wireKey) !== key)
          fail(`${label} 数字键无效`);
        writeValue(writer, schema.key, wireKey, stringId, `${label} 索引`);
        writeValue(writer, schema.value, item, stringId, `${label}.${key}`);
      }
      return;
    }
    case "optional":
      return fail(`${label} 可选值必须属于明确字段`);
  }
}

export function encodeSection(
  schema: Schema,
  value: unknown,
  label: string,
): Uint8Array {
  const strings: string[] = [];
  const indexes = new Map<string, number>();
  const writer = new ByteWriter();
  writeValue(
    writer,
    schema,
    value,
    (text) => {
      let index = indexes.get(text);
      if (index === undefined) {
        index = strings.length;
        indexes.set(text, index);
        strings.push(text);
      }
      return index;
    },
    label,
  );
  const result = new ByteWriter();
  writeStrings(result, strings);
  result.append(writer.finish());
  return result.finish();
}
