import { useEffect, useRef, useState } from "react";
import { isUnknownSource, type ShareView } from "@/share/types";
import type { ShareWorkerRequest } from "@/share/worker-protocol";
import {
  runShareTask,
  workbenchResultFromShare,
} from "@/ui/services/share-link";
import type { WorkbenchResult } from "@/ui/services/workbench-result";
import { useNavigate } from "@tanstack/react-router";
import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import { SidePanel } from "@/ui/components/side-panel/SidePanel";
import { ShareErrorPage } from "./components/share-error-page/ShareErrorPage";

/** App keys this boundary by token; resolve the input before mounting a workbench. */
export function ShareEntry({
  token,
  onReady,
}: {
  token: string;
  onReady(result: WorkbenchResult): void;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<{
    pending: boolean;
    view?: ShareView;
    error?: string;
  }>({ pending: true });
  const active = useRef<AbortController | undefined>(undefined);

  async function restore(request: ShareWorkerRequest, keep?: ShareView) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ pending: true, view: keep });
    try {
      const view = await runShareTask(request, controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      if (view.unknownSourceIds.length === 0)
        onReady(workbenchResultFromShare(view));
      else setState({ pending: false, view });
    } catch (error) {
      if (active.current !== controller || controller.signal.aborted) return;
      setState({
        pending: false,
        view: keep,
        error: error instanceof Error ? error.message : "无效的分享链接",
      });
    }
  }

  useEffect(() => {
    void restore({ token });
    return () => {
      const previous = active.current;
      active.current = undefined;
      previous?.abort();
    };
  }, [token, onReady]);

  const view = state.view;
  const returnToSearch = () =>
    void navigate({ to: view?.document.mode === "joint" ? "/joint" : "/single", search: {} });
  function ignoreUnknownSources() {
    if (!view || state.pending) return;
    const document = structuredClone(view.document);
    for (const config of document.configs) {
      config.excludedSources = config.excludedSources?.filter(
        (source) => !isUnknownSource(source),
      );
    }
    void restore({ document }, view);
  }
  if (state.error !== undefined)
    return (
      <ShareErrorPage
        error={state.error}
        onReturnHome={() =>
          void navigate({ to: "/", search: {}, hash: "", replace: true })
        }
      />
    );
  return (
    <WorkbenchLayout
      breadcrumbs={["分享链接"]}
      main={
        view ? (
          <section>
            <h1>分享链接包含未知来源条件</h1>
            <p role="status">
              未知来源（{view.unknownSourceIds.join("、")}
              ），无法恢复对应的装备来源排除条件。
            </p>
            <p>
              忽略这些条件后，可进入工作台查看配装、调整条件或重新搜索。其他条件和原选中配装保持不变。
            </p>
            {state.pending && <p role="status">正在恢复结果…</p>}
          </section>
        ) : (
          <p role="status">正在恢复分享结果…</p>
        )
      }
      aside={
        <SidePanel>
          <SidePanel.Header title="分享链接" />
          <SidePanel.Actions>
            {view && (
              <button disabled={state.pending} onClick={ignoreUnknownSources}>
                忽略未知来源并继续
              </button>
            )}
            <button onClick={returnToSearch}>返回搜索</button>
          </SidePanel.Actions>
        </SidePanel>
      }
    />
  );
}
