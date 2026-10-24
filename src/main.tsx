import "@/styles.scss";

import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "./ui/app/App";
import type {} from "./ui/app/app-shell/app-shell";

const shell = window.__APP_SHELL__;
if (!shell || (await shell.stylesReady())) {
  const root = createRoot(document.getElementById("root")!, {
    onUncaughtError(error) {
      console.error(error);
      shell?.fail(error);
    },
  });
  // 仅首次挂载同步提交，确保挂载期间的异常先交给外壳，再通知启动成功。
  flushSync(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
  shell?.ready();
}
