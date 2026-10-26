import { createFileRoute } from "@tanstack/react-router";
import { LaboratoryPage } from "@/ui/pages/laboratory/LaboratoryPage";
export const Route = createFileRoute("/lab")({ component: LaboratoryPage });
