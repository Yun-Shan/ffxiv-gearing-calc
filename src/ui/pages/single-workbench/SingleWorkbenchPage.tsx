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
        main={<SingleWorkbenchMain />}
        aside={<SingleWorkbenchAside />}
      />
      <SingleWorkbenchOverlays />
    </SingleWorkbenchProvider>
  );
}
