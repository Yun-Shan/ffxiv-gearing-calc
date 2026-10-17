import { GcdSection } from "./components/gcd-section/GcdSection";
import { FoodSection } from "./components/food-section/FoodSection";
import { SearchRangeSection } from "./components/search-range-section/SearchRangeSection";
import { TankConditionSection } from "./components/tank-condition-section/TankConditionSection";
import styles from "./JobConditionEditor.module.scss";

export function JobConditionEditor() {
  return (
    <div className={styles.editor}>
      <div className={styles.rangeAndFood}>
        <SearchRangeSection />
        <FoodSection />
      </div>
      <GcdSection />
      <TankConditionSection />
    </div>
  );
}
