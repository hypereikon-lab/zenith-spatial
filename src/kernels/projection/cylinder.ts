import { d } from "typegpu";
import * as std from "typegpu/std";
import { safeNormalize3, wrappedUnit } from "../math.js";
import { KERNEL_EPSILON, ProjectionModeCode, ProjectionSurfaceCode } from "./constants.js";

const TAU = Math.PI * 2;
const SURFACE_TOLERANCE = 0.0001;

export function cylinderCarrierToPhysicalTraversalKernel(
  carrierTraversal: number,
  carrierHorizon: number,
  physicalHorizon: number,
): number {
  "use gpu";
  const carrier = std.clamp(carrierTraversal, 0, 1);
  if (carrier <= carrierHorizon) {
    return (carrier / std.max(carrierHorizon, KERNEL_EPSILON)) * physicalHorizon;
  }
  return (
    physicalHorizon + ((carrier - carrierHorizon) / std.max(1 - carrierHorizon, KERNEL_EPSILON)) * (1 - physicalHorizon)
  );
}

export function cylinderPhysicalToCarrierTraversalKernel(
  physicalTraversal: number,
  carrierHorizon: number,
  physicalHorizon: number,
): number {
  "use gpu";
  const physical = std.clamp(physicalTraversal, 0, 1);
  if (physical <= physicalHorizon + KERNEL_EPSILON) {
    return (physical / std.max(physicalHorizon, KERNEL_EPSILON)) * carrierHorizon;
  }
  return (
    carrierHorizon +
    ((physical - physicalHorizon) / std.max(1 - physicalHorizon, KERNEL_EPSILON)) * (1 - carrierHorizon)
  );
}

export function cylinderRadialCarrierToTraversalKernel(
  rho: number,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
): number {
  "use gpu";
  const carrier = std.clamp(rho, capBand, 1);
  if (carrier <= horizonBand + KERNEL_EPSILON) {
    return ((carrier - capBand) / std.max(horizonBand - capBand, KERNEL_EPSILON)) * physicalHorizon;
  }
  return physicalHorizon + ((carrier - horizonBand) / std.max(1 - horizonBand, KERNEL_EPSILON)) * (1 - physicalHorizon);
}

export function cylinderTraversalToRadialCarrierKernel(
  traversal: number,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
): number {
  "use gpu";
  const physical = std.clamp(traversal, 0, 1);
  if (physical <= physicalHorizon + KERNEL_EPSILON) {
    return capBand + (physical / std.max(physicalHorizon, KERNEL_EPSILON)) * (horizonBand - capBand);
  }
  return (
    horizonBand + ((physical - physicalHorizon) / std.max(1 - physicalHorizon, KERNEL_EPSILON)) * (1 - horizonBand)
  );
}

/** Returns surface point xyz and validity in w. */
export function cylinderRadialUvToSurfaceKernel(
  uv: d.v2f,
  mode: number,
  cylinder: d.v3f,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  if (uv.x < -KERNEL_EPSILON || uv.x > 1 + KERNEL_EPSILON || uv.y < -KERNEL_EPSILON || uv.y > 1 + KERNEL_EPSILON) {
    return d.vec4f(0, 0, 0, 0);
  }
  const localX = (std.clamp(uv.x, 0, 1) - 0.5) * 2;
  const localY = (0.5 - std.clamp(uv.y, 0, 1)) * 2;
  const rho = std.length(d.vec2f(localX, localY));
  if (rho > 1 + KERNEL_EPSILON) return d.vec4f(0, 0, 0, 0);

  let angle = d.f32(0);
  if (rho > KERNEL_EPSILON) angle = std.atan2(localX, localY);
  const radialX = std.sin(angle);
  const radialZ = std.cos(angle);
  const bottom = -cylinder.z;
  const top = cylinder.y - cylinder.z;
  const nadir = mode === ProjectionModeCode.CylinderNadir;
  let capY = top;
  if (nadir) capY = bottom;

  if (rho <= capBand + KERNEL_EPSILON) {
    let capT = d.f32(0);
    if (capBand > KERNEL_EPSILON) capT = std.clamp(rho / capBand, 0, 1);
    return d.vec4f(cylinder.x * capT * radialX, capY, cylinder.x * capT * radialZ, 1);
  }

  const traversal = cylinderRadialCarrierToTraversalKernel(rho, capBand, horizonBand, physicalHorizon);
  let y = top - traversal * cylinder.y;
  if (nadir) y = bottom + traversal * cylinder.y;
  return d.vec4f(cylinder.x * radialX, y, cylinder.x * radialZ, 1);
}

