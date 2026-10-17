import { useId } from "react";
import {
  FormField,
  type LabelLayout,
  type ControlSize,
} from "../form-field/FormField";
import { Select } from "@base-ui/react/select";
import styles from "./LabeledSelect.module.scss";

export interface LabeledSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type SelectValue<Multiple extends boolean> = Multiple extends true
  ? string[]
  : string;

export function LabeledSelect<Multiple extends boolean = false>({
  label,
  multiple,
  placeholder = "请选择",
  value,
  options,
  onChange,
  disabled = false,
  layout = "stacked",
  controlSize,
  hideLabel,
}: {
  label: string;
  multiple?: Multiple;
  placeholder?: string;
  value: SelectValue<Multiple> | null;
  options: readonly LabeledSelectOption[];
  onChange(value: SelectValue<Multiple>): void;
  disabled?: boolean;
  layout?: LabelLayout;
  controlSize?: ControlSize;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <FormField
      id={id}
      label={label}
      layout={layout}
      controlSize={controlSize}
      hideLabel={hideLabel}
    >
      <Select.Root<string, Multiple>
        multiple={multiple}
        value={value}
        items={options}
        disabled={disabled}
        onValueChange={(nextValue) => {
          if (nextValue !== null) onChange(nextValue);
        }}
      >
        <Select.Trigger
          id={id}
          className={`${styles.trigger} ${multiple ? styles.multiple : ""} ${controlSize === "slot" ? styles.slot : ""} ${controlSize === "fit" ? styles.fit : ""} ${controlSize === "strategy" ? styles.strategy : ""}`}
        >
          <Select.Value
            className={styles.value}
            title={
              Array.isArray(value)
                ? value
                    .map(
                      (selected) =>
                        options.find((item) => item.value === selected)
                          ?.label ?? selected,
                    )
                    .join("、")
                : undefined
            }
          >
            {(selected: string | string[] | null) =>
              Array.isArray(selected)
                ? selected.length
                  ? selected
                      .map(
                        (value) =>
                          options.find((item) => item.value === value)?.label ??
                          value,
                      )
                      .join("、")
                  : placeholder
                : (options.find((item) => item.value === selected)?.label ??
                  selected ??
                  placeholder)
            }
          </Select.Value>
          <Select.Icon className={styles.icon} aria-hidden="true">
            ▾
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            className={styles.positioner}
            sideOffset={4}
            alignItemWithTrigger={false}
          >
            <Select.Popup className={styles.popup}>
              <Select.List className={styles.list}>
                {options.map((option) => (
                  <Select.Item
                    className={styles.item}
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator
                      className={styles.indicator}
                      aria-hidden="true"
                    >
                      ✓
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </FormField>
  );
}
