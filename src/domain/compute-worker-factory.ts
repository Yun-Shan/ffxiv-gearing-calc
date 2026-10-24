import { computeWorkerUrl } from "./compute-worker-url.ts";

export function createComputeWorker(): Worker {
  return new Worker(computeWorkerUrl, { type: "module" });
}
