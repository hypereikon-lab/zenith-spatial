import tgpu, { common, d, std, type TgpuRoot } from "typegpu";
import { previewCopyBindings } from "./contracts.js";

export const previewCopyFragment = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(({ uv }) => {
  return std.textureSampleLevel(previewCopyBindings.$.texture, previewCopyBindings.$.sampler, uv, 0);
});

export function createPreviewCopyPipeline(root: TgpuRoot, format: GPUTextureFormat) {
  return root.createRenderPipeline({
    vertex: common.fullScreenTriangle,
    fragment: previewCopyFragment,
    targets: { format },
    primitive: { topology: "triangle-list" },
  });
}
