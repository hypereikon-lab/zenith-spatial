import { d } from "typegpu";
import { clamp } from "../projection.js";
import type { MapUv, Vec3 } from "../projection.js";
import { normalizeSourceInnerGuideSplit } from "./source-guide-semantics.js";
import { DEFAULT_CYLINDER_ROOM, normalizeCylinderRoom, type CylinderRoom } from "./cylinder-continuity-carrier.js";
import {
  cylinderCarrierToPhysicalTraversalKernel,
  cylinderPhysicalToCarrierTraversalKernel,
  cylinderWallSurfaceFromDirectionKernel,
  cylinderWallSurfaceToUvKernel,
  cylinderWallUvToDirectionKernel,
  cylinderWallUvToSurfaceKernel,
  directionToCylinderWallUvKernel,
} from "../kernels/projection/cylinder.js";

export type CylinderWallCarrierProfile = {
  width: number;
  height: number;
  room: Required<CylinderRoom>;
  horizonBand: number;
};

export type CylinderWallCarrierInput = {
  width?: number | string | null;
  height?: number | string | null;
  room?: Partial<CylinderRoom> | null;
  horizonBand?: number | string | null;
};

/**
 * A rectangular chart for the cylindrical wall only.
 *
 * U is 360-degree azimuth with the identified seam at -Z. V runs from the
 * physical ceiling at 0 to the physical floor at 1. The carrier horizon is an
 * allocation breakpoint: moving it redistributes rows above/below eye level
 * while leaving the represented physical wall point unchanged.
 */
export function createCylinderWallCarrierProfile({
  width = 1,
  height = 1,
  room = DEFAULT_CYLINDER_ROOM,
  horizonBand,
}: CylinderWallCarrierInput = {}): CylinderWallCarrierProfile {
  return {
    width: Math.max(1, Math.round(finiteNumber(width, 1))),
    height: Math.max(1, Math.round(finiteNumber(height, 1))),
    room: normalizeCylinderRoom(room || DEFAULT_CYLINDER_ROOM),
    horizonBand: normalizeSourceInnerGuideSplit(horizonBand, "cylinder-wall"),
  };
}

export function cylinderWallUvToDirection(
  u: number,
  v: number,
  profile: CylinderWallCarrierProfile = createCylinderWallCarrierProfile(),
): Vec3 | null {
  const sample = cylinderWallUvToDirectionKernel(
    d.vec2f(u, v),
    cylinderVector(profile),
    profile.horizonBand,
    physicalHorizon(profile),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function directionToCylinderWallUv(
  direction: Vec3,
  profile: CylinderWallCarrierProfile = createCylinderWallCarrierProfile(),
): MapUv | null {
  const sample = directionToCylinderWallUvKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
    cylinderVector(profile),
    profile.horizonBand,
    physicalHorizon(profile),
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

export function cylinderWallUvToSurfacePoint(
  u: number,
  v: number,
  profile: CylinderWallCarrierProfile = createCylinderWallCarrierProfile(),
): Vec3 | null {
  const sample = cylinderWallUvToSurfaceKernel(
    d.vec2f(u, v),
    cylinderVector(profile),
    profile.horizonBand,
    physicalHorizon(profile),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function cylinderWallSurfacePointToUv(
  point: Vec3,
  profile: CylinderWallCarrierProfile = createCylinderWallCarrierProfile(),
): MapUv | null {
  const sample = cylinderWallSurfaceToUvKernel(
    d.vec3f(point[0], point[1], point[2]),
    cylinderVector(profile),
    profile.horizonBand,
    physicalHorizon(profile),
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

export function cylinderWallSurfacePointFromDirection(
  direction: Vec3,
  profile: CylinderWallCarrierProfile = createCylinderWallCarrierProfile(),
): Vec3 | null {
  const sample = cylinderWallSurfaceFromDirectionKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
    cylinderVector(profile),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function cylinderWallCarrierToPhysicalTraversal(
  carrierTraversal: number,
  profile: CylinderWallCarrierProfile = createCylinderWallCarrierProfile(),
): number {
  return cylinderCarrierToPhysicalTraversalKernel(carrierTraversal, profile.horizonBand, physicalHorizon(profile));
}

export function cylinderWallPhysicalToCarrierTraversal(
  physicalTraversal: number,
  profile: CylinderWallCarrierProfile = createCylinderWallCarrierProfile(),
): number {
  return cylinderPhysicalToCarrierTraversalKernel(physicalTraversal, profile.horizonBand, physicalHorizon(profile));
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function physicalHorizon(profile: CylinderWallCarrierProfile): number {
  return clamp(profile.room.eyeHeight / profile.room.height, 0.0001, 0.9999);
}

function cylinderVector(profile: CylinderWallCarrierProfile): d.v3f {
  return d.vec3f(profile.room.radius, profile.room.height, profile.room.eyeHeight);
}
