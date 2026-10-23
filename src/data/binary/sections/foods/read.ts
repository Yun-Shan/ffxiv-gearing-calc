import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { foodsSchema } from "./schema.ts";

type Foods = Pick<GeneratedDataInput, "foods">;

export function readSection(bytes: Uint8Array): Foods {
  return decodeSection<Foods>(foodsSchema, bytes, "FOODS_BINARY");
}
