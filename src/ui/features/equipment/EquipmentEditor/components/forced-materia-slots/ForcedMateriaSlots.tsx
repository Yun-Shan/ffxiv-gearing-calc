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
    [gear.id, config.jobId, config.sync?.kind, config.sync?.value],
  );
  const melds =
    typeof forcedValue !== "number" &&
    "melds" in forcedValue &&
    forcedValue.id === gear.id
      ? forcedValue.melds
      : [];
  const selections = useMemo<SlotChoice[]>(
    () =>
      prepared.slots.map((slot, index) => {
        const meld = melds[index];
        if (!meld) return "auto";
        const available = slot.options.find(
          (option) => option.stat === meld.stat,
        );
        return available?.value === meld.value &&
          available?.grade === meld.grade
          ? meld.stat
          : "__imported";
      }),
    [melds, prepared],
  );
  const effectivePrepared = useMemo(
    () => ({
      ...prepared,
      slots: prepared.slots.map((slot, index) => {
        if (selections[index] !== "__imported") return slot;
        const imported = melds[index];
        if (!imported) return slot;
        const options = [...slot.options];
        const existingIndex = options.findIndex(
          (option) => option.stat === imported.stat,
        );
        if (existingIndex < 0) options.push(imported);
        else options[existingIndex] = imported;
        return { ...slot, options };
      }),
    }),
    [melds, prepared, selections],
  );
  const menuOptions = useMemo(
    () =>
      prepared.slots.map((slot, index) => {
        const imported =
          selections[index] === "__imported" ? melds[index] : undefined;
        const options: { value: SlotChoice; label: string }[] = [
          { value: "auto", label: "自动" },
        ];
        let importedAdded = false;
        for (const option of slot.options) {
          if (imported?.stat === option.stat) {
            options.push({
              value: "__imported",
              label: `${statNames[imported.stat]} +${imported.value}（${imported.grade}级已导入）`,
            });
            importedAdded = true;
          }
          options.push({
            value: option.stat,
            label: `${statNames[option.stat]} +${option.value}`,
          });
        }
        if (imported && !importedAdded) {
          options.push({
            value: "__imported",
            label: `${statNames[imported.stat]} +${imported.value}（${imported.grade}级已导入）`,
          });
        }
        return options;
      }),
    [melds, prepared, selections],
  );
  const evaluationSelections = selections.map((selection, index) =>
    selection === "__imported" ? (melds[index]?.stat ?? "auto") : selection,
  );
  const description = evaluateEquipmentMateria(
    effectivePrepared,
    evaluationSelections,
  );
  if (description.synchronized) {
    return (
      <SyncIcon
        className={styles.syncIcon}
        aria-label="品级同步后魔晶石不生效"
      />
    );
  }
  return (
    <span className={styles.root} aria-label="魔晶石孔位">
      {description.slots.map((slot, index) => {
        const value = selections[index] ?? "auto";
        const selected =
          value === "__imported"
            ? melds[index]
            : slot.options.find((option) => option.stat === value);
        const kind = slot.safe ? "安全孔" : "禁断孔";
        const label = `${gear.name} ${kind} ${index + 1}`;
        const options = menuOptions[index]!;
        return (
          <Select.Root<SlotChoice>
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
                      : next === "__imported"
                        ? (melds[slotIndex] ?? null)
                        : (prepared.slots[slotIndex]!.options.find(
                            (option) => option.stat === next,
                          ) ?? null)
                    : (melds[slotIndex] ?? null),
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
                      const attributeStat =
                        option.value === "__imported"
                          ? melds[index]?.stat
                          : option.value;
                      const attribute = description.attributes.find(
                        (attribute) => attribute.stat === attributeStat,
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

type SlotChoice = EquipmentMateriaChoice | "__imported";
