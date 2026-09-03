import type { AudienceInSpace, ImageSpatialSpec } from "../domain/schema.js";
import {
  cameraBasisFromRigPose,
  multiplyQuaternions,
  quaternionFromEulerDegrees,
  type Quaternion,
} from "./camera-rig.js";
import { audienceCameraForProjection } from "./audience-in-space.js";
import { createCaveSurfacePointMapper } from "./cave-projection.js";
import {
  createCylinderContinuityCarrierProfile,
  cylinderContinuityUvToSurfacePoint,
} from "./cylinder-continuity-carrier.js";
import { createCylinderWallCarrierProfile, cylinderWallUvToSurfacePoint } from "./cylinder-wall-carrier.js";
import { createDoubleGableSurfacePointMapper } from "./double-gable-projection.js";
import {
  createSourceUvToDirectionMapper,
  sourceProjectionCenterLabel,
  sourceProjectionFieldOfViewDegrees,
} from "./source-projection.js";
import { normalizeProjectionSurfaceForMode } from "../lib/shared/contracts/projection-authoring.js";
import { clamp, dot, normalize, subtract, type Vec3 } from "../projection.js";

export const SPATIAL_TILE_IDS = ["front", "right", "back", "left", "up", "down"] as const;
export type SpatialTileId = (typeof SPATIAL_TILE_IDS)[number];

export type SpatialTileDescriptor = {
  readonly id: SpatialTileId;
  readonly label: string;
  readonly orientation: Quaternion;
  readonly verticalWarp?: {
    readonly kind: "angular-rim";
    readonly boundaryElevationDegrees: number;
    readonly validSide: "above" | "below";
  };
};

export type SpatialTileSample = {
  readonly u: number;
  readonly v: number;
  readonly weight: number;
};

export type SpatialTileBasis = {
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
};

export type SpatialTilePlanOptions = {
  readonly spatialSpec?: ImageSpatialSpec;
  readonly tileFovDegrees?: number;
};

const LOCAL_TILE_ROTATIONS: ReadonlyArray<{
  id: SpatialTileId;
  label: string;
  yawDegrees: number;
  pitchDegrees: number;
}> = [
  { id: "front", label: "Front", yawDegrees: 0, pitchDegrees: 0 },
  { id: "right", label: "Right", yawDegrees: 90, pitchDegrees: 0 },
  { id: "back", label: "Back", yawDegrees: 180, pitchDegrees: 0 },
  { id: "left", label: "Left", yawDegrees: -90, pitchDegrees: 0 },
  { id: "up", label: "Up", yawDegrees: 0, pitchDegrees: 90 },
  { id: "down", label: "Down", yawDegrees: 0, pitchDegrees: -90 },
];

/**
 * Six overlapping perspective cameras anchored to the current audience gaze.
 * Angular caps make the forward crop rim-aware so its lower center lands on
 * the actually visible carrier boundary instead of spending pixels below it.
 */
export function spatialTilePlan(
  audience: AudienceInSpace,
  options: SpatialTilePlanOptions = {},
): SpatialTileDescriptor[] {
  if (options.spatialSpec?.surface.kind === "angular") {
    return angularSpatialTilePlan(audience, options.spatialSpec, options.tileFovDegrees ?? 110);
  }
  const anchor = quaternionFromEulerDegrees(audience.yawDegrees, audience.pitchDegrees, 0);
  return LOCAL_TILE_ROTATIONS.map((tile) => ({
    id: tile.id,
    label: tile.label,
    orientation: multiplyQuaternions(anchor, quaternionFromEulerDegrees(tile.yawDegrees, tile.pitchDegrees, 0)),
  }));
}

