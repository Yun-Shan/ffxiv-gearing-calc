import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { syncSectionSchema } from "./schema.ts";

type Sync = Pick<GeneratedDataInput, "sync">;

export function readSection(bytes: Uint8Array): Sync {
  return decodeSection<Sync>(syncSectionSchema, bytes, "SYNC_BINARY");
}
