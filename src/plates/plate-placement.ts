import { d } from "typegpu";
import { clamp, dot, normalize } from "../projection.js";
import { sourceMapPointToDirection, sourceMapPointToUv } from "../geometry/source-projection.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { Vec3 } from "../projection.js";
import {
  directionFromPlateUvKernel,
  directionToPlateLocalKernel,
  PlateCornerCode,
  plateCornerBaseLocalKernel,
  plateCornerLocalKernel,
  plateLocalToWarpedUvKernel,
  plateWarpedUvToLocalKernel,
} from "../kernels/plates/placement.js";

export type PlateLike = { aspect?: number | string | null };
export type PlateCorner = "nw" | "ne" | "se" | "sw";
export type PlateCornerOffset = { x: number; y: number };
export type PlateCornerOffsets = Record<PlateCorner, PlateCornerOffset>;
export type PlatePlacementInput = {
  azimuth?: number | string | null;
  radius?: number | string | null;
  scale?: number | string | null;
  spin?: number | string | null;
  opacity?: number | string | null;
  flipX?: boolean | null;
  flipY?: boolean | null;
  aspect?: number | string | null;
  cornerOffsets?: Partial<Record<PlateCorner, Partial<PlateCornerOffset> | null>> | null;
};
export type NormalizedPlatePlacement = {
  azimuth: number;
  radius: number;
  scale: number;
  spin: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  cornerOffsets: PlateCornerOffsets;
};
export type PreparedPlatePlacement = NormalizedPlatePlacement & {
  theta: number;
  azimuthRadians: number;
  center: Vec3;
  right: Vec3;
  down: Vec3;
  mapCenter: [number, number];
  mapWidth: number;
  mapHeight: number;
  angularWidth: number;
  angularHeight: number;
  aspect: number;
  spinSin: number;
  spinCos: number;
};
export type PlateMapDimensions = { width: number; height: number };
export type PlateLocalPoint = { x: number; y: number };

export const MIN_PLATE_SCALE = 0.08;
export const MAX_PLATE_SCALE = 2.2;
export const PLATE_CORNERS: PlateCorner[] = ["nw", "ne", "se", "sw"];
export const PLATE_PLACEMENT_MODEL_VERSION = 9;
const DEFAULT_PLATE_SCALE = 0.72;
const CORNER_OFFSET_LIMIT = 0.85;
const DEFAULT_CORNER_OFFSETS: PlateCornerOffsets = {
  nw: { x: 0, y: 0 },
  ne: { x: 0, y: 0 },
  se: { x: 0, y: 0 },
  sw: { x: 0, y: 0 },
};

export function normalizePlatePlacement(
  placement: PlatePlacementInput = {},
  _plate: PlateLike | null = null,
): NormalizedPlatePlacement {
  const scale = Number.isFinite(Number(placement.scale)) ? Number(placement.scale) : DEFAULT_PLATE_SCALE;

  return {
    azimuth: normalizeDegrees(Number(placement.azimuth) || 0),
    radius: clamp(Number(placement.radius) || 0, 0, 1),
    scale: clamp(scale, MIN_PLATE_SCALE, MAX_PLATE_SCALE),
    spin: normalizeDegrees(Number(placement.spin) || 0),
    opacity: clamp(Number(placement.opacity) || 1, 0, 1),
    flipX: Boolean(placement.flipX),
    flipY: Boolean(placement.flipY),
    cornerOffsets: normalizeCornerOffsets(placement.cornerOffsets),
  };
}

export function preparePlatePlacement(
  placement: PlatePlacementInput | NormalizedPlatePlacement,
  plate: PlateLike | null = null,
  sourceProjectionMode: SourceProjectionMode = "zenith-180",
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
  projectionSurface?: ProjectionSurface | null,
): PreparedPlatePlacement {
  const normalized = normalizePlatePlacement(placement, plate);
  const aspect = plateAspect(plate, placement);
  const spin = (normalized.spin * Math.PI) / 180;
  const dimensions = plateMapDimensions(normalized, plate);
  return prepareSourceMapCarrierPlatePlacement(
    normalized,
    aspect,
    spin,
    dimensions,
    sourceProjectionMode,
    innerGuideSplit,
    carrierHorizonRadius,
    projectionSurface,
  );
}

