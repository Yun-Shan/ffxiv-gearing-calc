import { MAX_LINK_CHARS, type ShareView } from "@/share/types";
import { sharePrefix } from "@/share/url";
import { shareWorkerUrl } from "@/share/worker-url";
import type {
  ShareWorkerRequest,
  ShareWorkerResponse,
} from "@/share/worker-protocol";
import { domainConfig } from "@/share/validation";
import type { WorkbenchResult } from "./workbench-result";

/** Only complete, resolved conditions cross the application entry boundary. */
export function workbenchResultFromShare(view: ShareView): WorkbenchResult {
  if (view.unknownSourceIds.length) throw new Error("来源条件不完整");
  const { document, results } = view;
  const configs = document.configs.map((config) => ({
    ...domainConfig(config),
    ...(config.syncDuty === undefined ? {} : { syncDuty: config.syncDuty }),
  }));
  if (document.mode === "single")
    return {
      mode: "single",
      config: configs[0],
      result: results[0],
      dataVersion: document.dataVersion,
    };
  return {
    mode: "joint",
    config: {
      jobs: configs,
      commonSlots: document.commonSlots,
      foodStrategy: document.foodStrategy,
      objective: configs[0].objective,
    },
    result: {
      jobResults: Object.fromEntries(
        configs.map((config, index) => [config.jobId, results[index]]),
      ),
      optima: Object.fromEntries(
        configs.map((config, index) => [
          config.jobId,
          { score: document.baselines[index] },
        ]),
      ),
      commonGear: Object.fromEntries(
        document.commonSlots.map((slot) => [
          slot,
          [results[0].gear.find((gear) => gear.slot === slot)!],
        ]),
      ),
      commonFood:
        document.foodStrategy === "shared" ? results[0].food : undefined,
      objective: configs[0].objective,
      value: { approximate: document.jointValue! },
      statistics: { elapsedMs: document.elapsedMs },
    },
    dataVersion: document.dataVersion,
  };
}

export function runShareTask(
  request: ShareWorkerRequest,
  signal: AbortSignal,
): Promise<ShareView> {
  if (signal.aborted)
    return Promise.reject(new DOMException("恢复已取消", "AbortError"));
  if (
    "token" in request &&
    request.token.length +
      (typeof window === "undefined"
        ? 0
        : sharePrefix(window.location.href).length) >
      MAX_LINK_CHARS
  )
    return Promise.reject(new Error("分享链接超出容量限制"));
  const worker = new Worker(shareWorkerUrl, { type: "module" });
  return new Promise((resolve, reject) => {
    let finished = false,
      sent = false;
    const settle = (error?: Error, view?: ShareView) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(view!);
    };
    const cancel = () => settle(new DOMException("恢复已取消", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
    worker.addEventListener(
      "message",
      (event: MessageEvent<ShareWorkerResponse>) => {
        if (finished) return;
        const value = event.data;
        if (value.kind === "ready" && !sent) {
          sent = true;
          try {
            worker.postMessage(request);
          } catch (error) {
            settle(
              error instanceof Error ? error : new Error("分享条件传输失败"),
            );
          }
        } else if (value.kind === "error") settle(new Error(value.message));
        else if (value.kind === "result") settle(undefined, value.view);
      },
    );
    worker.addEventListener("error", (event) =>
      settle(new Error(event.message || "分享结果恢复失败")),
    );
    worker.addEventListener("messageerror", () =>
      settle(new Error("分享结果传输失败")),
    );
    if (signal.aborted) cancel();
  });
}

export async function copyShareUrl(url: string): Promise<void> {
  if (url.length > MAX_LINK_CHARS) throw new Error("分享链接超出容量限制");
  try {
    await navigator.clipboard.writeText(url);
  } catch (error) {
    throw new Error("无法复制链接，请检查浏览器的剪贴板权限后重试", {
      cause: error,
    });
  }
}
