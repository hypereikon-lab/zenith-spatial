import { d } from "typegpu";
import { clamp } from "../projection.js";
import {
  DEFAULT_SOURCE_INNER_GUIDE_SPLIT,
  normalizeSourceInnerGuideSplit,
  sourceGuideCarrierHorizonRadius,
} from "./source-guide-semantics.js";
import { DEFAULT_CAVE_ROOM, normalizeCaveRoom } from "./cave-projection.js";
import type { CaveRoom } from "./cave-projection.js";
import type { MapUv, Vec3 } from "../projection.js";
import {
  caveCarrierPointFromUvKernel,
  caveCarrierUvToDirectionKernel,
  caveCarrierUvToSurfaceKernel,
  caveCarrierWallToPhysicalKernel,
  cavePhysicalWallToCarrierKernel,
  caveSurfaceToCarrierUvKernel,
  caveUvFromCarrierPointKernel,
  directionToCaveCarrierUvKernel,
  rectangleBoundaryFractionKernel,
  rectangleBoundaryPointKernel,
} from "../kernels/projection/cave.js";

export type CaveContinuityCarrierProfile = {
  width: number;
  height: number;
  aspect: number;
  room: Required<CaveRoom>;
  floorBand: number;
  horizonBand: number;
};

export type CaveContinuityCarrierInput = {
  width?: number | string | null;
  height?: number | string | null;
  room?: CaveRoom | null;
  floorBand?: number | string | null;
  horizonBand?: number | string | null;
};

export type CaveCarrierPoint = {
  rho: number;
  perimeterFraction: number;
};

export const DEFAULT_CAVE_CONTINUITY_FLOOR_BAND = DEFAULT_SOURCE_INNER_GUIDE_SPLIT;

const EPSILON = 0.000001;

export function createCaveContinuityCarrierProfile({
  width = 1,
  height = 1,
  room = DEFAULT_CAVE_ROOM,
  floorBand = DEFAULT_CAVE_CONTINUITY_FLOOR_BAND,
  horizonBand = null,
}: CaveContinuityCarrierInput = {}): CaveContinuityCarrierProfile {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  const normalizedRoom = normalizeCaveRoom(room || DEFAULT_CAVE_ROOM);
  const normalizedFloorBand = normalizeSourceInnerGuideSplit(floorBand, "cave-270");
  return {
    width: safeWidth,
    height: safeHeight,
    // Perimeter allocation follows the physical room, not raster dimensions.
    // This keeps CPU directions stable when the same carrier is rendered at a
    // different resolution or canvas aspect.
    aspect: normalizedRoom.width / normalizedRoom.depth,
    room: normalizedRoom,
    floorBand: normalizedFloorBand,
    horizonBand: sourceGuideCarrierHorizonRadius("cave-270", normalizedFloorBand, horizonBand),
  };
}

export function caveContinuityUvToDirection(
  u: number,
  v: number,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): Vec3 | null {
  const sample = caveCarrierUvToDirectionKernel(
    d.vec2f(u, v),
    boxSize(profile),
    boxObserver(profile),
    profile.floorBand,
    profile.horizonBand,
    cavePhysicalHorizonWallFraction(profile.room),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function directionToCaveContinuityUv(
  direction: Vec3,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): MapUv | null {
  const sample = directionToCaveCarrierUvKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
    boxSize(profile),
    boxObserver(profile),
    profile.floorBand,
    profile.horizonBand,
    cavePhysicalHorizonWallFraction(profile.room),
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

export function caveContinuityUvToSurfacePoint(
  u: number,
  v: number,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): Vec3 | null {
  const sample = caveCarrierUvToSurfaceKernel(
    d.vec2f(u, v),
    boxSize(profile),
    boxObserver(profile),
    profile.floorBand,
    profile.horizonBand,
    cavePhysicalHorizonWallFraction(profile.room),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function caveContinuitySurfacePointToUv(
  surfacePoint: Vec3,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): MapUv | null {
  const sample = caveSurfaceToCarrierUvKernel(
    d.vec3f(surfacePoint[0], surfacePoint[1], surfacePoint[2]),
    boxSize(profile),
    boxObserver(profile),
    profile.floorBand,
    profile.horizonBand,
    cavePhysicalHorizonWallFraction(profile.room),
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

export function carrierWallRadiusToPhysicalWallT(
  rho: number,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): number {
  return caveCarrierWallToPhysicalKernel(
    rho,
    profile.floorBand,
    profile.horizonBand,
    cavePhysicalHorizonWallFraction(profile.room),
  );
}

export function physicalWallTToCarrierWallRadius(
  wallT: number,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): number {
  return cavePhysicalWallToCarrierKernel(
    wallT,
    profile.floorBand,
    profile.horizonBand,
    cavePhysicalHorizonWallFraction(profile.room),
  );
}

function cavePhysicalHorizonWallFraction(room: Required<CaveRoom>): number {
  const bottom = -room.eyeHeight;
  const top = room.height - room.eyeHeight;
  return clamp((0 - bottom) / Math.max(top - bottom, EPSILON), 0.0001, 0.9999);
}

export function caveCarrierPointFromUv(
  u: number,
  v: number,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): CaveCarrierPoint {
  const point = caveCarrierPointFromUvKernel(d.vec2f(u, v), profile.aspect);
  return {
    rho: point.x,
    perimeterFraction: point.y,
  };
}

export function uvFromCaveCarrierPoint(
  point: CaveCarrierPoint,
  profile: CaveContinuityCarrierProfile = createCaveContinuityCarrierProfile(),
): MapUv {
  const uv = caveUvFromCarrierPointKernel(point.rho, point.perimeterFraction, profile.aspect);
  return { u: uv.x, v: uv.y };
}

export function rectangleBoundaryFraction(x: number, y: number, aspect = 1): number {
  return rectangleBoundaryFractionKernel(x, y, Math.max(0.001, Number(aspect) || 1));
}

export function rectangleBoundaryPoint(fraction: number, aspect = 1): { x: number; y: number } {
  const point = rectangleBoundaryPointKernel(fraction, Math.max(0.001, Number(aspect) || 1));
  return { x: point.x, y: point.y };
}

function boxSize(profile: CaveContinuityCarrierProfile): d.v3f {
  return d.vec3f(profile.room.width, profile.room.depth, profile.room.height);
}

function boxObserver(profile: CaveContinuityCarrierProfile): d.v3f {
  return d.vec3f(profile.room.eyeX, profile.room.eyeHeight, profile.room.eyeZ);
}