function prepareSourceMapCarrierPlatePlacement(
  normalized: NormalizedPlatePlacement,
  aspect: number,
  spin: number,
  dimensions: PlateMapDimensions,
  sourceProjectionMode: SourceProjectionMode,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
  projectionSurface?: ProjectionSurface | null,
): PreparedPlatePlacement {
  const azimuth = (normalized.azimuth * Math.PI) / 180;
  const mapPoint = { radius: normalized.radius, azimuth: normalized.azimuth };
  const mapUv = sourceMapPointToUv(mapPoint, sourceProjectionMode);
  const center: Vec3 =
    sourceMapPointToDirection(
      mapPoint,
      sourceProjectionMode,
      2,
      2,
      1,
      innerGuideSplit,
      carrierHorizonRadius,
      projectionSurface,
    ) || fallbackCenter(sourceProjectionMode);
  const right: Vec3 =
    sourceMapPointTangent(
      center,
      mapPoint,
      sourceProjectionMode,
      0,
      0.1,
      innerGuideSplit,
      carrierHorizonRadius,
      projectionSurface,
    ) || fallbackRight(center);
  const rawDown: Vec3 =
    sourceMapPointTangent(
      center,
      mapPoint,
      sourceProjectionMode,
      0.0025,
      0,
      innerGuideSplit,
      carrierHorizonRadius,
      projectionSurface,
    ) || fallbackDown(center, right);
  const down = normalize([
    rawDown[0] - center[0] * dot(rawDown, center) - right[0] * dot(rawDown, right),
    rawDown[1] - center[1] * dot(rawDown, center) - right[1] * dot(rawDown, right),
    rawDown[2] - center[2] * dot(rawDown, center) - right[2] * dot(rawDown, right),
  ]);

  return {
    ...normalized,
    theta: normalized.radius,
    azimuthRadians: azimuth,
    center,
    right,
    down,
    mapCenter: [(mapUv.u - 0.5) * 2, (mapUv.v - 0.5) * 2],
    mapWidth: dimensions.width,
    mapHeight: dimensions.height,
    angularWidth: 2 * Math.atan(dimensions.width * 0.5),
    angularHeight: 2 * Math.atan(dimensions.height * 0.5),
    aspect,
    spinSin: Math.sin(spin),
    spinCos: Math.cos(spin),
  };
}

function sourceMapPointTangent(
  center: Vec3,
  point: { radius: number; azimuth: number },
  sourceProjectionMode: SourceProjectionMode,
  dRadius: number,
  dAzimuth: number,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
  projectionSurface?: ProjectionSurface | null,
): Vec3 | null {
  const forward = sourceMapPointToDirection(
    {
      radius: clamp(point.radius + dRadius, 0, 1),
      azimuth: normalizeDegrees(point.azimuth + dAzimuth),
    },
    sourceProjectionMode,
    2,
    2,
    1,
    innerGuideSplit,
    carrierHorizonRadius,
    projectionSurface,
  );
  const backward = sourceMapPointToDirection(
    {
      radius: clamp(point.radius - dRadius, 0, 1),
      azimuth: normalizeDegrees(point.azimuth - dAzimuth),
    },
    sourceProjectionMode,
    2,
    2,
    1,
    innerGuideSplit,
    carrierHorizonRadius,
    projectionSurface,
  );
  let tangent: Vec3 | null = null;
  if (forward && backward) {
    tangent = [forward[0] - backward[0], forward[1] - backward[1], forward[2] - backward[2]];
  } else if (forward) {
    tangent = [forward[0] - center[0], forward[1] - center[1], forward[2] - center[2]];
  } else if (backward) {
    tangent = [center[0] - backward[0], center[1] - backward[1], center[2] - backward[2]];
  }
  if (!tangent || Math.hypot(tangent[0], tangent[1], tangent[2]) <= 0.000001) return null;
  const projected: Vec3 = [
    tangent[0] - center[0] * dot(tangent, center),
    tangent[1] - center[1] * dot(tangent, center),
    tangent[2] - center[2] * dot(tangent, center),
  ];
  if (Math.hypot(projected[0], projected[1], projected[2]) <= 0.000001) return null;
  return normalize(projected);
}

