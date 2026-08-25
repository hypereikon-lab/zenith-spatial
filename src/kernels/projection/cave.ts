import { d } from "typegpu";
import * as std from "typegpu/std";
import { safeNormalize3, wrappedUnit } from "../math.js";
import { KERNEL_EPSILON, ProjectionSurfaceCode } from "./constants.js";

const TAU = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const SURFACE_TOLERANCE = 0.0001;

/**
 * Maps the carrier wall annulus to physical wall height, normalized bottom to
 * top. A bottom cap (CAVE floor) grows upward from the inner seam; a top cap
 * (hall roof) is the exact inverse and descends toward the outer boundary.
 */
export function squareShellCarrierWallToPhysicalKernel(
  rho: number,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
  capAtTop: boolean,
): number {
  "use gpu";
  const carrier = std.clamp(rho, capBand, 1);
  const horizon = std.clamp(physicalHorizon, KERNEL_EPSILON, 1 - KERNEL_EPSILON);
  if (carrier <= horizonBand + KERNEL_EPSILON) {
    const amount = (carrier - capBand) / std.max(horizonBand - capBand, KERNEL_EPSILON);
    if (capAtTop) return 1 - std.clamp(amount, 0, 1) * (1 - horizon);
    return std.clamp(amount, 0, 1) * horizon;
  }
  const amount = (carrier - horizonBand) / std.max(1 - horizonBand, KERNEL_EPSILON);
  if (capAtTop) return horizon * (1 - std.clamp(amount, 0, 1));
  return horizon + std.clamp(amount, 0, 1) * (1 - horizon);
}

/** Inverse of squareShellCarrierWallToPhysicalKernel. */
export function squareShellPhysicalWallToCarrierKernel(
  wallT: number,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
  capAtTop: boolean,
): number {
  "use gpu";
  const physical = std.clamp(wallT, 0, 1);
  const horizon = std.clamp(physicalHorizon, KERNEL_EPSILON, 1 - KERNEL_EPSILON);
  if (capAtTop) {
    if (physical >= horizon - KERNEL_EPSILON) {
      const amount = (1 - physical) / std.max(1 - horizon, KERNEL_EPSILON);
      return capBand + std.clamp(amount, 0, 1) * (horizonBand - capBand);
    }
    const amount = (horizon - physical) / std.max(horizon, KERNEL_EPSILON);
    return horizonBand + std.clamp(amount, 0, 1) * (1 - horizonBand);
  }
  if (physical <= horizon + KERNEL_EPSILON) {
    return capBand + (physical / std.max(horizon, KERNEL_EPSILON)) * (horizonBand - capBand);
  }
  return horizonBand + ((physical - horizon) / std.max(1 - horizon, KERNEL_EPSILON)) * (1 - horizonBand);
}

export function caveCarrierWallToPhysicalKernel(
  rho: number,
  floorBand: number,
  horizonBand: number,
  physicalHorizon: number,
): number {
  "use gpu";
  return squareShellCarrierWallToPhysicalKernel(rho, floorBand, horizonBand, physicalHorizon, false);
}

export function cavePhysicalWallToCarrierKernel(
  wallT: number,
  floorBand: number,
  horizonBand: number,
  physicalHorizon: number,
): number {
  "use gpu";
  return squareShellPhysicalWallToCarrierKernel(wallT, floorBand, horizonBand, physicalHorizon, false);
}

export function rectangleBoundaryFractionKernel(x: number, y: number, aspect: number): number {
  "use gpu";
  const safeAspect = std.max(0.001, aspect);
  const clampedX = std.clamp(x, -safeAspect, safeAspect);
  const clampedY = std.clamp(y, -1, 1);
  let edge = 0;
  let nearest = std.abs(clampedY - 1);
  const right = std.abs(clampedX - safeAspect);
  const bottom = std.abs(clampedY + 1);
  const left = std.abs(clampedX + safeAspect);
  if (right < nearest) {
    nearest = right;
    edge = 1;
  }
  if (bottom < nearest) {
    nearest = bottom;
    edge = 2;
  }
  if (left < nearest) edge = 3;

  let distance = clampedX + safeAspect;
  if (edge === 1) distance = safeAspect * 2 + (1 - clampedY);
  if (edge === 2) distance = safeAspect * 2 + 2 + (safeAspect - clampedX);
  if (edge === 3) distance = safeAspect * 4 + 2 + (clampedY + 1);
  return wrappedUnit(distance / (4 * (safeAspect + 1)));
}

