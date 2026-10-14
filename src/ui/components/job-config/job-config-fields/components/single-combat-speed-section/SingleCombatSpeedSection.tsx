import type { ReactNode } from "react";
import styles from "@/ui/components/job-config/job-config-fields/components/single-combat-speed-section/SingleCombatSpeedSection.module.scss";

export function SingleCombatSpeedSection({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return children;

  return (
    <section className={styles.section} aria-label="战斗速度与目标">
      <h2 className={styles.title}>战斗速度与目标</h2>
      {children}
    </section>
  );
}
