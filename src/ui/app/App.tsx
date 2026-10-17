import { useEffect, useState } from "react";
import { AppHeader, type AppPage } from "@/ui/components/app-header/AppHeader";
import { JointWorkbenchPage } from "@/ui/pages/joint-workbench/JointWorkbenchPage";
import { SingleWorkbenchPage } from "@/ui/pages/single-workbench/SingleWorkbenchPage";
import { LaboratoryPage } from "@/ui/pages/laboratory/LaboratoryPage";
import { GearComparisonPage } from "@/ui/pages/gear-comparison/GearComparisonPage";
import { FeedbackProvider } from "@/ui/components/feedback/FeedbackProvider";
import styles from "./App.module.scss";
function currentPage(): AppPage {
  const path = window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : window.location.pathname;
  return path === "/joint"
    ? "joint"
    : path === "/lab"
      ? "lab"
      : path === "/gear-comparison"
        ? "gear-comparison"
        : "single";
}
export function App() {
  const [page, setPage] = useState<AppPage>(currentPage);
  useEffect(() => {
    const update = () => setPage(currentPage());
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href^="/"]',
      );
      if (
        !link ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        link.target
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        !["/single", "/lab", "/joint", "/gear-comparison"].includes(
          url.pathname,
        )
      )
        return;
      event.preventDefault();
      history.pushState(null, "", url.pathname);
      update();
    };
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    document.addEventListener("click", navigate);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
      document.removeEventListener("click", navigate);
    };
  }, []);
  return (
    <FeedbackProvider>
      <div className={styles.root}>
        <AppHeader page={page} />
        <div className={styles.route}>
          {page === "single" ? (
            <SingleWorkbenchPage />
          ) : page === "joint" ? (
            <JointWorkbenchPage />
          ) : page === "lab" ? (
            <LaboratoryPage />
          ) : (
            <GearComparisonPage />
          )}
        </div>
      </div>
    </FeedbackProvider>
  );
}