export function rectangleBoundaryPointKernel(fraction: number, aspect: number): d.v2f {
  "use gpu";
  const safeAspect = std.max(0.001, aspect);
  const distance = wrappedUnit(fraction) * 4 * (safeAspect + 1);
  if (distance <= safeAspect * 2) return d.vec2f(distance - safeAspect, 1);
  if (distance <= safeAspect * 2 + 2) return d.vec2f(safeAspect, 1 - (distance - safeAspect * 2));
  if (distance <= safeAspect * 4 + 2) {
    return d.vec2f(safeAspect - (distance - safeAspect * 2 - 2), -1);
  }
  return d.vec2f(-safeAspect, -1 + (distance - safeAspect * 4 - 2));
}

/** Returns rho and perimeter fraction. */
export function caveCarrierPointFromUvKernel(uv: d.v2f, aspect: number): d.v2f {
  "use gpu";
  const localX = (std.clamp(uv.x, 0, 1) - 0.5) * 2;
  const localY = (0.5 - std.clamp(uv.y, 0, 1)) * 2;
  const rho = std.max(std.abs(localX), std.abs(localY));
  if (rho <= KERNEL_EPSILON) return d.vec2f(0, 0.125);
  return d.vec2f(std.clamp(rho, 0, 1), rectangleBoundaryFractionKernel((localX / rho) * aspect, localY / rho, aspect));
}

export function caveUvFromCarrierPointKernel(rho: number, perimeterFraction: number, aspect: number): d.v2f {
  "use gpu";
  const boundaryPoint = rectangleBoundaryPointKernel(perimeterFraction, aspect);
  const radius = std.clamp(rho, 0, 1);
  return d.vec2f(
    0.5 + (boundaryPoint.x / std.max(aspect, KERNEL_EPSILON)) * radius * 0.5,
    0.5 - boundaryPoint.y * radius * 0.5,
  );
}

export function caveWallEyePointFromFractionKernel(fraction: number, boxSize: d.v3f, observer: d.v3f): d.v3f {
  "use gpu";
  const halfWidth = boxSize.x * 0.5;
  const halfDepth = boxSize.y * 0.5;
  const perimeter = 2 * (boxSize.x + boxSize.y);
  const distance = wrappedUnit(fraction) * perimeter;
  let world = d.vec2f(distance - halfWidth, halfDepth);
  if (distance > boxSize.x && distance <= boxSize.x + boxSize.y) {
    world = d.vec2f(halfWidth, halfDepth - (distance - boxSize.x));
  } else if (distance > boxSize.x + boxSize.y && distance <= boxSize.x * 2 + boxSize.y) {
    world = d.vec2f(halfWidth - (distance - boxSize.x - boxSize.y), -halfDepth);
  } else if (distance > boxSize.x * 2 + boxSize.y) {
    world = d.vec2f(-halfWidth, -halfDepth + (distance - boxSize.x * 2 - boxSize.y));
  }
  return d.vec3f(world.x - observer.x, 0, world.y - observer.z);
}

