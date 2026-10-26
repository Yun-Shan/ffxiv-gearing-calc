import { configDefaults, defineConfig } from "vitest/config";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { appShellPlugin } from "./scripts/vite-app-shell.ts";
import { computeWorkerPlugin } from "./scripts/vite-compute-worker.ts";

const projectRoot = resolve(process.cwd());
const srcRoot = resolve(projectRoot, "src");

export function applicationBaseFromHtml(html: string): string {
  const tags = html.replace(/<!--[\s\S]*?-->/g, "").match(/<base\b[^>]*>/gi);
  const href =
    tags?.length === 1
      ? /\shref\s*=\s*(["'])(.*?)\1/i.exec(tags[0]!)?.[2]
      : undefined;
  if (
    !href ||
    !href.startsWith("/") ||
    href.startsWith("//") ||
    !href.endsWith("/") ||
    /[?#\\\s&"'<>]/.test(href)
  ) {
    throw new Error(
      'index.html must contain exactly one <base href="/.../"> with an absolute path ending in / and no query, hash or origin',
    );
  }
  return new URL(href, "https://application-base.invalid").pathname;
}

function isWithin(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

export default defineConfig({
  base: applicationBaseFromHtml(
    readFileSync(resolve(projectRoot, "index.html"), "utf8"),
  ),
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: false,
      tmpDir: resolve(projectRoot, ".tmp/tanstack-router"),
      routesDirectory: "./src/ui/app/routes",
      generatedRouteTree: "./src/ui/app/routeTree.gen.ts",
    }),
    react(),
    appShellPlugin(projectRoot),
    computeWorkerPlugin(projectRoot),
  ],
  resolve: {
    alias: {
      "@": srcRoot,
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/*.helper.test.*",
      ".tmp/**",
      "docs/search-optimization/acceptance-runs/**",
      "scripts/node-tests/**",
      "reference/**",
    ],
    setupFiles: [
      resolve(projectRoot, "src/test-utils/test-binary-data.helper.test.ts"),
    ],
  },
  server: {
    watch: {
      ignored: (path) => {
        const absolutePath = resolve(path);

        // Keep the watcher root traversable so it can reach src.
        if (absolutePath === projectRoot) return false;
        if (!isWithin(srcRoot, absolutePath)) return true;

        const relativePath = relative(srcRoot, absolutePath);
        return (
          relativePath.split(sep).includes("test-utils") ||
          relativePath.split(sep).includes("__tests__") ||
          /\.(?:test|spec)\.[^\\/]+$/i.test(relativePath)
        );
      },
    },
  },
});
