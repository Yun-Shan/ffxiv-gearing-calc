import { createFileRoute } from "@tanstack/react-router";
import { AboutPage } from "@/ui/pages/about/AboutPage";
export const Route = createFileRoute("/about")({ component: AboutPage });
