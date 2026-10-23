import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { levelFormulasSchema } from "./schema.ts";

type LevelFormulas = Pick<
  GeneratedDataInput,
  "jobLevelModifiers" | "bluMdmgAdditions"
>;

export function readSection(bytes: Uint8Array): LevelFormulas {
  return decodeSection<LevelFormulas>(
    levelFormulasSchema,
    bytes,
    "LEVEL_FORMULAS_BINARY",
  );
}
