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
          当前屏幕过小，仅可查看结果。<br/>建议在电脑上打开以使用完整功能。
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
