import { useId, type ComponentProps } from "react";
import { Input } from "@base-ui/react/input";
import {
  FormField,
  type LabelLayout,
  type ControlSize,
} from "../form-field/FormField";
import styles from "./TextInput.module.scss";
export function TextInput({
  label,
  layout,
  controlSize,
  ...props
}: Omit<ComponentProps<typeof Input>, "className"> & {
  label: string;
  layout?: LabelLayout;
  controlSize?: ControlSize;
}) {
  const id = useId();
  return (
    <FormField id={id} label={label} layout={layout} controlSize={controlSize}>
      <Input {...props} id={id} className={styles.input} />
    </FormField>
  );
}