function angularSpatialTilePlan(
  audience: AudienceInSpace,
  spec: ImageSpatialSpec,
  _tileFovDegrees: number,
): SpatialTileDescriptor[] {
  const sourceHalfAngle = sourceProjectionFieldOfViewDegrees(spec.projectionMode) * 0.5;
  const isNadir = sourceProjectionCenterLabel(spec.projectionMode) === "Nadir";
  const boundaryElevationDegrees = isNadir ? -90 + sourceHalfAngle : 90 - sourceHalfAngle;
  const poleFace: SpatialTileId = isNadir ? "down" : "up";
  const ringYawByFace: Partial<Record<SpatialTileId, number>> = isNadir
    ? { front: 0, right: 72, back: 144, left: -144, up: -72 }
    : { front: 0, right: 72, back: 144, left: -144, down: -72 };

  return LOCAL_TILE_ROTATIONS.map((tile) => {
    if (tile.id === poleFace) {
      return {
        id: tile.id,
        label: isNadir ? "Nadir" : "Zenith",
        orientation: quaternionFromEulerDegrees(audience.yawDegrees, isNadir ? -90 : 90, 0),
      };
    }
    const ringYaw = ringYawByFace[tile.id]!;
    return {
      id: tile.id,
      label: ringTileLabel(ringYaw),
      orientation: quaternionFromEulerDegrees(audience.yawDegrees + ringYaw, 0, 0),
      verticalWarp: {
        kind: "angular-rim",
        boundaryElevationDegrees,
        validSide: isNadir ? "below" : "above",
      },
    };
  });
}

function ringTileLabel(yawDegrees: number): string {
  if (yawDegrees === 0) return "Front";
  if (yawDegrees === 72) return "Front right";
  if (yawDegrees === 144) return "Rear right";
  if (yawDegrees === -144) return "Rear left";
  return "Front left";
}

/** Perspective-space row occupied by the angular carrier rim at one tile column. */
export function spatialTileRimBoundaryV(
  u: number,
  cameraPosition: Vec3,
  tile: SpatialTileDescriptor,
  tileFovDegrees: number,
): number | null {
  const warp = tile.verticalWarp;
  if (!warp) return null;
  const basis = spatialTileBasis(tile);
  const tangent = Math.tan((clamp(tileFovDegrees, 90, 130) * Math.PI) / 360);
  const nx = (clamp(u, 0, 1) * 2 - 1) * tangent;
  const horizontalDirection: Vec3 = [basis.forward[0] + basis.right[0] * nx, 0, basis.forward[2] + basis.right[2] * nx];
  const elevation = (warp.boundaryElevationDegrees * Math.PI) / 180;
  const boundaryY = Math.sin(elevation);
  const boundaryRadius = Math.cos(elevation);
  const a = horizontalDirection[0] ** 2 + horizontalDirection[2] ** 2;
  const b = 2 * (cameraPosition[0] * horizontalDirection[0] + cameraPosition[2] * horizontalDirection[2]);
  const c = cameraPosition[0] ** 2 + cameraPosition[2] ** 2 - boundaryRadius ** 2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || a <= 0.000001) return warp.validSide === "above" ? 1 : 0;
  const root = Math.sqrt(Math.max(0, discriminant));
  const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((value) => value > 0.000001);
  const distance = roots.length > 0 ? Math.min(...roots) : null;
  if (distance === null) return warp.validSide === "above" ? 1 : 0;
  const ny = (boundaryY - cameraPosition[1]) / (distance * tangent);
  return clamp(0.5 - ny * 0.5, 0.001, 0.999);
}

export function remapSpatialTileSampleToAtlas(
  sample: SpatialTileSample,
  cameraPosition: Vec3,
  tile: SpatialTileDescriptor,
  tileFovDegrees: number,
): SpatialTileSample | null {
  const warp = tile.verticalWarp;
  if (!warp) return weightedSpatialTileSample(sample.u, sample.v);
  const boundaryV = spatialTileRimBoundaryV(sample.u, cameraPosition, tile, tileFovDegrees);
  if (boundaryV === null) return null;
  const tolerance = 0.00001;
  const v =
    warp.validSide === "above"
      ? sample.v <= boundaryV + tolerance
        ? sample.v / boundaryV
        : null
      : sample.v >= boundaryV - tolerance
        ? (sample.v - boundaryV) / (1 - boundaryV)
        : null;
  return v === null ? null : weightedSpatialTileSample(sample.u, clamp(v, 0, 1));
}

function weightedSpatialTileSample(u: number, v: number): SpatialTileSample {
  const border = Math.max(0, Math.min(u, v, 1 - u, 1 - v));
  const feather = smoothstep(0, 0.16, border);
  return { u, v, weight: feather * feather };
}

export function spatialTileCameraPosition(audience: AudienceInSpace, spec: ImageSpatialSpec): Vec3 {
  return audienceCameraForProjection(audience, spec.projectionMode, spec.surface).position;
}

/**
 * Maps an exact point on the carrier into one perspective crop. The returned
 * cosine feather is deliberately zero at tile borders and broad across the
 * 20-degree overlap, which gives the pyramid blender useful shared content.
 */
