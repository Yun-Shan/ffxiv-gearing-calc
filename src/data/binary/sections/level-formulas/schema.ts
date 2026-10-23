import { wire } from "../../shared/schema.ts";

const levelModifierSchema = wire.struct([
  ["main", wire.u32],
  ["sub", wire.u32],
  ["div", wire.u32],
  ["det", wire.u32],
  ["detTrunc", wire.u32],
  ["ap", wire.u32],
  ["apTank", wire.u32],
  ["hp", wire.u32],
  ["vit", wire.f64],
  ["vitTank", wire.f64],
]);

export const levelFormulasSchema = wire.struct([
  ["jobLevelModifiers", wire.map(wire.uint, levelModifierSchema)],
  ["bluMdmgAdditions", wire.array(wire.u16)],
]);
