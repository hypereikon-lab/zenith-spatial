import { describe, expect, test, vi } from "vitest";
import type { GpuRuntime } from "../gpu-runtime.js";
import { readRgba8Texture, rgba8TextureReadbackShader, unpackRgba8Pixels } from "./texture-readback.js";

describe("TypeGPU RGBA8 texture readback", () => {
  test("resolves a bounded compute kernel with typed texture and storage bindings", () => {
    expect(rgba8TextureReadbackShader).toContain("@compute @workgroup_size(16, 16)");
    expect(rgba8TextureReadbackShader).toContain("var source: texture_2d<f32>");
    expect(rgba8TextureReadbackShader).toContain("var<storage, read_write> pixels: array<u32>");
    expect(rgba8TextureReadbackShader).toContain("textureLoad(source");
    expect(rgba8TextureReadbackShader).toContain("pack4x8unorm(color)");
  });

  test("unpacks WGSL pack4x8unorm words without depending on host endianness", () => {
    expect(Array.from(unpackRgba8Pixels([0x04030201, 0xff00ff00]))).toEqual([1, 2, 3, 4, 0, 255, 0, 255]);
  });

  test("rejects invalid dimensions before allocating a TypeGPU buffer", async () => {
    const createBuffer = vi.fn();
    const runtime = fakeRuntime(createBuffer);

    await expect(readRgba8Texture(runtime, {} as never, 10.5, 8)).rejects.toThrow(/positive integer dimensions/);
    expect(createBuffer).not.toHaveBeenCalled();
  });

  test("fails early when the typed storage buffer would exceed device limits", async () => {
    const createBuffer = vi.fn();
    const runtime = fakeRuntime(createBuffer, {
      maxTextureDimension2D: 4096,
      maxBufferSize: 4096,
      maxStorageBufferBindingSize: 1024,
    });

    await expect(readRgba8Texture(runtime, {} as never, 32, 32)).rejects.toThrow(
      "RGBA8 texture readback needs 4096 storage bytes; this GPU exposes 1024.",
    );
    expect(createBuffer).not.toHaveBeenCalled();
  });
});

function fakeRuntime(
  createBuffer: ReturnType<typeof vi.fn>,
  limits = {
    maxTextureDimension2D: 4096,
    maxBufferSize: 256 * 1024 * 1024,
    maxStorageBufferBindingSize: 128 * 1024 * 1024,
  },
): GpuRuntime {
  return {
    root: { createBuffer },
    limits,
    assertActive: vi.fn(),
  } as unknown as GpuRuntime;
}
