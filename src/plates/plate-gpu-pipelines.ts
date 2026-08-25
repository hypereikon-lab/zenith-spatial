import { common, type TgpuRoot } from "typegpu";
import { PLATE_OUTPUT_FORMAT } from "./plate-gpu-compositor-types.js";
import { plateCompositeFragment } from "./plate-composite-shader.js";
import { plateGuideFragment } from "./plate-guide-shader.js";

export function createPlateGpuPipelines(root: TgpuRoot) {
  return {
    composite: root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: plateCompositeFragment,
      targets: {
        format: PLATE_OUTPUT_FORMAT,
        blend: {
          color: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
          },
          alpha: {
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
          },
        },
      },
      primitive: { topology: "triangle-list" },
    }),
    guide: root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: plateGuideFragment,
      targets: { format: PLATE_OUTPUT_FORMAT },
      primitive: { topology: "triangle-list" },
    }),
  };
}

export type PlateGpuPipelines = ReturnType<typeof createPlateGpuPipelines>;
