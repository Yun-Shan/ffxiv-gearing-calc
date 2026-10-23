import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { characterStatsSchema } from "./schema.ts";

type CharacterStats = Pick<GeneratedDataInput, "baseStats" | "clanStats">;

export function writeSection(value: CharacterStats): Uint8Array {
  return encodeSection(characterStatsSchema, value, "CHARACTER_STATS_BINARY");
}
