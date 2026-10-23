import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { foodsSchema } from "./schema.ts";

type Foods = Pick<GeneratedDataInput, "foods">;

export function writeSection(value: Foods): Uint8Array {
  return encodeSection(foodsSchema, value, "FOODS_BINARY");
}
