import { Worker } from "node:worker_threads";
import type {
  BaselineWorkerHandle,
  BaselineWorkerMessage,
  BaselineWorkerRequest,
} from "../search/parallel-baseline-executor.ts";

type ReadyMessage = { type: "ready" };

export function createNodeBaselineWorker(): BaselineWorkerHandle {
  const worker = new Worker(new URL("./parallel-baseline-node.worker.ts", import.meta.url));
  let ready = false;
  const pending: BaselineWorkerRequest[] = [];
  worker.on("message", (message: BaselineWorkerMessage | ReadyMessage) => {
    if (message.type !== "ready") return;
    ready = true;
    for (const request of pending.splice(0)) worker.postMessage(request);
  });
  return {
    postMessage: (request: BaselineWorkerRequest) => {
      if (ready) worker.postMessage(request);
      else pending.push(request);
    },
    onMessage: (listener: (message: BaselineWorkerMessage) => void) => {
      const wrapped = (message: BaselineWorkerMessage | ReadyMessage): void => {
        if (message.type !== "ready") listener(message);
      };
      worker.on("message", wrapped);
      return () => worker.off("message", wrapped);
    },
    onError: (listener: (error: Error) => void) => {
      const wrapped = (error: Error): void => listener(error);
      worker.on("error", wrapped);
      return () => worker.off("error", wrapped);
    },
    onExit: (listener: (code: number) => void) => {
      const wrapped = (code: number): void => listener(code);
      worker.on("exit", wrapped);
      return () => worker.off("exit", wrapped);
    },
    terminate: () => worker.terminate(),
  };
}
