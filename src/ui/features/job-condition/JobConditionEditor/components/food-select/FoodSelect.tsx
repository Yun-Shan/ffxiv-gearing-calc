import { Check } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import type { Stats } from "@/domain";
import { SearchSelect } from "@/ui/components/form-controls/search-select/SearchSelect";
import { EquipmentIcon } from "@/ui/components/equipment-icon/EquipmentIcon";
import { statName } from "@/ui/services/labels";
import { itemIconId } from "@/ui/services/item-icons";
import { foodOptionsFor } from "@/ui/services/app-config";
import type { FoodDraft } from "../../../types";
import styles from "./FoodSelect.module.scss";

interface FoodOption {
  id: number;
  name: string;
  level?: number;
  stats: Stats;
  statRates: Stats;
}

const autoOption: FoodOption = {
  id: 0,
  name: "自动选择",
  stats: {},
  statRates: {},
};

export function FoodSelect({
  label,
  food,
  disabled,
  onChange,
}: {
  label: string;
  food: FoodDraft;
  disabled?: boolean;
  onChange(food: FoodDraft): void;
}) {
  const [hovered, setHovered] = useState<FoodOption>();
  const listRef = useRef<HTMLDivElement>(null);
  const items = [
    autoOption,
    ...foodOptionsFor(food.mode === "specific" ? food.foodId : undefined)
      .toSorted((left, right) => right.id - left.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        level: item.level,
        stats: item.stats,
        statRates: item.statRates,
      })),
  ];
  const value = items.find(
    (item) => item.id === (food.mode === "specific" ? food.foodId : 0),
  );
  const hoveredStats = hovered
    ? Object.entries(hovered.stats)
        .filter(([, value]) => typeof value === "number" && value > 0)
        .sort(([left], [right]) => left.localeCompare(right))
    : [];
  return (
    <>
      <SearchSelect
        controlSize="wide"
        label={label}
        layout="inline"
        placeholder="搜索食物名称"
        items={items}
        value={value}
        disabled={disabled}
        getLabel={(item) => item.name}
        getKey={(item) => String(item.id)}
        popupRef={listRef}
        onOpenChange={(open) => {
          if (!open) setHovered(undefined);
        }}
        onItemHighlighted={(item) => {
          setHovered(item && item.id !== 0 ? item : undefined);
        }}
        renderOption={(item, { selected }) => (
          <span className={styles.option}>
            {item.id === 0 ? (
              <span className={styles.autoIcon} aria-hidden="true" />
            ) : (
              <EquipmentIcon
                iconId={itemIconId(item.id)}
                className={styles.icon}
              />
            )}
            <span className={styles.name}>{item.name}</span>
            {item.level !== undefined && (
              <span className={styles.level}>品级 {item.level}</span>
            )}
            {selected && (
              <Check size={14} className={styles.check} aria-hidden="true" />
            )}
          </span>
        )}
        onSelect={(item) => {
          setHovered(undefined);
          onChange(
            item.id === 0
              ? { mode: "auto" }
              : { mode: "specific", foodId: item.id },
          );
        }}
        onClear={
          food.mode === "specific"
            ? () => {
                setHovered(undefined);
                onChange({ mode: "auto" });
              }
            : undefined
        }
      />
      <Popover.Root open={hovered !== undefined}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={listRef.current}
            className={styles.statsPositioner}
            side="left"
            align="center"
            sideOffset={8}
            collisionAvoidance={{
              side: "flip",
              align: "shift",
              fallbackAxisSide: "none",
            }}
          >
            <Popover.Popup
              className={styles.statsPopup}
              aria-label="食物属性"
              initialFocus={false}
              finalFocus={false}
            >
              {hovered && (
                <>
                  <strong className={styles.statsTitle}>{hovered.name}</strong>
                  <ul className={styles.statsList}>
                    {hoveredStats.map(([stat, value]) => (
                      <li className={styles.statsRow} key={stat}>
                        <span>{statName(stat)}</span>
                        <span className={styles.statsValue}>+{value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
