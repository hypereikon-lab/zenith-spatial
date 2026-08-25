import {
  dot,
  multiplyMat4,
  multiplyMat4Vec4,
  normalize,
  orthographicLH,
  perspectiveLH,
  scaleVec3,
} from "../projection.js";
import { domePointFromSourceDirection } from "./dome-view.js";
import {
  DEFAULT_CAVE_ROOM,
  caveContinuityDirectionFromSurfacePoint,
  caveSurfacePointFromContinuityDirection,
  normalizeCaveRoom,
} from "./cave-projection.js";
import {
  createCylinderContinuityCarrierProfile,
  cylinderSurfacePointFromDirection,
} from "./cylinder-continuity-carrier.js";
import { createCylinderWallCarrierProfile, cylinderWallSurfacePointFromDirection } from "./cylinder-wall-carrier.js";
import {
  doubleGableRoofHeight,
  doubleGableSurfacePointFromDirection,
  normalizeDoubleGableProjectionSurface,
} from "./double-gable-projection.js";
import { physicalDirectionFromSourceDirection, sourceDirectionFromPhysicalDirection } from "./source-transform.js";
import { sourceDirectionToUv } from "./source-projection.js";
import { normalizeProjectionSurfaceForMode, planarRoofProfile } from "../lib/shared/contracts/projection-authoring.js";
import type { CaveRoom } from "./cave-projection.js";
import type { DoubleGableProjectionSurface, ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { SourceProjectionMode } from "./source-projection.js";
import type { Mat4, Point2D, Rect, Vec3 } from "../projection.js";

export type CaveViewProjection = {
  rect: Rect;
  viewMatrix: Mat4;
  fovDegrees: number;
  projectionMode?: "perspective" | "orthographic";
  orthographicViewHeight?: number;
  sourceRotationRadians: number;
  domeTiltRadians: number;
  mirror: boolean;
  sourceProjectionMode?: SourceProjectionMode;
  room?: CaveRoom;
  projectionSurface?: ProjectionSurface;
  showCaveMask?: boolean;
};

type Ray = { origin: Vec3; direction: Vec3 };

const EPSILON = 0.000001;

export function sourceCaveDirectionFromScreenPoint(point: Point2D, projection: CaveViewProjection): Vec3 | null {
  const surfacePoint = caveSurfacePointFromScreenPoint(point, projection);
  if (!surfacePoint) return null;
  const continuityPhysical = continuityDirectionFromSurfacePoint(surfacePoint, projection);
  const source = sourceDirectionFromPhysicalDirection(continuityPhysical, projection);
  return sourceDirectionIsInProjection(source, projection) ? source : null;
}

export function sourceCavePointFromScreenPoint(point: Point2D, projection: CaveViewProjection) {
  const direction = sourceCaveDirectionFromScreenPoint(point, projection);
  return direction ? domePointFromSourceDirection(direction, projection.sourceProjectionMode || "zenith-180") : null;
}

export function sourceCaveDirectionToScreenPoint(direction: Vec3, projection: CaveViewProjection): Point2D | null {
  if (!sourceDirectionIsInProjection(direction, projection)) return null;
  const continuityPhysical = physicalDirectionFromSourceDirection(direction, projection);
  return physicalCaveDirectionToScreenPoint(continuityPhysical, projection);
}

/**
 * Projects a direction expressed in venue space, without routing it through
 * source-map allocation. This is the correct boundary for physical guides
 * such as the observer's horizontal eye plane.
 */
export function physicalCaveDirectionToScreenPoint(direction: Vec3, projection: CaveViewProjection): Point2D | null {
  const continuityPhysical = normalize(direction);
  const sourceDirection = sourceDirectionFromPhysicalDirection(continuityPhysical, projection);
  if (!sourceDirectionIsInProjection(sourceDirection, projection)) return null;
  const hit = surfacePointFromContinuityDirection(continuityPhysical, projection);
  if (!hit) return null;

  return physicalCaveSurfacePointToScreenPoint(hit, projection);
}

/** Projects an observer-relative point that already lies on the measured shell. */
export function physicalCaveSurfacePointToScreenPoint(point: Vec3, projection: CaveViewProjection): Point2D | null {
  const cameraProjection = cameraProjectionMatrix(projection);
  const mvp = multiplyMat4(cameraProjection, projection.viewMatrix);
  const clip = multiplyMat4Vec4(mvp, [point[0], point[1], point[2], 1]);
  if (clip[3] <= 0.0001) return null;

  const x = clip[0] / clip[3];
  const y = clip[1] / clip[3];
  const z = clip[2] / clip[3];
  if (x < -1.1 || x > 1.1 || y < -1.1 || y > 1.1 || z < 0 || z > 1.05) return null;

  const screenPoint = {
    x: projection.rect.x + (x * 0.5 + 0.5) * projection.rect.width,
    y: projection.rect.y + (1 - (y * 0.5 + 0.5)) * projection.rect.height,
  };
  const visibleSurfacePoint = caveSurfacePointFromScreenPoint(screenPoint, projection);
  if (!visibleSurfacePoint) return null;
  return dot(normalize(visibleSurfacePoint), normalize(point)) > 0.999 ? screenPoint : null;
}

/** Returns the visible venue-surface point in observer-relative world space. */
export function caveSurfacePointFromScreenPoint(point: Point2D, projection: CaveViewProjection): Vec3 | null {
  if (!pointInRect(point, projection.rect)) return null;
  const ray = worldRayFromScreenPoint(point, projection);
  if (!ray) return null;
  if (projection.sourceProjectionMode?.startsWith("cylinder-")) return intersectCylinderSurface(ray, projection);
  if (projection.sourceProjectionMode === "hall-double-gable") {
    return intersectDoubleGableSurface(ray, doubleGableSurfaceForProjection(projection), projection.showCaveMask);
  }
  return intersectCaveSurface(ray, caveRoomForProjection(projection), projection.showCaveMask);
}

export function caveSurfacePointForPhysicalDirection(direction: Vec3, room: CaveRoom = DEFAULT_CAVE_ROOM): Vec3 | null {
  return intersectCaveSurface({ origin: [0, 0, 0], direction: normalize(direction) }, room);
}

function intersectCaveSurface(ray: Ray, room: CaveRoom = DEFAULT_CAVE_ROOM, showCaveMask?: boolean): Vec3 | null {
  const safeRoom = normalizeCaveRoom(room);
  const halfWidth = safeRoom.width * 0.5;
  const halfDepth = safeRoom.depth * 0.5;
  const minX = -halfWidth - safeRoom.eyeX;
  const maxX = halfWidth - safeRoom.eyeX;
  const minZ = -halfDepth - safeRoom.eyeZ;
  const maxZ = halfDepth - safeRoom.eyeZ;
  const bottom = -safeRoom.eyeHeight;
  const top = safeRoom.height - safeRoom.eyeHeight;
  const candidates: Array<{ t: number; point: Vec3 }> = [];

  addPlaneCandidate(candidates, ray, 0, maxX, bottom, top, minZ, maxZ, showCaveMask);
  addPlaneCandidate(candidates, ray, 0, minX, bottom, top, minZ, maxZ, showCaveMask);
  addPlaneCandidate(candidates, ray, 2, maxZ, minX, maxX, bottom, top, showCaveMask);
  addPlaneCandidate(candidates, ray, 2, minZ, minX, maxX, bottom, top, showCaveMask);
  addPlaneCandidate(candidates, ray, 1, bottom, minX, maxX, minZ, maxZ, showCaveMask);

  candidates.sort((a, b) => a.t - b.t);
  return candidates[0]?.point || null;
}

function intersectDoubleGableSurface(
  ray: Ray,
  surface: DoubleGableProjectionSurface,
  showCaveMask?: boolean,
): Vec3 | null {
  const safe = normalizeDoubleGableProjectionSurface(surface);
  const halfLength = safe.length * 0.5;
  const halfWidth = safe.width * 0.5;
  const minX = -halfLength - safe.eyeX;
  const maxX = halfLength - safe.eyeX;
  const minZ = -halfWidth - safe.eyeZ;
  const maxZ = halfWidth - safe.eyeZ;
  const bottom = -safe.eyeHeight;
  const candidates: Array<{ t: number; point: Vec3 }> = [];

  const profile = planarRoofProfile(safe);
  const leftEave = profile[0].height - safe.eyeHeight;
  const rightEave = profile.at(-1)!.height - safe.eyeHeight;

  addPlaneCandidate(candidates, ray, 2, maxZ, minX, maxX, bottom, rightEave, showCaveMask);
  addPlaneCandidate(candidates, ray, 2, minZ, minX, maxX, bottom, leftEave, showCaveMask);
  addDoubleGableEndWallCandidate(candidates, ray, maxX, safe, showCaveMask);
  addDoubleGableEndWallCandidate(candidates, ray, minX, safe, showCaveMask);

  const measuredProfile: ReadonlyArray<readonly [number, number]> = profile.map((anchor) => [
    (anchor.position - 0.5) * safe.width,
    anchor.height,
  ]);
  for (let index = 0; index < measuredProfile.length - 1; index += 1) {
    addDoubleGableRoofCandidate(
      candidates,
      ray,
      measuredProfile[index],
      measuredProfile[index + 1],
      safe,
      showCaveMask,
    );
  }

  candidates.sort((left, right) => left.t - right.t);
  return candidates[0]?.point ?? null;
}

function addDoubleGableEndWallCandidate(
  candidates: Array<{ t: number; point: Vec3 }>,
  ray: Ray,
  wallX: number,
  surface: DoubleGableProjectionSurface,
  showCaveMask?: boolean,
): void {
  if (Math.abs(ray.direction[0]) <= EPSILON) return;
  const t = (wallX - ray.origin[0]) / ray.direction[0];
  if (t <= EPSILON) return;
  const point = pointAlongRay(ray, t);
  const worldZ = point[2] + surface.eyeZ;
  const roofY = doubleGableRoofHeight(worldZ, surface) - surface.eyeHeight;
  if (
    point[2] < -surface.width * 0.5 - surface.eyeZ - 0.0001 ||
    point[2] > surface.width * 0.5 - surface.eyeZ + 0.0001 ||
    point[1] < -surface.eyeHeight - 0.0001 ||
    point[1] > roofY + 0.0001
  ) {
    return;
  }
  const inwardNormal: Vec3 = wallX > 0 ? [-1, 0, 0] : [1, 0, 0];
  if (showCaveMask && dot(ray.direction, inwardNormal) > 0) return;
  candidates.push({ t, point });
}

function addDoubleGableRoofCandidate(
  candidates: Array<{ t: number; point: Vec3 }>,
  ray: Ray,
  start: readonly [number, number],
  end: readonly [number, number],
  surface: DoubleGableProjectionSurface,
  showCaveMask?: boolean,
): void {
  const slope = (end[1] - start[1]) / Math.max(end[0] - start[0], EPSILON);
  const denominator = ray.direction[1] - slope * ray.direction[2];
  if (Math.abs(denominator) <= EPSILON) return;
  const planeHeightAtRelativeZero = start[1] + slope * (surface.eyeZ - start[0]) - surface.eyeHeight;
  const t = (planeHeightAtRelativeZero + slope * ray.origin[2] - ray.origin[1]) / denominator;
  if (t <= EPSILON) return;
  const point = pointAlongRay(ray, t);
  const worldX = point[0] + surface.eyeX;
  const worldZ = point[2] + surface.eyeZ;
  if (
    worldX < -surface.length * 0.5 - 0.0001 ||
    worldX > surface.length * 0.5 + 0.0001 ||
    worldZ < start[0] - 0.0001 ||
    worldZ > end[0] + 0.0001
  ) {
    return;
  }
  const inwardNormal = normalize([0, -1, slope] as Vec3);
  if (showCaveMask && dot(ray.direction, inwardNormal) > 0) return;
  candidates.push({ t, point });
}

function intersectCylinderSurface(ray: Ray, projection: CaveViewProjection): Vec3 | null {
  const mode = projection.sourceProjectionMode === "cylinder-zenith" ? "cylinder-zenith" : "cylinder-nadir";
  const profile = cylinderProfileForProjection(projection, mode);
  const { radius, height, eyeHeight } = profile.room;
  const bottom = -eyeHeight;
  const top = height - eyeHeight;
  const candidates: Array<{ t: number; point: Vec3 }> = [];
  const a = ray.direction[0] ** 2 + ray.direction[2] ** 2;
  if (a > EPSILON) {
    const b = 2 * (ray.origin[0] * ray.direction[0] + ray.origin[2] * ray.direction[2]);
    const c = ray.origin[0] ** 2 + ray.origin[2] ** 2 - radius ** 2;
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        if (t <= EPSILON) continue;
        const point = pointAlongRay(ray, t);
        if (point[1] < bottom - 0.0001 || point[1] > top + 0.0001) continue;
        const inwardNormal: Vec3 = normalize([-point[0], 0, -point[2]]);
        if (projection.showCaveMask && dot(ray.direction, inwardNormal) > 0) continue;
        candidates.push({ t, point });
      }
    }
  }

  const capY = mode === "cylinder-nadir" ? bottom : top;
  if (Math.abs(ray.direction[1]) > EPSILON) {
    const t = (capY - ray.origin[1]) / ray.direction[1];
    if (t > EPSILON) {
      const point = pointAlongRay(ray, t);
      const inwardNormal: Vec3 = mode === "cylinder-nadir" ? [0, 1, 0] : [0, -1, 0];
      if (
        Math.hypot(point[0], point[2]) <= radius + 0.0001 &&
        !(projection.showCaveMask && dot(ray.direction, inwardNormal) > 0)
      ) {
        candidates.push({ t, point });
      }
    }
  }

  candidates.sort((left, right) => left.t - right.t);
  return candidates[0]?.point ?? null;
}

