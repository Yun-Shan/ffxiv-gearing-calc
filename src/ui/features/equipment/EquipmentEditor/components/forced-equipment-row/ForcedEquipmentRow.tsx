import type {
  EquipmentMateriaConfig,
  ForcedGearValue,
  Gear,
  GearSlot,
} from "@/domain";
import { EquipmentOptionRow } from "@/ui/components/equipment-option-row/EquipmentOptionRow";
import { itemIconId } from "@/ui/services/icons";
import { ForcedMateriaSlots } from "../forced-materia-slots/ForcedMateriaSlots";
import styles from "../../EquipmentEditor.module.scss";

export function ForcedEquipmentRow({
  gear,
  slot,
  value,
  config,
  readOnly,
  onChange,
  onRemove,
}: {
  gear: Gear;
  slot: GearSlot;
  value: ForcedGearValue;
  config?: EquipmentMateriaConfig;
  readOnly: boolean;
  onChange(value: ForcedGearValue): void;
  onRemove?(): void;
}) {
  return (
    <li>
      <EquipmentOptionRow
        className={styles.forcedEquipmentRow}
        iconInName
        slot={slot}
        iconId={itemIconId(gear.id)}
        name={gear.name}
        level={gear.level}
        source={gear.source}
        afterName={
          config ? (
            <ForcedMateriaSlots
              key={`${gear.id}:${config.jobId}:${gear.customParameters || gear.resistanceWeaponAdjust ? "custom" : "materia"}`}
              gear={gear}
              config={config}
              readOnly={readOnly}
              value={value}
              onChange={onChange}
            />
          ) : (
            <span />
          )
        }
      />
      {onRemove && (
        <button type="button" disabled={readOnly} onClick={onRemove}>
          移除
        </button>
      )}
    </li>
  );
}
