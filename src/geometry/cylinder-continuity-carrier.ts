import { d } from "typegpu";
import { clamp } from "../projection.js";
import type { MapUv, Vec3 } from "../projection.js";
import type { SourceProjectionMode } from "../lib/shared/contracts/projection-profile.js";
import { normalizeSourceGuideCarrierHorizonRadius, normalizeSourceInnerGuideSplit } from "./source-guide-semantics.js";
import { projectionCarrierProfile } from "./projection-carrier-profile.js";
import {
  cylinderRadialCarrierToTraversalKernel,
  cylinderRadialSurfaceFromDirectionKernel,
  cylinderRadialSurfaceToUvKernel,
  cylinderRadialUvToDirectionKernel,
  cylinderRadialUvToSurfaceKernel,
  cylinderTraversalToRadialCarrierKernel,
  directionToCylinderRadialUvKernel,
} from "../kernels/projection/cylinder.js";
import { projectionModeCode } from "../kernels/projection/constants.js";

export type CylinderCarrierMode = Extract<SourceProjectionMode, "cylinder-nadir" | "cylinder-zenith">;

export type CylinderRoom = {
  radius: number;
  height: number;
  eyeHeight: number;
};

export type CylinderContinuityCarrierProfile = {
  mode: CylinderCarrierMode;
  width: number;
  height: number;
  room: Required<CylinderRoom>;
  capBand: number;
  horizonBand: number;
};

export type CylinderContinuityCarrierInput = {
  mode?: CylinderCarrierMode;
  width?: number | string | null;
  height?: number | string | null;
  room?: Partial<CylinderRoom> | null;
  capBand?: number | string | null;
  horizonBand?: number | string | null;
};

const DEFAULT_CYLINDER_SURFACE = projectionCarrierProfile("cylinder-nadir").surface!;

export const DEFAULT_CYLINDER_ROOM: Readonly<Required<CylinderRoom>> = {
  radius: DEFAULT_CYLINDER_SURFACE.radius,
  height: DEFAULT_CYLINDER_SURFACE.height,
  eyeHeight: DEFAULT_CYLINDER_SURFACE.eyeHeight,
};

export function normalizeCylinderRoom(room: Partial<CylinderRoom> = DEFAULT_CYLINDER_ROOM): Required<CylinderRoom> {
  const radius = Math.max(0.001, finiteNumber(room.radius, DEFAULT_CYLINDER_ROOM.radius));
  const height = Math.max(0.01, finiteNumber(room.height, DEFAULT_CYLINDER_ROOM.height));
  return {
    radius,
    height,
    eyeHeight: clamp(finiteNumber(room.eyeHeight, height * 0.5), 0.001, height - 0.001),
  };
}

export function createCylinderContinuityCarrierProfile({
  mode = "cylinder-nadir",
  width = 1,
  height = 1,
  room = DEFAULT_CYLINDER_ROOM,
  capBand,
  horizonBand,
}: CylinderContinuityCarrierInput = {}): CylinderContinuityCarrierProfile {
  const normalizedCapBand = normalizeSourceInnerGuideSplit(capBand, mode);
  return {
    mode,
    width: Math.max(1, Math.round(finiteNumber(width, 1))),
    height: Math.max(1, Math.round(finiteNumber(height, 1))),
    room: normalizeCylinderRoom(room || DEFAULT_CYLINDER_ROOM),
    capBand: normalizedCapBand,
    horizonBand: normalizeSourceGuideCarrierHorizonRadius(mode, normalizedCapBand, horizonBand),
  };
}

export function cylinderContinuityUvToDirection(
  u: number,
  v: number,
  profile: CylinderContinuityCarrierProfile = createCylinderContinuityCarrierProfile(),
): Vec3 | null {
  const sample = cylinderRadialUvToDirectionKernel(
    d.vec2f(u, v),
    projectionModeCode(profile.mode),
    cylinderVector(profile),
    profile.capBand,
    profile.horizonBand,
    cylinderPhysicalHorizonTraversal(profile),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function directionToCylinderContinuityUv(
  direction: Vec3,
  profile: CylinderContinuityCarrierProfile = createCylinderContinuityCarrierProfile(),
): MapUv | null {
  const sample = directionToCylinderRadialUvKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
    projectionModeCode(profile.mode),
    cylinderVector(profile),
    profile.capBand,
    profile.horizonBand,
    cylinderPhysicalHorizonTraversal(profile),
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

export function cylinderContinuityUvToSurfacePoint(
  u: number,
  v: number,
  profile: CylinderContinuityCarrierProfile = createCylinderContinuityCarrierProfile(),
): Vec3 | null {
  const sample = cylinderRadialUvToSurfaceKernel(
    d.vec2f(u, v),
    projectionModeCode(profile.mode),
    cylinderVector(profile),
    profile.capBand,
    profile.horizonBand,
    cylinderPhysicalHorizonTraversal(profile),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function cylinderContinuitySurfacePointToUv(
  point: Vec3,
  profile: CylinderContinuityCarrierProfile = createCylinderContinuityCarrierProfile(),
): MapUv | null {
  const sample = cylinderRadialSurfaceToUvKernel(
    d.vec3f(point[0], point[1], point[2]),
    projectionModeCode(profile.mode),
    cylinderVector(profile),
    profile.capBand,
    profile.horizonBand,
    cylinderPhysicalHorizonTraversal(profile),
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

export function cylinderSurfacePointFromDirection(
  direction: Vec3,
  profile: CylinderContinuityCarrierProfile = createCylinderContinuityCarrierProfile(),
): Vec3 | null {
  const sample = cylinderRadialSurfaceFromDirectionKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
    projectionModeCode(profile.mode),
    cylinderVector(profile),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function carrierWallRadiusToCylinderTraversal(
  rho: number,
  profile: CylinderContinuityCarrierProfile = createCylinderContinuityCarrierProfile(),
): number {
  return cylinderRadialCarrierToTraversalKernel(
    rho,
    profile.capBand,
    profile.horizonBand,
    cylinderPhysicalHorizonTraversal(profile),
  );
}

export function cylinderTraversalToCarrierWallRadius(
  traversal: number,
  profile: CylinderContinuityCarrierProfile = createCylinderContinuityCarrierProfile(),
): number {
  return cylinderTraversalToRadialCarrierKernel(
    traversal,
    profile.capBand,
    profile.horizonBand,
    cylinderPhysicalHorizonTraversal(profile),
  );
}

function cylinderPhysicalHorizonTraversal(profile: CylinderContinuityCarrierProfile): number {
  return profile.mode === "cylinder-nadir"
    ? clamp(profile.room.eyeHeight / profile.room.height, 0.0001, 0.9999)
    : clamp((profile.room.height - profile.room.eyeHeight) / profile.room.height, 0.0001, 0.9999);
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cylinderVector(profile: CylinderContinuityCarrierProfile): d.v3f {
  return d.vec3f(profile.room.radius, profile.room.height, profile.room.eyeHeight);
}
