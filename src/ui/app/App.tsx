import {
  createRouter,
  RouterProvider,
  type RouterHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { WorkbenchRuntime } from "./workbench-runtime";
import { parseRouterSearch, stringifyRouterSearch } from "./router-search";
import { applicationBase } from "@/ui/services/application-base";

export interface AppRouterOptions {
  history?: RouterHistory;
  restore?: boolean;
}
function buildRouter(options: AppRouterOptions, workflow: WorkbenchRuntime) {
  return createRouter({
    routeTree,
    basepath: applicationBase(),
    history: options.history,
    context: { workflow },
    parseSearch: parseRouterSearch,
    stringifySearch: stringifyRouterSearch,
    defaultPreload: false,
    caseSensitive: true,
    scrollRestoration: false,
    // Startup failures belong to the existing application shell, including
    // exceptions rethrown by the root route's error boundary.
    disableGlobalCatchBoundary: true,
  });
}
export type AppRouter = ReturnType<typeof buildRouter>;
export function createAppRouter(options: AppRouterOptions = {}): AppRouter {
  const workflow = new WorkbenchRuntime(options.restore);
  const router = buildRouter(options, workflow);
  workflow.connect({
    navigate: (options) => router.navigate(options),
    history: router.history,
    location: () => router.state.location,
  });
  return router;
}
declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
export function App({ router }: { router: AppRouter }) {
  return <RouterProvider router={router} />;
}
