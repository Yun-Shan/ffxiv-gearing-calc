import { Check } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { useId, useRef, useState } from "react";
import type { Stats } from "@/domain";
import { FormField } from "@/ui/components/form-controls/form-field/FormField";
import { GameIcon } from "@/ui/components/game-icon/GameIcon";
import { statName } from "@/ui/services/labels";
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

function FoodOptionContent({
  item,
  selected = false,
  compact = false,
}: {
  item: FoodOption;
  selected?: boolean;
  compact?: boolean;
}) {
  return (
    <span className={`${styles.option} ${compact ? styles.selected : ""}`}>
      {item.id === 0 ? (
        <span className={styles.autoIcon} aria-hidden="true" />
      ) : (
        <GameIcon itemId={item.id} className={styles.icon} />
      )}
      <span className={styles.name}>{item.name}</span>
      {item.level !== undefined && (
        <span className={styles.level}>品级 {item.level}</span>
      )}
      {selected && (
        <Check size={14} className={styles.check} aria-hidden="true" />
      )}
    </span>
  );
}

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
  const id = useId();
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
      <FormField id={id} label={label} layout="inline" controlSize="wide">
        <Select.Root
          value={value?.id ?? 0}
          disabled={disabled}
          onOpenChange={(open) => {
            if (!open) setHovered(undefined);
          }}
          onValueChange={(next) => {
            setHovered(undefined);
            onChange(
              next === 0 || next === null
                ? { mode: "auto" }
                : { mode: "specific", foodId: next },
            );
          }}
        >
          <Select.Trigger id={id} aria-label={label} className={styles.trigger}>
            <Select.Value className={styles.value}>
              {() =>
                value &&
                (value.id === 0 ? (
                  value.name
                ) : (
                  <FoodOptionContent item={value} compact />
                ))
              }
            </Select.Value>
            <Select.Icon aria-hidden="true">▾</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner
              className={styles.positioner}
              sideOffset={4}
              alignItemWithTrigger={false}
            >
              <Select.Popup
                ref={listRef}
                className={styles.popup}
                onMouseLeave={() => setHovered(undefined)}
              >
                <Select.List className={styles.list}>
                  {items.map((item) => (
                    <Select.Item
                      key={item.id}
                      value={item.id}
                      label={item.name}
                      className={styles.item}
                      onMouseEnter={() =>
                        setHovered(item.id === 0 ? undefined : item)
                      }
                      onFocus={() =>
                        setHovered(item.id === 0 ? undefined : item)
                      }
                    >
                      <Select.ItemText className={styles.value}>
                        <FoodOptionContent
                          item={item}
                          selected={item.id === value?.id}
                        />
                      </Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </FormField>
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
              <strong className={styles.statsTitle}>{hovered?.name}</strong>
              <ul className={styles.statsList}>
                {hoveredStats.map(([stat, value]) => (
                  <li className={styles.statsRow} key={stat}>
                    <span>{statName(stat)}</span>
                    <span className={styles.statsValue}>+{value}</span>
                  </li>
                ))}
              </ul>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
