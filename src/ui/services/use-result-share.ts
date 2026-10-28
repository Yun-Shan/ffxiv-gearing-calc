import { useSyncExternalStore } from "react";
import { resultShareCopy } from "./share-copy";

export function useResultShare() {
  const copying = useSyncExternalStore(
    resultShareCopy.subscribe,
    resultShareCopy.getSnapshot,
  );
  return {
    copying,
    copyLink: resultShareCopy.copyLink,
    copyImage: resultShareCopy.copyImage,
  };
}
