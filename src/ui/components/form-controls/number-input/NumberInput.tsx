import { type CSSProperties, useId } from "react";
import { NumberField } from "@base-ui/react/number-field";
import {
  FormField,
  type LabelLayout,
  type ControlSize,
} from "../form-field/FormField";
import styles from "./NumberInput.module.scss";
export function NumberInput({
  label,
  value,
  onChange,
  layout = "inline",
  controlSize = "fit",
  disabled,
  min,
  max,
  step,
  invalid,
  suffix,
  minDigits,
  hideLabel,
}: {
  label: string;
  value?: number | null;
  onChange(value: number | null): void;
  layout?: LabelLayout;
  controlSize?: ControlSize;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  suffix?: string;
  minDigits?: number;
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
      <NumberField.Root
        className={styles.root}
        id={id}
        value={value ?? null}
        onValueChange={onChange}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        allowOutOfRange
        format={{ useGrouping: false }}
      >
        <NumberField.Group
          className={styles.group}
          style={
            minDigits === undefined
              ? undefined
              : ({ "--number-min-digits": minDigits } as CSSProperties)
          }
        >
          <NumberField.Input
            className={styles.input}
            aria-invalid={invalid || undefined}
          />
          {suffix && <span>{suffix}</span>}
        </NumberField.Group>
      </NumberField.Root>
    </FormField>
  );
}