function fallbackCenter(sourceProjectionMode: SourceProjectionMode): Vec3 {
  if (
    sourceProjectionMode === "nadir-180" ||
    sourceProjectionMode === "cave-270" ||
    sourceProjectionMode === "cylinder-nadir"
  )
    return [0, -1, 0];
  return [0, 1, 0];
}

function fallbackRight(center: Vec3): Vec3 {
  return Math.abs(center[1]) > 0.97 ? [1, 0, 0] : normalize([center[2], 0, -center[0]]);
}

function fallbackDown(center: Vec3, right: Vec3): Vec3 {
  return normalize([
    center[1] * right[2] - center[2] * right[1],
    center[2] * right[0] - center[0] * right[2],
    center[0] * right[1] - center[1] * right[0],
  ]);
}

export function plateMapDimensions(
  placement: PlatePlacementInput | NormalizedPlatePlacement,
  plate: PlateLike | null = null,
): PlateMapDimensions {
  const scale = clamp(Number(placement.scale) || DEFAULT_PLATE_SCALE, MIN_PLATE_SCALE, MAX_PLATE_SCALE);
  const aspect = plateAspect(plate, placement);
  return {
    width: scale,
    height: scale / aspect,
  };
}

export function directionFromPlateUv(placement: PreparedPlatePlacement, u: number, v: number): Vec3 {
  const vectors = plateKernelVectors(placement);
  const direction = directionFromPlateUvKernel(
    d.vec2f(u, v),
    d.vec3f(...placement.center),
    d.vec3f(...placement.right),
    d.vec3f(...placement.down),
    vectors.angularSize,
    d.vec2f(placement.spinSin, placement.spinCos),
    vectors.warpNorth,
    vectors.warpSouth,
  );
  return [direction.x, direction.y, direction.z];
}

export function directionToPlateLocal(direction: Vec3, placement: PreparedPlatePlacement): PlateLocalPoint | null {
  const local = directionToPlateLocalKernel(
    d.vec3f(...direction),
    d.vec3f(...placement.center),
    d.vec3f(...placement.right),
    d.vec3f(...placement.down),
    d.vec2f(placement.spinSin, placement.spinCos),
  );
  return local.z < 0.5 ? null : { x: local.x, y: local.y };
}

export function plateCornerBaseLocal(placement: PreparedPlatePlacement, corner: PlateCorner): PlateLocalPoint {
  const local = plateCornerBaseLocalKernel(
    plateCornerCode(corner),
    d.vec2f(placement.angularWidth, placement.angularHeight),
  );
  return { x: local.x, y: local.y };
}

export function plateCornerLocal(placement: PreparedPlatePlacement, corner: PlateCorner): PlateLocalPoint {
  const vectors = plateKernelVectors(placement);
  const local = plateCornerLocalKernel(
    plateCornerCode(corner),
    vectors.angularSize,
    vectors.warpNorth,
    vectors.warpSouth,
  );
  return { x: local.x, y: local.y };
}

