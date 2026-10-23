import { wire } from "../../shared/schema.ts";

export const MATERIA_STATS = [
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
] as const;
const materiaStatSchema = wire.enum(MATERIA_STATS);

export const materiaSchema = wire.struct([
  ["materias", wire.map(materiaStatSchema, wire.array(wire.u16))],
  ["materiaGradeRequiredLevels", wire.array(wire.u16)],
  ["materiaGradeIsRestricted", wire.array(wire.bool)],
]);