function surfacePointFromContinuityDirection(direction: Vec3, projection: CaveViewProjection): Vec3 | null {
  const mode = projection.sourceProjectionMode;
  if (mode === "hall-double-gable") {
    return doubleGableSurfacePointFromDirection(direction, doubleGableSurfaceForProjection(projection));
  }
  if (mode === "cylinder-wall") {
    const surface = normalizeProjectionSurfaceForMode(projection.projectionSurface, mode);
    return cylinderWallSurfacePointFromDirection(
      direction,
      createCylinderWallCarrierProfile({ room: surface.kind === "cylinder" ? surface : undefined }),
    );
  }
  if (mode?.startsWith("cylinder-")) {
    return cylinderSurfacePointFromDirection(
      direction,
      cylinderProfileForProjection(projection, mode === "cylinder-zenith" ? "cylinder-zenith" : "cylinder-nadir"),
    );
  }
  return caveSurfacePointFromContinuityDirection(direction, caveRoomForProjection(projection));
}

function continuityDirectionFromSurfacePoint(point: Vec3, projection: CaveViewProjection): Vec3 {
  if (
    projection.sourceProjectionMode?.startsWith("cylinder-") ||
    projection.sourceProjectionMode === "hall-double-gable"
  ) {
    return normalize(point);
  }
  return caveContinuityDirectionFromSurfacePoint(point, caveRoomForProjection(projection));
}

