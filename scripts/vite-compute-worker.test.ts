import { resolve } from "node:path";
import { build } from "vite";
import type { OutputChunk } from "rolldown";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("shared page/compute worker production build", () => {
  it.each(["/", "/ffxiv-gearing-calc/", "./"])(
    "shares modules and keeps worker imports DOM-free at base %s",
    async (base) => {
      const result = await build({
        configFile: resolve("vite.config.ts"),
        base,
        logLevel: "silent",
        build: { write: false },
      });
      if (Array.isArray(result) || !("output" in result))
        throw new Error("Expected one browser build");
      const chunks = result.output.filter(
        (entry): entry is OutputChunk => entry.type === "chunk",
      );
      const page = chunks.find(
        (chunk) =>
          chunk.isEntry && chunk.facadeModuleId?.endsWith("/index.html"),
      )!;
      const workers = chunks.filter((chunk) =>
        chunk.facadeModuleId?.endsWith(".worker.ts"),
      );
      expect(workers).toHaveLength(1);
      const worker = workers[0]!;
      expect(worker.facadeModuleId).toMatch(/\/compute\.worker\.ts$/);

      const owners = new Map<string, string[]>();
      for (const chunk of chunks)
        for (const id of chunk.moduleIds) {
          owners.set(id, [...(owners.get(id) ?? []), chunk.fileName]);
        }
      expect([...owners.values()].filter((files) => files.length > 1)).toEqual(
        [],
      );
      const reach = (entry: OutputChunk, dynamic = false): Set<string> => {
        const reached = new Set<string>();
        const visit = (chunk: OutputChunk) => {
          if (reached.has(chunk.fileName)) return;
          reached.add(chunk.fileName);
          for (const name of [
            ...chunk.imports,
            ...(dynamic ? chunk.dynamicImports : []),
          ]) {
            const dependency = chunks.find(
              (candidate) => candidate.fileName === name,
            );
            if (dependency) visit(dependency);
          }
        };
        visit(entry);
        return reached;
      };
      const pageImports = reach(page);
      const workerImports = reach(worker);
      const dataOwner = [...owners].find(([id]) =>
        id.endsWith("/src/domain/data.ts"),
      )![1][0]!;
      expect(pageImports.has(dataOwner)).toBe(true);
      expect(workerImports.has(dataOwner)).toBe(true);
      expect(pageImports.has(worker.fileName)).toBe(false);
      const workerModules = chunks
        .filter((chunk) => workerImports.has(chunk.fileName))
        .flatMap((chunk) => chunk.moduleIds);
      expect(
        workerModules.some((id) =>
          /\/src\/ui\/|\/node_modules\/(?:react|react-dom)\//.test(id),
        ),
      ).toBe(false);

      const highsOwners = [...owners].filter(([id]) =>
        id.endsWith("/node_modules/highs/build/highs.mjs"),
      );
      expect(highsOwners).toHaveLength(1);
      const highsFile = highsOwners[0]![1][0]!;
      expect(pageImports.has(highsFile)).toBe(false);
      expect(workerImports.has(highsFile)).toBe(false);
      expect(reach(page, true).has(highsFile)).toBe(true);
      expect(reach(worker, true).has(highsFile)).toBe(true);
      expect(
        result.output.filter((entry) => entry.fileName.endsWith(".wasm")),
      ).toHaveLength(1);

      const html = result.output.find(
        (entry) => entry.type === "asset" && entry.fileName === "index.html",
      );
      if (html?.type !== "asset") throw new Error("Expected HTML output");
      const manifest =
        /<script id="app-preload-resources"[^>]*>(.*?)<\/script>/s.exec(
          String(html.source),
        );
      expect(manifest).not.toBeNull();
      const resources = JSON.parse(manifest![1]!) as string[];
      expect(resources).toContain(base + worker.fileName);
      expect(resources).toContain(base + highsFile);
      expect(resources.some((url) => url.endsWith(".wasm"))).toBe(true);
      const snapdom = chunks.find((chunk) =>
        chunk.moduleIds.some((id) => id.includes("/node_modules/@zumer/snapdom/")),
      )!;
      const shareLayout = chunks.find((chunk) =>
        chunk.moduleIds.some((id) => id.endsWith("/ResultShareLayout.tsx")),
      )!;
      expect(pageImports.has(snapdom.fileName)).toBe(false);
      expect(pageImports.has(shareLayout.fileName)).toBe(false);
      expect(reach(worker, true).has(snapdom.fileName)).toBe(false);
      expect(resources).toContain(base + snapdom.fileName);
      expect(resources).toContain(base + shareLayout.fileName);
      const deferredCss = result.output.filter(
        (entry) =>
          entry.fileName.startsWith("assets/ResultShareLayout-") &&
          entry.fileName.endsWith(".css"),
      );
      expect(deferredCss).toHaveLength(1);
      expect(resources).toContain(base + deferredCss[0]!.fileName);
      // Every emitted runtime resource is covered, beyond today's known imports.
      for (const entry of result.output) {
        if (entry.fileName === "index.html" || entry.fileName === page.fileName)
          continue;
        expect(resources).toContain(base + entry.fileName);
      }
      expect(resources).not.toContain(base + page.fileName);
      expect(new Set(resources).size).toBe(resources.length);
      expect(resources.every((url) => url.startsWith(base))).toBe(true);
      const outputUrls = new Set(
        result.output.map((entry) => base + entry.fileName),
      );
      expect(resources.filter((url) => !outputUrls.has(url))).toEqual([]);

      const factory = chunks.find((chunk) =>
        chunk.moduleIds.some((id) => id.endsWith("/compute-worker-factory.ts")),
      )!;
      if (base === "./") expect(factory.code).toContain("import.meta.url");
      else expect(factory.code).toContain(base + worker.fileName);

      // Exercise the actual emitted helper, including rejected imports: no DOM globals
      // exist here, so an accidental page preload/error handler would mask the error.
      const helper = chunks.find((chunk) =>
        chunk.moduleIds.includes("\0vite/preload-helper.js"),
      )!;
      const helperModule = await import(
        /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(helper.code).toString("base64")}`
      );
      const preload = Object.values(helperModule)[0] as (
        load: () => Promise<unknown>,
        deps: string[],
      ) => Promise<unknown>;
      await expect(preload(async () => "loaded", ["/shared.js"])).resolves.toBe(
        "loaded",
      );
      const failure = new Error("worker import unavailable");
      await expect(
        preload(() => Promise.reject(failure), ["/shared.js"]),
      ).rejects.toBe(failure);

      // Page failures must still reach AppShell via Vite's preload-error event.
      const dispatchEvent = vi.fn(() => true);
      vi.stubGlobal("document", {});
      vi.stubGlobal("window", { dispatchEvent });
      await expect(preload(() => Promise.reject(failure), [])).rejects.toBe(
        failure,
      );
      expect(dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "vite:preloadError",
          payload: failure,
        }),
      );
    },
    30_000,
  );
});
