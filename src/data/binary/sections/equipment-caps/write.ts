import type { GeneratedDataInput } from "../../types.ts";
import { encodeSection } from "../../shared/schema-write.ts";
import { equipmentCapsSchema } from "./schema.ts";

type EquipmentCaps = Pick<GeneratedDataInput, "slotCaps" | "roleCaps">;

export function writeSection(value: EquipmentCaps): Uint8Array {
  return encodeSection(equipmentCapsSchema, value, "EQUIPMENT_CAPS_BINARY");
}