/** Returns u, v, valid, surface. */
export function cylinderRadialSurfaceToUvKernel(
  point: d.v3f,
  mode: number,
  cylinder: d.v3f,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const bottom = -cylinder.z;
  const top = cylinder.y - cylinder.z;
  const nadir = mode === ProjectionModeCode.CylinderNadir;
  let capY = top;
  if (nadir) capY = bottom;
  const planarRadius = std.length(d.vec2f(point.x, point.z));
  // TypeGPU requires WGSL-resolved locals to have explicit initializers.
  // eslint-disable-next-line no-useless-assignment
  let rho = d.f32(0);
  let surface: number = ProjectionSurfaceCode.CylinderWall;

  if (std.abs(point.y - capY) <= SURFACE_TOLERANCE && planarRadius <= cylinder.x + SURFACE_TOLERANCE) {
    rho = capBand * std.clamp(planarRadius / std.max(cylinder.x, KERNEL_EPSILON), 0, 1);
    surface = ProjectionSurfaceCode.CylinderCap;
  } else {
    if (std.abs(planarRadius - cylinder.x) > 0.001) {
      return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
    }
    let traversal = std.clamp((top - point.y) / cylinder.y, 0, 1);
    if (nadir) traversal = std.clamp((point.y - bottom) / cylinder.y, 0, 1);
    rho = cylinderTraversalToRadialCarrierKernel(traversal, capBand, horizonBand, physicalHorizon);
  }

  if (rho <= KERNEL_EPSILON) return d.vec4f(0.5, 0.5, 1, surface);
  const angle = std.atan2(point.x, point.z);
  return d.vec4f(0.5 + std.sin(angle) * rho * 0.5, 0.5 - std.cos(angle) * rho * 0.5, 1, surface);
}

/** Returns surface point xyz and validity in w. */
export function cylinderRadialSurfaceFromDirectionKernel(direction: d.v3f, mode: number, cylinder: d.v3f): d.v4f {
  "use gpu";
  const dir = safeNormalize3(direction);
  const bottom = -cylinder.z;
  const top = cylinder.y - cylinder.z;
  let capY = top;
  if (mode === ProjectionModeCode.CylinderNadir) capY = bottom;
  let bestDistance = 1e30;
  let result = d.vec3f(0, 0, 0);
  let valid = d.f32(0);

  if (std.abs(dir.y) > KERNEL_EPSILON) {
    const distance = capY / dir.y;
    const point = std.mul(dir, distance);
    if (distance >= 0 && std.length(d.vec2f(point.x, point.z)) <= cylinder.x + SURFACE_TOLERANCE) {
      bestDistance = distance;
      result = d.vec3f(point.x, capY, point.z);
      valid = 1;
    }
  }

  const horizontalLength = std.length(d.vec2f(dir.x, dir.z));
  if (horizontalLength > KERNEL_EPSILON) {
    const distance = cylinder.x / horizontalLength;
    const point = std.mul(dir, distance);
    if (distance < bestDistance && point.y >= bottom - SURFACE_TOLERANCE && point.y <= top + SURFACE_TOLERANCE) {
      result = d.vec3f(point.x, std.clamp(point.y, bottom, top), point.z);
      valid = 1;
    }
  }
  return d.vec4f(result.x, result.y, result.z, valid);
}

/** Returns direction.xyz and validity in w. */
export function cylinderRadialUvToDirectionKernel(
  uv: d.v2f,
  mode: number,
  cylinder: d.v3f,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const point = cylinderRadialUvToSurfaceKernel(uv, mode, cylinder, capBand, horizonBand, physicalHorizon);
  if (point.w < 0.5) return d.vec4f(0, 0, 0, 0);
  const direction = safeNormalize3(point.xyz);
  return d.vec4f(direction.x, direction.y, direction.z, 1);
}

