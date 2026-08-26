import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();
const BROWSER_ROOTS = [
  "src/domain",
  "src/geometry",
  "src/graphics",
  "src/inpaint",
  "src/kernels",
  "src/media",
  "src/plates",
  "src/react",
  "src/runtime",
  "src/scene",
];

describe("Zenith architecture boundaries", () => {
  test("keeps Node APIs and server secrets outside browser-owned modules", () => {
    const violations = sourceFiles(BROWSER_ROOTS).flatMap((file) => {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return [];
      const source = readFileSync(file, "utf8");
      const imports = importSpecifiers(source)
        .filter((specifier) => specifier.startsWith("node:") || specifier.includes("/server/"))
        .map((specifier) => `${relative(ROOT, file)} -> ${specifier}`);
      if (/RUNWAYML_API_SECRET|process\.env/.test(source)) imports.push(`${relative(ROOT, file)} -> private env`);
      return imports;
    });
    expect(violations).toEqual([]);
  });

  test("has no Svelte runtime, legacy graph, Zod, or browser-global media registry imports", () => {
    const violations = sourceFiles(["src", "server"]).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return importSpecifiers(source)
        .filter((specifier) =>
          /(?:svelte|zod|artifacts|operator-registry|composition-sequence|artifact-media-handles)/.test(specifier),
        )
        .map((specifier) => `${relative(ROOT, file)} -> ${specifier}`);
    });
    expect(violations).toEqual([]);
  });

  test("keeps the portable domain free of browser runtime objects", () => {
    const violations = sourceFiles(["src/domain"])
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) =>
        /\b(?:Blob|File|HTMLCanvasElement|ImageBitmap|objectURL|createObjectURL)\b/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(ROOT, file));
    expect(violations).toEqual([]);
  });

  test("contains no Svelte source, legacy runtime directories, or legacy packages", () => {
    const legacyDirectories = [
      "src/app",
      "src/artifacts",
      "src/routes",
      "src/runway",
      "src/sequence",
      "src/ui",
      "src/viewport",
    ].filter((path) => existsSync(join(ROOT, path)));
    const svelteFiles = allFiles(join(ROOT, "src"))
      .filter((file) => file.endsWith(".svelte") || file.endsWith(".svelte.ts"))
      .map((file) => relative(ROOT, file));
    const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);
    const legacyPackages = [
      "svelte",
      "@sveltejs/kit",
      "@sveltejs/adapter-node",
      "bits-ui",
      "lucide-svelte",
      "zod",
      "prettier-plugin-svelte",
    ].filter((name) => installed.has(name));

    expect({ legacyDirectories, svelteFiles, legacyPackages }).toEqual({
      legacyDirectories: [],
      svelteFiles: [],
      legacyPackages: [],
    });
  });
});

function sourceFiles(roots: ReadonlyArray<string>): string[] {
  return roots.flatMap((root) => walk(join(ROOT, root)));
}

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return walk(child);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [child] : [];
  });
}

function allFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? allFiles(child) : [child];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)].map((match) => match[1]!);
}
