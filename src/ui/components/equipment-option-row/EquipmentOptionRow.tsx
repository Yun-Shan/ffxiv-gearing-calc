import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { GearSlot } from "@/domain";
import { gearSlotLabels } from "@/ui/services/labels";
import { GameIcon } from "@/ui/components/game-icon/GameIcon";
import styles from "./EquipmentOptionRow.module.scss";

export function EquipmentOptionRow({
  slot,
  itemId,
  name,
  level,
  source,
  selected = false,
  nameSuffix,
  afterName,
  className = "",
  iconInName = false,
}: {
  slot: GearSlot;
  itemId?: number;
  name: string;
  level: number;
  source?: string;
  selected?: boolean;
  nameSuffix?: ReactNode;
  afterName?: ReactNode;
  className?: string;
  iconInName?: boolean;
}) {
  return (
    <div
      className={`${styles.row} ${selected ? styles.selected : ""} ${afterName ? styles.withAfterName : ""} ${iconInName ? styles.iconInName : ""} ${className}`}
    >
      <span className={styles.slot}>
        {selected && (
          <Check size={14} className={styles.check} aria-hidden="true" />
        )}
        <span>
          {slot === "ring" || slot === "ring2" ? "戒指" : gearSlotLabels[slot]}
        </span>
      </span>
      {!iconInName && <GameIcon itemId={itemId} />}
      <span className={styles.name}>
        {iconInName && <GameIcon itemId={itemId} />}
        <span>
          {name}
          {nameSuffix}
        </span>
      </span>
      {afterName}
      <span className={styles.source} title={source ?? "来源未标注"}>
        {source ?? "—"}
      </span>
      <span className={styles.level}>品级 {level}</span>
    </div>
  );
}
