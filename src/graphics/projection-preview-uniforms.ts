import { sizeOf } from "typegpu/data";
import type { Mat4, Vec3 } from "../projection.js";
import { encodeTypeGpuData } from "./typegpu/encoding.js";
import { projectionPreviewUniformSchema } from "./typegpu/contracts.js";
import type { compileProjectionKernelParams } from "../geometry/projection-kernel-parameters.js";

export const PROJECTION_PREVIEW_UNIFORM_BYTES = sizeOf(projectionPreviewUniformSchema);
export const PROJECTION_PREVIEW_UNIFORM_FLOATS = PROJECTION_PREVIEW_UNIFORM_BYTES / Float32Array.BYTES_PER_ELEMENT;

export type ProjectionGuideOverlay = "clean" | "guides" | "edge";

export type ProjectionPreviewUniformInput = {
  mvp: Mat4;
  rotation?: number;
  exposure?: number;
  overlayOpacity: number;
  mirror?: boolean;
  domeTilt?: number;
  cutaway?: boolean;
  /** Explicit review layer. Prefer this over the compatibility boolean. */
  guideOverlay?: ProjectionGuideOverlay;
  /** @deprecated Use guideOverlay so guide contours and physical edges remain distinct. */
  showGuides?: boolean;
  shellShade: number;
  caveMaskMode: 0 | 1 | 2;
  cameraPosition: Vec3;
  sourceOverlayOpacity?: number;
  sourceCapDetailAvailable?: boolean;
  kernel: ReturnType<typeof compileProjectionKernelParams>;
};

/**
 * The only authoring point for the Projection Preview GPU ABI. TypeGPU derives
 * byte layout from the schema; callers work with named projection concepts.
 */
export function buildProjectionPreviewUniformValue(input: ProjectionPreviewUniformInput) {
  const legacyGuides = input.guideOverlay === undefined && input.showGuides;
  const showGuides = input.guideOverlay === "guides" || legacyGuides ? 1 : 0;
  const showEdges = input.guideOverlay === "edge" || legacyGuides ? 1 : 0;
  return {
    mvp: input.mvp,
    rotation: input.rotation ?? 0,
    exposure: input.exposure ?? 1,
    overlayOpacity: input.overlayOpacity,
    mirror: input.mirror ? 1 : 0,
    domeTilt: input.domeTilt ?? 0,
    cutaway: input.cutaway ? 1 : 0,
    showRings: showGuides,
    showSpokes: showGuides,
    showHorizon: showGuides,
    showZenith: showGuides,
    showSourceCircle: showEdges,
    shellShade: input.shellShade,
    showCaveMask: input.caveMaskMode,
    cameraPosX: input.cameraPosition[0],
    cameraPosY: input.cameraPosition[1],
    cameraPosZ: input.cameraPosition[2],
    sourceOverlay: [input.sourceOverlayOpacity ?? 0, input.sourceCapDetailAvailable ? 1 : 0, 0, 0] as const,
    kernel: input.kernel,
  };
}

/**
 * Retained for CPU parity tests and focused browser shader probes. Production
 * renderers write the named value through TypeGPU uniforms instead.
 */
export function buildProjectionPreviewUniformArray(input: ProjectionPreviewUniformInput): Float32Array {
  return encodeTypeGpuData(projectionPreviewUniformSchema, buildProjectionPreviewUniformValue(input));
}
