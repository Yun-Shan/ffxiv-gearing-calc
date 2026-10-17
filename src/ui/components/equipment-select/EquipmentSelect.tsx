import { SearchSelect } from "@/ui/components/form-controls/search-select/SearchSelect";
import type { GearSlot } from "@/domain";
import { equipmentIconId } from "@/ui/services/equipment-icons";
import { EquipmentOptionRow } from "@/ui/components/equipment-option-row/EquipmentOptionRow";

export interface EquipmentSelectionItem {
  id: number;
  slot: GearSlot;
  name: string;
  level: number;
  source?: string;
}

export function EquipmentSelect<T extends EquipmentSelectionItem>(props: {
  label: string;
  hideLabel?: boolean;
  placeholder: string;
  items: readonly T[];
  value?: T;
  onSelect(gear: T): void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  return (
    <SearchSelect
      {...props}
      virtualized
      getLabel={(gear) => gear.name}
      getKey={(gear) => String(gear.id)}
      renderOption={(gear, { selected }) => (
        <EquipmentOptionRow
          selected={selected}
          slot={gear.slot}
          name={gear.name}
          level={gear.level}
          source={gear.source}
          iconId={equipmentIconId(gear.id)}
        />
      )}
      matches={(gear, query) =>
        `${gear.name} ${gear.level}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())
      }
    />
  );
}
