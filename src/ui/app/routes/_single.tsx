import { createFileRoute } from "@tanstack/react-router";
import { SingleRoutesLayout } from "../WorkbenchRoutes";
export const Route = createFileRoute("/_single")({
  component: SingleRoutesLayout,
});
