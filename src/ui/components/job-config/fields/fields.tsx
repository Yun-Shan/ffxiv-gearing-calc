import { Check } from "lucide-react";
import { selectableSyncLevels } from "../../../services/app-config";

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
  className,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={className ? "number-field " + className : "number-field"}>
      <span>{label}</span>
      <span className="number-input-wrap">
        <input
          type="number"
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

export function CheckControl({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="check-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-indicator">
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>{children}</span>
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  disabled = false,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className ? "config-field " + className : "config-field"}>
      <span className="field-label">{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function SyncLevelField({
  value,
  onChange,
  inactiveLabel,
  className,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  inactiveLabel: string;
  className?: string;
}) {
  return (
    <SelectField
      label="同步品级"
      value={value === undefined ? "" : String(value)}
      className={className}
      onChange={(selected) => onChange(selected === "" ? undefined : Number(selected))}
    >
      <option value="">{inactiveLabel}</option>
      {selectableSyncLevels.map((level) => (
        <option key={level} value={level}>{level}</option>
      ))}
    </SelectField>
  );
}
