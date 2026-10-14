import type { ReactNode } from "react";
import styles from "./SingleEquipmentRestrictionsSection.module.scss";

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
