// These declarations describe wire fields, never arbitrary JS object serialization.
export function optionalMaskKind(count: number): "u8" | "u16" | "u32" {
  return count <= 8 ? "u8" : count <= 16 ? "u16" : "u32";
}

export type Schema =
  | {
      readonly kind:
        | "u8"
        | "u16"
        | "u32"
        | "i16"
        | "i32"
        | "f64"
        | "uint"
        | "bool"
        | "string"
        | "baseStat";
    }
  | { readonly kind: "enum"; readonly values: readonly (string | number)[] }
  | { readonly kind: "array"; readonly item: Schema }
  | { readonly kind: "optional"; readonly value: Schema }
  | {
      readonly kind: "struct";
      readonly fields: readonly (readonly [string, Schema])[];
    }
  | { readonly kind: "map"; readonly key: Schema; readonly value: Schema };

export const wire = {
  u8: { kind: "u8" },
  u16: { kind: "u16" },
  u32: { kind: "u32" },
  i16: { kind: "i16" },
  i32: { kind: "i32" },
  f64: { kind: "f64" },
  uint: { kind: "uint" },
  bool: { kind: "bool" },
  string: { kind: "string" },
  baseStat: { kind: "baseStat" },
  enum: (values: readonly (string | number)[]): Schema => ({
    kind: "enum",
    values,
  }),
  array: (item: Schema): Schema => ({ kind: "array", item }),
  optional: (value: Schema): Schema => ({ kind: "optional", value }),
  struct: (fields: readonly (readonly [string, Schema])[]): Schema => ({
    kind: "struct",
    fields,
  }),
  map: (key: Schema, value: Schema): Schema => ({ kind: "map", key, value }),
} as const;
