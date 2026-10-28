import type { ReactNode } from "react";
import { Breadcrumbs } from "@/ui/components/breadcrumbs/Breadcrumbs";
import styles from "./WorkbenchLayout.module.scss";

export function WorkbenchLayout({
  breadcrumbs,
  main,
  aside,
  mobileResult = false,
}: {
  breadcrumbs: readonly string[];
  main: ReactNode;
  aside: ReactNode;
  mobileResult?: boolean;
}) {
  return (
    <main className={`${styles.root} ${mobileResult ? styles.mobileResult : ""}`}>
      {mobileResult && (
        <p className={styles.viewportWarning} role="status">
          当前视口过小，仅可查看结果，建议在大屏幕打开。
        </p>
      )}
      <div className={styles.main}>
        <div className={styles.breadcrumbs}>
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <div className={styles.content}>{main}</div>
      </div>
      {aside}
    </main>
  );
}
