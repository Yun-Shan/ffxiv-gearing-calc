import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { materiaSchema } from "./schema.ts";

type Materia = Pick<
  GeneratedDataInput,
  "materias" | "materiaGradeRequiredLevels" | "materiaGradeIsRestricted"
>;

export function readSection(bytes: Uint8Array): Materia {
  return decodeSection<Materia>(materiaSchema, bytes, "MATERIA_BINARY");
}
