import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import {
  SingleWorkbenchMain,
  SingleWorkbenchAside,
  SingleWorkbenchOverlays,
} from "./components/workbench/SingleWorkbench";
export function SingleWorkbenchContent() {
  return (
    <>
      <WorkbenchLayout
        breadcrumbs={["单职业搜索"]}
        main={<SingleWorkbenchMain />}
        aside={<SingleWorkbenchAside />}
      />
      <SingleWorkbenchOverlays />
    </>
  );
}
