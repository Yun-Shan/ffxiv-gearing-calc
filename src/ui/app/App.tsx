import { useCallback, useEffect, useState } from "react";
import { AppHeader, type AppPage } from "@/ui/components/app-header/AppHeader";
import { JointWorkbenchPage } from "@/ui/pages/joint-workbench/JointWorkbenchPage";
import { SingleWorkbenchPage } from "@/ui/pages/single-workbench/SingleWorkbenchPage";
import { LaboratoryPage } from "@/ui/pages/laboratory/LaboratoryPage";
import { GearComparisonPage } from "@/ui/pages/gear-comparison/GearComparisonPage";
import { FaqPage } from "@/ui/pages/faq/FaqPage";
import { AboutPage } from "@/ui/pages/about/AboutPage";
import { ShareEntry } from "./ShareEntry";
import type { WorkbenchResult } from "@/ui/services/workbench-result";
import { FeedbackProvider } from "@/ui/components/feedback/FeedbackProvider";
import {
  navigateTo,
  routeHref,
  subscribeNavigation,
} from "@/ui/services/navigation";
import styles from "./App.module.scss";

const routes: Record<string, AppPage> = {
  "/single": "single",
  "/lab": "lab",
  "/joint": "joint",
  "/gear-comparison": "gear-comparison",
  "/faq": "faq",
  "/about": "about",
};

function currentPage(): AppPage {
  const path = window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : window.location.pathname;
  return routes[path] ?? "single";
}

function RouteView({
  page,
  initialResult,
}: {
  page: AppPage;
  initialResult?: WorkbenchResult;
}) {
  switch (page) {
    case "single":
      return (
        <SingleWorkbenchPage
          initialResult={
            initialResult?.mode === "single" ? initialResult : undefined
          }
        />
      );
    case "joint":
      return (
        <JointWorkbenchPage
          initialResult={
            initialResult?.mode === "joint" ? initialResult : undefined
          }
        />
      );
    case "lab":
      return <LaboratoryPage />;
    case "gear-comparison":
      return <GearComparisonPage />;
    case "faq":
      return <FaqPage />;
    case "about":
      return <AboutPage />;
  }
}

export function App() {
  const [route, setRoute] = useState<{
    page: AppPage;
    visit: number;
    shareToken: string | null;
    initialResult?: WorkbenchResult;
  }>(() => ({
    page: currentPage(),
    visit: 0,
    shareToken: new URLSearchParams(window.location.search).get("s"),
  }));
  const { shareToken } = route;
  const enterWorkbench = useCallback((initialResult: WorkbenchResult) => {
    const page = initialResult.mode === "joint" ? "joint" : "single";
    window.history.replaceState(null, "", routeHref(`/${page}`));
    setRoute((current) => ({
      page,
      visit: current.visit + 1,
      initialResult,
      shareToken: null,
    }));
  }, []);
  // 目前还是手动实现的路由机制不是用的路由库
  useEffect(() => {
    const update = () => {
      setRoute((current) => ({
        page: currentPage(),
        visit: current.visit + 1,
        shareToken: new URLSearchParams(window.location.search).get("s"),
      }));
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href^="/"]',
      );
      if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        link.target
      )
        return;
      const url = new URL(link.href);
      if (url.searchParams.has("s")) return;
      const path = url.hash.startsWith("#/") ? url.hash.slice(1) : url.pathname;
      if (url.origin !== location.origin || !Object.hasOwn(routes, path))
        return;
      event.preventDefault();
      navigateTo(path);
    };
    const unsubscribe = subscribeNavigation(update);
    document.addEventListener("click", navigate);
    return () => {
      unsubscribe();
      document.removeEventListener("click", navigate);
    };
  }, []);
  return (
    <FeedbackProvider>
      <div className={styles.root}>
        <p className={styles.viewportWarning} role="status">
          当前屏幕过小，可能无法正常使用
        </p>
        <AppHeader page={route.page} />
        <div className={styles.route}>
          {shareToken !== null ? (
            <ShareEntry
              key={shareToken}
              token={shareToken}
              onReady={enterWorkbench}
            />
          ) : (
            <RouteView
              key={`${route.page}-${route.visit}`}
              page={route.page}
              initialResult={route.initialResult}
            />
          )}
        </div>
      </div>
    </FeedbackProvider>
  );
}
