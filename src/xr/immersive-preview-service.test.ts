import { Effect } from "effect";
import { describe, expect, test, vi } from "vitest";

import type { ImmersivePreviewController } from "./immersive-preview-renderer.js";
import { makeImmersivePreviewService } from "./immersive-preview-service.js";

describe("immersive preview Effect service", () => {
  test("reports injected browser capabilities without touching hardware", async () => {
    const expected = { secureContext: true, lookaround: true as const, orientation: true, vr: true, ar: false };
    const service = makeImmersivePreviewService({ detect: async () => expected });

    await expect(Effect.runPromise(service.capabilities)).resolves.toEqual(expected);
  });

  test("keeps the scoped controller alive until completion and releases it", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const end = vi.fn(async () => finish());
    const controller: ImmersivePreviewController = { finished, end, recenter: vi.fn(), move: vi.fn() };
    const start = vi.fn(async () => controller);
    const onReady = vi.fn();
    const service = makeImmersivePreviewService({ start });
    const running = Effect.runPromise(
      service.run({
        mode: "lookaround",
        canvas: {} as HTMLCanvasElement,
        overlayRoot: {} as HTMLElement,
        mediaUrl: "blob:test",
        mediaKind: "image",
        spec: {} as never,
        audience: {} as never,
        label: "Test",
        orientationPermission: Promise.resolve("unavailable"),
        onUpdate: vi.fn(),
        onReady,
      }),
    );

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(controller));
    finish();
    await running;
    expect(end).toHaveBeenCalledOnce();
  });
});