export function spatialPointToTileSample(
  point: Vec3,
  cameraPosition: Vec3,
  tile: SpatialTileDescriptor,
  tileFovDegrees: number,
): SpatialTileSample | null {
  const sample = spatialPointToTileSampleWithBasis(point, cameraPosition, spatialTileBasis(tile), tileFovDegrees);
  return sample ? remapSpatialTileSampleToAtlas(sample, cameraPosition, tile, tileFovDegrees) : null;
}

export function spatialTileBasis(tile: SpatialTileDescriptor): SpatialTileBasis {
  const basis = cameraBasisFromRigPose({ orientation: tile.orientation, mode: "inside" });
  return { right: basis.right, up: basis.up, forward: basis.forward };
}

export function spatialPointToTileSampleWithBasis(
  point: Vec3,
  cameraPosition: Vec3,
  basis: SpatialTileBasis,
  tileFovDegrees: number,
): SpatialTileSample | null {
  const direction = normalize(subtract(point, cameraPosition));
  const forward = dot(direction, basis.forward);
  if (forward <= 0.000001) return null;
  const tangent = Math.tan((clamp(tileFovDegrees, 90, 130) * Math.PI) / 360);
  const nx = dot(direction, basis.right) / (forward * tangent);
  const ny = dot(direction, basis.up) / (forward * tangent);
  if (Math.abs(nx) > 1.000001 || Math.abs(ny) > 1.000001) return null;
  const u = clamp(nx * 0.5 + 0.5, 0, 1);
  const v = clamp(0.5 - ny * 0.5, 0, 1);
  return weightedSpatialTileSample(u, v);
}

/** Converts a carrier-map pixel back to the same physical surface rendered in Audience in Space. */
export function spatialSurfacePointFromSourceUv(u: number, v: number, spec: ImageSpatialSpec): Vec3 | null {
  return createSpatialSurfacePointMapper(spec)(u, v);
}

/** Prepares the carrier kernels once before traversing a dense output raster. */
export function createSpatialSurfacePointMapper(spec: ImageSpatialSpec): (u: number, v: number) => Vec3 | null {
  const surface = normalizeProjectionSurfaceForMode(spec.surface, spec.projectionMode);
  if (spec.projectionMode === "cylinder-wall") {
    const profile = createCylinderWallCarrierProfile({
      width: spec.targetWidth,
      height: spec.targetHeight,
      room: surface.kind === "cylinder" ? surface : undefined,
      horizonBand: spec.horizonSplit,
    });
    return (sourceU, sourceV) => cylinderWallUvToSurfacePoint(sourceU, sourceV, profile);
  }
  if (spec.projectionMode === "cylinder-zenith" || spec.projectionMode === "cylinder-nadir") {
    const profile = createCylinderContinuityCarrierProfile({
      mode: spec.projectionMode === "cylinder-zenith" ? "cylinder-zenith" : "cylinder-nadir",
      width: spec.targetWidth,
      height: spec.targetHeight,
      room: surface.kind === "cylinder" ? surface : undefined,
      capBand: spec.guideSplit,
      horizonBand: spec.horizonSplit,
    });
    return (sourceU, sourceV) => cylinderContinuityUvToSurfacePoint(sourceU, sourceV, profile);
  }
  const directionForUv = createSourceUvToDirectionMapper({
    mode: spec.projectionMode,
    width: spec.targetWidth,
    height: spec.targetHeight,
    radiusScale: 1,
    innerGuideSplit: spec.guideSplit,
    carrierHorizonRadius: spec.horizonSplit,
    surface,
  });
  if (surface.kind === "angular") return directionForUv;
  if (surface.kind === "box-room") {
    const surfacePoint = createCaveSurfacePointMapper(surface);
    return (sourceU, sourceV) => {
      const direction = directionForUv(sourceU, sourceV);
      return direction ? surfacePoint(direction) : null;
    };
  }
  if (surface.kind === "double-gable-room") {
    const surfacePoint = createDoubleGableSurfacePointMapper(surface);
    return (sourceU, sourceV) => {
      const direction = directionForUv(sourceU, sourceV);
      return direction ? surfacePoint(direction) : null;
    };
  }
  return () => null;
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = clamp((value - start) / Math.max(end - start, 0.000001), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
