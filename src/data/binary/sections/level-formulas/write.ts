import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { levelFormulasSchema } from "./schema.ts";

type LevelFormulas = Pick<
  GeneratedDataInput,
  "jobLevelModifiers" | "bluMdmgAdditions"
>;

export function writeSection(value: LevelFormulas): Uint8Array {
  return encodeSection(levelFormulasSchema, value, "LEVEL_FORMULAS_BINARY");
}
