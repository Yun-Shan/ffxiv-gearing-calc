import {
  createRootRouteWithContext,
  Navigate,
  redirect,
} from "@tanstack/react-router";
import { FeedbackProvider } from "@/ui/components/feedback/FeedbackProvider";
import { AppFrame } from "../AppFrame";
import type { AppRouterContext } from "../router-context";

export const Route = createRootRouteWithContext<AppRouterContext>()({
  beforeLoad: ({ context, location }) => {
    const destination = context.workflow.prepare(location);
    if (destination) throw redirect({ ...destination, replace: true });
  },
  component: () => (
    <FeedbackProvider>
      <AppFrame />
    </FeedbackProvider>
  ),
  notFoundComponent: () => <Navigate to="/" search={{}} replace />,
  errorComponent: ({ error }) => {
    throw error;
  },
});
