import { useEffect, useState } from "react";
import { AppHeader, type AppPage } from "@/ui/components/app-header/AppHeader";
import { JointWorkbenchPage } from "@/ui/pages/joint-workbench/JointWorkbenchPage";
import { SingleWorkbenchPage } from "@/ui/pages/single-workbench/SingleWorkbenchPage";
import styles from "./App.module.scss";
import { SingleWorkbenchPageNew } from '@/ui/pages/single-workbench/SingleWorkbenchPageNew.tsx';

function currentPage(): AppPage {
  return window.location.hash === "#/joint" ? "joint" : "single";
}

function route(page: "single" | "joint") {
  switch (page) {
    case "single": return (<SingleWorkbenchPageNew />);
    case "joint": return (<JointWorkbenchPage />);
  }
}

export function App() {
  const [page, setPage] = useState<AppPage>(() => currentPage());

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", "#/single");
    const updatePage = () => setPage(currentPage());
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  return (
    <div className={styles.root}>
      <AppHeader page={page} />
      {route(page)}
    </div>
  );
}