function caveRoomForProjection(projection: CaveViewProjection): CaveRoom {
  const surface = normalizeProjectionSurfaceForMode(projection.projectionSurface, "cave-270");
  return projection.room || (surface.kind === "box-room" ? surface : DEFAULT_CAVE_ROOM);
}

function doubleGableSurfaceForProjection(projection: CaveViewProjection): DoubleGableProjectionSurface {
  const surface = normalizeProjectionSurfaceForMode(projection.projectionSurface, "hall-double-gable");
  return normalizeDoubleGableProjectionSurface(surface.kind === "double-gable-room" ? surface : undefined);
}

function cylinderProfileForProjection(projection: CaveViewProjection, mode: "cylinder-nadir" | "cylinder-zenith") {
  const surface = normalizeProjectionSurfaceForMode(projection.projectionSurface, mode);
  return createCylinderContinuityCarrierProfile({
    mode,
    room: surface.kind === "cylinder" ? surface : undefined,
  });
}

function pointAlongRay(ray: Ray, distance: number): Vec3 {
  return [
    ray.origin[0] + ray.direction[0] * distance,
    ray.origin[1] + ray.direction[1] * distance,
    ray.origin[2] + ray.direction[2] * distance,
  ];
}

function sourceDirectionIsInProjection(direction: Vec3, projection: CaveViewProjection): boolean {
  return Boolean(
    sourceDirectionToUv(
      direction,
      projection.sourceProjectionMode || "zenith-180",
      2,
      2,
      1,
      undefined,
      undefined,
      projection.projectionSurface,
    ),
  );
}

