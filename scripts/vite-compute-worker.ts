import { resolve } from "node:path";
import { normalizePath, type Plugin } from "vite";
import type { OutputChunk } from "rolldown";

/** Build the page and compute workers in one module graph so shared code has one URL. */
export function computeWorkerPlugin(projectRoot: string): Plugin {
  const urlModule = normalizePath(
    resolve(projectRoot, "src/domain/compute-worker-url.ts"),
  );
  const workerEntry = normalizePath(
    resolve(projectRoot, "src/domain/compute.worker.ts"),
  );
  let building = false;
  let base = "/";

  return {
    name: "compute-worker",
    enforce: "pre",
    configResolved(config) {
      building = config.command === "build";
      base = config.base;
    },
    load(id) {
      if (!building || normalizePath(id) !== urlModule) return;
      const reference = this.emitFile({
        type: "chunk",
        id: workerEntry,
        name: "compute.worker",
      });
      return `export const computeWorkerUrl = import.meta.ROLLDOWN_FILE_URL_${reference};`;
    },
    transform(code, id) {
      if (!building || id !== "\0vite/preload-helper.js") return;
      // Vite's page preload helper touches document/window, including on import failure.
      // Shared dynamic imports must use native import semantics inside a worker, while
      // the page keeps Vite's CSS preloads and vite:preloadError notifications.
      const declaration = "export const __vitePreload =";
      if (!code.includes(declaration)) {
        this.error(
          "Vite preload helper changed; update the compute-worker compatibility wrapper.",
        );
      }
      return {
        code:
          code.replace(declaration, "const preloadForDocument =") +
          `;
export const __vitePreload = (load, ...args) =>
  typeof document === "undefined" ? load() : preloadForDocument(load, ...args);
`,
        map: null,
      };
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        if (!context.bundle) return;
        const bundle = context.bundle;
        const worker = Object.values(bundle).find(
          (entry): entry is OutputChunk =>
            entry.type === "chunk" && entry.facadeModuleId === workerEntry,
        );
        if (!worker)
          throw new Error(
            "Compute worker entry missing from the browser build",
          );
        const files = new Set<string>();
        // Cover every emitted module, including page-only dynamic imports such as
        // result sharing. The runtime skips resources already loaded by the page.
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== "chunk") continue;
          if (chunk.fileName !== context.chunk?.fileName)
            files.add(chunk.fileName);
          const metadata = (
            chunk as OutputChunk & {
              viteMetadata?: {
                importedAssets: Set<string>;
                importedCss: Set<string>;
              };
            }
          ).viteMetadata;
          for (const name of [
            ...(metadata?.importedAssets ?? []),
            ...(metadata?.importedCss ?? []),
          ]) {
            // Emitted chunk URLs can remain hash placeholders in Vite metadata.
            // Their final filenames are already collected from the bundle above.
            if (bundle[name]) files.add(name);
          }
        }
        // This is data only: fetching starts after a successful page mount, never
        // during HTML parsing. Dev keeps native on-demand module loading.
        return [
          {
            tag: "script",
            attrs: {
              id: "app-preload-resources",
              type: "application/json",
            },
            children: JSON.stringify(
              [...files].map((name) => base + name),
            ).replaceAll("<", "\\u003c"),
            injectTo: "head",
          },
        ];
      },
    },
  };
}
