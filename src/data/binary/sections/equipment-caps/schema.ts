import { wire } from "../../shared/schema.ts";
import { CAP_COLUMNS } from "../item-level-caps/schema.ts";

const capsSchema = wire.struct(
  CAP_COLUMNS.map((column) => [column, wire.array(wire.u32)] as const),
);

export const equipmentCapsSchema = wire.struct([
  ["slotCaps", capsSchema],
  ["roleCaps", capsSchema],
]);
