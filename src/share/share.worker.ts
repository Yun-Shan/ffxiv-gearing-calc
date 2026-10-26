import {
  restoreDocument,
  restoreShare,
} from "./restore.ts";
import type {
  ShareWorkerRequest,
  ShareWorkerResponse,
} from "./worker-protocol.ts";
const scope = self as unknown as {
  postMessage(value: ShareWorkerResponse): void;
  addEventListener(
    type: "message",
    fn: (event: MessageEvent<ShareWorkerRequest>) => void,
  ): void;
};
scope.addEventListener("message", (event) => {
  try {
    const request = event.data;
    const view =
      "token" in request
        ? restoreShare(request.token)
        : restoreDocument(request.document);
    scope.postMessage({ kind: "result", view });
  } catch (error) {
    scope.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : "无效的分享链接",
    });
  }
});
scope.postMessage({ kind: "ready" });
