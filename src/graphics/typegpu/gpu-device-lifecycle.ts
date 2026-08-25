/**
 * The deliberately small raw WebGPU boundary left below TypeGPU. TypeGPU owns
 * rendering and resource commands; the browser GPU device still owns loss
 * notification, validation scopes, and queue-completion fences.
 */
export type GpuDeviceLifecycle = {
  readonly lost: Promise<GPUDeviceLostInfo>;
  beginValidationScope(): void;
  endValidationScope(): Promise<GPUError | null>;
  waitForSubmittedWork(): Promise<void>;
};

export function createGpuDeviceLifecycle(device: GPUDevice): GpuDeviceLifecycle {
  return {
    lost: device.lost,
    beginValidationScope(): void {
      device.pushErrorScope("validation");
    },
    endValidationScope(): Promise<GPUError | null> {
      return device.popErrorScope();
    },
    waitForSubmittedWork(): Promise<void> {
      return device.queue.onSubmittedWorkDone();
    },
  };
}
