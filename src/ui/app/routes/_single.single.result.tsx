import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchResultEntry } from "../WorkbenchRoutes";
export const Route = createFileRoute("/_single/single/result")({
  component: () => <WorkbenchResultEntry mode="single" />,
});
