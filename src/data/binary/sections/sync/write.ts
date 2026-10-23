import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { syncSectionSchema } from "./schema.ts";

type Sync = Pick<GeneratedDataInput, "sync">;

export function writeSection(value: Sync): Uint8Array {
  return encodeSection(syncSectionSchema, value, "SYNC_BINARY");
}
