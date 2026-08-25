import {
  caveSurfacePointFromScreenPoint,
  physicalCaveDirectionToScreenPoint,
  physicalCaveSurfacePointToScreenPoint,
  sourceCaveDirectionFromScreenPoint,
  sourceCaveDirectionToScreenPoint,
} from "../geometry/cave-view.js";
import {
  physicalDomeDirectionFromScreenPoint,
  physicalDomeDirectionToScreenPoint,
  sourceDomeDirectionFromScreenPoint,
  sourceDomeDirectionToScreenPoint,
} from "../geometry/dome-view.js";
import {
  sourceDirectionToMapPoint,
  sourceDirectionToUv,
  sourceProjectionIsCaveCarrier,
  sourceProjectionIsSurfaceCarrier,
  sourceUvToDirection,
  sourceUvToMapPoint,
} from "../geometry/source-projection.js";
import { directionFromPlateUv } from "./plate-placement.js";
import {
  plateEditorCaveProjection,
  plateEditorDomeProjection,
  plateEditorViewDisabledReason,
} from "./plate-editor-view.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { Point2D, Rect, Vec3 } from "../projection.js";
import type { PreparedPlatePlacement } from "./plate-placement.js";
import type { PlateEditorCamera, PlateEditorViewMode } from "./plate-editor-view.js";

export type PlateEditorSourcePoint = { radius: number; azimuth: number };

export type PlateEditorProjectionAdapter = {
  mode: PlateEditorViewMode;
  sourceProjectionMode: SourceProjectionMode;
  projectSourceDirection(direction: Vec3): Point2D | null;
  /** Project a direction already expressed in physical venue space. */
  projectPhysicalDirection(direction: Vec3): Point2D | null;
  /** Project an observer-relative point on a measured venue shell. */
  projectPhysicalSurfacePoint(point: Vec3): Point2D | null;
  /** Physical direction at a projected dome/volume pixel. */
  physicalDirectionAt(point: Point2D): Vec3 | null;
  sourceDirectionAt(point: Point2D): Vec3 | null;
  /** Visible venue hit in observer-relative world space; projected rooms only. */
  physicalSurfacePointAt(point: Point2D): Vec3 | null;
  projectPlateUv(placement: PreparedPlatePlacement, u: number, v: number): Point2D | null;
  sourcePointAt(point: Point2D): PlateEditorSourcePoint | null;
};

export type PlateEditorProjectionAdapterOptions = {
  mode: PlateEditorViewMode;
  sourceProjectionMode: SourceProjectionMode;
  camera: Partial<PlateEditorCamera>;
  rect: Rect;
  domeGuideSemanticSplit?: number | string | null;
  domeGuideHorizonSplit?: number | string | null;
  showCaveMask?: boolean;
  projectionSurface?: ProjectionSurface;
};

