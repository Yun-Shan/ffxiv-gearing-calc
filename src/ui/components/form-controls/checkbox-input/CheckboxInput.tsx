import { Checkbox } from "@base-ui/react/checkbox";
import { useId, type ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import styles from "./CheckboxInput.module.scss";
export function CheckboxInput({
  label,
  checked,
  indeterminate = false,
  value,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked?: boolean;
  indeterminate?: boolean;
  value?: string;
  onChange?(value: boolean): void;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <label className={styles.label} data-disabled={disabled || undefined}>
      <Checkbox.Root
        className={styles.control}
        aria-labelledby={labelId}
        value={value}
        checked={checked}
        indeterminate={indeterminate}
        onCheckedChange={onChange}
        disabled={disabled}
      >
        <Checkbox.Indicator>
          {indeterminate ? (
            <Minus size={14} aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span id={labelId}>{label}</span>
    </label>
  );
}