export function caveWallFractionFromEyePointKernel(point: d.v3f, boxSize: d.v3f, observer: d.v3f): number {
  "use gpu";
  const worldX = point.x + observer.x;
  const worldZ = point.z + observer.z;
  const halfWidth = boxSize.x * 0.5;
  const halfDepth = boxSize.y * 0.5;
  let face = 0;
  let nearest = std.abs(worldZ - halfDepth);
  const right = std.abs(worldX - halfWidth);
  const back = std.abs(worldZ + halfDepth);
  const left = std.abs(worldX + halfWidth);
  if (right < nearest) {
    nearest = right;
    face = 1;
  }
  if (back < nearest) {
    nearest = back;
    face = 2;
  }
  if (left < nearest) face = 3;
  let distance = worldX + halfWidth;
  if (face === 1) distance = boxSize.x + (halfDepth - worldZ);
  if (face === 2) distance = boxSize.x + boxSize.y + (halfWidth - worldX);
  if (face === 3) distance = boxSize.x * 2 + boxSize.y + (worldZ + halfDepth);
  return std.clamp(distance / (2 * (boxSize.x + boxSize.y)), 0, 1);
}

export function caveFloorBoundaryKernel(x: number, z: number, boxSize: d.v3f, observer: d.v3f): d.v2f {
  "use gpu";
  const minX = -boxSize.x * 0.5 - observer.x;
  const maxX = boxSize.x * 0.5 - observer.x;
  const minZ = -boxSize.y * 0.5 - observer.z;
  const maxZ = boxSize.y * 0.5 - observer.z;
  let scaleX = 1e30;
  let scaleZ = 1e30;
  if (x > KERNEL_EPSILON) scaleX = maxX / x;
  if (x < -KERNEL_EPSILON) scaleX = minX / x;
  if (z > KERNEL_EPSILON) scaleZ = maxZ / z;
  if (z < -KERNEL_EPSILON) scaleZ = minZ / z;
  const scale = std.min(scaleX, scaleZ);
  return d.vec2f(x * scale, z * scale);
}

/** Returns the eye-relative horizontal cap point for a square-shell carrier sample. */
export function squareShellCapPointKernel(rho: number, capBand: number, wallBase: d.v3f): d.v2f {
  "use gpu";
  let capT = d.f32(0);
  if (capBand > KERNEL_EPSILON) capT = std.clamp(rho / capBand, 0, 1);
  return d.vec2f(wallBase.x * capT, wallBase.z * capT);
}

/** Returns carrier rho and perimeter fraction for an eye-relative cap point. */
export function squareShellCarrierPointFromCapKernel(
  point: d.v2f,
  boxSize: d.v3f,
  observer: d.v3f,
  capBand: number,
): d.v2f {
  "use gpu";
  const distance = std.length(point);
  if (distance <= KERNEL_EPSILON) return d.vec2f(0, 0.125);
  const boundary = caveFloorBoundaryKernel(point.x, point.y, boxSize, observer);
  const boundaryDistance = std.length(boundary);
  const perimeterFraction = caveWallFractionFromEyePointKernel(d.vec3f(boundary.x, 0, boundary.y), boxSize, observer);
  const rho = capBand * std.clamp(distance / std.max(boundaryDistance, KERNEL_EPSILON), 0, 1);
  return d.vec2f(rho, perimeterFraction);
}

export function caveWallSurfaceCodeKernel(perimeterFraction: number, boxSize: d.v3f): number {
  "use gpu";
  const perimeter = 2 * (boxSize.x + boxSize.y);
  const distance = perimeterFraction * perimeter;
  let surface = d.f32(ProjectionSurfaceCode.CaveFront);
  if (distance > boxSize.x && distance <= boxSize.x + boxSize.y) surface = ProjectionSurfaceCode.CaveRight;
  if (distance > boxSize.x + boxSize.y && distance <= boxSize.x * 2 + boxSize.y)
    surface = ProjectionSurfaceCode.CaveBack;
  if (distance > boxSize.x * 2 + boxSize.y) surface = ProjectionSurfaceCode.CaveLeft;
  return surface;
}

export function cavePerimeterAngleKernel(point: d.v3f, boxSize: d.v3f, observer: d.v3f): number {
  "use gpu";
  const fraction = caveWallFractionFromEyePointKernel(point, boxSize, observer);
  const perimeter = 2 * (boxSize.x + boxSize.y);
  return ((fraction * perimeter - boxSize.x * 0.5) / perimeter) * TAU;
}

