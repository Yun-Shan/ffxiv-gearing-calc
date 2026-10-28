import type { ShareInput } from "@/share/types";
import { shareUrl } from "@/share/codec";
import { projectShareInput } from "@/share/projection";
import type { ResultShareData } from "@/ui/components/results/result-share-layout/types";
import { applicationBase } from "./application-base";
import { copyShareUrl } from "./share-link";
import { copyResultImage } from "./share-result";

// Clipboard transactions outlive their buttons, including Portal remounts.
let copying = false;
const listeners = new Set<() => void>();

function setCopying(value: boolean) {
  copying = value;
  for (const listener of listeners) listener();
}

async function runCopy(task: () => Promise<void>): Promise<boolean> {
  if (copying) return false;
  setCopying(true);
  try {
    // Invoke before the first await to preserve the original clipboard gesture.
    await task();
    return true;
  } finally {
    setCopying(false);
  }
}

export const resultShareCopy = {
  getSnapshot: () => copying,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  copyLink(data: ShareInput) {
    return runCopy(() =>
      copyShareUrl(
        shareUrl(
          projectShareInput(data),
          new URL(applicationBase(), window.location.origin).href,
        ),
      ),
    );
  },
  copyImage(data: ResultShareData) {
    return runCopy(() => copyResultImage(data));
  },
};
