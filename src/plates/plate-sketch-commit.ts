import { countWarpedPlateSketchCorners, serializePlateSketchPlacement } from "./plate-sketch-arrangement.js";
import type { SerializedPlatePlacement } from "./plate-sketch-arrangement.js";
import type { ArtifactMedia, ArtifactRecord, ArtifactResult } from "../artifacts/artifact-types.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { CarrierRaster, ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { NormalizedPlatePlacement } from "./plate-placement.js";

export type PlateSketchCommitInput = {
  dataUrl: string;
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

export type PlateSketchCommitPayload = {
  artifactPatch: Partial<Omit<ArtifactRecord, "id" | "type" | "media">> & Pick<ArtifactRecord, "media">;
  result: Omit<ArtifactResult, "id" | "createdAt">;
  status: string;
  serializedPlacements: SerializedPlatePlacement[];
  warpedCornerCount: number;
};

export function buildPlateSketchCommitPayload({
  dataUrl,
  plateCount,
  placements,
  plateFit,
  plateFeather,
  domeGuideSemanticSplit,
  domeGuideHorizonSplit,
  plateEditMode,
  projectionProfile,
  projectionSurface,
  raster,
  commitWidth,
  commitHeight,
}: PlateSketchCommitInput): PlateSketchCommitPayload {
  const serializedPlacements = placements.slice(0, plateCount).map(serializePlateSketchPlacement);
  const warpedCornerCount = countWarpedPlateSketchCorners(serializedPlacements);
  const warpedCornerSuffix = warpedCornerCount > 0 ? ` with ${warpedCornerCount} warped corners` : "";
  const media: ArtifactMedia = {
    kind: "image" as const,
    url: dataUrl,
    name: `Committed Plate Sketch (${plateCount} plates)`,
    mime: "image/png",
    alt: "Committed semantic-color Plate Sketch inpaint handoff",
    blob: null,
    file: null,
    canvas: null,
  };
  const config = {
    plateCount,
    plateFit,
    plateFeather,
    domeGuideSemanticSplit,
    domeGuideHorizonSplit,
    plateEditMode,
    placements: serializedPlacements,
    projectionProfile,
    projectionSurface,
    raster,
    commitWidth,
    commitHeight,
  };

  return {
    artifactPatch: {
      status: "ready",
      stale: false,
      summary: `${plateCount} plates committed as ${commitWidth} × ${commitHeight} inpaint handoff${warpedCornerSuffix}.`,
      operatorId: "commit-plates",
      media,
      config,
      warnings: [],
    },
    result: {
      label: `Committed Plate Sketch (${plateCount})`,
      media,
      config,
      operatorId: "commit-plates",
    },
    status: `${commitWidth} × ${commitHeight} Plate Sketch handoff committed for inpaint${warpedCornerSuffix}.`,
    serializedPlacements,
    warpedCornerCount,
  };
}
