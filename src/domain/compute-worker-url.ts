// Production replaces this URL with a chunk emitted in the page's build graph.
// Keep a normal module here so Node consumers can still import the domain entry.
export const computeWorkerUrl = new URL(
  "./compute.worker.ts?worker_file&type=module",
  import.meta.url,
).href;
