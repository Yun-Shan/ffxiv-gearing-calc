import type { ReactNode } from "react";
import { Breadcrumbs } from "@/ui/components/breadcrumbs/Breadcrumbs";
import styles from "./WorkbenchLayout.module.scss";

export function WorkbenchLayout({
  breadcrumbs,
  main,
  aside,
}: {
  breadcrumbs: readonly string[];
  main: ReactNode;
  aside: ReactNode;
}) {
  return (
    <main className={styles.root}>
      <div className={styles.main}>
        <Breadcrumbs items={breadcrumbs} />
        <div className={styles.content}>{main}</div>
      </div>
      {aside}
    </main>
  );
}
