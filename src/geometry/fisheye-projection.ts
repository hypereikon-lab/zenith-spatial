import { d } from "typegpu";
import { clamp, cross, dot, normalize, scaleVec3, subtract } from "../projection.js";
import type { MapUv, ProjectionProfile, TangentBasis, Vec3 } from "../projection.js";
import { directionToFisheyeUvKernel, fisheyeUvToDirectionKernel } from "../kernels/projection/fisheye.js";

export type FisheyeCenter = "zenith" | "nadir" | Vec3;

export type FisheyeProjectionProfile = ProjectionProfile & {
  centerAxis: Vec3;
  imageRightAxis: Vec3;
  imageUpAxis: Vec3;
  fieldOfViewDegrees: number;
};

export type FisheyeProjectionInput = {
  width: number;
  height: number;
  center: FisheyeCenter;
  fieldOfViewDegrees: number;
  radiusScale?: number | string | null;
  imageRightAxis?: Vec3;
  imageUpAxis?: Vec3;
};

const EPSILON = 0.000001;
const EAST_AXIS: Vec3 = [1, 0, 0];
const NORTH_AXIS: Vec3 = [0, 0, 1];
const UP_AXIS: Vec3 = [0, 1, 0];

export function createFisheyeProjectionProfile({
  width,
  height,
  center,
  fieldOfViewDegrees,
  radiusScale = 1,
  imageRightAxis = EAST_AXIS,
  imageUpAxis = NORTH_AXIS,
}: FisheyeProjectionInput): FisheyeProjectionProfile {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const scale = clamp(Number(radiusScale) || 1, 0.05, 2);
  const radiusPixels = Math.min(safeWidth, safeHeight) * 0.5 * scale;
  const centerAxis = resolveFisheyeCenter(center);
  const imageUp = tangentAxis(imageUpAxis, centerAxis, UP_AXIS);
  const imageRight = orthogonalTangentAxis(imageRightAxis, centerAxis, imageUp);

  return {
    width: safeWidth,
    height: safeHeight,
    fisheyeScaleX: radiusPixels / safeWidth,
    fisheyeScaleY: radiusPixels / safeHeight,
    radiusPixels,
    centerAxis,
    imageRightAxis: imageRight,
    imageUpAxis: imageUp,
    fieldOfViewDegrees: clamp(Number(fieldOfViewDegrees) || 180, 1, 360),
  };
}

export function directionToFisheyeUv(direction: Vec3, profile: FisheyeProjectionProfile): MapUv | null {
  const sample = directionToFisheyeUvKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
    d.vec3f(profile.centerAxis[0], profile.centerAxis[1], profile.centerAxis[2]),
    d.vec3f(profile.imageRightAxis[0], profile.imageRightAxis[1], profile.imageRightAxis[2]),
    d.vec3f(profile.imageUpAxis[0], profile.imageUpAxis[1], profile.imageUpAxis[2]),
    d.vec2f(profile.fisheyeScaleX, profile.fisheyeScaleY),
    fisheyeHalfAngleRadians(profile),
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

export function fisheyeUvToDirection(u: number, v: number, profile: FisheyeProjectionProfile): Vec3 | null {
  const sample = fisheyeUvToDirectionKernel(
    d.vec2f(u, v),
    d.vec3f(profile.centerAxis[0], profile.centerAxis[1], profile.centerAxis[2]),
    d.vec3f(profile.imageRightAxis[0], profile.imageRightAxis[1], profile.imageRightAxis[2]),
    d.vec3f(profile.imageUpAxis[0], profile.imageUpAxis[1], profile.imageUpAxis[2]),
    d.vec2f(profile.fisheyeScaleX, profile.fisheyeScaleY),
    fisheyeHalfAngleRadians(profile),
  );
  return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
}

export function fisheyeTangentBasisAtUv(u: number, v: number, profile: FisheyeProjectionProfile): TangentBasis | null {
  const center = fisheyeUvToDirection(u, v, profile);
  if (!center) return null;
  const epsilon = 2 / Math.max(profile.width, profile.height, 2);
  const xNeighbor = fisheyeUvToDirection(u + epsilon, v, profile) || fisheyeUvToDirection(u - epsilon, v, profile);
  const yNeighbor = fisheyeUvToDirection(u, v + epsilon, profile) || fisheyeUvToDirection(u, v - epsilon, profile);
  let right = xNeighbor ? tangentVector(center, xNeighbor) : null;
  let down = yNeighbor ? tangentVector(center, yNeighbor) : null;
  if (!right || vectorLength(right) < EPSILON) {
    right = Math.abs(center[1]) > 0.97 ? [1, 0, 0] : normalize(cross(UP_AXIS, center));
  } else {
    right = normalize(right);
  }
  if (!down || vectorLength(down) < EPSILON) {
    down = normalize(cross(center, right));
  } else {
    down = subtract(down, scaleVec3(right, dot(down, right)));
    down = vectorLength(down) < EPSILON ? normalize(cross(center, right)) : normalize(down);
  }
  if (dot(cross(right, down), center) < 0) {
    down = scaleVec3(down, -1);
  }
  return { center, right, down };
}

export function fisheyeHalfAngleRadians(profile: Pick<FisheyeProjectionProfile, "fieldOfViewDegrees">): number {
  return clamp(profile.fieldOfViewDegrees, 1, 360) * 0.5 * (Math.PI / 180);
}

function resolveFisheyeCenter(center: FisheyeCenter): Vec3 {
  if (center === "zenith") return [0, 1, 0];
  if (center === "nadir") return [0, -1, 0];
  return normalize(center);
}

function tangentAxis(axis: Vec3, centerAxis: Vec3, alternateAxis: Vec3): Vec3 {
  const projected = subtract(axis, scaleVec3(centerAxis, dot(axis, centerAxis)));
  if (vectorLength(projected) > EPSILON) return normalize(projected);

  const alternate = subtract(alternateAxis, scaleVec3(centerAxis, dot(alternateAxis, centerAxis)));
  if (vectorLength(alternate) > EPSILON) return normalize(alternate);

  return normalize(cross(centerAxis, Math.abs(centerAxis[1]) < 0.9 ? UP_AXIS : EAST_AXIS));
}

function orthogonalTangentAxis(axis: Vec3, centerAxis: Vec3, imageUpAxis: Vec3): Vec3 {
  const tangent = tangentAxis(axis, centerAxis, NORTH_AXIS);
  const orthogonal = subtract(tangent, scaleVec3(imageUpAxis, dot(tangent, imageUpAxis)));
  if (vectorLength(orthogonal) > EPSILON) return normalize(orthogonal);
  return normalize(cross(imageUpAxis, centerAxis));
}

function vectorLength(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function tangentVector(center: Vec3, neighbor: Vec3): Vec3 {
  return subtract(neighbor, scaleVec3(center, dot(neighbor, center)));
}
