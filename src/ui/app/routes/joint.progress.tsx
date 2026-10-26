import { createFileRoute } from "@tanstack/react-router";
import { JointWorkbenchContent } from "@/ui/pages/joint-workbench/JointWorkbenchPage";
export const Route = createFileRoute("/joint/progress")({
  component: JointWorkbenchContent,
});
