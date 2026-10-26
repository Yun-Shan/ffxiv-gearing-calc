export const shareWorkerUrl = new URL(
  "./share.worker.ts?worker_file&type=module",
  import.meta.url,
).href;
