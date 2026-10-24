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
        const visit = (chunk: OutputChunk) => {
          if (files.has(chunk.fileName)) return;
          files.add(chunk.fileName);
          for (const name of [...chunk.imports, ...chunk.dynamicImports]) {
            const dependency = bundle[name];
            if (dependency?.type === "chunk") visit(dependency);
          }
          const assets = (
            chunk as OutputChunk & {
              viteMetadata?: { importedAssets: Set<string> };
            }
          ).viteMetadata?.importedAssets;
          for (const name of assets ?? [])
            if (name.endsWith(".wasm")) files.add(name);
        };
        visit(worker);
        // This is data only: fetching starts after a successful page mount, never
        // during HTML parsing. Dev keeps native on-demand module loading.
        return [
          {
            tag: "script",
            attrs: {
              id: "compute-preload-resources",
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