export function createPlateEditorProjectionAdapter({
  mode,
  sourceProjectionMode,
  camera,
  rect,
  domeGuideSemanticSplit,
  domeGuideHorizonSplit,
  showCaveMask,
  projectionSurface,
}: PlateEditorProjectionAdapterOptions): PlateEditorProjectionAdapter {
  const disabledReason = plateEditorViewDisabledReason(mode, sourceProjectionMode);
  if (disabledReason) {
    throw new Error(disabledReason);
  }

  const projectSourceDirection = (direction: Vec3): Point2D | null => {
    if (mode === "source-map") {
      const uv = sourceDirectionToUv(
        direction,
        sourceProjectionMode,
        rect.width,
        rect.height,
        1,
        domeGuideSemanticSplit,
        domeGuideHorizonSplit,
        projectionSurface,
      );
      return uv ? { x: rect.x + uv.u * rect.width, y: rect.y + uv.v * rect.height } : null;
    }
    if (mode === "cave-room") {
      return sourceCaveDirectionToScreenPoint(
        direction,
        plateEditorCaveProjection(camera, sourceProjectionMode, rect, showCaveMask, projectionSurface),
      );
    }
    return sourceDomeDirectionToScreenPoint(
      direction,
      plateEditorDomeProjection(mode, camera, sourceProjectionMode, rect, showCaveMask),
    );
  };

  const sourceDirectionAt = (point: Point2D): Vec3 | null => {
    if (mode === "source-map") {
      return sourceUvToDirection(
        (point.x - rect.x) / Math.max(rect.width, 0.000001),
        (point.y - rect.y) / Math.max(rect.height, 0.000001),
        sourceProjectionMode,
        rect.width,
        rect.height,
        1,
        domeGuideSemanticSplit,
        domeGuideHorizonSplit,
        projectionSurface,
      );
    }
    if (mode === "cave-room") {
      return sourceCaveDirectionFromScreenPoint(
        point,
        plateEditorCaveProjection(camera, sourceProjectionMode, rect, showCaveMask, projectionSurface),
      );
    }
    return sourceDomeDirectionFromScreenPoint(
      point,
      plateEditorDomeProjection(mode, camera, sourceProjectionMode, rect, showCaveMask),
    );
  };

  const adapter: PlateEditorProjectionAdapter = {
    mode,
    sourceProjectionMode,
    projectSourceDirection,
    projectPhysicalDirection(direction) {
      if (mode === "cave-room") {
        return physicalCaveDirectionToScreenPoint(
          direction,
          plateEditorCaveProjection(camera, sourceProjectionMode, rect, showCaveMask, projectionSurface),
        );
      }
      if (mode === "source-map") return null;
      return physicalDomeDirectionToScreenPoint(
        direction,
        plateEditorDomeProjection(mode, camera, sourceProjectionMode, rect, showCaveMask),
      );
    },
    projectPhysicalSurfacePoint(point) {
      if (mode !== "cave-room") return null;
      return physicalCaveSurfacePointToScreenPoint(
        point,
        plateEditorCaveProjection(camera, sourceProjectionMode, rect, showCaveMask, projectionSurface),
      );
    },
    physicalDirectionAt(point) {
      if (mode === "cave-room") {
        const surfacePoint = caveSurfacePointFromScreenPoint(
          point,
          plateEditorCaveProjection(camera, sourceProjectionMode, rect, showCaveMask, projectionSurface),
        );
        return surfacePoint ? normalizeVec3(surfacePoint) : null;
      }
      if (mode === "source-map") return null;
      return physicalDomeDirectionFromScreenPoint(
        point,
        plateEditorDomeProjection(mode, camera, sourceProjectionMode, rect, showCaveMask),
      );
    },
    sourceDirectionAt,
    physicalSurfacePointAt(point) {
      if (mode !== "cave-room") return null;
      return caveSurfacePointFromScreenPoint(
        point,
        plateEditorCaveProjection(camera, sourceProjectionMode, rect, showCaveMask, projectionSurface),
      );
    },
    projectPlateUv(placement, u, v) {
      return projectSourceDirection(directionFromPlateUv(placement, u, v));
    },
    sourcePointAt(point) {
      if (mode === "source-map") {
        return sourceMapPointAt(point, rect, sourceProjectionMode);
      }
      const direction = sourceDirectionAt(point);
      return direction
        ? sourceDirectionToMapPoint(
            direction,
            sourceProjectionMode,
            rect.width,
            rect.height,
            1,
            domeGuideSemanticSplit,
            domeGuideHorizonSplit,
            projectionSurface,
          )
        : null;
    },
  };
  return adapter;
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 0.000001 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1];
}

function sourceMapPointAt(point: Point2D, rect: Rect, mode: SourceProjectionMode): PlateEditorSourcePoint | null {
  const u = clamp01((point.x - rect.x) / Math.max(rect.width, 0.000001));
  const v = clamp01((point.y - rect.y) / Math.max(rect.height, 0.000001));
  const mapped = sourceUvToMapPoint(u, v, mode, rect.width, rect.height);
  if (mapped) return mapped;

  let dx = (u - 0.5) * 2;
  let dy = (v - 0.5) * 2;
  if (!sourceProjectionIsSurfaceCarrier(mode)) {
    const shortEdge = Math.max(0.000001, Math.min(rect.width, rect.height));
    dx *= rect.width / shortEdge;
    dy *= rect.height / shortEdge;
  }
  const radius = sourceProjectionIsCaveCarrier(mode) ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy);
  if (radius <= 0.000001) {
    return { radius: 0, azimuth: 0 };
  }
  return {
    radius: Math.min(radius, 1),
    azimuth: normalizeMapDegrees((Math.atan2(dx, -dy) * 180) / Math.PI),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeMapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
