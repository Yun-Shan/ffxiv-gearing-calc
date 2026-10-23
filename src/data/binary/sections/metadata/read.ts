import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { metadataSchema } from "./schema.ts";

type Metadata = Pick<GeneratedDataInput, "version" | "provenance">;

export function readSection(bytes: Uint8Array): Metadata {
  return decodeSection<Metadata>(metadataSchema, bytes, "METADATA_BINARY");
}
