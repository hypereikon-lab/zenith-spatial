import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PlateGpuCompositor, plateCompositeShader, plateGuideShader } from "./plate-gpu-compositor.js";
import { createPlateSketchGpuRenderer } from "./plate-sketch-gpu-renderer.js";
import tgpu from "typegpu";
import { createGpuDeviceLifecycle } from "../graphics/typegpu/gpu-device-lifecycle.js";
import { createGpuResourceScope } from "../graphics/typegpu/resource-scope.js";

type Destroyable = { destroy: ReturnType<typeof vi.fn> };
type FakeTexture = Destroyable & { createView: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.stubGlobal("GPUShaderStage", {
    VERTEX: 1,
    FRAGMENT: 2,
  });
  vi.stubGlobal("GPUBufferUsage", {
    UNIFORM: 1,
    COPY_DST: 2,
    VERTEX: 4,
    INDEX: 8,
  });
  vi.stubGlobal("GPUTextureUsage", {
    RENDER_ATTACHMENT: 1,
    TEXTURE_BINDING: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("plate GPU compositor shader", () => {
  test("resolves the same portable inverse-spin kernel used by the placement HUD", () => {
    expect(plateCompositeShader).toContain("fn directionToPlateLocalKernel");
    expect(plateCompositeShader).toContain("(map.x * spin.y) + (map.y * spin.x)");
    expect(plateCompositeShader).toContain("(-(map.x) * spin.x) + (map.y * spin.y)");
    expect(plateCompositeShader).toContain("dot(direction, right)");
    expect(plateCompositeShader).toContain("dot(direction, down)");
  });

  test("inverts the warped quadrilateral before sampling plate uv", () => {
    expect(plateCompositeShader).toContain("warpNorth: vec4f");
    expect(plateCompositeShader).toContain("warpSouth: vec4f");
    expect(plateCompositeShader).toContain("fn plateLocalToWarpedUvKernel");
    expect(plateCompositeShader).toContain("let warped = plateLocalToWarpedUvKernel");
    expect(plateCompositeShader).toContain("let residual = length((projected - local))");
  });

  test("bakes plate maps through the governed projection and plate kernels", () => {
    expect(plateCompositeShader).toContain("struct projectionKernelParamsSchema");
    expect(plateCompositeShader).toContain("struct plateKernelParamsSchema");
    expect(plateCompositeShader).toContain("fn sourceUvToDirectionKernel");
    expect(plateCompositeShader).toContain("fn plateSampleUvForDirectionKernel");
    expect(plateCompositeShader).toContain("plate.projection.innerSplit");
    expect(plateCompositeShader).toContain("plate.plate.angularSize");
    expect(plateCompositeShader).not.toContain("sourceCenterTheta");
    expect(plateCompositeShader).not.toContain("carrierObserver");
  });

  test("keeps angular fisheye and cylinder carrier masks distinct on rectangular rasters", () => {
    expect(plateCompositeShader).toContain("plate.projection.topology == 0u");
    expect(plateCompositeShader).toContain("let fisheyeScale = max(plate.projection.fisheyeScale");
    expect(plateCompositeShader).toContain("let fisheyePoint = (in.uv - vec2f(0.5)) / fisheyeScale");
    expect(plateCompositeShader).toContain("plate.projection.topology == 2u");
    expect(plateCompositeShader).toContain("let cylinderPoint = (in.uv - vec2f(0.5)) * 2.0");
    expect(plateCompositeShader).toContain("fn cylinderWallUvToDirectionKernel");
    expect(plateCompositeShader).not.toContain("carrierObserver.w");
  });

  test("keeps rings, spokes, and black construction lines out of the inpaint handoff", () => {
    expect(plateGuideShader).toContain("fn guideFieldColorKernel");
    expect(plateGuideShader).toContain("fn guideFieldAzimuthKernel");
    expect(plateGuideShader).not.toContain("let rayLine =");
    expect(plateGuideShader).not.toContain("let ringLine =");
    expect(plateGuideShader).not.toContain("construction");
    expect(plateGuideShader).not.toContain("fwidth(");
  });

  test("draws the wall unwrap as a full rectangular seam-continuous field", () => {
    expect(plateGuideShader).toContain("if (guide.projection.topology == 3u)");
    expect(plateGuideShader).toContain("let seamContinuousTint = mix");
    expect(plateGuideShader).toContain("sin(in.uv.x * 6.283185307179586)");
    expect(plateGuideShader).not.toContain("edgeLine");
  });

  test("expresses dome sky and floor meaning through continuous field colors", () => {
    expect(plateGuideShader).toContain("let sky = vec3f(0.0, 0.8705882353, 1.0)");
    expect(plateGuideShader).toContain("let horizon = vec3f(0.0, 1.0, 0.6901960784)");
    expect(plateGuideShader).toContain("let floor = vec3f(0.0, 1.0, 0.0)");
    expect(plateGuideShader).toContain("guide.projection.center == 1u");
    expect(plateGuideShader).toContain("let firstAnchor = clamp(guide.projection.innerSplit");
    expect(plateGuideShader).toContain("let secondAnchor = clamp(guide.projection.horizonSplit");
  });

  test("encodes the CAVE allocation anchors without a baked scaffold", () => {
    expect(plateGuideShader).toContain("if (guide.projection.topology == 1u)");
    expect(plateGuideShader).toContain("guideFieldColorKernel(carrier.z, firstAnchor, secondAnchor");
    expect(plateGuideShader).not.toContain("seamLine");
    expect(plateGuideShader).not.toContain("horizonLine");
  });

  test("encodes the measured planar roof profile into the hall field", () => {
    expect(plateGuideShader).toContain("fn doubleGableCarrierUvToSurfaceKernel");
    expect(plateGuideShader).toContain("fn planarRoofNormalizedHeightKernel");
    expect(plateGuideShader).toContain("struct planarRoofProfileKernelSchema");
    expect(plateGuideShader).toContain("guide.projection.roofProfile");
    expect(plateGuideShader).toContain("let crossHall = clamp");
    expect(plateGuideShader).toContain("let roofWave = roofHeight * roofHeight");
    expect(plateGuideShader).toContain("fn profiledHallGuideFieldColorKernel");
    expect(plateGuideShader).toContain("let roofColor = clamp");
    expect(plateGuideShader).not.toContain("field * roofTint");
    expect(plateGuideShader).not.toContain("RidgeLine");
  });

  test("uses explicit TypeGPU projection semantics instead of overloaded negative sentinels", () => {
    expect(plateGuideShader).toContain("struct guideKernelParamsSchema");
    expect(plateGuideShader).toContain("fn guideCarrierCoordinateKernel");
    expect(plateGuideShader).toContain("guide.projection.topology");
    expect(plateGuideShader).toContain("guide.projection.center");
    expect(plateGuideShader).not.toContain("guide.values");
    expect(plateGuideShader).not.toContain("guide.semantics");
  });

  test("can explicitly reset cached plate textures", () => {
    const gpu = fakeGpuDevice();
    const { runtime, sampler } = fakeRuntime(gpu.device);
    const compositor = new PlateGpuCompositor({ runtime, sampler });
    const plate = fakePlate(100, 80);

    const firstTexture = compositor.textureForPlate(plate);
    const firstRawTexture = runtime.root.unwrap(firstTexture);
    compositor.resetPlateTextures();
    const secondTexture = compositor.textureForPlate(plate);

    expect(firstRawTexture).toBe(gpu.textures[0]);
    expect(runtime.root.unwrap(secondTexture)).toBe(gpu.textures[1]);
    expect(gpu.textures[0].destroy).toHaveBeenCalledTimes(1);
    expect(gpu.copyExternalImageToTexture).toHaveBeenCalledTimes(2);

    compositor.destroy();
  });

  test("destroy releases output textures, cached plate textures, and buffers", () => {
    const gpu = fakeGpuDevice();
    const { runtime, sampler } = fakeRuntime(gpu.device);
    const compositor = new PlateGpuCompositor({ runtime, sampler });
    const plate = fakePlate(100, 80);

    compositor.ensureOutputTexture(256, 144);
    const outputTexture = (
      compositor as unknown as { outputTexture: import("./plate-gpu-compositor-types.js").PlateTexture }
    ).outputTexture;
    const rawOutputTexture = runtime.root.unwrap(outputTexture);
    const rawPlateTexture = runtime.root.unwrap(compositor.textureForPlate(plate));
    const uniformBuffer = compositor.uniformBufferForIndex(0);
    const rawUniformBuffer = uniformBuffer.uniform.buffer.buffer;
    compositor.destroy();

    expect(rawOutputTexture.destroy).toHaveBeenCalledTimes(1);
    expect(rawPlateTexture.destroy).toHaveBeenCalledTimes(1);
    expect(gpu.buffers[0].destroy).toHaveBeenCalledTimes(1);
    expect(rawUniformBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(() => compositor.ensureOutputTexture(128, 72)).toThrow("Plate GPU compositor has been destroyed.");
  });

  test("reinitializes the plate sketch renderer after WebGPU device loss", async () => {
    const firstLost = deferred<GPUDeviceLostInfo>();
    const secondLost = deferred<GPUDeviceLostInfo>();
    const firstGpu = fakeGpuDevice(firstLost.promise);
    const secondGpu = fakeGpuDevice(secondLost.promise);
    const adapter = {
      requestDevice: vi.fn().mockResolvedValueOnce(firstGpu.device).mockResolvedValueOnce(secondGpu.device),
    };
    const requestAdapter = vi.fn().mockResolvedValue(adapter);
    const context = fakeCanvasContext();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const renderer = await createPlateSketchGpuRenderer(canvas);
    firstLost.resolve({ reason: "unknown", message: "test device loss" } as GPUDeviceLostInfo);

    await waitForExpectation(() => expect(context.configure).toHaveBeenCalledTimes(2));

    expect(requestAdapter).toHaveBeenCalledTimes(2);
    expect(firstGpu.buffers.some((buffer) => buffer.destroy.mock.calls.length > 0)).toBe(true);
    renderer.destroy();
    expect(secondGpu.destroy).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

function fakePlate(width: number, height: number) {
  return {
    canvas: { width, height } as HTMLCanvasElement,
    width,
    height,
    aspect: width / height,
  };
}

function fakeRuntime(device: GPUDevice) {
  const root = tgpu.initFromDevice({ device, unstable_names: "strict" });
  return {
    runtime: {
      root,
      format: "rgba8unorm" as GPUTextureFormat,
      lifecycle: createGpuDeviceLifecycle(device),
      state: "active" as const,
      limits: {
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        maxBufferSize: device.limits.maxBufferSize,
        maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      },
      createScope: createGpuResourceScope,
      assertActive: vi.fn(),
      destroy: vi.fn(() => root.destroy()),
    },
    sampler: root.createSampler({ magFilter: "linear", minFilter: "linear" }),
  };
}

function fakeGpuDevice(lost: Promise<GPUDeviceLostInfo> = new Promise(() => {})) {
  const buffers: Destroyable[] = [];
  const textures: FakeTexture[] = [];
  const copyExternalImageToTexture = vi.fn();
  const destroy = vi.fn();
  const device = {
    lost,
    features: new Set(),
    limits: {
      maxTextureDimension2D: 4096,
      maxBufferSize: 256 * 1024 * 1024,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    },
    queue: {
      writeBuffer: vi.fn(),
      copyExternalImageToTexture,
      submit: vi.fn(),
    },
    createSampler: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn(), createView: vi.fn(() => ({})) };
      textures.push(texture);
      return texture;
    }),
    destroy,
  };
  return {
    device: device as unknown as GPUDevice,
    buffers,
    textures,
    copyExternalImageToTexture,
    destroy,
  };
}

function fakeCanvasContext() {
  return {
    configure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) })),
  } as unknown as GPUCanvasContext & { configure: ReturnType<typeof vi.fn> };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}
