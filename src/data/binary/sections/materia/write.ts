import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { materiaSchema } from "./schema.ts";

type Materia = Pick<
  GeneratedDataInput,
  "materias" | "materiaGradeRequiredLevels" | "materiaGradeIsRestricted"
>;

export function writeSection(value: Materia): Uint8Array {
  return encodeSection(materiaSchema, value, "MATERIA_BINARY");
}
