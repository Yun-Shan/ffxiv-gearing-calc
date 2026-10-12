import { type CommonGearSlot, type JointOptimizationResult } from "../../../../../domain/index";
import { commonGearSlotLabels } from "../../../../services/labels";
import styles from "./JointCommonGearSection.module.css";

export const commonSlotLabels = commonGearSlotLabels;

export function JointCommonGearSection({ result }: { result: JointOptimizationResult }) {
  const commonGear = result.commonGear ?? {};
  const slots = Object.entries(commonGear).filter(([, items]) => (items?.length ?? 0) > 0);
  if (slots.length === 0) return null;

  const itemCount = slots.reduce((count, [, items]) => count + (items?.length ?? 0), 0);

  return (
    <details className={styles.section}>
      <summary className={`result-toolbar ${styles.summary}`}>
        <div>
          <h2>公共共享装备</h2>
          <span className="muted">所有参与职业使用相同装备和属性方案</span>
        </div>
        <span className={styles.summaryMeta}>
          {itemCount} 个部位{result.commonFood ? ` · 食物 ${result.commonFood.name}` : ""}
        </span>
      </summary>
      <div className={styles.content}>
        <div className={styles.list}>
          {slots.flatMap(([slot, items]) => {
            if (slot === "rings") {
              return (items ?? []).map((item, index) => (
                <div className={styles.row} key={`ring-${index}-${item.id}`}>
                  <span>{`戒指${index + 1}`}</span>
                  <div><strong>{item.name}</strong></div>
                </div>
              ));
            }
            const slotLabel = commonSlotLabels[slot as CommonGearSlot];
            return [(
              <div className={styles.row} key={slot}>
                <span>{slotLabel}</span>
                <div>{items?.map((item) => <strong key={item.id}>{item.name}</strong>)}</div>
              </div>
            )];
          })}
        </div>
        {result.commonFood && <p className={styles.foodNote}>共用食物：{result.commonFood.name}</p>}
      </div>
    </details>
  );
}
