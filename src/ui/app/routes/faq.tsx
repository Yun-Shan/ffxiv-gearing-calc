import { createFileRoute } from "@tanstack/react-router";
import { FaqPage } from "@/ui/pages/faq/FaqPage";
export const Route = createFileRoute("/faq")({ component: FaqPage });
