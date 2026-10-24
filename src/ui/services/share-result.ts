import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ResultShareData } from "@/ui/components/results/result-share-layout/types";

async function renderResultImage(data: ResultShareData): Promise<Blob> {
  const [{ snapdom }, { ResultShareLayout }] = await Promise.all([
    import("@zumer/snapdom"),
    import("@/ui/components/results/result-share-layout/ResultShareLayout"),
  ]);
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    pointerEvents: "none",
  });
  host.inert = true;
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);
  let renderError: unknown;
  const root = createRoot(host, {
    onUncaughtError: (error) => {
      renderError = error;
    },
  });
  try {
    // snapdom 读取前确保专用布局已提交到 DOM。
    flushSync(() => root.render(createElement(ResultShareLayout, data)));
    if (renderError) throw renderError;
    const capture = host.querySelector<HTMLElement>(
      "[data-result-share-layout]",
    );
    if (!capture) throw new Error("分享图片布局渲染失败");

    // 图片不依赖页面的懒加载位置；资源超时仍由 snapdom 的回退流程处理。
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(
          Array.from(capture.querySelectorAll("img"), (image) =>
            image.decode?.().catch(() => {}),
          ),
        ),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 3000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }

    return await snapdom.toBlob(capture, {
      format: "png",
      scale: 1,
      dpr: 1,
      backgroundColor: "#ffffff",
      reconcile: true,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function copyResultImage(
  data: ResultShareData,
): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error(
      "当前浏览器不支持复制图片，请使用支持此功能的浏览器并通过 HTTPS 访问",
    );
  }

  const image = renderResultImage(data);
  // 先提交包含 Promise 的 ClipboardItem，保留点击的用户手势（包括 Safari）。
  // 写入被拒绝时，仍处理后台渲染的拒绝，避免未捕获的 Promise 错误。
  void image.catch(() => {});
  await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
}
