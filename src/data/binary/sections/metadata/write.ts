import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { metadataSchema } from "./schema.ts";

type Metadata = Pick<GeneratedDataInput, "version" | "provenance">;

export function writeSection(value: Metadata): Uint8Array {
  return encodeSection(metadataSchema, value, "METADATA_BINARY");
}
