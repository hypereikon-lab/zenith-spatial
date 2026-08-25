import type { TgpuRoot } from "typegpu";
import {
  acquireZenithGpuRuntime,
  type AcquireZenithGpuRuntimeOptions,
  type ZenithGpuRuntimeLease,
} from "./typegpu/runtime.js";
import type { GpuDeviceLifecycle } from "./typegpu/gpu-device-lifecycle.js";
import { createGpuResourceScope, type GpuResourceScope } from "./typegpu/resource-scope.js";

export type GpuRuntime = {
  root: TgpuRoot;
  format: GPUTextureFormat;
  lifecycle: GpuDeviceLifecycle;
  readonly state: "active" | "lost" | "destroyed";
  readonly limits: Pick<GPUSupportedLimits, "maxTextureDimension2D" | "maxBufferSize" | "maxStorageBufferBindingSize">;
  createScope(label: string): GpuResourceScope;
  assertActive(): void;
  destroy(): void;
};

/**
 * Public workflow lease. Passing this object to child renderers shares the
 * TypeGPU root without giving those renderers ownership of the runtime.
 */
export async function createGpuRuntime(options: AcquireZenithGpuRuntimeOptions = {}): Promise<GpuRuntime> {
  const lease: ZenithGpuRuntimeLease = await acquireZenithGpuRuntime(options);
  let destroyed = false;
  const runtime: GpuRuntime = {
    root: lease.root,
    format: lease.format,
    lifecycle: lease.lifecycle,
    get state(): "active" | "lost" | "destroyed" {
      return destroyed ? "destroyed" : lease.state;
    },
    limits: lease.limits,
    createScope: createGpuResourceScope,
    assertActive(): void {
      if (destroyed) throw new Error("The Zenith GPU runtime has been destroyed.");
      if (lease.state === "lost") throw new Error("The Zenith WebGPU device has been lost.");
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      lease.release();
    },
  };
  return runtime;
}
