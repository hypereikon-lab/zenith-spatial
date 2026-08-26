import { sourceProjectionLabel, type SourceProjectionMode } from "../geometry/source-projection.js";

export const SOURCE_REVIEW_VIEW_MODES = ["domemaster", "dome-check", "rim-check"] as const;
export const SPATIAL_PROJECTION_VIEW_MODES = [
  "source-map",
  "dome-orbit",
  "dome-pov",
  "cave-room",
  "audience-space",
] as const;

export type SourceReviewViewMode = (typeof SOURCE_REVIEW_VIEW_MODES)[number];
export type SpatialProjectionViewMode = (typeof SPATIAL_PROJECTION_VIEW_MODES)[number];

export type ProjectionViewUiCopy = {
  label: string;
  description: string;
};

export type SpatialProjectionViewUiCopy = ProjectionViewUiCopy & {
  editingStatus: string;
  carrierStatus: string;
};

export const SOURCE_REVIEW_VIEW_COPY: Record<SourceReviewViewMode, ProjectionViewUiCopy> = {
  domemaster: {
    label: "Clean",
    description: "Clean domemaster/source-map view.",
  },
  "dome-check": {
    label: "Guides",
    description: "Toggleable diagnostic contours for anchors, direction, horizon, and carrier zones; never baked.",
  },
  "rim-check": {
    label: "Edge",
    description: "Toggleable exact seams, roof breaks, rim, and black-exterior inspection.",
  },
};

export const SPATIAL_PROJECTION_VIEW_COPY: Record<SpatialProjectionViewMode, SpatialProjectionViewUiCopy> = {
  "source-map": {
    label: "Plate Map",
    description: "Edit projected positions on the 2D dome map.",
    editingStatus: "editing projected guide on dome map",
    carrierStatus: "using plate map carrier",
  },
  "dome-orbit": {
    label: "Dome Stage",
    description: "Arrange primitives in dome-relative 3D.",
    editingStatus: "editing in dome stage view",
    carrierStatus: "using plate map carrier",
  },
  "dome-pov": {
    label: "Audience POV",
    description: "Preview what the audience and Video1 guide see.",
    editingStatus: "editing from audience point of view",
    carrierStatus: "using plate map carrier",
  },
  "cave-room": {
    label: "Volume Room",
    description: "Inspect volume, walls, floor, and depth relationships.",
    editingStatus: "editing in volume room view",
    carrierStatus: "using CAVE carrier",
  },
  "audience-space": {
    label: "Audience in Space",
    description: "Stand at a movable, meter-aware audience position inside the physical carrier.",
    editingStatus: "inspecting from a physical audience position",
    carrierStatus: "using measured audience space",
  },
};

export function sourceReviewViewModeUi(mode: SourceReviewViewMode): ProjectionViewUiCopy {
  return SOURCE_REVIEW_VIEW_COPY[mode];
}

/** Maps the artist-facing review mode onto mutually exclusive render diagnostics. */
export function sourceReviewGuideOverlay(mode: SourceReviewViewMode): "clean" | "guides" | "edge" {
  if (mode === "dome-check") return "guides";
  if (mode === "rim-check") return "edge";
  return "clean";
}

export function sourceProjectionModeUiLabel(mode: SourceProjectionMode): string {
  return sourceProjectionLabel(mode);
}

export function spatialProjectionViewModeUi(mode: SpatialProjectionViewMode): SpatialProjectionViewUiCopy {
  return SPATIAL_PROJECTION_VIEW_COPY[mode];
}