export function caveWallPointFromAngleKernel(angle: number, boxSize: d.v3f, observer: d.v3f): d.v3f {
  "use gpu";
  const perimeter = 2 * (boxSize.x + boxSize.y);
  return caveWallEyePointFromFractionKernel(angle / TAU + (boxSize.x * 0.5) / perimeter, boxSize, observer);
}

export function caveContinuityDirectionFromSurfaceKernel(point: d.v3f, boxSize: d.v3f, observer: d.v3f): d.v3f {
  "use gpu";
  const bottom = -observer.y;
  if (std.abs(point.y - bottom) < SURFACE_TOLERANCE) {
    const distance = std.length(d.vec2f(point.x, point.z));
    if (distance <= KERNEL_EPSILON) return d.vec3f(0, -1, 0);
    const boundary = caveFloorBoundaryKernel(point.x, point.z, boxSize, observer);
    const angle = cavePerimeterAngleKernel(d.vec3f(boundary.x, 0, boundary.y), boxSize, observer);
    const boundaryDistance = std.length(boundary);
    const boundaryElevation = std.atan2(-observer.y, std.max(boundaryDistance, KERNEL_EPSILON));
    const radiusFraction = std.clamp(distance / std.max(boundaryDistance, KERNEL_EPSILON), 0, 1);
    const elevation = -HALF_PI + radiusFraction * (boundaryElevation + HALF_PI);
    const cosElevation = std.cos(elevation);
    return safeNormalize3(d.vec3f(std.sin(angle) * cosElevation, std.sin(elevation), std.cos(angle) * cosElevation));
  }

  const angle = cavePerimeterAngleKernel(point, boxSize, observer);
  const horizontalDistance = std.length(d.vec2f(point.x, point.z));
  const elevation = std.atan2(point.y, std.max(horizontalDistance, KERNEL_EPSILON));
  const cosElevation = std.cos(elevation);
  return safeNormalize3(d.vec3f(std.sin(angle) * cosElevation, std.sin(elevation), std.cos(angle) * cosElevation));
}

/** Returns surface point xyz and validity in w. */
export function caveSurfaceFromContinuityDirectionKernel(direction: d.v3f, boxSize: d.v3f, observer: d.v3f): d.v4f {
  "use gpu";
  const dir = safeNormalize3(direction);
  const bottom = -observer.y;
  const angle = std.atan2(dir.x, dir.z);
  const wallPoint = caveWallPointFromAngleKernel(angle, boxSize, observer);
  const horizontalDistance = std.length(d.vec2f(wallPoint.x, wallPoint.z));
  const horizontalLength = std.length(d.vec2f(dir.x, dir.z));
  const elevation = std.atan2(dir.y, std.max(horizontalLength, KERNEL_EPSILON));
  const boundaryElevation = std.atan2(bottom, std.max(horizontalDistance, KERNEL_EPSILON));
  const top = boxSize.z - observer.y;
  if (elevation >= boundaryElevation - SURFACE_TOLERANCE) {
    if (horizontalLength <= KERNEL_EPSILON) return d.vec4f(0, 0, 0, 0);
    const y = horizontalDistance * (dir.y / horizontalLength);
    if (y < bottom - SURFACE_TOLERANCE || y > top + SURFACE_TOLERANCE) return d.vec4f(0, 0, 0, 0);
    return d.vec4f(wallPoint.x, std.clamp(y, bottom, top), wallPoint.z, 1);
  }

  const boundaryDistance = std.length(d.vec2f(wallPoint.x, wallPoint.z));
  const floorBoundaryElevation = std.atan2(-observer.y, std.max(boundaryDistance, KERNEL_EPSILON));
  const denominator = floorBoundaryElevation + HALF_PI;
  let radiusFraction = d.f32(0);
  if (denominator > KERNEL_EPSILON) {
    radiusFraction = std.clamp((elevation + HALF_PI) / denominator, 0, 1);
  }
  return d.vec4f(wallPoint.x * radiusFraction, bottom, wallPoint.z * radiusFraction, 1);
}

