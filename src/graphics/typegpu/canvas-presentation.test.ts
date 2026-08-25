import { describe, expect, test, vi } from "vitest";
import type { TgpuRoot } from "typegpu";
import { createCanvasPresentation } from "./canvas-presentation.js";

describe("TypeGPU canvas presentation", () => {
  test("reconfigures only for a size or alpha change and unconfigures the active context", () => {
    const first = { unconfigure: vi.fn() } as unknown as GPUCanvasContext;
    const second = { unconfigure: vi.fn() } as unknown as GPUCanvasContext;
    const third = { unconfigure: vi.fn() } as unknown as GPUCanvasContext;
    const configureContext = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
    const root = { configureContext } as unknown as TgpuRoot;
    const canvas = { width: 64, height: 32 } as HTMLCanvasElement;
    const presentation = createCanvasPresentation(root, canvas, {
      format: "rgba8unorm",
      alphaMode: "opaque",
      usage: 1,
    });

    expect(presentation.configure({ width: 64, height: 32 })).toBe(first);
    expect(configureContext).toHaveBeenCalledTimes(1);

    expect(presentation.configure({ width: 96, height: 48 })).toBe(second);
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(48);
    expect(presentation.configure({ width: 96, height: 48, alphaMode: "premultiplied" })).toBe(third);
    expect(configureContext).toHaveBeenCalledTimes(3);

    presentation.destroy();
    presentation.destroy();
    expect(third.unconfigure).toHaveBeenCalledTimes(1);
    expect(() => presentation.configure({ width: 1, height: 1 })).toThrow(/destroyed/);
  });
});
