import { describe, expect, test, vi } from "vitest";
import type { GpuRuntime } from "../gpu-runtime.js";
import { executeTypeGpuFullscreenDrawSequence } from "./ordered-render-pass.js";

describe("ordered TypeGPU render pass", () => {
  test("clears once and preserves heterogeneous draw order through TypeGPU", () => {
    const operations: string[] = [];
    const pass = {
      setViewport: vi.fn(() => operations.push("viewport")),
      setScissorRect: vi.fn(() => operations.push("scissor")),
      setPipeline: vi.fn((pipeline: { label: string }) => operations.push(`pipeline:${pipeline.label}`)),
      setBindGroup: vi.fn((_layout: unknown, group: { label: string }) => operations.push(`group:${group.label}`)),
      draw: vi.fn((count: number) => operations.push(`draw:${count}`)),
    };
    const beginRenderPass = vi.fn((descriptor: unknown, callback: (value: typeof pass) => void) => {
      callback(pass);
      return descriptor;
    });
    const assertActive = vi.fn();
    const targetView = {};
    const target = { createView: vi.fn(() => ({ resourceType: "texture-view" })) };
    const runtime = {
      root: {
        unwrap: vi.fn(() => targetView),
        "~unstable": { beginRenderPass },
      },
      assertActive,
    } as unknown as GpuRuntime;
    const guideLayout = { label: "guide-layout" };
    const compositeLayout = { label: "composite-layout" };
    const draws = [
      {
        pipeline: { label: "guide" },
        bindGroup: { label: "guide", layout: guideLayout },
      },
      {
        pipeline: { label: "plate-a" },
        bindGroup: { label: "plate-a", layout: compositeLayout },
        vertexCount: 6,
      },
      {
        pipeline: { label: "plate-b" },
        bindGroup: { label: "plate-b", layout: compositeLayout },
      },
    ];

    executeTypeGpuFullscreenDrawSequence(runtime, {
      target: target as never,
      width: 2048,
      height: 1024,
      draws: draws as never,
    });

    expect(assertActive).toHaveBeenCalledOnce();
    expect(target.createView).toHaveBeenCalledWith("render");
    expect(runtime.root.unwrap).toHaveBeenCalledWith(target.createView.mock.results[0]?.value);
    expect(beginRenderPass).toHaveBeenCalledOnce();
    expect(beginRenderPass.mock.calls[0]?.[0]).toMatchObject({
      label: "Zenith ordered TypeGPU fullscreen pass",
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    expect(operations).toEqual([
      "viewport",
      "scissor",
      "pipeline:guide",
      "group:guide",
      "draw:3",
      "pipeline:plate-a",
      "group:plate-a",
      "draw:6",
      "pipeline:plate-b",
      "group:plate-b",
      "draw:3",
    ]);
    expect(pass.setBindGroup).toHaveBeenNthCalledWith(1, guideLayout, draws[0]?.bindGroup);
    expect(pass.setBindGroup).toHaveBeenNthCalledWith(2, compositeLayout, draws[1]?.bindGroup);
  });
});
