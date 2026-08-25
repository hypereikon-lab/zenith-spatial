import { d } from "typegpu";
import { angularDistance, clamp, normalize } from "../projection.js";
import { directionToFisheyeUv } from "./fisheye-projection.js";
import type { FisheyeProjectionProfile } from "./fisheye-projection.js";
import type { Vec3 } from "../projection.js";
import { projectionCarrierProfile } from "./projection-carrier-profile.js";
import {
  caveContinuityDirectionFromSurfaceKernel,
  caveSurfaceFromContinuityDirectionKernel,
  caveWallEyePointFromFractionKernel,
  caveWallFractionFromEyePointKernel,
} from "../kernels/projection/cave.js";

export const CAVE_FACES = ["front", "right", "back", "left", "floor"] as const;

export type CaveFace = (typeof CAVE_FACES)[number];

export type CaveRoom = {
  width: number;
  depth: number;
  height: number;
  eyeHeight: number;
  eyeX?: number;
  eyeZ?: number;
};

export type CaveFaceSample = {
  u: number;
  v: number;
};

export type CaveCoverage = {
  covered: number;
  total: number;
  ratio: number;
};

export type CavePerimeterPoint = {
  fraction: number;
  point: Vec3;
};

const DEFAULT_CAVE_SURFACE = projectionCarrierProfile("cave-270").surface!;

export const DEFAULT_CAVE_ROOM: CaveRoom = {
  width: DEFAULT_CAVE_SURFACE.width,
  depth: DEFAULT_CAVE_SURFACE.depth,
  height: DEFAULT_CAVE_SURFACE.height,
  eyeHeight: DEFAULT_CAVE_SURFACE.eyeHeight,
  eyeX: DEFAULT_CAVE_SURFACE.eyeX,
  eyeZ: DEFAULT_CAVE_SURFACE.eyeZ,
};

export function caveFacePoint(face: CaveFace, sample: CaveFaceSample, room: CaveRoom = DEFAULT_CAVE_ROOM): Vec3 {
  const safeRoom = normalizeCaveRoom(room);
  const u = clamp(sample.u, 0, 1);
  const v = clamp(sample.v, 0, 1);
  const halfWidth = safeRoom.width * 0.5;
  const halfDepth = safeRoom.depth * 0.5;
  const wallY = (1 - v) * safeRoom.height;

  if (face === "front") {
    return [lerp(-halfWidth, halfWidth, u), wallY, halfDepth];
  }
  if (face === "right") {
    return [halfWidth, wallY, lerp(halfDepth, -halfDepth, u)];
  }
  if (face === "back") {
    return [lerp(halfWidth, -halfWidth, u), wallY, -halfDepth];
  }
  if (face === "left") {
    return [-halfWidth, wallY, lerp(-halfDepth, halfDepth, u)];
  }
  return [lerp(-halfWidth, halfWidth, u), 0, lerp(halfDepth, -halfDepth, v)];
}

export function caveFaceDirection(face: CaveFace, sample: CaveFaceSample, room: CaveRoom = DEFAULT_CAVE_ROOM): Vec3 {
  const safeRoom = normalizeCaveRoom(room);
  const point = caveFacePoint(face, sample, safeRoom);
  return normalize([point[0] - safeRoom.eyeX, point[1] - safeRoom.eyeHeight, point[2] - safeRoom.eyeZ]);
}

export function caveContinuityDirectionFromSurfacePoint(surfacePoint: Vec3, room: CaveRoom = DEFAULT_CAVE_ROOM): Vec3 {
  const safeRoom = normalizeCaveRoom(room);
  const direction = caveContinuityDirectionFromSurfaceKernel(
    d.vec3f(surfacePoint[0], surfacePoint[1], surfacePoint[2]),
    caveBoxSize(safeRoom),
    caveObserver(safeRoom),
  );
  return [direction.x, direction.y, direction.z];
}

export function caveSurfacePointFromContinuityDirection(
  direction: Vec3,
  room: CaveRoom = DEFAULT_CAVE_ROOM,
): Vec3 | null {
  const safeRoom = normalizeCaveRoom(room);
  const point = caveSurfaceFromContinuityDirectionKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
    caveBoxSize(safeRoom),
    caveObserver(safeRoom),
  );
  return point.w < 0.5 ? null : [point.x, point.y, point.z];
}

