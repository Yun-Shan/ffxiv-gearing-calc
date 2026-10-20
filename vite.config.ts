import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { isAbsolute, relative, resolve, sep } from "node:path";

const projectRoot = resolve(process.cwd());
const srcRoot = resolve(projectRoot, "src");

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
  plugins: [react()],
  resolve: {
    alias: {
      "@": srcRoot,
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/*.helper.test.*",
      "scripts/cpsat-unique-research/**",
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
  worker: { format: "es" },
});
