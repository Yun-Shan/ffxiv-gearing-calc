import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { characterStatsSchema } from "./schema.ts";

type CharacterStats = Pick<GeneratedDataInput, "baseStats" | "clanStats">;

export function readSection(bytes: Uint8Array): CharacterStats {
  return decodeSection<CharacterStats>(
    characterStatsSchema,
    bytes,
    "CHARACTER_STATS_BINARY",
  );
}
