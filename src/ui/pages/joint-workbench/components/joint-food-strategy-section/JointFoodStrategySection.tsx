import { FoodSelect } from "@/ui/features/job-condition/JobConditionEditor/components/food-select/FoodSelect";
import { LabeledSelect } from "@/ui/components/form-controls/labeled-select/LabeledSelect";
import type { FoodDraft } from "../../joint-workbench-types";
import styles from "./JointFoodStrategySection.module.scss";

export function JointFoodStrategySection({
  strategy,
  food,
  onStrategyChange,
  onFoodChange,
}: {
  strategy: "shared" | "independent";
  food: FoodDraft;
  onStrategyChange(strategy: "shared" | "independent"): void;
  onFoodChange(food: FoodDraft): void;
}) {
  return (
    <section className={styles.section} aria-label="食物策略">
      <h2>食物策略</h2>
      <div className={styles.controls}>
        <LabeledSelect
          controlSize="regular"
          label="食物策略"
          layout="inline"
          value={strategy}
          options={[
            { value: "shared", label: "全职业共用" },
            { value: "independent", label: "各职业独立" },
          ]}
          onChange={(value) =>
            onStrategyChange(value as "shared" | "independent")
          }
        />
        {strategy === "shared" && (
          <FoodSelect
            label="共享食物选择"
            food={food}
            onChange={onFoodChange}
          />
        )}
      </div>
    </section>
  );
}
