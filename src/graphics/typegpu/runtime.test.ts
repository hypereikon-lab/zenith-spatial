import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { acquireZenithGpuRuntime } from "./runtime.js";

beforeEach(() => {
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2 });
  vi.stubGlobal("navigator", {
    gpu: {
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Zenith TypeGPU runtime leases", () => {
  test("shares one root per external device and releases it only after the final owner", async () => {
    const device = fakeDevice();

    const first = await acquireZenithGpuRuntime({ device });
    const second = await acquireZenithGpuRuntime({ device });
    expect(second.root).toBe(first.root);
    expect(second.lifecycle).toBe(first.lifecycle);
    expect(second.limits).toBe(first.limits);
    expect(second.format).toBe("bgra8unorm");

    first.release();
    const third = await acquireZenithGpuRuntime({ device });
    expect(third.root).toBe(second.root);

    second.release();
    third.release();
    const afterFinalRelease = await acquireZenithGpuRuntime({ device });
    expect(afterFinalRelease.root).not.toBe(first.root);
    expect(device.destroy).not.toHaveBeenCalled();

    afterFinalRelease.release();
  });

  test("makes an individual release idempotent", async () => {
    const lease = await acquireZenithGpuRuntime({ device: fakeDevice() });

    lease.release();
    expect(() => lease.release()).not.toThrow();
  });

  test("rejects conflicting presentation formats for one shared device", async () => {
    const device = fakeDevice();
    const lease = await acquireZenithGpuRuntime({ device, format: "rgba8unorm" });

    await expect(acquireZenithGpuRuntime({ device, format: "bgra8unorm" })).rejects.toThrow(/already registered/);
    lease.release();
  });

  test("marks leases lost and refuses to wrap the same lost external device again", async () => {
    const lost = deferred<GPUDeviceLostInfo>();
    const device = fakeDevice(lost.promise);
    const lease = await acquireZenithGpuRuntime({ device });

    expect(lease.state).toBe("active");
    lost.resolve({ reason: "unknown", message: "test loss" } as GPUDeviceLostInfo);
    await lease.lifecycle.lost;
    await Promise.resolve();

    expect(lease.state).toBe("lost");
    await expect(acquireZenithGpuRuntime({ device })).rejects.toThrow(/lost WebGPU device/);
    lease.release();
  });
});

function fakeDevice(lost: Promise<GPUDeviceLostInfo> = new Promise(() => {})) {
  return {
    lost,
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
    limits: {
      maxTextureDimension2D: 8192,
      maxBufferSize: 256 * 1024 * 1024,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    },
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createCommandEncoder: vi.fn(() => ({ finish: vi.fn(() => ({})) })),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
    destroy: vi.fn(),
  } as unknown as GPUDevice & { destroy: ReturnType<typeof vi.fn> };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