function addPlaneCandidate(
  candidates: Array<{ t: number; point: Vec3 }>,
  ray: Ray,
  axis: 0 | 1 | 2,
  value: number,
  firstMin: number,
  firstMax: number,
  secondMin: number,
  secondMax: number,
  showCaveMask?: boolean,
): void {
  const denominator = ray.direction[axis];
  if (Math.abs(denominator) <= EPSILON) return;
  const t = (value - ray.origin[axis]) / denominator;
  if (t <= EPSILON) return;

  if (showCaveMask) {
    let normal: Vec3;
    if (axis === 0) {
      normal = [-Math.sign(value), 0, 0];
    } else if (axis === 2) {
      normal = [0, 0, -Math.sign(value)];
    } else {
      normal = [0, 1, 0];
    }
    if (dot(ray.direction, normal) > 0.0) {
      return;
    }
  }

  const point: Vec3 = [
    ray.origin[0] + ray.direction[0] * t,
    ray.origin[1] + ray.direction[1] * t,
    ray.origin[2] + ray.direction[2] * t,
  ];
  const first = axis === 0 ? point[1] : point[0];
  const second = axis === 0 ? point[2] : axis === 1 ? point[2] : point[1];
  if (first < firstMin - 0.0001 || first > firstMax + 0.0001) return;
  if (second < secondMin - 0.0001 || second > secondMax + 0.0001) return;
  candidates.push({ t, point });
}

