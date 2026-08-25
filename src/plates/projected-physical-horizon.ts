import {
  projectionSpatialAnchors,
  projectionSurfacePhysicalHorizon,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { Point2D, Rect, Vec3 } from "../projection.js";

export type ProjectedSpatialAnchorId = "semantic" | "horizon";

export type ProjectedSpatialAnchorGuide = {
  id: ProjectedSpatialAnchorId;
  label: string;
  value: number;
  unit: "degrees" | "meters";
  minimum: number;
  maximum: number;
  segments: Point2D[][];
  handle: Point2D | null;
};

/** Backward-compatible name used by the overlay while the UI migrates to multiple anchors. */
export type ProjectedPhysicalHorizonGuide = ProjectedSpatialAnchorGuide;

export function buildProjectedSpatialAnchorGuides({
  surface,
  mode,
  viewport,
  projectPhysicalDirection,
  projectPhysicalSurfacePoint,
  sampleCount = 180,
}: {
  surface: ProjectionSurface;
  mode: SourceProjectionMode;
  viewport: Rect;
  projectPhysicalDirection: (direction: Vec3) => Point2D | null;
  projectPhysicalSurfacePoint: (point: Vec3) => Point2D | null;
  sampleCount?: number;
}): ProjectedSpatialAnchorGuide[] {
  if (surface.kind === "angular") {
    const anchors = projectionSpatialAnchors(surface);
    const semanticFirst = mode !== "nadir-180";
    const domainMinimum = mode === "nadir-180" ? -89.5 : mode === "zenith-230" ? -25 : 0;
    const domainMaximum = mode === "nadir-180" ? 0 : 89.5;
    return [
      buildAngularGuide({
        id: "semantic",
        label: semanticFirst ? "Sky field" : "Floor field",
        elevationDegrees: anchors.semanticElevationDegrees,
        minimum: semanticFirst ? anchors.horizonElevationDegrees + 0.5 : domainMinimum,
        maximum: semanticFirst ? domainMaximum : anchors.horizonElevationDegrees - 0.5,
        viewport,
        projectPhysicalDirection,
        sampleCount,
        handleTargetY: 0.34,
      }),
      buildAngularGuide({
        id: "horizon",
        label: "Viewing horizon",
        elevationDegrees: anchors.horizonElevationDegrees,
        minimum: semanticFirst ? domainMinimum : anchors.semanticElevationDegrees + 0.5,
        maximum: semanticFirst ? anchors.semanticElevationDegrees - 0.5 : domainMaximum,
        viewport,
        projectPhysicalDirection,
        sampleCount,
        handleTargetY: 0.58,
      }),
    ];
  }

  const horizon = projectionSurfacePhysicalHorizon(surface);
  if (!horizon) return [];
  const points = measuredHorizonLoop(surface, horizon.height, sampleCount);
  return [
    buildGuideFromProjectedPoints({
      id: "horizon",
      label: "Texture horizon",
      value: horizon.height,
      unit: "meters",
      minimum: 0.01,
      maximum: horizon.upperLimit - 0.01,
      points,
      viewport,
      project: projectPhysicalSurfacePoint,
      handleTargetY: 0.52,
    }),
  ];
}

/** Legacy single-guide builder retained for focused callers and tests. */
export function buildProjectedPhysicalHorizonGuide({
  horizon,
  viewport,
  projectPhysicalDirection,
  sampleCount = 180,
}: {
  horizon: { height: number; upperLimit: number };
  viewport: Rect;
  projectPhysicalDirection: (direction: Vec3) => Point2D | null;
  sampleCount?: number;
}): ProjectedSpatialAnchorGuide {
  const samples = Math.max(32, Math.round(sampleCount));
  const directions = Array.from({ length: samples + 1 }, (_, index) => {
    const azimuth = (index / samples) * Math.PI * 2;
    return [Math.sin(azimuth), 0, Math.cos(azimuth)] as Vec3;
  });
  return buildGuideFromProjectedPoints({
    id: "horizon",
    label: "Texture horizon",
    value: horizon.height,
    unit: "meters",
    minimum: 0.01,
    maximum: horizon.upperLimit - 0.01,
    points: directions,
    viewport,
    project: projectPhysicalDirection,
    handleTargetY: 0.52,
  });
}

export function projectedSpatialAnchorHandleHit(
  point: Point2D | null,
  guides: readonly ProjectedSpatialAnchorGuide[],
  hitRadius = 24,
): ProjectedSpatialAnchorGuide | null {
  if (!point) return null;
  return guides.find((guide) => guide.handle && squaredDistance(point, guide.handle) <= hitRadius * hitRadius) ?? null;
}

export function projectedPhysicalHorizonHandleHit(
  point: Point2D | null,
  guide: ProjectedSpatialAnchorGuide | null,
  hitRadius = 24,
): boolean {
  return projectedSpatialAnchorHandleHit(point, guide ? [guide] : [], hitRadius) !== null;
}

function buildAngularGuide({
  id,
  label,
  elevationDegrees,
  minimum,
  maximum,
  viewport,
  projectPhysicalDirection,
  sampleCount,
  handleTargetY,
}: {
  id: ProjectedSpatialAnchorId;
  label: string;
  elevationDegrees: number;
  minimum: number;
  maximum: number;
  viewport: Rect;
  projectPhysicalDirection: (direction: Vec3) => Point2D | null;
  sampleCount: number;
  handleTargetY: number;
}): ProjectedSpatialAnchorGuide {
  const elevation = (elevationDegrees * Math.PI) / 180;
  const radius = Math.cos(elevation);
  const samples = Math.max(32, Math.round(sampleCount));
  const directions = Array.from({ length: samples + 1 }, (_, index) => {
    const azimuth = (index / samples) * Math.PI * 2;
    return [radius * Math.sin(azimuth), Math.sin(elevation), radius * Math.cos(azimuth)] as Vec3;
  });
  return buildGuideFromProjectedPoints({
    id,
    label,
    value: elevationDegrees,
    unit: "degrees",
    minimum,
    maximum,
    points: directions,
    viewport,
    project: projectPhysicalDirection,
    handleTargetY,
  });
}

function measuredHorizonLoop(
  surface: Exclude<ProjectionSurface, { kind: "angular" }>,
  height: number,
  count: number,
): Vec3[] {
  const y = height - surface.eyeHeight;
  if (surface.kind === "cylinder") {
    const samples = Math.max(48, Math.round(count));
    return Array.from({ length: samples + 1 }, (_, index) => {
      const azimuth = (index / samples) * Math.PI * 2;
      return [surface.radius * Math.sin(azimuth), y, surface.radius * Math.cos(azimuth)] as Vec3;
    });
  }

  const halfX = (surface.kind === "box-room" ? surface.width : surface.length) * 0.5;
  const halfZ = (surface.kind === "box-room" ? surface.depth : surface.width) * 0.5;
  const x0 = -halfX - surface.eyeX;
  const x1 = halfX - surface.eyeX;
  const z0 = -halfZ - surface.eyeZ;
  const z1 = halfZ - surface.eyeZ;
  const edgeSamples = Math.max(8, Math.round(count / 4));
  const corners: Vec3[] = [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
    [x0, y, z0],
  ];
  const points: Vec3[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    for (let index = 0; index < edgeSamples; index += 1) {
      const t = index / edgeSamples;
      points.push([
        corners[edge][0] + (corners[edge + 1][0] - corners[edge][0]) * t,
        y,
        corners[edge][2] + (corners[edge + 1][2] - corners[edge][2]) * t,
      ]);
    }
  }
  points.push(corners[4]);
  return points;
}

function buildGuideFromProjectedPoints({
  id,
  label,
  value,
  unit,
  minimum,
  maximum,
  points,
  viewport,
  project,
  handleTargetY,
}: {
  id: ProjectedSpatialAnchorId;
  label: string;
  value: number;
  unit: "degrees" | "meters";
  minimum: number;
  maximum: number;
  points: readonly Vec3[];
  viewport: Rect;
  project: (point: Vec3) => Point2D | null;
  handleTargetY: number;
}): ProjectedSpatialAnchorGuide {
  const segments: Point2D[][] = [];
  let segment: Point2D[] = [];
  const visiblePoints: Point2D[] = [];
  const discontinuity = Math.hypot(viewport.width, viewport.height) * 0.16;
  for (const sample of points) {
    const point = project(sample);
    const previous = segment.at(-1);
    if (!point || (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > discontinuity)) {
      if (segment.length > 1) segments.push(segment);
      segment = point ? [point] : [];
    } else {
      segment.push(point);
    }
    if (point) visiblePoints.push(point);
  }
  if (segment.length > 1) segments.push(segment);

  const target = { x: viewport.x + viewport.width * 0.72, y: viewport.y + viewport.height * handleTargetY };
  const handle = visiblePoints.reduce<Point2D | null>((nearest, point) => {
    if (!nearest) return point;
    return squaredDistance(point, target) < squaredDistance(nearest, target) ? point : nearest;
  }, null);
  return { id, label, value, unit, minimum, maximum, segments, handle };
}

function squaredDistance(left: Point2D, right: Point2D): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}