export function estimateCaveFaceCoverage(
  face: CaveFace,
  sourceProfile: FisheyeProjectionProfile,
  room: CaveRoom = DEFAULT_CAVE_ROOM,
  samples = 33,
): CaveCoverage {
  const steps = Math.max(2, Math.round(samples));
  let covered = 0;
  let total = 0;
  for (let y = 0; y < steps; y += 1) {
    for (let x = 0; x < steps; x += 1) {
      const direction = caveFaceDirection(
        face,
        {
          u: steps === 1 ? 0.5 : x / (steps - 1),
          v: steps === 1 ? 0.5 : y / (steps - 1),
        },
        room,
      );
      total += 1;
      if (directionToFisheyeUv(direction, sourceProfile)) covered += 1;
    }
  }
  return {
    covered,
    total,
    ratio: total > 0 ? covered / total : 0,
  };
}

export function requiredFisheyeFieldOfViewDegrees(
  centerAxis: Vec3,
  room: CaveRoom = DEFAULT_CAVE_ROOM,
  faces: readonly CaveFace[] = CAVE_FACES,
  samples = 33,
): number {
  const center = normalize(centerAxis);
  const steps = Math.max(2, Math.round(samples));
  let maxTheta = 0;
  for (const face of faces) {
    for (let y = 0; y < steps; y += 1) {
      for (let x = 0; x < steps; x += 1) {
        const direction = caveFaceDirection(
          face,
          {
            u: x / (steps - 1),
            v: y / (steps - 1),
          },
          room,
        );
        maxTheta = Math.max(maxTheta, angularDistance(direction, center));
      }
    }
  }
  return maxTheta * 2 * (180 / Math.PI);
}

export function normalizeCaveRoom(room: CaveRoom): Required<CaveRoom> {
  const width = Math.max(0.001, Number(room.width) || DEFAULT_CAVE_ROOM.width);
  const depth = Math.max(0.001, Number(room.depth) || DEFAULT_CAVE_ROOM.depth);
  const height = Math.max(0.01, Number(room.height) || DEFAULT_CAVE_ROOM.height);
  return {
    width,
    depth,
    height,
    eyeHeight: clamp(Number(room.eyeHeight) || height * 0.5, 0.001, height - 0.001),
    eyeX: clamp(Number(room.eyeX) || 0, -width * 0.5 + 0.001, width * 0.5 - 0.001),
    eyeZ: clamp(Number(room.eyeZ) || 0, -depth * 0.5 + 0.001, depth * 0.5 - 0.001),
  };
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function caveWallPerimeterFractionFromEyeRelativePoint(point: Vec3, room: CaveRoom = DEFAULT_CAVE_ROOM): number {
  const safeRoom = normalizeCaveRoom(room);
  return caveWallFractionFromEyePointKernel(
    d.vec3f(point[0], point[1], point[2]),
    caveBoxSize(safeRoom),
    caveObserver(safeRoom),
  );
}

export function caveWallPerimeterFraction(point: Vec3, room: CaveRoom = DEFAULT_CAVE_ROOM): number {
  const safeRoom = normalizeCaveRoom(room);
  return caveWallFractionFromEyePointKernel(
    d.vec3f(point[0] - safeRoom.eyeX, point[1], point[2] - safeRoom.eyeZ),
    caveBoxSize(safeRoom),
    caveObserver(safeRoom),
  );
}

export function caveWallEyeRelativePointFromPerimeterFraction(
  fraction: number,
  room: CaveRoom = DEFAULT_CAVE_ROOM,
): Vec3 {
  const safeRoom = normalizeCaveRoom(room);
  const point = caveWallEyePointFromFractionKernel(fraction, caveBoxSize(safeRoom), caveObserver(safeRoom));
  return [point.x, point.y, point.z];
}

export function caveWallPointFromPerimeterFraction(fraction: number, room: CaveRoom = DEFAULT_CAVE_ROOM): Vec3 {
  const safeRoom = normalizeCaveRoom(room);
  const point = caveWallEyePointFromFractionKernel(fraction, caveBoxSize(safeRoom), caveObserver(safeRoom));
  return [point.x + safeRoom.eyeX, point.y, point.z + safeRoom.eyeZ];
}

function caveBoxSize(room: Required<CaveRoom>): d.v3f {
  return d.vec3f(room.width, room.depth, room.height);
}

function caveObserver(room: Required<CaveRoom>): d.v3f {
  return d.vec3f(room.eyeX, room.eyeHeight, room.eyeZ);
}
