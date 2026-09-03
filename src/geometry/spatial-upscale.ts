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
  tileFovDegrees: number,
): SpatialTileDescriptor[] {
  const anchor = quaternionFromEulerDegrees(audience.yawDegrees, audience.pitchDegrees, 0);
  const camera = spatialTileCameraPosition(audience, spec);
  const sourceHalfAngle = sourceProjectionFieldOfViewDegrees(spec.projectionMode) * 0.5;
  const isNadir = sourceProjectionCenterLabel(spec.projectionMode) === "Nadir";
  const boundaryElevationDegrees = isNadir ? -90 + sourceHalfAngle : 90 - sourceHalfAngle;
  const boundaryElevation = (boundaryElevationDegrees * Math.PI) / 180;
  const boundaryY = Math.sin(boundaryElevation);
  const boundaryRadius = Math.cos(boundaryElevation);
  const halfTileFov = clamp(tileFovDegrees, 90, 130) * 0.5;
  const seamCoverageFace: SpatialTileId = isNadir ? "up" : "down";

  return LOCAL_TILE_ROTATIONS.map((tile) => {
    if (tile.id === seamCoverageFace) {
      return {
        id: tile.id,
        label: "Front seam overlap",
        orientation: anchor,
      };
    }
    if (tile.id !== "front") {
      return {
        id: tile.id,
        label: tile.label,
        orientation: multiplyQuaternions(anchor, quaternionFromEulerDegrees(tile.yawDegrees, tile.pitchDegrees, 0)),
      };
    }
    const sourceYaw = (audience.yawDegrees * Math.PI) / 180;
    const boundaryPoint: Vec3 = [Math.sin(sourceYaw) * boundaryRadius, boundaryY, Math.cos(sourceYaw) * boundaryRadius];
    const direction = subtract(boundaryPoint, camera);
    const boundaryYawDegrees = (Math.atan2(direction[0], direction[2]) * 180) / Math.PI;
    const boundaryPitchDegrees = (Math.atan2(direction[1], Math.hypot(direction[0], direction[2])) * 180) / Math.PI;
    const pitchDegrees = boundaryPitchDegrees + (isNadir ? -halfTileFov : halfTileFov);
    return {
      id: tile.id,
      label: tile.label,
      orientation: quaternionFromEulerDegrees(boundaryYawDegrees, pitchDegrees, 0),
    };
  });
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
  return spatialPointToTileSampleWithBasis(point, cameraPosition, spatialTileBasis(tile), tileFovDegrees);
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
  const border = Math.max(0, Math.min(u, v, 1 - u, 1 - v));
  const feather = smoothstep(0, 0.16, border);
  return { u, v, weight: feather * feather };
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
