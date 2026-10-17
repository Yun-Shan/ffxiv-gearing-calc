import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { GearSlot } from "@/domain";
import { gearSlotLabels } from "@/ui/services/labels";
import { EquipmentIcon } from "@/ui/components/equipment-icon/EquipmentIcon";
import styles from "./EquipmentOptionRow.module.scss";

export function EquipmentOptionRow({
  slot,
  iconId,
  name,
  level,
  source,
  selected = false,
  nameSuffix,
}: {
  slot: GearSlot;
  iconId?: number;
  name: string;
  level: number;
  source?: string;
  selected?: boolean;
  nameSuffix?: ReactNode;
}) {
  return (
    <div className={`${styles.row} ${selected ? styles.selected : ""}`}>
      <span className={styles.slot}>
        {selected && (
          <Check size={14} className={styles.check} aria-hidden="true" />
        )}
        <span>
          {slot === "ring" || slot === "ring2" ? "戒指" : gearSlotLabels[slot]}
        </span>
      </span>
      <EquipmentIcon iconId={iconId} />
      <span className={styles.name}>
        {name}
        {nameSuffix}
      </span>
      <span className={styles.source} title={source ?? "来源未标注"}>
        {source ?? "—"}
      </span>
      <span className={styles.level}>品级 {level}</span>
    </div>
  );
}
