import { createFileRoute } from "@tanstack/react-router";
import { GearComparisonPage } from "@/ui/pages/gear-comparison/GearComparisonPage";
export const Route = createFileRoute("/gear-comparison")({
  component: GearComparisonPage,
});
