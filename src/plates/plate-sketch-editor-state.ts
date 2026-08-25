import type { SourceProjectionMode } from "../geometry/source-projection.js";
import {
  cloneCarrierRaster,
  cloneProjectionSurface,
  type CarrierRaster,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import type { PlateEditorCamera, PlateEditorViewMode } from "./plate-editor-view.js";
import type { NormalizedPlatePlacement } from "./plate-placement.js";
import type { PlateSketchPreviewInput } from "./plate-sketch-preview-session.js";
import type { PlateSketchImage } from "./plate-sketch-sources.js";

export type PlateSketchEditorSnapshot = {
  plates: PlateSketchImage[];
  placements: NormalizedPlatePlacement[];
  canvasWidth: number;
  canvasHeight: number;
  plateFit: string;
  plateFeather: number;
  plateEditMode: "scale" | "warp";
  domeGuideSemanticSplit: number;
  domeGuideHorizonSplit: number;
  projectionProfile: SourceProjectionMode;
  projectionSurface: ProjectionSurface;
  viewerMode: PlateSketchPreviewInput["viewerMode"];
  projectionViewMode: PlateEditorViewMode;
  projectionCamera: Partial<PlateEditorCamera>;
  showCaveMask: boolean;
  invertCaveMask: boolean;
};

export type PlateSketchCommitInput = {
  plateCount: number;
  placements: NormalizedPlatePlacement[];
  plateFit: string;
  plateFeather: number;
  domeGuideSemanticSplit: number;
  domeGuideHorizonSplit: number;
  plateEditMode: "scale" | "warp";
  projectionProfile: SourceProjectionMode;
  projectionSurface: ProjectionSurface;
  raster: CarrierRaster;
  commitWidth: number;
  commitHeight: number;
};

export function plateSketchPreviewInputFromEditorSnapshot(
  snapshot: PlateSketchEditorSnapshot,
): PlateSketchPreviewInput {
  return {
    plates: snapshot.plates,
    placements: snapshot.placements,
    canvasWidth: snapshot.canvasWidth,
    canvasHeight: snapshot.canvasHeight,
    plateFit: snapshot.plateFit,
    plateFeather: snapshot.plateFeather,
    domeGuideSemanticSplit: snapshot.domeGuideSemanticSplit,
    domeGuideHorizonSplit: snapshot.domeGuideHorizonSplit,
    sourceProjectionMode: snapshot.projectionProfile,
    projectionSurface: snapshot.projectionSurface,
    projectionViewMode: snapshot.projectionViewMode,
    projectionCamera: snapshot.projectionCamera,
    viewerMode: snapshot.viewerMode,
    showCaveMask: snapshot.showCaveMask,
    invertCaveMask: snapshot.invertCaveMask,
  };
}

export function plateSketchCommitInputFromEditorSnapshot(
  snapshot: PlateSketchEditorSnapshot,
  raster: CarrierRaster,
): PlateSketchCommitInput {
  return {
    plateCount: snapshot.plates.length,
    placements: snapshot.placements,
    plateFit: snapshot.plateFit,
    plateFeather: snapshot.plateFeather,
    domeGuideSemanticSplit: snapshot.domeGuideSemanticSplit,
    domeGuideHorizonSplit: snapshot.domeGuideHorizonSplit,
    plateEditMode: snapshot.plateEditMode,
    projectionProfile: snapshot.projectionProfile,
    projectionSurface: cloneProjectionSurface(snapshot.projectionSurface),
    raster: cloneCarrierRaster(raster),
    commitWidth: raster.width,
    commitHeight: raster.height,
  };
}