export function plateUvToLocal(placement: PreparedPlatePlacement, u: number, v: number): PlateLocalPoint {
  const clampedU = Number.isFinite(u) ? u : 0.5;
  const clampedV = Number.isFinite(v) ? v : 0.5;
  const vectors = plateKernelVectors(placement);
  const local = plateWarpedUvToLocalKernel(
    d.vec2f(clampedU, clampedV),
    vectors.angularSize,
    vectors.warpNorth,
    vectors.warpSouth,
  );
  return { x: local.x, y: local.y };
}

export function plateLocalToWarpedUv(
  local: PlateLocalPoint,
  placement: PreparedPlatePlacement,
): PlateLocalPoint | null {
  const vectors = plateKernelVectors(placement);
  const uv = plateLocalToWarpedUvKernel(
    d.vec2f(local.x, local.y),
    vectors.angularSize,
    vectors.warpNorth,
    vectors.warpSouth,
  );
  return uv.z < 0.5 ? null : { x: uv.x, y: uv.y };
}

export function cornerOffsetFromLocal(
  placement: PreparedPlatePlacement,
  corner: PlateCorner,
  local: PlateLocalPoint,
): PlateCornerOffset {
  const base = plateCornerBaseLocal(placement, corner);
  return {
    x: clamp(
      (local.x - base.x) / Math.max(placement.angularWidth, 0.000001),
      -CORNER_OFFSET_LIMIT,
      CORNER_OFFSET_LIMIT,
    ),
    y: clamp(
      (local.y - base.y) / Math.max(placement.angularHeight, 0.000001),
      -CORNER_OFFSET_LIMIT,
      CORNER_OFFSET_LIMIT,
    ),
  };
}

export function clonePlateCornerOffsets(offsets: PlateCornerOffsets): PlateCornerOffsets {
  return {
    nw: { ...offsets.nw },
    ne: { ...offsets.ne },
    se: { ...offsets.se },
    sw: { ...offsets.sw },
  };
}

function plateAspect(
  plate: PlateLike | null | undefined,
  placement: PlatePlacementInput | NormalizedPlatePlacement,
): number {
  const explicitAspect = Number(plate?.aspect);
  if (Number.isFinite(explicitAspect) && explicitAspect > 0) return explicitAspect;
  const placementAspect = Number("aspect" in placement ? placement.aspect : undefined);
  if (Number.isFinite(placementAspect) && placementAspect > 0) return placementAspect;
  return 1;
}

function normalizeDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function normalizeCornerOffsets(
  offsets: PlatePlacementInput["cornerOffsets"] | PlateCornerOffsets | undefined,
): PlateCornerOffsets {
  const normalized = clonePlateCornerOffsets(DEFAULT_CORNER_OFFSETS);
  for (const corner of PLATE_CORNERS) {
    const offset = offsets?.[corner];
    normalized[corner] = {
      x: normalizeCornerOffsetValue(offset?.x),
      y: normalizeCornerOffsetValue(offset?.y),
    };
  }
  return normalized;
}

function normalizeCornerOffsetValue(value: number | string | null | undefined): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? clamp(numericValue, -CORNER_OFFSET_LIMIT, CORNER_OFFSET_LIMIT) : 0;
}

function plateCornerCode(corner: PlateCorner): number {
  if (corner === "ne") return PlateCornerCode.NorthEast;
  if (corner === "se") return PlateCornerCode.SouthEast;
  if (corner === "sw") return PlateCornerCode.SouthWest;
  return PlateCornerCode.NorthWest;
}

function plateKernelVectors(placement: PreparedPlatePlacement) {
  return {
    angularSize: d.vec2f(placement.angularWidth, placement.angularHeight),
    warpNorth: d.vec4f(
      placement.cornerOffsets.nw.x,
      placement.cornerOffsets.nw.y,
      placement.cornerOffsets.ne.x,
      placement.cornerOffsets.ne.y,
    ),
    warpSouth: d.vec4f(
      placement.cornerOffsets.sw.x,
      placement.cornerOffsets.sw.y,
      placement.cornerOffsets.se.x,
      placement.cornerOffsets.se.y,
    ),
  };
}
