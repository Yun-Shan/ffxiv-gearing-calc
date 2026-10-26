import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import type { JointWorkbenchResult } from "@/ui/services/workbench-result";
import { JointWorkbenchAside } from "./components/workbench/JointWorkbenchAside";
import { JointWorkbenchMain } from "./components/workbench/JointWorkbenchMain";
import { JointWorkbenchProvider } from "./useJointWorkbenchController";

export function JointWorkbenchPage({ initialResult }: { initialResult?: JointWorkbenchResult }) {
  return (
    <JointWorkbenchProvider initialResult={initialResult}>
      <WorkbenchLayout
        breadcrumbs={["实验室", "多职业联合搜索"]}
        main={<JointWorkbenchMain />}
        aside={<JointWorkbenchAside />}
      />
    </JointWorkbenchProvider>
  );
}
