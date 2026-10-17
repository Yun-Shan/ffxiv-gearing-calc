import { Field } from "@base-ui/react/field";
import type { ReactNode } from "react";
import styles from "./FormField.module.scss";
export type ControlSize =
  "compact" | "regular" | "wide" | "slot" | "fit" | "strategy";
export type LabelLayout = "stacked" | "inline";
export function FormField({
  label,
  id,
  layout = "stacked",
  controlSize,
  hideLabel = false,
  children,
}: {
  label: string;
  id: string;
  layout?: LabelLayout;
  controlSize?: ControlSize;
  hideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <Field.Root
      className={`${styles.field} ${layout === "inline" && !hideLabel ? styles.inline : ""}`}
    >
      <Field.Label
        className={`${styles.label} ${hideLabel ? styles.visuallyHidden : ""} ${controlSize === "strategy" && !hideLabel ? styles.strategyLabel : ""}`}
        htmlFor={id}
      >
        {label}
      </Field.Label>
      <div
        className={`${styles.content} ${controlSize ? styles[controlSize] : ""}`}
      >
        {children}
      </div>
    </Field.Root>
  );
}
