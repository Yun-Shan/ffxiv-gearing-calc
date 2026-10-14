import { useEffect, useState } from "react";
import { AppHeader, type AppPage } from "../components/app-header/AppHeader";
import { JointWorkbenchPage } from "../pages/joint-workbench/JointWorkbenchPage";
import { SingleWorkbenchPage } from "../pages/single-workbench/SingleWorkbenchPage";
import styles from "./App.module.scss";

function currentPage(): AppPage {
  return window.location.hash === "#/joint" ? "joint" : "single";
}

export function App() {
  const [page, setPage] = useState<AppPage>(() => currentPage());
  const [resetVersion, setResetVersion] = useState(0);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", "#/single");
    const updatePage = () => setPage(currentPage());
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  return (
    <div className={styles.root}>
      {page === "joint" ? (
        <>
          <AppHeader page={page} />
          <JointWorkbenchPage key={"joint-" + resetVersion} />
        </>
      ) : (
        <SingleWorkbenchPage
          key={"single-" + resetVersion}
          onReset={() => setResetVersion((version) => version + 1)}
        />
      )}
    </div>
  );
}
