import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import { JointWorkbenchAside } from "./components/workbench/JointWorkbenchAside";
import { JointWorkbenchMain } from "./components/workbench/JointWorkbenchMain";
import { JointWorkbenchProvider } from "./useJointWorkbenchController";

export function JointWorkbenchPage() {
  return (
    <JointWorkbenchProvider>
      <WorkbenchLayout
        breadcrumbs={["实验室", "多职业联合搜索"]}
        main={<JointWorkbenchMain />}
        aside={<JointWorkbenchAside />}
      />
    </JointWorkbenchProvider>
  );
}
