import { describe, expect, test, vi } from "vitest";
import { createGpuDeviceLifecycle } from "./gpu-device-lifecycle.js";

describe("GPU device lifecycle boundary", () => {
  test("exposes diagnostics and completion without exposing rendering commands", async () => {
    const lost = Promise.resolve({ reason: "destroyed", message: "test" } as GPUDeviceLostInfo);
    const validationError = { message: "validation failed" } as GPUError;
    const device = {
      lost,
      queue: { onSubmittedWorkDone: vi.fn(async () => undefined) },
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => validationError),
    } as unknown as GPUDevice;
    const lifecycle = createGpuDeviceLifecycle(device);

    lifecycle.beginValidationScope();
    await expect(lifecycle.endValidationScope()).resolves.toBe(validationError);
    await lifecycle.waitForSubmittedWork();

    expect(lifecycle.lost).toBe(lost);
    expect(device.pushErrorScope).toHaveBeenCalledWith("validation");
    expect(device.popErrorScope).toHaveBeenCalledOnce();
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    expect(Object.keys(lifecycle).sort()).toEqual([
      "beginValidationScope",
      "endValidationScope",
      "lost",
      "waitForSubmittedWork",
    ]);
    expect(lifecycle).not.toHaveProperty("device");
    expect(lifecycle).not.toHaveProperty("createCommandEncoder");
    expect(lifecycle).not.toHaveProperty("submit");
  });
});
