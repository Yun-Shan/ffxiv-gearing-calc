import type {
  BaselineWorkerHandle,
  BaselineWorkerMessage,
  BaselineWorkerRequest,
} from "./parallel-baseline-executor.ts";

export function createBrowserBaselineWorker(): BaselineWorkerHandle {
  const worker = new Worker(new URL("./parallel-baseline-browser.worker.ts", import.meta.url), {
    type: "module",
  });
  let ready = false;
  const pending: BaselineWorkerRequest[] = [];
  worker.addEventListener("message", (event: MessageEvent<{ type: string }>) => {
    if (event.data.type !== "ready") return;
    ready = true;
    for (const request of pending.splice(0)) worker.postMessage(request);
  });
  return {
    postMessage: (request) => {
      if (ready) worker.postMessage(request);
      else pending.push(request);
    },
    onMessage: (listener) => {
      const wrapped = (event: MessageEvent<BaselineWorkerMessage | { type: "ready" }>) => {
        if (event.data.type !== "ready") listener(event.data);
      };
      worker.addEventListener("message", wrapped);
      return () => worker.removeEventListener("message", wrapped);
    },
    onError: (listener) => {
      const wrapped = (event: ErrorEvent) => listener(new Error(event.message || "基线工作线程失败"));
      worker.addEventListener("error", wrapped);
      return () => worker.removeEventListener("error", wrapped);
    },
    terminate: () => worker.terminate(),
  };
}
