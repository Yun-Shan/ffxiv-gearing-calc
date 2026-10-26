import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import type { SingleWorkbenchResult } from "@/ui/services/workbench-result";
import {
  SingleWorkbenchProvider,
  SingleWorkbenchMain,
  SingleWorkbenchAside,
  SingleWorkbenchOverlays,
} from "./components/workbench/SingleWorkbench";
export function SingleWorkbenchPage({ initialResult }: { initialResult?: SingleWorkbenchResult }) {
  return (
    <SingleWorkbenchProvider initialResult={initialResult}>
      <WorkbenchLayout
        breadcrumbs={["单职业搜索"]}
        main={<SingleWorkbenchMain />}
        aside={<SingleWorkbenchAside />}
      />
      <SingleWorkbenchOverlays />
    </SingleWorkbenchProvider>
  );
}
