import { Worker } from "node:worker_threads";

export function createNodeBaselineWorker() {
  const worker = new Worker(new URL("./parallel-baseline-node.worker.ts", import.meta.url));
  return {
    postMessage: (request) => worker.postMessage(request),
    onMessage: (listener) => {
      const wrapped = (message) => listener(message);
      worker.on("message", wrapped);
      return () => worker.off("message", wrapped);
    },
    onError: (listener) => {
      const wrapped = (error) => listener(error);
      worker.on("error", wrapped);
      return () => worker.off("error", wrapped);
    },
    onExit: (listener) => {
      const wrapped = (code) => listener(code);
      worker.on("exit", wrapped);
      return () => worker.off("exit", wrapped);
    },
    terminate: () => worker.terminate(),
  };
}
