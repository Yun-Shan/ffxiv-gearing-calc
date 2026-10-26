import { createFileRoute } from "@tanstack/react-router";
import { RootEntry } from "../WorkbenchRoutes";
export const Route = createFileRoute("/_single/")({ component: RootEntry });
