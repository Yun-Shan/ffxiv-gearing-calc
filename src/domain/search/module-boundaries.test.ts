import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { expect, test } from "vitest";

const domainRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalized = (path: string) =>
  relative(domainRoot, path).replaceAll("\\", "/");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.ts$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

function localModule(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const path = resolve(dirname(file), specifier);
  const candidates = [
    path.replace(/\.js$/, ".ts"),
    `${path}.ts`,
    resolve(path, "index.ts"),
  ];
  return candidates.find(
    (candidate) => existsSync(candidate) && candidate.endsWith(".ts"),
  );
}

function dependencies(file: string, includeTypes: boolean): string[] {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["typescript"],
    createImportExpressions: true,
  });
  const references: string[] = [];
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") {
      if (
        includeTypes ||
        (node.importKind !== "type" &&
          (node.specifiers.length === 0 ||
            node.specifiers.some(
              (specifier) =>
                specifier.type !== "ImportSpecifier" ||
                specifier.importKind !== "type",
            )))
      ) {
        references.push(node.source.value);
      }
    } else if (
      (node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      if (includeTypes || node.exportKind !== "type")
        references.push(node.source.value);
    }
  }
  // Literal dynamic imports are graph edges too, including environment adapters.
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const value = node as Record<string, unknown>;
    if (value.type === "ImportExpression") {
      const source = value.source as { type: string; value?: string };
      if (source.type === "StringLiteral" && source.value)
        references.push(source.value);
    }
    for (const [key, child] of Object.entries(value)) {
      if (["loc", "start", "end", "comments"].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast.program);
  return [
    ...new Set(
      references.flatMap((specifier) => localModule(file, specifier) ?? []),
    ),
  ];
}

test("search modules have no runtime dependency cycles", () => {
  const files = sources(domainRoot);
  const graph = new Map(files.map((file) => [file, dependencies(file, false)]));
  const complete = new Set<string>();
  const active: string[] = [];
  const visit = (file: string): void => {
    if (complete.has(file)) return;
    expect(
      active.includes(file),
      active.concat(file).map(normalized).join(" -> "),
    ).toBe(false);
    active.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    active.pop();
    complete.add(file);
  };
  for (const file of files.filter((file) =>
    normalized(file).startsWith("search/"),
  ))
    visit(file);
});

test("solver primitives and exact model modules do not depend on coordinators", () => {
  const files = sources(resolve(domainRoot, "search"));
  for (const file of files) {
    const name = normalized(file);
    const imports = dependencies(file, true).map(normalized);
    if (name.startsWith("search/core/")) {
      expect(
        imports.filter(
          (dependency) =>
            !dependency.startsWith("search/core/") &&
            !["search/linear-mip.ts", "search/highs-browser.ts"].includes(
              dependency,
            ),
        ),
        name,
      ).toEqual([]);
    }
    if (name.startsWith("search/exact-mip/")) {
      expect(
        imports.filter(
          (dependency) =>
            dependency.startsWith("search/joint-loadout/") ||
            dependency === "search/loadout-finder-exact-mip.ts" ||
            dependency === "search/loadout-finder-v3.ts",
        ),
        name,
      ).toEqual([]);
      if (
        !name.endsWith("/single-search.ts") &&
        !name.endsWith("/joint-search.ts")
      ) {
        expect(
          imports.filter((dependency) =>
            /exact-mip\/(single|joint)-search\.ts$/.test(dependency),
          ),
          name,
        ).toEqual([]);
      }
    }
  }
});
