import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import { JointWorkbenchAside } from "./components/workbench/JointWorkbenchAside";
import { JointWorkbenchMain } from "./components/workbench/JointWorkbenchMain";
import { JointWorkbenchProvider } from "./useJointWorkbenchController";

export function JointWorkbenchPage() {
  return (
    <JointWorkbenchProvider>
      <WorkbenchLayout
        main={<JointWorkbenchMain />}
        aside={<JointWorkbenchAside />}
      />
    </JointWorkbenchProvider>
  );
}