/** Returns surface point xyz and validity in w. */
export function caveCarrierUvToSurfaceKernel(
  uv: d.v2f,
  boxSize: d.v3f,
  observer: d.v3f,
  floorBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  if (uv.x < -KERNEL_EPSILON || uv.x > 1 + KERNEL_EPSILON || uv.y < -KERNEL_EPSILON || uv.y > 1 + KERNEL_EPSILON) {
    return d.vec4f(0, 0, 0, 0);
  }
  const aspect = boxSize.x / std.max(boxSize.y, KERNEL_EPSILON);
  const carrierPoint = caveCarrierPointFromUvKernel(uv, aspect);
  const rho = carrierPoint.x;
  const perimeterFraction = carrierPoint.y;
  const wallBase = caveWallEyePointFromFractionKernel(perimeterFraction, boxSize, observer);
  const bottom = -observer.y;
  const top = boxSize.z - observer.y;
  if (rho <= floorBand + KERNEL_EPSILON) {
    const capPoint = squareShellCapPointKernel(rho, floorBand, wallBase);
    return d.vec4f(capPoint.x, bottom, capPoint.y, 1);
  }
  const wallT = caveCarrierWallToPhysicalKernel(rho, floorBand, horizonBand, physicalHorizon);
  return d.vec4f(wallBase.x, bottom + (top - bottom) * wallT, wallBase.z, 1);
}

/** Returns u, v, valid, surface. */
export function caveSurfaceToCarrierUvKernel(
  point: d.v3f,
  boxSize: d.v3f,
  observer: d.v3f,
  floorBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const bottom = -observer.y;
  const top = boxSize.z - observer.y;
  // TypeGPU requires WGSL-resolved locals to have explicit initializers.
  // eslint-disable-next-line no-useless-assignment
  let rho = d.f32(0);
  // eslint-disable-next-line no-useless-assignment
  let perimeterFraction = 0.125;
  let surface = d.f32(ProjectionSurfaceCode.CaveFloor);
  if (std.abs(point.y - bottom) <= SURFACE_TOLERANCE) {
    const carrierPoint = squareShellCarrierPointFromCapKernel(d.vec2f(point.x, point.z), boxSize, observer, floorBand);
    rho = carrierPoint.x;
    perimeterFraction = carrierPoint.y;
  } else {
    perimeterFraction = caveWallFractionFromEyePointKernel(point, boxSize, observer);
    const wallT = std.clamp((point.y - bottom) / std.max(top - bottom, KERNEL_EPSILON), 0, 1);
    rho = cavePhysicalWallToCarrierKernel(wallT, floorBand, horizonBand, physicalHorizon);
    surface = caveWallSurfaceCodeKernel(perimeterFraction, boxSize);
  }
  const aspect = boxSize.x / std.max(boxSize.y, KERNEL_EPSILON);
  const uv = caveUvFromCarrierPointKernel(rho, perimeterFraction, aspect);
  return d.vec4f(uv.x, uv.y, 1, surface);
}

/** Returns direction.xyz and validity in w. */
export function caveCarrierUvToDirectionKernel(
  uv: d.v2f,
  boxSize: d.v3f,
  observer: d.v3f,
  floorBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const point = caveCarrierUvToSurfaceKernel(uv, boxSize, observer, floorBand, horizonBand, physicalHorizon);
  if (point.w < 0.5) return d.vec4f(0, 0, 0, 0);
  const direction = caveContinuityDirectionFromSurfaceKernel(point.xyz, boxSize, observer);
  return d.vec4f(direction.x, direction.y, direction.z, 1);
}

/** Returns u, v, valid, surface. */
export function directionToCaveCarrierUvKernel(
  direction: d.v3f,
  boxSize: d.v3f,
  observer: d.v3f,
  floorBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const point = caveSurfaceFromContinuityDirectionKernel(direction, boxSize, observer);
  if (point.w < 0.5) return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
  return caveSurfaceToCarrierUvKernel(point.xyz, boxSize, observer, floorBand, horizonBand, physicalHorizon);
}
