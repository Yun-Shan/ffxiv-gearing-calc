import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import {
  SingleWorkbenchProvider,
  SingleWorkbenchMain,
  SingleWorkbenchAside,
  SingleWorkbenchOverlays,
} from "./components/workbench/SingleWorkbench";
export function SingleWorkbenchPage() {
  return (
    <SingleWorkbenchProvider>
      <WorkbenchLayout
        breadcrumbs={["单职业搜索"]}
        main={<SingleWorkbenchMain />}
        aside={<SingleWorkbenchAside />}
      />
      <SingleWorkbenchOverlays />
    </SingleWorkbenchProvider>
  );
}
