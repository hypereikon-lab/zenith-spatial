import type { RenderFlag, TgpuBindGroup, TgpuRenderPipeline, TgpuTexture } from "typegpu";
import type { GpuRuntime } from "../gpu-runtime.js";

export type TypeGpuFullscreenDraw = {
  pipeline: TgpuRenderPipeline;
  bindGroup: TgpuBindGroup;
  vertexCount?: number;
};

/**
 * Executes Zenith's heterogeneous fullscreen stack in one ordered TypeGPU
 * render pass. TypeGPU's high-level pipeline draws each open their own pass;
 * the explicitly unstable pass API is the typed command layer for cases that
 * require one clear followed by multiple pipelines with deterministic alpha
 * blending.
 *
 * TypeGPU 0.11.9 still requires a raw attachment view in the pass descriptor,
 * so the render view is unwrapped here. Command encoding, pipeline/bind-group
 * state, pass finalization, and queue submission all remain TypeGPU-owned.
 */
export function executeTypeGpuFullscreenDrawSequence(
  runtime: GpuRuntime,
  {
    target,
    width,
    height,
    draws,
  }: {
    target: TgpuTexture & RenderFlag;
    width: number;
    height: number;
    draws: readonly TypeGpuFullscreenDraw[];
  },
): void {
  runtime.assertActive();
  // TypeGPU's runtime unwrap supports its render-view object, but 0.11.9's
  // public unwrap overload omits that specific view type.
  const targetView = runtime.root.unwrap(target.createView("render") as never) as unknown as GPUTextureView;

  runtime.root["~unstable"].beginRenderPass(
    {
      label: "Zenith ordered TypeGPU fullscreen pass",
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    },
    (pass) => {
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setScissorRect(0, 0, width, height);
      for (const draw of draws) {
        pass.setPipeline(draw.pipeline);
        pass.setBindGroup(draw.bindGroup.layout, draw.bindGroup);
        pass.draw(draw.vertexCount ?? 3);
      }
    },
  );
}
