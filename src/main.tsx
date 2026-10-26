import "@/styles.scss";

import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App, createAppRouter } from "./ui/app/App";
import type {} from "./ui/app/app-shell/app-shell";
import { scheduleResourcePreload } from "./ui/services/resource-preload";

const shell = window.__APP_SHELL__;
if (!shell || (await shell.stylesReady())) {
  const router = createAppRouter();
  // Resolve initial guards and refresh recovery before the first visible commit.
  await router.load().catch((error) => {
    shell?.fail(error);
    throw error;
  });
  let mountFailed = false;
  const root = createRoot(document.getElementById("root")!, {
    onUncaughtError(error) {
      mountFailed = true;
      console.error(error);
      shell?.fail(error);
    },
  });
  // 仅首次挂载同步提交，确保挂载期间的异常先交给外壳，再通知启动成功。
  flushSync(() =>
    root.render(
      <StrictMode>
        <App router={router} />
      </StrictMode>,
    ),
  );
  shell?.ready();
  if (!mountFailed) scheduleResourcePreload();
}
