import { useCallback, useReducer } from "react";
import {
  Outlet,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { SingleWorkbenchProvider } from "@/ui/pages/single-workbench/components/workbench/SingleWorkbench";
import { SingleWorkbenchContent } from "@/ui/pages/single-workbench/SingleWorkbenchPage";
import { JointWorkbenchProvider } from "@/ui/pages/joint-workbench/useJointWorkbenchController";
import { JointWorkbenchContent } from "@/ui/pages/joint-workbench/JointWorkbenchPage";
import { ShareEntry } from "./ShareEntry";
import { shareToken } from "./router-search";
import type { WorkbenchResult } from "@/ui/services/workbench-result";
import type { WorkbenchMode } from "@/ui/services/workbench-routing";

export function SingleRoutesLayout() {
  const router = useRouter();
  return (
    <SingleWorkbenchProvider
      routing={router.options.context.workflow.port("single")}
    >
      <Outlet />
    </SingleWorkbenchProvider>
  );
}
export function JointRoutesLayout() {
  const router = useRouter();
  return (
    <JointWorkbenchProvider
      routing={router.options.context.workflow.port("joint")}
    >
      <Outlet />
    </JointWorkbenchProvider>
  );
}
export function RootEntry() {
  const search = useSearch({ strict: false });
  const token = shareToken(search);
  const router = useRouter();
  const onReady = useCallback(
    (value: WorkbenchResult) => {
      if (token !== undefined)
        router.options.context.workflow.acceptShare(value, token, search);
    },
    [router, search, token],
  );
  return token === undefined ? (
    <SingleWorkbenchContent />
  ) : (
    <ShareEntry key={token} token={token} onReady={onReady} />
  );
}

export function WorkbenchResultEntry({ mode }: { mode: WorkbenchMode }) {
  const router = useRouter();
  useRouterState({ select: (state) => state.location });
  const recovery = router.options.context.workflow.pendingShare(mode);
  const [, decoded] = useReducer((value) => value + 1, 0);
  const onReady = useCallback(
    (value: WorkbenchResult) => {
      if (!recovery) return;
      router.options.context.workflow.acceptShare(
        value,
        recovery.token,
        recovery.search,
      );
      decoded();
    },
    [router, recovery],
  );
  if (recovery)
    return (
      <ShareEntry
        key={recovery.token}
        token={recovery.token}
        onReady={onReady}
      />
    );
  return mode === "single" ? (
    <SingleWorkbenchContent />
  ) : (
    <JointWorkbenchContent />
  );
}
