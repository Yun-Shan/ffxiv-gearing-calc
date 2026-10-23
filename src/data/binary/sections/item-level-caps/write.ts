import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { compactLevelCaps } from "./compact.ts";
import { itemLevelCapsSectionSchema } from "./schema.ts";

type ItemLevelCaps = Pick<GeneratedDataInput, "levelCaps">;

export function writeSection(value: ItemLevelCaps): Uint8Array {
  return encodeSection(
    itemLevelCapsSectionSchema,
    compactLevelCaps(value),
    "ITEM_LEVEL_CAPS_BINARY",
  );
}
