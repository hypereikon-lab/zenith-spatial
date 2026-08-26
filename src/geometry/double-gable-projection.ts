import { d } from "typegpu";
import * as Schema from "effect/Schema";
import { normalize } from "../projection.js";
import {
  directionToDoubleGableCarrierUvKernel,
  doubleGableCarrierUvToDirectionKernel,
  doubleGableSurfaceFromDirectionKernel,
  planarHallRoofHeightKernel,
} from "../kernels/projection/double-gable.js";
import { compilePlanarRoofProfileKernelParams } from "./projection-kernel-parameters.js";
import {
  DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
  DoubleGableProjectionSurfaceSchema,
  planarRoofProfile,
  projectionSpatialAnchors,
  type DoubleGableProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import type { Point2D, Vec3 } from "../projection.js";

export type DoubleGableCarrierSample = {
  uv: Point2D;
  surfaceCode: number;
};

export function normalizeDoubleGableProjectionSurface(
  surface: DoubleGableProjectionSurface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
): DoubleGableProjectionSurface {
  try {
    return Schema.decodeUnknownSync(DoubleGableProjectionSurfaceSchema)(surface);
  } catch {
    return { ...DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE };
  }
}

export function doubleGableRoofHeight(
  worldZ: number,
  surface: DoubleGableProjectionSurface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
): number {
  const safe = normalizeDoubleGableProjectionSurface(surface);
  return planarHallRoofHeightKernel(worldZ, boxSize(safe), parameters(safe));
}

export function doubleGableSurfacePointFromDirection(
  direction: Vec3,
  surface: DoubleGableProjectionSurface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
): Vec3 | null {
  const safe = normalizeDoubleGableProjectionSurface(surface);
  const point = doubleGableSurfaceFromDirectionKernel(
    d.vec3f(...normalize(direction)),
    boxSize(safe),
    observer(safe),
    parameters(safe),
  );
  return point.w < 0.5 ? null : [point.x, point.y, point.z];
}

export function doubleGableDirectionFromCarrierUv(
  uv: Point2D,
  roofBand: number,
  horizonBand: number,
  surface: DoubleGableProjectionSurface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
): Vec3 | null {
  const safe = normalizeDoubleGableProjectionSurface(surface);
  const sample = doubleGableCarrierUvToDirectionKernel(
    d.vec2f(uv.x, uv.y),
    boxSize(safe),
    observer(safe),
    parameters(safe),
    roofBand,
    horizonBand,
    projectionSpatialAnchors(safe).horizonHeight,
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function doubleGableCarrierUvFromDirection(
  direction: Vec3,
  roofBand: number,
  horizonBand: number,
  surface: DoubleGableProjectionSurface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
): DoubleGableCarrierSample | null {
  const safe = normalizeDoubleGableProjectionSurface(surface);
  const sample = directionToDoubleGableCarrierUvKernel(
    d.vec3f(...normalize(direction)),
    boxSize(safe),
    observer(safe),
    parameters(safe),
    roofBand,
    horizonBand,
    projectionSpatialAnchors(safe).horizonHeight,
  );
  return sample.z < 0.5 ? null : { uv: { x: sample.x, y: sample.y }, surfaceCode: sample.w };
}

function boxSize(surface: DoubleGableProjectionSurface): d.v3f {
  return d.vec3f(surface.length, surface.width, planarRoofProfile(surface)[0].height);
}

function observer(surface: DoubleGableProjectionSurface): d.v3f {
  return d.vec3f(surface.eyeX, surface.eyeHeight, surface.eyeZ);
}

function parameters(surface: DoubleGableProjectionSurface) {
  return compilePlanarRoofProfileKernelParams(surface);
}
