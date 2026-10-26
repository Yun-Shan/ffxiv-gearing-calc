import type { ShareDocument, ShareView } from "./types.ts";
export type ShareWorkerRequest =
  | { token: string }
  | { document: ShareDocument };
export type ShareWorkerResponse =
  | { kind: "ready" }
  | { kind: "result"; view: ShareView }
  | { kind: "error"; message: string };
