import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, test } from "vitest";

const kernelRoot = new URL(".", import.meta.url).pathname;
const sharedRoot = new URL("../lib/shared", import.meta.url).pathname;

describe("portable kernel import boundary", () => {
  test("keeps production kernels independent from browsers, UI, services, and servers", () => {
    const violations: string[] = [];
    for (const file of productionTypeScriptFiles(kernelRoot)) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        /from\s+["'][^"']*(?:services|routes|ui|artifacts|runway|lib\/server)[^"']*["']/,
        /\b(?:window|document|navigator|HTMLCanvasElement|GPUDevice)\b/,
        /from\s+["']svelte(?:\/[^"']*)?["']/,
      ]) {
        if (forbidden.test(source)) violations.push(`${file}: ${forbidden.source}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("keeps JSON-only shared contracts independent from TypeGPU kernels", () => {
    const violations = productionTypeScriptFiles(sharedRoot).filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["'](?:typegpu|[^"']*kernels\/)/.test(source);
    });
    expect(violations).toEqual([]);
  });
});

function productionTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    if (extname(entry.name) !== ".ts" || entry.name.endsWith(".test.ts")) return [];
    return [path];
  });
}
