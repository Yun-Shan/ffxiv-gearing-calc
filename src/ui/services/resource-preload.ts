/** Warm production resource caches without executing modules or creating a worker. */
export function scheduleResourcePreload(): void {
  const manifest = document.getElementById("app-preload-resources");
  if (!manifest || manifest.dataset.scheduled === "true") return;
  let resources: unknown;
  try {
    resources = JSON.parse(manifest.textContent ?? "[]");
  } catch {
    return;
  }
  if (
    !Array.isArray(resources) ||
    !resources.every((url) => typeof url === "string")
  )
    return;
  manifest.dataset.scheduled = "true";
  const urls = [...new Set(resources as string[])];
  const warm = async () => {
    // Run sequentially at low priority; normal demand loading remains independent.
    for (const url of urls) {
      try {
        const href = new URL(url, document.baseURI).href;
        if (performance.getEntriesByName(href).length > 0) continue;
        const response = await fetch(href, {
          cache: "force-cache",
          credentials: "same-origin",
          priority: "low",
        });
        // Consume the body to complete the cache entry, without compiling JS/WASM.
        if (response.ok) await response.arrayBuffer();
        else await response.body?.cancel();
      } catch {
        // Speculative downloads never fail startup or the actual computation.
      }
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(
      () => {
        void warm();
      },
      { timeout: 3000 },
    );
  } else {
    window.setTimeout(() => {
      void warm();
    }, 1000);
  }
}
