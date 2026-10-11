import type {
  BaselineWorkerHandle,
  BaselineWorkerMessage,
  BaselineWorkerRequest,
} from "./parallel-baseline-executor.ts";

export function createBrowserBaselineWorker(): BaselineWorkerHandle {
  const worker = new Worker(new URL("./parallel-baseline-browser.worker.ts", import.meta.url), {
    type: "module",
  });
  return {
    postMessage: (request) => worker.postMessage(request),
    onMessage: (listener) => {
      const wrapped = (event: MessageEvent<BaselineWorkerMessage>) => listener(event.data);
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
