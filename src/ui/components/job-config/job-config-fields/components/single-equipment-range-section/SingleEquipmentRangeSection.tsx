import type { ReactNode } from "react";
import styles from "@/ui/components/job-config/job-config-fields/components/single-equipment-range-section/SingleEquipmentRangeSection.module.scss";

export function SingleEquipmentRangeSection({
  children,
  note,
}: {
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className={styles.section} aria-label="装备范围与食物">
      <h2 className={styles.title}>装备范围与食物</h2>
      <div className={styles.fields}>{children}</div>
      {note}
    </section>
  );
}
