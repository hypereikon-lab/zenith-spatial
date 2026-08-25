import tgpu, { d, type SampledFlag, type TgpuComputePipeline, type TgpuRoot, type TgpuTexture } from "typegpu";
import type { GpuRuntime } from "../gpu-runtime.js";

const READBACK_WORKGROUP_SIZE = 16;

export const rgba8TextureReadbackBindings = tgpu
  .bindGroupLayout({
    source: { texture: d.texture2d(d.f32), visibility: ["compute"] },
    pixels: { storage: d.arrayOf(d.u32), access: "mutable", visibility: ["compute"] },
  })
  .$idx(0)
  .$name("RGBA8 texture readback bindings");

const readback = rgba8TextureReadbackBindings.bound;

export const rgba8TextureReadbackCompute = tgpu
  .computeFn({
    in: { globalId: d.builtin.globalInvocationId },
    workgroupSize: [READBACK_WORKGROUP_SIZE, READBACK_WORKGROUP_SIZE],
  })(
    `{
    let dimensions = textureDimensions(source);
    if (globalId.x >= dimensions.x || globalId.y >= dimensions.y) {
      return;
    }
    let pixelIndex = globalId.y * dimensions.x + globalId.x;
    let color = textureLoad(source, vec2i(globalId.xy), 0);
    pixels[pixelIndex] = pack4x8unorm(color);
  }`,
  )
  .$uses({
    pixels: readback.pixels,
    source: readback.source,
  })
  .$name("rgba8TextureReadback");

export const rgba8TextureReadbackShader = tgpu.resolve([rgba8TextureReadbackCompute], {
  names: "strict",
});

const pipelineByRoot = new WeakMap<TgpuRoot, TgpuComputePipeline>();

/**
 * Reads a TypeGPU-owned rgba8unorm texture without an application-owned raw
 * WebGPU copy or mapped buffer. A typed compute pass packs each texel into a
 * u32 storage buffer; TypeGPU owns dispatch, staging, mapping, and cleanup.
 */
export async function readRgba8Texture(
  runtime: GpuRuntime,
  texture: TgpuTexture & SampledFlag,
  width: number,
  height: number,
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  runtime.assertActive();
  assertReadbackDimensions(runtime, width, height);

  const pixelCount = width * height;
  const pixelSchema = d.arrayOf(d.u32, pixelCount);
  const pixelBuffer = runtime.root
    .createBuffer(pixelSchema)
    .$usage("storage")
    .$name(`Zenith RGBA8 readback ${width}x${height}`);

  try {
    const bindGroup = runtime.root.createBindGroup(rgba8TextureReadbackBindings, {
      source: texture,
      pixels: pixelBuffer,
    });
    readbackPipeline(runtime.root)
      .with(bindGroup)
      .dispatchWorkgroups(Math.ceil(width / READBACK_WORKGROUP_SIZE), Math.ceil(height / READBACK_WORKGROUP_SIZE));

    return unpackRgba8Pixels(await pixelBuffer.read());
  } finally {
    pixelBuffer.destroy();
  }
}

export function unpackRgba8Pixels(packedPixels: readonly number[]): Uint8ClampedArray<ArrayBuffer> {
  const pixels: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(packedPixels.length * 4);
  for (let index = 0; index < packedPixels.length; index += 1) {
    const packed = packedPixels[index] >>> 0;
    const offset = index * 4;
    pixels[offset] = packed & 0xff;
    pixels[offset + 1] = (packed >>> 8) & 0xff;
    pixels[offset + 2] = (packed >>> 16) & 0xff;
    pixels[offset + 3] = (packed >>> 24) & 0xff;
  }
  return pixels;
}

function assertReadbackDimensions(runtime: GpuRuntime, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`RGBA8 texture readback requires positive integer dimensions; received ${width} x ${height}.`);
  }
  if (width > runtime.limits.maxTextureDimension2D || height > runtime.limits.maxTextureDimension2D) {
    throw new Error(
      `RGBA8 texture readback is ${width} x ${height}; this GPU accepts texture edges up to ${runtime.limits.maxTextureDimension2D}.`,
    );
  }

  const requiredBytes = width * height * Uint32Array.BYTES_PER_ELEMENT;
  const availableBytes = Math.min(runtime.limits.maxBufferSize, runtime.limits.maxStorageBufferBindingSize);
  if (requiredBytes > availableBytes) {
    throw new Error(`RGBA8 texture readback needs ${requiredBytes} storage bytes; this GPU exposes ${availableBytes}.`);
  }
}

function readbackPipeline(root: TgpuRoot): TgpuComputePipeline {
  const cached = pipelineByRoot.get(root);
  if (cached) return cached;
  const pipeline = root
    .createComputePipeline({ compute: rgba8TextureReadbackCompute })
    .$name("Zenith RGBA8 texture readback pipeline");
  pipelineByRoot.set(root, pipeline);
  return pipeline;
}
