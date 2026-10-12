import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: (path) => {
        const absolutePath = resolve(path);

        // Keep the watcher root traversable so it can reach src.
        if (absolutePath === projectRoot) return false;
        if (!isWithin(srcRoot, absolutePath)) return true;

        const relativePath = relative(srcRoot, absolutePath);
        return (
          relativePath.split(sep).includes("__tests__") ||
          /\.(?:test|spec)\.[^\\/]+$/i.test(relativePath)
        );
      },
    },
  },
  worker: { format: "es" },
});
