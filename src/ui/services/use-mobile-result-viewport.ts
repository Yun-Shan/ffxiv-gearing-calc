import { useSyncExternalStore } from "react";

// Keep aligned with tokens.$result-mobile-breakpoint. Floating share controls
// render outside size containers so they remain fixed to the viewport.
const mobileResultQuery = "(width < 1000px)";
function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(mobileResultQuery);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}
function getSnapshot() {
  return window.matchMedia?.(mobileResultQuery).matches ?? false;
}

export function useMobileResultViewport() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
