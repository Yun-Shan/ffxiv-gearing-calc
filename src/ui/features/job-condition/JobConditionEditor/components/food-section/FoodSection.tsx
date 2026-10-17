import { useJobConditionScope } from "../../../scope";
import { FoodSelect } from "../food-select/FoodSelect";
import styles from "./FoodSection.module.scss";

export function FoodSection() {
  const { draft, updateDraft, validation, readOnly, foodDisabled } =
    useJobConditionScope();
  const issues = validation?.sections.food.issues ?? [];

  return (
    <section className={styles.section} aria-label="食物">
      <h2 className={styles.title}>食物</h2>
      <FoodSelect
        label="食物选择"
        food={draft.food}
        disabled={readOnly || foodDisabled}
        onChange={(food) => updateDraft((current) => ({ ...current, food }))}
      />
      {foodDisabled && (
        <p className={styles.note} title="此职业的编辑值会在当前条件会话内保留">
          使用共享食物
        </p>
      )}
      {issues.map((entry, index) => (
        <p className={styles.issue} key={`${entry.code}-${index}`}>
          {entry.message}
        </p>
      ))}
    </section>
  );
}
