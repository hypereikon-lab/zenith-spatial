import tgpu, { type TgpuRoot } from "typegpu";
import { createGpuDeviceLifecycle, type GpuDeviceLifecycle } from "./gpu-device-lifecycle.js";

export type ZenithGpuLimits = Pick<
  GPUSupportedLimits,
  "maxTextureDimension2D" | "maxBufferSize" | "maxStorageBufferBindingSize"
>;

export type ZenithGpuRuntimeLease = {
  root: TgpuRoot;
  format: GPUTextureFormat;
  lifecycle: GpuDeviceLifecycle;
  limits: ZenithGpuLimits;
  readonly state: "active" | "lost";
  release(): void;
};

export type AcquireZenithGpuRuntimeOptions = {
  device?: GPUDevice | null;
  format?: GPUTextureFormat;
};

type RuntimeEntry = {
  root: TgpuRoot;
  device: GPUDevice;
  format: GPUTextureFormat;
  lifecycle: GpuDeviceLifecycle;
  limits: ZenithGpuLimits;
  leases: number;
  externalDevice: boolean;
  state: "active" | "lost";
};

const externalEntries = new WeakMap<GPUDevice, RuntimeEntry>();
const lostExternalDevices = new WeakSet<GPUDevice>();
let defaultEntryPromise: Promise<RuntimeEntry> | null = null;
let defaultEntryValue: RuntimeEntry | null = null;

/**
 * Acquires Zenith's TypeGPU-first browser runtime.
 *
 * Interactive renderers share one TypeGPU root and GPUDevice. Workflows that
 * explicitly provide a device (for example deterministic export) share a root
 * for that device without transferring device ownership to TypeGPU.
 */
export async function acquireZenithGpuRuntime({
  device = null,
  format,
}: AcquireZenithGpuRuntimeOptions = {}): Promise<ZenithGpuRuntimeLease> {
  const entry = device ? externalEntry(device, format) : await defaultEntry(format);
  entry.leases += 1;
  let released = false;

  const lease: ZenithGpuRuntimeLease = {
    root: entry.root,
    format: entry.format,
    lifecycle: entry.lifecycle,
    limits: entry.limits,
    get state(): "active" | "lost" {
      return entry.state;
    },
    release(): void {
      if (released) return;
      released = true;
      entry.leases -= 1;
      if (entry.leases > 0) return;

      entry.root.destroy();
      if (entry.externalDevice) {
        externalEntries.delete(entry.device);
      } else if (defaultEntryValue === entry) {
        defaultEntryValue = null;
        defaultEntryPromise = null;
      }
    },
  };
  return lease;
}

function externalEntry(device: GPUDevice, format?: GPUTextureFormat): RuntimeEntry {
  if (lostExternalDevices.has(device)) {
    throw new Error("Cannot acquire a TypeGPU runtime for a lost WebGPU device.");
  }
  const existing = externalEntries.get(device);
  if (existing) {
    if (format && existing.format !== format) {
      throw new Error(
        `The shared WebGPU device is already registered with ${existing.format}, not the requested ${format}.`,
      );
    }
    return existing;
  }

  const root = tgpu.initFromDevice({ device, unstable_names: "strict" });
  const entry: RuntimeEntry = {
    root,
    device,
    format: format || preferredCanvasFormat(),
    lifecycle: createGpuDeviceLifecycle(device),
    limits: supportedLimits(device),
    leases: 0,
    externalDevice: true,
    state: "active",
  };
  externalEntries.set(device, entry);
  watchEntryLoss(entry);
  return entry;
}

async function defaultEntry(format?: GPUTextureFormat): Promise<RuntimeEntry> {
  if (!defaultEntryPromise) {
    defaultEntryPromise = createDefaultEntry(format)
      .then((entry) => {
        if (entry.state === "lost") {
          defaultEntryPromise = null;
          throw new Error("The WebGPU device was lost while the TypeGPU runtime was initializing.");
        }
        defaultEntryValue = entry;
        return entry;
      })
      .catch((error) => {
        defaultEntryPromise = null;
        defaultEntryValue = null;
        throw error;
      });
  }
  const entry = await defaultEntryPromise;
  if (format && entry.format !== format) {
    throw new Error(`The shared TypeGPU runtime uses ${entry.format}, not the requested ${format}.`);
  }
  return entry;
}

async function createDefaultEntry(format?: GPUTextureFormat): Promise<RuntimeEntry> {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new Error("WebGPU is not available in this browser.");
  }
  const root = await tgpu.init({ unstable_names: "strict" });
  const entry: RuntimeEntry = {
    root,
    device: root.device,
    format: format || preferredCanvasFormat(),
    lifecycle: createGpuDeviceLifecycle(root.device),
    limits: supportedLimits(root.device),
    leases: 0,
    externalDevice: false,
    state: "active",
  };
  watchEntryLoss(entry);
  return entry;
}

function watchEntryLoss(entry: RuntimeEntry): void {
  void entry.lifecycle.lost.then(() => {
    entry.state = "lost";
    if (entry.externalDevice) {
      lostExternalDevices.add(entry.device);
      if (externalEntries.get(entry.device) === entry) {
        externalEntries.delete(entry.device);
      }
      return;
    }
    if (defaultEntryValue === entry) {
      defaultEntryValue = null;
      defaultEntryPromise = null;
    }
  });
}

function supportedLimits(device: GPUDevice): ZenithGpuLimits {
  return {
    maxTextureDimension2D: device.limits?.maxTextureDimension2D ?? 8192,
    maxBufferSize: device.limits?.maxBufferSize ?? 256 * 1024 * 1024,
    maxStorageBufferBindingSize: device.limits?.maxStorageBufferBindingSize ?? 128 * 1024 * 1024,
  };
}

function preferredCanvasFormat(): GPUTextureFormat {
  if (typeof navigator === "undefined" || !navigator.gpu) return "rgba8unorm";
  return navigator.gpu.getPreferredCanvasFormat();
}
