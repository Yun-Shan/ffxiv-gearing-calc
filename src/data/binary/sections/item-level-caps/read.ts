import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { expandLevelCaps, type CompactLevelCaps } from "./compact.ts";
import { itemLevelCapsSectionSchema } from "./schema.ts";

type ItemLevelCaps = Pick<GeneratedDataInput, "levelCaps">;

export function readSection(bytes: Uint8Array): ItemLevelCaps {
  const compact = decodeSection<CompactLevelCaps>(
    itemLevelCapsSectionSchema,
    bytes,
    "ITEM_LEVEL_CAPS_BINARY",
  );
  return expandLevelCaps(compact);
}
