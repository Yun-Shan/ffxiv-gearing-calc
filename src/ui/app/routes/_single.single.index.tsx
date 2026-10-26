import { createFileRoute } from "@tanstack/react-router";
import { SingleWorkbenchContent } from "@/ui/pages/single-workbench/SingleWorkbenchPage";
export const Route = createFileRoute("/_single/single/")({
  component: SingleWorkbenchContent,
});
