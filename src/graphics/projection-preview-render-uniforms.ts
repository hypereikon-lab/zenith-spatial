import type { SourceProjectionMode } from "../geometry/source-projection.js";
import { multiplyMat4 } from "../projection.js";
import {
  normalizePlateEditorCamera,
  plateEditorProjectionMatrix,
  plateEditorViewMatrix,
  type PlateEditorCamera,
  type PlateEditorViewMode,
} from "../plates/plate-editor-view.js";
import {
  buildProjectionPreviewUniformArray,
  buildProjectionPreviewUniformValue,
} from "./projection-preview-uniforms.js";
import type { ProjectionGuideOverlay } from "./projection-preview-uniforms.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import { compileProjectionKernelParams } from "../geometry/projection-kernel-parameters.js";

export type ProjectionPreviewRenderUniformOptions = {
  targetWidth: number;
  targetHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceProjectionMode: SourceProjectionMode;
  projectionViewMode?: PlateEditorViewMode;
  projectionCamera?: Partial<PlateEditorCamera>;
  showProjectionGuides?: boolean;
  guideOverlay?: ProjectionGuideOverlay;
  domeGuideSemanticSplit?: number | string | null;
  domeGuideHorizonSplit?: number | string | null;
  showCaveMask?: boolean;
  invertCaveMask?: boolean;
  sourceOverlayOpacity?: number;
  sourceCapDetailAvailable?: boolean;
  projectionSurface?: ProjectionSurface;
};

export function buildProjectionPreviewRenderUniforms({
  targetWidth,
  targetHeight,
  sourceWidth,
  sourceHeight,
  sourceProjectionMode,
  projectionViewMode = "dome-orbit",
  projectionCamera,
  showProjectionGuides,
  guideOverlay,
  domeGuideSemanticSplit,
  domeGuideHorizonSplit,
  showCaveMask,
  invertCaveMask,
  sourceOverlayOpacity,
  sourceCapDetailAvailable,
  projectionSurface,
}: ProjectionPreviewRenderUniformOptions): Float32Array {
  return buildProjectionPreviewUniformArray(
    buildProjectionPreviewRenderUniformInput({
      targetWidth,
      targetHeight,
      sourceWidth,
      sourceHeight,
      sourceProjectionMode,
      projectionViewMode,
      projectionCamera,
      showProjectionGuides,
      guideOverlay,
      domeGuideSemanticSplit,
      domeGuideHorizonSplit,
      showCaveMask,
      invertCaveMask,
      sourceOverlayOpacity,
      sourceCapDetailAvailable,
      projectionSurface,
    }),
  );
}

export function buildProjectionPreviewRenderUniformValue(options: ProjectionPreviewRenderUniformOptions) {
  return buildProjectionPreviewUniformValue(buildProjectionPreviewRenderUniformInput(options));
}

function buildProjectionPreviewRenderUniformInput({
  targetWidth,
  targetHeight,
  sourceWidth,
  sourceHeight,
  sourceProjectionMode,
  projectionViewMode = "dome-orbit",
  projectionCamera,
  showProjectionGuides,
  guideOverlay,
  domeGuideSemanticSplit,
  domeGuideHorizonSplit,
  showCaveMask,
  invertCaveMask,
  sourceOverlayOpacity,
  sourceCapDetailAvailable,
  projectionSurface,
}: ProjectionPreviewRenderUniformOptions) {
  const camera = normalizePlateEditorCamera(projectionCamera || {});
  const resolvedViewMode = projectionViewMode === "source-map" ? "dome-orbit" : projectionViewMode;
  const projection = plateEditorProjectionMatrix(
    camera,
    sourceProjectionMode,
    Math.max(1, targetWidth) / Math.max(1, targetHeight),
    resolvedViewMode,
  );
  const view = plateEditorViewMatrix(resolvedViewMode, camera, sourceProjectionMode);
  const kernel = compileProjectionKernelParams({
    mode: sourceProjectionMode,
    width: sourceWidth,
    height: sourceHeight,
    radiusScale: 1,
    innerSplit: domeGuideSemanticSplit,
    horizonSplit: domeGuideHorizonSplit,
    surface: projectionSurface,
  });

  return {
    mvp: multiplyMat4(projection, view),
    overlayOpacity: guideOverlay === "clean" || (!guideOverlay && !showProjectionGuides) ? 0.28 : 0.78,
    guideOverlay,
    showGuides: Boolean(showProjectionGuides),
    shellShade: resolvedViewMode === "dome-pov" || resolvedViewMode === "audience-space" ? 0.12 : 0.3,
    caveMaskMode: (showCaveMask ? (invertCaveMask ? 2 : 1) : 0) as 0 | 1 | 2,
    cameraPosition: camera.position,
    sourceOverlayOpacity,
    sourceCapDetailAvailable,
    kernel,
  };
}
