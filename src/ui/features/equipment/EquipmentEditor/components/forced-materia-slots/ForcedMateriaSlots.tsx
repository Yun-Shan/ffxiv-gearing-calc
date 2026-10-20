import { SyncIcon } from "@/ui/components/sync-icon/SyncIcon";
import { useMemo } from "react";
import { Select } from "@base-ui/react/select";
import { Check } from "lucide-react";
import {
  prepareEquipmentMateria,
  evaluateEquipmentMateria,
  type EquipmentMateriaChoice,
  type EquipmentMateriaConfig,
  type ForcedGearValue,
  type Gear,
  type Materia,
} from "@/domain";
import { statNames } from "@/ui/services/labels";
import styles from "./ForcedMateriaSlots.module.scss";
import { CustomEquipmentParameters } from "../custom-equipment-parameters/CustomEquipmentParameters";

interface ForcedMateriaSlotsProps {
  gear: Gear;
  config: EquipmentMateriaConfig;
  readOnly: boolean;
  value: ForcedGearValue;
  onChange(value: ForcedGearValue): void;
}

export function ForcedMateriaSlots(props: ForcedMateriaSlotsProps) {
  return props.gear.customParameters !== undefined ||
    props.gear.resistanceWeaponAdjust !== undefined ? (
    <CustomEquipmentParameters {...props} />
  ) : (
    <RegularMateriaSlots {...props} />
  );
}

function RegularMateriaSlots({
  gear,
  config,
  readOnly,
  value: forcedValue,
  onChange,
}: ForcedMateriaSlotsProps) {
  // Gear records are decoded again by some parent catalogs; identity is stable within the data snapshot.
  const prepared = useMemo(
    () => prepareEquipmentMateria(gear, config),
    [gear.id, config.jobId, config.syncLevel],
  );
  const melds =
    typeof forcedValue !== "number" &&
    "melds" in forcedValue &&
    forcedValue.id === gear.id
      ? forcedValue.melds
      : [];
  const selections = useMemo<EquipmentMateriaChoice[]>(
    () => prepared.slots.map((_, index) => melds[index]?.stat ?? ("auto" as const)),
    [melds, prepared],
  );
  const menuOptions = useMemo(
    () =>
      prepared.slots.map((slot) => [
        { value: "auto" as const, label: "自动" },
        ...slot.options.map((option) => ({
          value: option.stat,
          label: `${statNames[option.stat]} +${option.value}`,
        })),
      ]),
    [prepared],
  );
  const description = evaluateEquipmentMateria(prepared, selections);
  if (description.synchronized) {
    return (
      <SyncIcon className={styles.syncIcon} aria-label="品级同步后魔晶石不生效" />
    );
  }
  return (
    <span className={styles.root} aria-label="魔晶石孔位">
      {description.slots.map((slot, index) => {
        const value = selections[index] ?? "auto";
        const selected = slot.options.find((option) => option.stat === value);
        const kind = slot.safe ? "安全孔" : "禁断孔";
        const label = `${gear.name} ${kind} ${index + 1}`;
        const options = menuOptions[index]!;
        return (
          <Select.Root<EquipmentMateriaChoice>
            key={index}
            value={value}
            items={options}
            disabled={readOnly || description.disabledReason !== undefined}
            onValueChange={(next) => {
              if (next === null) return;
              const updated: (Materia | null)[] = prepared.slots.map(
                (_, slotIndex) =>
                  slotIndex === index
                    ? next === "auto"
                      ? null
                      : prepared.slots[slotIndex]!.options.find(
                          (option) => option.stat === next,
                        ) ?? null
                    : melds[slotIndex] ?? null,
              );
              onChange(
                updated.every((meld) => meld === null)
                  ? gear.id
                  : { id: gear.id, melds: updated },
              );
            }}
          >
            <Select.Trigger
              className={`${styles.hole} ${slot.safe ? styles.safe : styles.overmeld}`}
              aria-label={label}
              title={description.disabledReason ?? `${kind} ${index + 1}`}
            >
              <span>{selected ? statNames[selected.stat] : "自动"}</span>
              <span className={styles.value}>
                {selected ? `+${selected.value}` : "—"}
              </span>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner
                className={styles.positioner}
                sideOffset={4}
                align="start"
                alignItemWithTrigger={false}
              >
                <Select.Popup className={styles.popup}>
                  <Select.List aria-label={`${label}选择`}>
                    {options.map((option) => {
                      const attribute = description.attributes.find(
                        (attribute) => attribute.stat === option.value,
                      );
                      return (
                        <Select.Item
                          key={option.value}
                          value={option.value}
                          className={styles.option}
                        >
                          <Select.ItemIndicator
                            keepMounted
                            className={styles.indicator}
                          >
                            <Check size={14} aria-hidden="true" />
                          </Select.ItemIndicator>
                          <Select.ItemText>{option.label}</Select.ItemText>
                          <span
                            className={`${styles.attribute} ${attribute && attribute.total > attribute.cap ? styles.overCap : attribute && attribute.total === attribute.cap ? styles.atCap : ""}`}
                            aria-label={
                              attribute
                                ? `${statNames[attribute.stat]}当前 ${attribute.total}，上限 ${attribute.cap}`
                                : undefined
                            }
                          >
                            {attribute
                              ? `${attribute.total} / ${attribute.cap}`
                              : ""}
                          </span>
                        </Select.Item>
                      );
                    })}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        );
      })}
    </span>
  );
}
