import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import {
  SingleWorkbenchMain,
  SingleWorkbenchAside,
  SingleWorkbenchOverlays,
  useSingleWorkbench,
} from "./components/workbench/SingleWorkbench";
export function SingleWorkbenchContent() {
  const { state } = useSingleWorkbench();
  return (
    <>
      <WorkbenchLayout
        breadcrumbs={["单职业搜索"]}
        main={<SingleWorkbenchMain />}
        aside={<SingleWorkbenchAside />}
        mobileResult={state.phase === "result"}
      />
      <SingleWorkbenchOverlays />
    </>
  );
}
