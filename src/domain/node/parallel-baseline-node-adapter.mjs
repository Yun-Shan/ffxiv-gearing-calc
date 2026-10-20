import { Worker } from "node:worker_threads";

export function createNodeBaselineWorker() {
  const worker = new Worker(new URL("./parallel-baseline-node.worker.ts", import.meta.url));
  let ready = false;
  const pending = [];
  worker.on("message", (message) => {
    if (message.type !== "ready") return;
    ready = true;
    for (const request of pending.splice(0)) worker.postMessage(request);
  });
  return {
    postMessage: (request) => ready ? worker.postMessage(request) : pending.push(request),
    onMessage: (listener) => {
      const wrapped = (message) => { if (message.type !== "ready") listener(message); };
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
