import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchResultEntry } from "../WorkbenchRoutes";
export const Route = createFileRoute("/joint/result")({
  component: () => <WorkbenchResultEntry mode="joint" />,
});
