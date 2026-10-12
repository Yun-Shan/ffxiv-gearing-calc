import type { ReactNode } from "react";
import styles from "./SinglePageSidePanel.module.css";

export function SinglePageSidePanel({
  ariaLabel,
  className,
  children,
}: {
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={className ? `${styles.root} ${className}` : styles.root}
      aria-label={ariaLabel}
    >
      {children}
    </aside>
  );
}