/** Returns u, v, valid, surface. */
export function directionToCylinderRadialUvKernel(
  direction: d.v3f,
  mode: number,
  cylinder: d.v3f,
  capBand: number,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const point = cylinderRadialSurfaceFromDirectionKernel(direction, mode, cylinder);
  if (point.w < 0.5) return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
  return cylinderRadialSurfaceToUvKernel(point.xyz, mode, cylinder, capBand, horizonBand, physicalHorizon);
}

/** Returns surface point xyz and validity in w. */
export function cylinderWallUvToSurfaceKernel(
  uv: d.v2f,
  cylinder: d.v3f,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  if (uv.x < -KERNEL_EPSILON || uv.x > 1 + KERNEL_EPSILON || uv.y < -KERNEL_EPSILON || uv.y > 1 + KERNEL_EPSILON) {
    return d.vec4f(0, 0, 0, 0);
  }
  const azimuth = (std.clamp(uv.x, 0, 1) - 0.5) * TAU;
  const carrierTraversal = 1 - std.clamp(uv.y, 0, 1);
  const physicalTraversal = cylinderCarrierToPhysicalTraversalKernel(carrierTraversal, horizonBand, physicalHorizon);
  const bottom = -cylinder.z;
  return d.vec4f(
    std.sin(azimuth) * cylinder.x,
    bottom + physicalTraversal * cylinder.y,
    std.cos(azimuth) * cylinder.x,
    1,
  );
}

/** Returns surface point xyz and validity in w. */
export function cylinderWallSurfaceFromDirectionKernel(direction: d.v3f, cylinder: d.v3f): d.v4f {
  "use gpu";
  const dir = safeNormalize3(direction);
  const horizontalLength = std.length(d.vec2f(dir.x, dir.z));
  if (horizontalLength <= KERNEL_EPSILON) return d.vec4f(0, 0, 0, 0);
  const distance = cylinder.x / horizontalLength;
  const y = dir.y * distance;
  const bottom = -cylinder.z;
  const top = cylinder.y - cylinder.z;
  if (y < bottom - SURFACE_TOLERANCE || y > top + SURFACE_TOLERANCE) return d.vec4f(0, 0, 0, 0);
  return d.vec4f(dir.x * distance, std.clamp(y, bottom, top), dir.z * distance, 1);
}

/** Returns u, v, valid, surface. */
export function cylinderWallSurfaceToUvKernel(
  point: d.v3f,
  cylinder: d.v3f,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const planarRadius = std.length(d.vec2f(point.x, point.z));
  const bottom = -cylinder.z;
  const top = cylinder.y - cylinder.z;
  if (
    std.abs(planarRadius - cylinder.x) > 0.001 ||
    point.y < bottom - SURFACE_TOLERANCE ||
    point.y > top + SURFACE_TOLERANCE
  ) {
    return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
  }
  const physicalTraversal = std.clamp((point.y - bottom) / cylinder.y, 0, 1);
  const carrierTraversal = cylinderPhysicalToCarrierTraversalKernel(physicalTraversal, horizonBand, physicalHorizon);
  const azimuth = std.atan2(point.x, point.z);
  return d.vec4f(std.clamp(0.5 + azimuth / TAU, 0, 1), 1 - carrierTraversal, 1, ProjectionSurfaceCode.CylinderWall);
}

/** Returns direction.xyz and validity in w. */
export function cylinderWallUvToDirectionKernel(
  uv: d.v2f,
  cylinder: d.v3f,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const point = cylinderWallUvToSurfaceKernel(uv, cylinder, horizonBand, physicalHorizon);
  if (point.w < 0.5) return d.vec4f(0, 0, 0, 0);
  const direction = safeNormalize3(point.xyz);
  return d.vec4f(direction.x, direction.y, direction.z, 1);
}

/** Returns u, v, valid, surface. */
export function directionToCylinderWallUvKernel(
  direction: d.v3f,
  cylinder: d.v3f,
  horizonBand: number,
  physicalHorizon: number,
): d.v4f {
  "use gpu";
  const point = cylinderWallSurfaceFromDirectionKernel(direction, cylinder);
  if (point.w < 0.5) return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
  return cylinderWallSurfaceToUvKernel(point.xyz, cylinder, horizonBand, physicalHorizon);
}

export function cylinderSeamWrappedUvKernel(uv: d.v2f): d.v2f {
  "use gpu";
  return d.vec2f(wrappedUnit(uv.x), uv.y);
}
