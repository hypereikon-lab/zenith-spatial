import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();
const BROWSER_ROOTS = [
  "src/app",
  "src/artifacts",
  "src/geometry",
  "src/graphics",
  "src/media",
  "src/plates",
  "src/runway",
  "src/scene",
  "src/ui",
  "src/viewport",
];

describe("architecture boundaries", () => {
  test("keeps server-only modules and Node builtins out of browser ownership", () => {
    const violations = sourceFiles(BROWSER_ROOTS).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return importSpecifiers(source)
        .filter((specifier) => specifier.startsWith("node:") || specifier.includes("lib/server"))
        .map((specifier) => `${relative(ROOT, file)} -> ${specifier}`);
    });
    expect(violations).toEqual([]);
  });

  test("keeps private environment and filesystem access server-side", () => {
    const guarded = ["$env/dynamic/private", "node:fs", "node:fs/promises"];
    const violations = sourceFiles(["src"]).flatMap((file) => {
      if (file.includes("/src/lib/server/") || file.includes("/src/routes/api/")) return [];
      const source = readFileSync(file, "utf8");
      return importSpecifiers(source)
        .filter((specifier) => guarded.includes(specifier))
        .map((specifier) => `${relative(ROOT, file)} -> ${specifier}`);
    });
    expect(violations).toEqual([]);
  });
});

function sourceFiles(roots: string[]): string[] {
  return roots
    .flatMap((root) => walk(join(ROOT, root)))
    .filter((file) => [".ts", ".svelte"].includes(extname(file)) && !file.endsWith(".test.ts"));
}

function walk(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)].map((match) => match[1]);
}
