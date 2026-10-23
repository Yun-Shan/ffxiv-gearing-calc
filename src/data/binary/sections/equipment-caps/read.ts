import type { GeneratedDataInput } from "../../types.ts";
import { decodeSection } from "../../shared/schema-read.ts";
import { equipmentCapsSchema } from "./schema.ts";

type EquipmentCaps = Pick<GeneratedDataInput, "slotCaps" | "roleCaps">;

export function readSection(bytes: Uint8Array): EquipmentCaps {
  return decodeSection<EquipmentCaps>(
    equipmentCapsSchema,
    bytes,
    "EQUIPMENT_CAPS_BINARY",
  );
}
