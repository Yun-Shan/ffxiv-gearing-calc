import type { ReactNode } from "react";
import styles from "./SingleWorkbenchLayout.module.css";

export function SingleWorkbenchLayout({
  main,
  sidebar,
}: {
  main: ReactNode;
  sidebar: ReactNode;
}) {
  return <div className={styles.layout}>{main}{sidebar}</div>;
}

export function SingleWorkbenchFlow({ children, resultView = false }: { children: ReactNode; resultView?: boolean }) {
  return <main className={styles.flow} data-result-view={resultView || undefined}>{children}</main>;
}
