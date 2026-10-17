import type { ReactNode } from "react";
import styles from "./WorkbenchLayout.module.scss";
export function WorkbenchLayout({
  main,
  aside,
}: {
  main: ReactNode;
  aside: ReactNode;
}) {
  return (
    <main className={styles.root}>
      <div className={styles.main}>{main}</div>
      {aside}
    </main>
  );
}