function worldRayFromScreenPoint(
  point: Point2D,
  projection: Pick<
    CaveViewProjection,
    "rect" | "viewMatrix" | "fovDegrees" | "projectionMode" | "orthographicViewHeight"
  >,
): Ray | null {
  const { rect, viewMatrix } = projection;
  if (rect.width <= 0 || rect.height <= 0) return null;

  const ndcX = ((point.x - rect.x) / rect.width) * 2 - 1;
  const ndcY = 1 - ((point.y - rect.y) / rect.height) * 2;
  const aspect = rect.width / Math.max(rect.height, EPSILON);
  const xAxis: Vec3 = [viewMatrix[0], viewMatrix[4], viewMatrix[8]];
  const yAxis: Vec3 = [viewMatrix[1], viewMatrix[5], viewMatrix[9]];
  const zAxis: Vec3 = [viewMatrix[2], viewMatrix[6], viewMatrix[10]];
  const origin = addVec3(
    addVec3(scaleVec3(xAxis, -viewMatrix[12]), scaleVec3(yAxis, -viewMatrix[13])),
    scaleVec3(zAxis, -viewMatrix[14]),
  );

  if (projection.projectionMode === "orthographic") {
    const viewHeight = Math.max(EPSILON, projection.orthographicViewHeight ?? 2);
    const viewWidth = viewHeight * aspect;
    return {
      origin: addVec3(
        addVec3(origin, scaleVec3(xAxis, ndcX * viewWidth * 0.5)),
        scaleVec3(yAxis, ndcY * viewHeight * 0.5),
      ),
      direction: normalize(zAxis),
    };
  }

  const fovRadians = (projection.fovDegrees * Math.PI) / 180;
  const tanHalfFov = Math.tan(fovRadians * 0.5);
  if (!Number.isFinite(tanHalfFov) || tanHalfFov <= 0) return null;

  const cameraDirection: Vec3 = normalize([ndcX * tanHalfFov * aspect, ndcY * tanHalfFov, 1]);
  const direction = normalize(
    addVec3(
      addVec3(scaleVec3(xAxis, cameraDirection[0]), scaleVec3(yAxis, cameraDirection[1])),
      scaleVec3(zAxis, cameraDirection[2]),
    ),
  );
  return { origin, direction };
}

function cameraProjectionMatrix(
  projection: Pick<CaveViewProjection, "rect" | "fovDegrees" | "projectionMode" | "orthographicViewHeight">,
): Mat4 {
  const aspect = projection.rect.width / Math.max(projection.rect.height, EPSILON);
  if (projection.projectionMode === "orthographic") {
    const viewHeight = Math.max(EPSILON, projection.orthographicViewHeight ?? 2);
    return orthographicLH(viewHeight * aspect, viewHeight, 0.001, 1000);
  }
  return perspectiveLH((projection.fovDegrees * Math.PI) / 180, aspect, 0.01, 20);
}

function pointInRect(point: Point2D, rect: Rect): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
