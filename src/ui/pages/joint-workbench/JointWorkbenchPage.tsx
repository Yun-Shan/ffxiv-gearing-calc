import { WorkbenchLayout } from "@/ui/components/workbench-layout/WorkbenchLayout";
import { JointWorkbenchAside } from "./components/workbench/JointWorkbenchAside";
import { JointWorkbenchMain } from "./components/workbench/JointWorkbenchMain";
import { useJointWorkbench } from "./useJointWorkbenchController";

export function JointWorkbenchContent() {
  const { phase } = useJointWorkbench();
  return (
    <WorkbenchLayout
      breadcrumbs={["实验室", "多职业联合搜索"]}
      main={<JointWorkbenchMain />}
      aside={<JointWorkbenchAside />}
      mobileResult={phase.phase === "result"}
    />
  );
}
