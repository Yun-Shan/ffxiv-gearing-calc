import { createFileRoute } from "@tanstack/react-router";
import { JointRoutesLayout } from "../WorkbenchRoutes";
export const Route = createFileRoute("/joint")({
  component: JointRoutesLayout,
});
