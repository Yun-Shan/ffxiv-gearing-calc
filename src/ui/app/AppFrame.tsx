import { useEffect } from "react";
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { AppHeader, type AppPage } from "@/ui/components/app-header/AppHeader";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import styles from "./App.module.scss";

export function AppFrame() {
  const router = useRouter();
  const path = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { notify } = useFeedback();
  const mobileResult = useRouterState({
    select: (state) => state.matches.some(
      (match) => match.routeId === "/_single/single/result" ||
        match.routeId === "/joint/result",
    ),
  });
  useEffect(() => {
    const show = () => {
      for (const warning of router.options.context.workflow.takeWarnings())
        notify(warning, "warning");
    };
    const unsubscribe = router.options.context.workflow.subscribeWarnings(show);
    show();
    return unsubscribe;
  }, [router, notify]);
  const page: AppPage = path.startsWith("/joint")
    ? "joint"
    : path.startsWith("/gear-comparison")
      ? "gear-comparison"
      : path === "/lab"
        ? "lab"
        : path === "/faq"
          ? "faq"
          : path === "/about"
            ? "about"
            : "single";
  return (
    <div className={styles.root}>
      <AppHeader page={page} mobileResult={mobileResult} />
      {!mobileResult && (
        <p className={styles.viewportWarning} role="status">
          当前屏幕过小，可能无法正常使用
        </p>
      )}
      <div className={styles.route}>
        <Outlet />
      </div>
    </div>
  );
}
