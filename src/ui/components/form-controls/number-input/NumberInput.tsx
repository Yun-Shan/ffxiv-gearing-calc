import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
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
  debounceMs = 0,
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
  debounceMs?: number;
}) {
  const id = useId();
  const [localValue, setLocalValue] = useState(value ?? null);
  const [resetKey, setResetKey] = useState(0);
  const pending = useRef<number | null>(value ?? null);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    window.clearTimeout(timer.current);
    // NumberField preserves focused text; an external replacement must discard it.
    if (debounceMs > 0 && (value ?? null) !== pending.current) {
      setResetKey((current) => current + 1);
    }
    dirty.current = false;
    pending.current = value ?? null;
    setLocalValue(value ?? null);
    return () => window.clearTimeout(timer.current);
  }, [value, disabled, debounceMs]);

  function flush() {
    window.clearTimeout(timer.current);
    if (!dirty.current || disabled) return;
    dirty.current = false;
    onChangeRef.current(pending.current);
  }

  function change(nextValue: number | null) {
    if (debounceMs <= 0) {
      onChange(nextValue);
      return;
    }
    setLocalValue(nextValue);
    pending.current = nextValue;
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, debounceMs);
  }
  return (
    <FormField
      id={id}
      label={label}
      layout={layout}
      controlSize={controlSize}
      hideLabel={hideLabel}
    >
      <NumberField.Root
        key={resetKey}
        className={styles.root}
        id={id}
        value={debounceMs > 0 ? localValue : value ?? null}
        onValueChange={change}
        onBlur={debounceMs > 0 ? flush : undefined}
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
