import { createComputeWorker } from "../compute-worker-factory.ts";
import type { ComputeWorkerResponse } from "../compute-worker-protocol.ts";
import type {
  BaselineWorkerHandle,
  BaselineWorkerRequest,
} from "./parallel-baseline-executor.ts";

export function createBrowserBaselineWorker(): BaselineWorkerHandle {
  const worker = createComputeWorker();
  const send = (request: BaselineWorkerRequest) => worker.postMessage({ kind: "baseline", ...request });
  let ready = false;
  const pending: BaselineWorkerRequest[] = [];
  worker.addEventListener("message", (event: MessageEvent<ComputeWorkerResponse>) => {
    if (event.data.kind !== "ready") return;
    ready = true;
    for (const request of pending.splice(0)) send(request);
  });
  return {
    postMessage: (request) => {
      if (ready) send(request);
      else pending.push(request);
    },
    onMessage: (listener) => {
      const wrapped = (event: MessageEvent<ComputeWorkerResponse>) => {
        if (event.data.kind === "baseline") listener(event.data.message);
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
