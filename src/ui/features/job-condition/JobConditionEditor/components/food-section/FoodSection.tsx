import { useJobConditionScope } from "../../../scope";
import { FoodSelect } from "../food-select/FoodSelect";
import styles from "./FoodSection.module.scss";

export function FoodSection() {
  const { draft, updateDraft, readOnly, foodDisabled } =
    useJobConditionScope();

  return (
    <section className={styles.section} aria-label="食物">
      <h2 className={styles.title}>食物</h2>
      <FoodSelect
        label="食物选择"
        food={draft.food}
        disabled={readOnly || foodDisabled}
        onChange={(food) => updateDraft((current) => ({ ...current, food }))}
      />
    </section>
  );
}
