import { useId, type ReactNode, type Ref } from "react";
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
  suffix?: ReactNode;
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
  invalid = false,
  onOptionHighlighted,
  popupRef,
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
  invalid?: boolean;
  onOptionHighlighted?(option: LabeledSelectOption | undefined): void;
  popupRef?: Ref<HTMLDivElement>;
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
        onOpenChange={(open) => { if (!open) onOptionHighlighted?.(undefined); }}
        onValueChange={(nextValue) => {
          if (nextValue !== null) onChange(nextValue);
        }}
      >
        <Select.Trigger
          id={id}
          aria-invalid={invalid || undefined}
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
                : selected === null
                  ? placeholder
                  : <>
                      {options.find((item) => item.value === selected)?.label ?? selected}
                      {options.find((item) => item.value === selected)?.suffix}
                    </>
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
            <Select.Popup
              ref={popupRef}
              onMouseLeave={() => onOptionHighlighted?.(undefined)}
              className={`${styles.popup} ${invalid ? styles.invalid : ""}`}
            >
              <Select.List className={styles.list}>
                {options.map((option) => (
                  <Select.Item
                    className={styles.item}
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    onMouseEnter={() => onOptionHighlighted?.(option)}
                    onFocus={() => onOptionHighlighted?.(option)}
                  >
                    <Select.ItemText>{option.label}{option.suffix}</Select.ItemText>
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
