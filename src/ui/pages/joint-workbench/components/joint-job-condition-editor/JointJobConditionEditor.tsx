import { FoodSection } from "@/ui/features/job-condition/JobConditionEditor/components/food-section/FoodSection";
import { GcdSection } from "@/ui/features/job-condition/JobConditionEditor/components/gcd-section/GcdSection";
import { TankConditionSection } from "@/ui/features/job-condition/JobConditionEditor/components/tank-condition-section/TankConditionSection";
import styles from "./JointJobConditionEditor.module.scss";

/** 联合搜索的搜索范围属于共享条件，职业编辑器只保留 gcd/food/tank。 */
export function JointJobConditionEditor() {
  return (
    <div className={styles.editor}>
      <FoodSection />
      <GcdSection />
      <TankConditionSection />
    </div>
  );
}
