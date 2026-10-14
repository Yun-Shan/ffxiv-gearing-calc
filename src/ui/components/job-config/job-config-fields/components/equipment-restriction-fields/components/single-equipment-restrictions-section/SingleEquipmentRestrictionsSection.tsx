import type { ReactNode } from "react";
import styles from "@/ui/components/job-config/job-config-fields/components/equipment-restriction-fields/components/single-equipment-restrictions-section/SingleEquipmentRestrictionsSection.module.scss";

export function SingleEquipmentRestrictionsSection({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <section className={styles.section} aria-label="装备限制">
      <h2 className={styles.title}>装备限制</h2>
      <div className={styles.columns}>{left}{right}</div>
    </section>
  );
}
