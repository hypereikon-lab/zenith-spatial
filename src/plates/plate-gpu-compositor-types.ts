import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import { sizeOf } from "typegpu/data";
import type { RenderFlag, SampledFlag, TgpuSampler, TgpuTexture } from "typegpu";
import { plateCompositeUniformSchema } from "../graphics/typegpu/contracts.js";
import type { GpuRuntime } from "../graphics/gpu-runtime.js";
import type { PlatePlacementInput } from "./plate-placement.js";

export const PLATE_OUTPUT_FORMAT = "rgba8unorm";
export const PLATE_UNIFORM_BYTES = sizeOf(plateCompositeUniformSchema);
export const PLATE_UNIFORM_FLOATS = PLATE_UNIFORM_BYTES / Float32Array.BYTES_PER_ELEMENT;

export type PlateImage = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  aspect?: number;
};

export type PlateTexture = TgpuTexture & SampledFlag & RenderFlag;

export type PlateTextureCache = {
  texture: PlateTexture;
  width: number;
  height: number;
};

export type PlateGpuCompositorOptions = {
  runtime: GpuRuntime;
  sampler: TgpuSampler;
};

export type PlateRenderOptions = {
  plates: PlateImage[];
  plateCount: number;
  plateFit: string;
  plateFeather: number | string;
  platePlacements: PlatePlacementInput[];
  width: number;
  height: number;
  sourceProjectionMode?: SourceProjectionMode;
  projectionSurface?: ProjectionSurface;
  guideMode?: "transparent" | "inpaint-handoff";
  domeGuideSemanticSplit?: number | string | null;
  domeGuideHorizonSplit?: number | string | null;
  /**
   * Overrides only the raster-to-direction cap split. Plate placement still
   * uses domeGuideSemanticSplit, allowing a high-resolution cylinder-cap
   * detail texture without changing the authored carrier coordinates.
   */
  rasterInnerSplit?: number;
};

export type PlacementUniformOptions = {
  placement: PlatePlacementInput;
  plate: PlateImage;
  plateFit: string;
  plateFeather: number | string;
  outputWidth: number;
  outputHeight: number;
  sourceProjectionMode: SourceProjectionMode;
  projectionSurface?: ProjectionSurface;
  domeGuideSemanticSplit?: number | string | null;
  domeGuideHorizonSplit?: number | string | null;
  rasterInnerSplit?: number;
};
