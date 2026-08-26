import { normalizeCameraRigPose, quaternionFromLookAt, viewMatrixFromCameraRigPose } from "../geometry/camera-rig.js";
import type { CameraRigPose } from "../geometry/camera-rig.js";
import { clamp, orthographicLH, perspectiveLH } from "../projection.js";
import type { Mat4, Rect, Vec3 } from "../projection.js";
import type { CaveViewProjection } from "../geometry/cave-view.js";
import type { DomeViewProjection } from "../geometry/dome-view.js";
import { sourceProjectionIsSurfaceCarrier, type SourceProjectionMode } from "../geometry/source-projection.js";
import {
  normalizeProjectionSurfaceForMode,
  planarRoofProfile,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import {
  SPATIAL_PROJECTION_VIEW_MODES,
  spatialProjectionViewModeUi,
  type SpatialProjectionViewMode,
} from "../scene/projection-view-contract.js";

export const PLATE_EDITOR_VIEW_MODES = SPATIAL_PROJECTION_VIEW_MODES;
export const PLATE_EDITOR_ORTHOGRAPHIC_VIEW_HEIGHT_PER_DISTANCE = 1.62;
const MIN_ORTHOGRAPHIC_VIEW_HEIGHT = 0.35;
const MAX_ORTHOGRAPHIC_VIEW_HEIGHT = 120;

export type PlateEditorViewMode = SpatialProjectionViewMode;
export type PlateEditorCameraMode = "inside" | "orbit" | "fly";
export type PlateEditorCamera = CameraRigPose<PlateEditorCameraMode>;

export function plateEditorViewLabel(mode: PlateEditorViewMode): string {
  return spatialProjectionViewModeUi(mode).label;
}

export function plateEditorViewDisabledReason(
  mode: PlateEditorViewMode,
  sourceProjectionMode: SourceProjectionMode,
): string | null {
  if ((mode === "dome-orbit" || mode === "dome-pov") && sourceProjectionMode.startsWith("cylinder-")) {
    return "Cylinder carriers are inspected in Plate Map or Volume Room.";
  }
  if (mode === "cave-room" && !sourceProjectionIsSurfaceCarrier(sourceProjectionMode)) {
    return "Volume Room is available for CAVE and cylinder surface carriers.";
  }
  return null;
}

export function plateEditorViewUsesSurfaceGeometry(
  mode: PlateEditorViewMode,
  sourceProjectionMode: SourceProjectionMode,
): boolean {
  return (mode === "cave-room" || mode === "audience-space") && sourceProjectionIsSurfaceCarrier(sourceProjectionMode);
}

export function defaultPlateEditorCamera(
  sourceProjectionMode: SourceProjectionMode,
  projectionSurface?: ProjectionSurface | null,
): PlateEditorCamera {
  const target = defaultPlateEditorPivot(sourceProjectionMode);
  const sign = projectionVerticalSign(sourceProjectionMode);
  const surfaceRadius = sourceProjectionIsSurfaceCarrier(sourceProjectionMode)
    ? projectionSurfaceBoundingRadius(sourceProjectionMode, projectionSurface)
    : 0;
  const distance = sourceProjectionIsSurfaceCarrier(sourceProjectionMode) ? Math.max(4.4, surfaceRadius * 1.27) : 2.45;
  const yaw = -0.72;
  const pitch = sourceProjectionIsSurfaceCarrier(sourceProjectionMode) ? 0.76 : 0.48 * sign;
  const position: Vec3 = [
    target[0] + distance * Math.cos(pitch) * Math.sin(yaw),
    target[1] + distance * Math.sin(pitch),
    target[2] + distance * Math.cos(pitch) * Math.cos(yaw),
  ];
  return normalizePlateEditorCamera({
    position,
    orientation: quaternionFromLookAt(position, target),
    pivot: target,
    fovDegrees: 78,
    nearMeters: 0.01,
    farMeters: Math.max(80, distance + surfaceRadius * 4),
    mode: "orbit",
  });
}

/** Radius of the measured carrier around its observer-relative origin. */
export function projectionSurfaceBoundingRadius(
  sourceProjectionMode: SourceProjectionMode,
  projectionSurface?: ProjectionSurface | null,
): number {
  const surface = normalizeProjectionSurfaceForMode(projectionSurface, sourceProjectionMode);
  if (surface.kind === "box-room") {
    const halfWidth = surface.width * 0.5;
    const halfDepth = surface.depth * 0.5;
    const maxX = Math.max(Math.abs(-halfWidth - surface.eyeX), Math.abs(halfWidth - surface.eyeX));
    const maxY = Math.max(surface.eyeHeight, surface.height - surface.eyeHeight);
    const maxZ = Math.max(Math.abs(-halfDepth - surface.eyeZ), Math.abs(halfDepth - surface.eyeZ));
    return Math.hypot(maxX, maxY, maxZ);
  }
  if (surface.kind === "double-gable-room") {
    const halfLength = surface.length * 0.5;
    const halfWidth = surface.width * 0.5;
    const maxX = Math.max(Math.abs(-halfLength - surface.eyeX), Math.abs(halfLength - surface.eyeX));
    const maxY = Math.max(
      surface.eyeHeight,
      ...planarRoofProfile(surface).map((anchor) => anchor.height - surface.eyeHeight),
    );
    const maxZ = Math.max(Math.abs(-halfWidth - surface.eyeZ), Math.abs(halfWidth - surface.eyeZ));
    return Math.hypot(maxX, maxY, maxZ);
  }
  if (surface.kind === "cylinder") {
    return Math.hypot(surface.radius, Math.max(surface.eyeHeight, surface.height - surface.eyeHeight));
  }
  return 1;
}

export function normalizePlateEditorCamera(
  camera: Partial<PlateEditorCamera> & Record<string, unknown> = {},
): PlateEditorCamera {
  const normalized = normalizeCameraRigPose<PlateEditorCameraMode>(camera, {
    position: [0, 0, -2.45],
    orientation: quaternionFromLookAt([0, 0, -2.45], [0, 0, 0]),
    pivot: [0, 0, 0],
    fovDegrees: 78,
    nearMeters: 0.01,
    farMeters: 80,
    mode: "orbit",
  });
  return {
    ...normalized,
    mode: normalized.mode === "inside" || normalized.mode === "fly" ? normalized.mode : "orbit",
  };
}

export function plateEditorViewMatrix(
  mode: Exclude<PlateEditorViewMode, "source-map">,
  camera: Partial<PlateEditorCamera>,
  sourceProjectionMode: SourceProjectionMode,
): Mat4 {
  const normalized = normalizePlateEditorCamera(camera as Partial<PlateEditorCamera> & Record<string, unknown>);
  if (mode === "dome-pov" || mode === "audience-space") {
    return viewMatrixFromCameraRigPose({
      ...normalized,
      mode: "inside",
    });
  }
  if (mode === "cave-room") {
    return viewMatrixFromCameraRigPose({
      ...normalized,
      pivot: normalized.pivot || defaultPlateEditorPivot(sourceProjectionMode),
    });
  }
  return viewMatrixFromCameraRigPose({
    ...normalized,
    pivot: normalized.pivot || defaultPlateEditorPivot(sourceProjectionMode),
  });
}

export function plateEditorOrthographicViewHeight(
  camera: Partial<PlateEditorCamera>,
  sourceProjectionMode: SourceProjectionMode,
  aspect = 1,
): number {
  const normalized = normalizePlateEditorCamera(camera as Partial<PlateEditorCamera> & Record<string, unknown>);
  const pivot = normalized.pivot || defaultPlateEditorPivot(sourceProjectionMode);
  const distance = Math.hypot(
    normalized.position[0] - pivot[0],
    normalized.position[1] - pivot[1],
    normalized.position[2] - pivot[2],
  );
  const squareViewHeight = clamp(
    Math.max(0.08, distance) * PLATE_EDITOR_ORTHOGRAPHIC_VIEW_HEIGHT_PER_DISTANCE,
    MIN_ORTHOGRAPHIC_VIEW_HEIGHT,
    MAX_ORTHOGRAPHIC_VIEW_HEIGHT,
  );
  // Orthographic width is height * aspect. Portrait carriers therefore need
  // a taller frustum to retain the same horizontal physical-room coverage.
  return squareViewHeight / Math.min(1, Math.max(0.000001, aspect));
}

export function plateEditorProjectionMatrix(
  camera: Partial<PlateEditorCamera>,
  sourceProjectionMode: SourceProjectionMode,
  aspect = 1,
  viewMode: PlateEditorViewMode = "dome-orbit",
): Mat4 {
  const normalized = normalizePlateEditorCamera(camera as Partial<PlateEditorCamera> & Record<string, unknown>);
  const safeAspect = Math.max(0.000001, aspect);
  if (viewMode === "audience-space") {
    return perspectiveLH(
      (normalized.fovDegrees * Math.PI) / 180,
      safeAspect,
      normalized.nearMeters || 0.01,
      normalized.farMeters || 80,
    );
  }
  const viewHeight = plateEditorOrthographicViewHeight(normalized, sourceProjectionMode, safeAspect);
  return orthographicLH(viewHeight * safeAspect, viewHeight, normalized.nearMeters || 0.01, normalized.farMeters || 80);
}

export function plateEditorDomeProjection(
  mode: "dome-orbit" | "dome-pov" | "audience-space",
  camera: Partial<PlateEditorCamera>,
  sourceProjectionMode: SourceProjectionMode,
  rect: Rect,
  showCaveMask?: boolean,
): DomeViewProjection {
  const normalized = normalizePlateEditorCamera(camera as Partial<PlateEditorCamera> & Record<string, unknown>);
  return {
    rect,
    viewMatrix: plateEditorViewMatrix(mode, normalized, sourceProjectionMode),
    fovDegrees: normalized.fovDegrees,
    projectionMode: mode === "audience-space" ? "perspective" : "orthographic",
    ...(mode === "audience-space"
      ? {}
      : {
          orthographicViewHeight: plateEditorOrthographicViewHeight(
            normalized,
            sourceProjectionMode,
            rect.width / Math.max(rect.height, 0.000001),
          ),
        }),
    sourceRotationRadians: 0,
    domeTiltRadians: 0,
    mirror: false,
    sourceProjectionMode,
    showCaveMask,
  };
}

export function plateEditorCaveProjection(
  camera: Partial<PlateEditorCamera>,
  sourceProjectionMode: SourceProjectionMode,
  rect: Rect,
  showCaveMask?: boolean,
  projectionSurface?: ProjectionSurface,
  viewMode: "cave-room" | "audience-space" = "cave-room",
): CaveViewProjection {
  const normalized = normalizePlateEditorCamera(camera as Partial<PlateEditorCamera> & Record<string, unknown>);
  return {
    rect,
    viewMatrix: plateEditorViewMatrix(viewMode, normalized, sourceProjectionMode),
    fovDegrees: normalized.fovDegrees,
    projectionMode: viewMode === "audience-space" ? "perspective" : "orthographic",
    ...(viewMode === "audience-space"
      ? {}
      : {
          orthographicViewHeight: plateEditorOrthographicViewHeight(
            normalized,
            sourceProjectionMode,
            rect.width / Math.max(rect.height, 0.000001),
          ),
        }),
    sourceRotationRadians: 0,
    domeTiltRadians: 0,
    mirror: false,
    sourceProjectionMode,
    projectionSurface,
    showCaveMask,
  };
}

function defaultPlateEditorPivot(sourceProjectionMode: SourceProjectionMode): Vec3 {
  if (sourceProjectionIsSurfaceCarrier(sourceProjectionMode)) return [0, 0, 0];
  return [0, 0.42 * projectionVerticalSign(sourceProjectionMode), 0];
}

function projectionVerticalSign(sourceProjectionMode: SourceProjectionMode): 1 | -1 {
  return sourceProjectionMode.startsWith("nadir") ||
    sourceProjectionMode === "cave-270" ||
    sourceProjectionMode === "cylinder-nadir"
    ? -1
    : 1;
}
