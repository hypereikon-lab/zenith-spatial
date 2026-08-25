import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();
const AUDITED_RAW_DEVICE_LIFECYCLE = new Set(["src/graphics/typegpu/gpu-device-lifecycle.ts"]);

const RAW_GPU_OPERATIONS = [
  /\bdevice\.create(?:Sampler|Texture|Buffer|ShaderModule|RenderPipeline|ComputePipeline|BindGroupLayout|BindGroup|PipelineLayout|CommandEncoder|RenderBundleEncoder|QuerySet)\s*\(/g,
  /\b(?:encoder|commandEncoder)\.beginRenderPass\s*\(/g,
  /\b(?:encoder|commandEncoder)\.beginComputePass\s*\(/g,
  /\.queue\.(?:writeBuffer|writeTexture|copyExternalImageToTexture|submit|onSubmittedWorkDone)\s*\(/g,
  /\bcontext\.configure\s*\(/g,
  /navigator\.gpu\.requestAdapter\s*\(/g,
  /\.(?:copyBufferToBuffer|copyTextureToBuffer|copyTextureToTexture|clearBuffer|resolveQuerySet)\s*\(/g,
  /\.mapAsync\s*\(/g,
  /\bdevice\.(?:pushErrorScope|popErrorScope)\s*\(/g,
  /\bdevice\.lost\b/g,
];

describe("TypeGPU architecture boundary", () => {
  test("keeps raw WebGPU execution inside the audited device lifecycle module", () => {
    const violations = productionTypeScriptFiles(join(ROOT, "src")).flatMap((file) => {
      const repoPath = relative(ROOT, file);
      if (AUDITED_RAW_DEVICE_LIFECYCLE.has(repoPath)) return [];
      const source = readFileSync(file, "utf8");
      return RAW_GPU_OPERATIONS.flatMap((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(source) ? [`${repoPath}: ${pattern.source}`] : [];
      });
    });

    expect(violations).toEqual([]);
  });

  test("keeps direct GPUDevice execution inside runtime and lifecycle ownership", () => {
    const allowed = new Set([
      ...AUDITED_RAW_DEVICE_LIFECYCLE,
      "src/graphics/gpu-runtime.ts",
      "src/graphics/typegpu/runtime.ts",
    ]);
    const violations = productionTypeScriptFiles(join(ROOT, "src")).flatMap((file) => {
      const repoPath = relative(ROOT, file);
      if (allowed.has(repoPath)) return [];
      const source = readFileSync(file, "utf8");
      return /(?:runtime|nextRuntime|root)\.device\b/.test(source) ? [repoPath] : [];
    });

    expect(violations).toEqual([]);
  });

  test("uses TypeGPU for the ordered multi-pipeline render pass", () => {
    const source = readFileSync(join(ROOT, "src/graphics/typegpu/ordered-render-pass.ts"), "utf8");

    expect(source).toContain('runtime.root["~unstable"].beginRenderPass');
    expect(source).toContain("pass.setBindGroup(draw.bindGroup.layout, draw.bindGroup)");
    expect(source).not.toMatch(/createCommandEncoder|queue\.submit|GPUCommandEncoder/);
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
