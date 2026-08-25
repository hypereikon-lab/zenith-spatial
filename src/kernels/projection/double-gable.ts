import { d } from "typegpu";
import * as std from "typegpu/std";
import type { PlanarRoofProfileKernel } from "../schemas.js";
import { safeNormalize3 } from "../math.js";
import { KERNEL_EPSILON, ProjectionSurfaceCode } from "./constants.js";
import {
  caveCarrierPointFromUvKernel,
  caveUvFromCarrierPointKernel,
  caveWallEyePointFromFractionKernel,
  caveWallFractionFromEyePointKernel,
  caveWallSurfaceCodeKernel,
  squareShellCapPointKernel,
  squareShellCarrierPointFromCapKernel,
  squareShellCarrierWallToPhysicalKernel,
  squareShellPhysicalWallToCarrierKernel,
} from "./cave.js";
import {
  planarRoofAnchorHeightKernel,
  planarRoofAnchorPositionKernel,
  planarRoofHeightKernel,
  planarRoofWorldZKernel,
} from "./planar-roof-profile.js";

const SURFACE_TOLERANCE = 0.0001;

/** Returns left eave, first ridge, second ridge and right eave world-Z coordinates. */
export function doubleGableRoofBreakpointsKernel(boxSize: d.v3f, doubleGable: d.v4f): d.v4f {
  "use gpu";
  const halfWidth = boxSize.y * 0.5;
  const inset = std.clamp(doubleGable.z, KERNEL_EPSILON, std.max(halfWidth - KERNEL_EPSILON, KERNEL_EPSILON));
  return d.vec4f(-halfWidth, -halfWidth + inset, halfWidth - inset, halfWidth);
}

/** Roof profile parameters: x ridge height, y valley height, z symmetric ridge inset. */
export function doubleGableRoofHeightKernel(worldZ: number, boxSize: d.v3f, doubleGable: d.v4f): number {
  "use gpu";
  const breakpoints = doubleGableRoofBreakpointsKernel(boxSize, doubleGable);
  const z0 = breakpoints.x;
  const z1 = breakpoints.y;
  const z2 = d.f32(0);
  const z3 = breakpoints.z;
  const z4 = breakpoints.w;
  const z = std.clamp(worldZ, z0, z4);
  if (z <= z1) return boxSize.z + ((z - z0) / std.max(z1 - z0, KERNEL_EPSILON)) * (doubleGable.x - boxSize.z);
  if (z <= z2) return doubleGable.x + ((z - z1) / std.max(z2 - z1, KERNEL_EPSILON)) * (doubleGable.y - doubleGable.x);
  if (z <= z3) return doubleGable.y + ((z - z2) / std.max(z3 - z2, KERNEL_EPSILON)) * (doubleGable.x - doubleGable.y);
  return doubleGable.x + ((z - z3) / std.max(z4 - z3, KERNEL_EPSILON)) * (boxSize.z - doubleGable.x);
}

/** Legacy fixed-preset helper: returns the zero-based roof plane containing worldZ. */
export function doubleGableRoofSegmentKernel(worldZ: number, boxSize: d.v3f, doubleGable: d.v4f): number {
  "use gpu";
  const breakpoints = doubleGableRoofBreakpointsKernel(boxSize, doubleGable);
  const z = std.clamp(worldZ, breakpoints.x, breakpoints.w);
  if (z <= breakpoints.y) return 0;
  if (z <= 0) return 1;
  if (z <= breakpoints.z) return 2;
  return 3;
}

/** Active arbitrary planar-profile evaluator used by the warehouse carrier. */
export function planarHallRoofHeightKernel(worldZ: number, boxSize: d.v3f, profile: PlanarRoofProfileKernel): number {
  "use gpu";
  return planarRoofHeightKernel(worldZ, boxSize.y, profile);
}

/** Returns the eye-relative roof hit in xyz and ray distance in w. */
export function doubleGableRoofSegmentHitKernel(
  direction: d.v3f,
  boxSize: d.v3f,
  observer: d.v3f,
  z0: number,
  z1: number,
  h0: number,
  h1: number,
): d.v4f {
  "use gpu";
  const slope = (h1 - h0) / std.max(z1 - z0, KERNEL_EPSILON);
  const denominator = direction.y - slope * direction.z;
  if (std.abs(denominator) <= KERNEL_EPSILON) return d.vec4f(0, 0, 0, 0);
  const distance = (h0 + slope * (observer.z - z0) - observer.y) / denominator;
  if (distance <= KERNEL_EPSILON) return d.vec4f(0, 0, 0, 0);
  const worldX = observer.x + direction.x * distance;
  const worldZ = observer.z + direction.z * distance;
  if (
    worldX < -boxSize.x * 0.5 - SURFACE_TOLERANCE ||
    worldX > boxSize.x * 0.5 + SURFACE_TOLERANCE ||
    worldZ < z0 - SURFACE_TOLERANCE ||
    worldZ > z1 + SURFACE_TOLERANCE
  ) {
    return d.vec4f(0, 0, 0, 0);
  }
  return d.vec4f(direction.x * distance, direction.y * distance, direction.z * distance, distance);
}

/** Returns the nearest eye-relative point and a ProjectionSurfaceCode in w. */
export function doubleGableSurfaceFromDirectionKernel(
  direction: d.v3f,
  boxSize: d.v3f,
  observer: d.v3f,
  profile: PlanarRoofProfileKernel,
): d.v4f {
  "use gpu";
  const dir = safeNormalize3(direction);
  const halfLength = boxSize.x * 0.5;
  const halfWidth = boxSize.y * 0.5;
  let bestDistance = d.f32(1e30);
  let bestPoint = d.vec3f(0, 0, 0);
  let bestSurface = d.f32(ProjectionSurfaceCode.Invalid);

  const roof0 = doubleGableRoofSegmentHitKernel(
    dir,
    boxSize,
    observer,
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(0, profile), boxSize.y),
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(1, profile), boxSize.y),
    planarRoofAnchorHeightKernel(0, profile),
    planarRoofAnchorHeightKernel(1, profile),
  );
  if (roof0.w > KERNEL_EPSILON && roof0.w < bestDistance) {
    bestDistance = roof0.w;
    bestPoint = roof0.xyz;
    bestSurface = ProjectionSurfaceCode.GabledRoof;
  }
  const roof1 = doubleGableRoofSegmentHitKernel(
    dir,
    boxSize,
    observer,
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(1, profile), boxSize.y),
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(2, profile), boxSize.y),
    planarRoofAnchorHeightKernel(1, profile),
    planarRoofAnchorHeightKernel(2, profile),
  );
  if (profile.count > 2 && roof1.w > KERNEL_EPSILON && roof1.w < bestDistance) {
    bestDistance = roof1.w;
    bestPoint = roof1.xyz;
    bestSurface = ProjectionSurfaceCode.GabledRoof;
  }
  const roof2 = doubleGableRoofSegmentHitKernel(
    dir,
    boxSize,
    observer,
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(2, profile), boxSize.y),
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(3, profile), boxSize.y),
    planarRoofAnchorHeightKernel(2, profile),
    planarRoofAnchorHeightKernel(3, profile),
  );
  if (profile.count > 3 && roof2.w > KERNEL_EPSILON && roof2.w < bestDistance) {
    bestDistance = roof2.w;
    bestPoint = roof2.xyz;
    bestSurface = ProjectionSurfaceCode.GabledRoof;
  }
  const roof3 = doubleGableRoofSegmentHitKernel(
    dir,
    boxSize,
    observer,
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(3, profile), boxSize.y),
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(4, profile), boxSize.y),
    planarRoofAnchorHeightKernel(3, profile),
    planarRoofAnchorHeightKernel(4, profile),
  );
  if (profile.count > 4 && roof3.w > KERNEL_EPSILON && roof3.w < bestDistance) {
    bestDistance = roof3.w;
    bestPoint = roof3.xyz;
    bestSurface = ProjectionSurfaceCode.GabledRoof;
  }
  const roof4 = doubleGableRoofSegmentHitKernel(
    dir,
    boxSize,
    observer,
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(4, profile), boxSize.y),
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(5, profile), boxSize.y),
    planarRoofAnchorHeightKernel(4, profile),
    planarRoofAnchorHeightKernel(5, profile),
  );
  if (profile.count > 5 && roof4.w > KERNEL_EPSILON && roof4.w < bestDistance) {
    bestDistance = roof4.w;
    bestPoint = roof4.xyz;
    bestSurface = ProjectionSurfaceCode.GabledRoof;
  }
  const roof5 = doubleGableRoofSegmentHitKernel(
    dir,
    boxSize,
    observer,
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(5, profile), boxSize.y),
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(6, profile), boxSize.y),
    planarRoofAnchorHeightKernel(5, profile),
    planarRoofAnchorHeightKernel(6, profile),
  );
  if (profile.count > 6 && roof5.w > KERNEL_EPSILON && roof5.w < bestDistance) {
    bestDistance = roof5.w;
    bestPoint = roof5.xyz;
    bestSurface = ProjectionSurfaceCode.GabledRoof;
  }
  const roof6 = doubleGableRoofSegmentHitKernel(
    dir,
    boxSize,
    observer,
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(6, profile), boxSize.y),
    planarRoofWorldZKernel(planarRoofAnchorPositionKernel(7, profile), boxSize.y),
    planarRoofAnchorHeightKernel(6, profile),
    planarRoofAnchorHeightKernel(7, profile),
  );
  if (profile.count > 7 && roof6.w > KERNEL_EPSILON && roof6.w < bestDistance) {
    bestDistance = roof6.w;
    bestPoint = roof6.xyz;
    bestSurface = ProjectionSurfaceCode.GabledRoof;
  }

  if (std.abs(dir.z) > KERNEL_EPSILON) {
    let wallZ = d.f32(halfWidth);
    let wallSurface = d.f32(ProjectionSurfaceCode.CaveFront);
    if (dir.z < 0) {
      wallZ = -halfWidth;
      wallSurface = ProjectionSurfaceCode.CaveBack;
    }
    const distance = (wallZ - observer.z) / dir.z;
    const worldX = observer.x + dir.x * distance;
    const worldY = observer.y + dir.y * distance;
    if (
      distance > KERNEL_EPSILON &&
      distance < bestDistance &&
      worldX >= -halfLength - SURFACE_TOLERANCE &&
      worldX <= halfLength + SURFACE_TOLERANCE &&
      worldY >= -SURFACE_TOLERANCE &&
      worldY <= planarHallRoofHeightKernel(wallZ, boxSize, profile) + SURFACE_TOLERANCE
    ) {
      bestDistance = distance;
      bestPoint = d.vec3f(dir.x * distance, dir.y * distance, dir.z * distance);
      bestSurface = wallSurface;
    }
  }

  if (std.abs(dir.x) > KERNEL_EPSILON) {
    let wallX = d.f32(halfLength);
    let wallSurface = d.f32(ProjectionSurfaceCode.CaveRight);
    if (dir.x < 0) {
      wallX = -halfLength;
      wallSurface = ProjectionSurfaceCode.CaveLeft;
    }
    const distance = (wallX - observer.x) / dir.x;
    const worldZ = observer.z + dir.z * distance;
    const worldY = observer.y + dir.y * distance;
    const roofHeight = planarHallRoofHeightKernel(worldZ, boxSize, profile);
    if (
      distance > KERNEL_EPSILON &&
      distance < bestDistance &&
      worldZ >= -halfWidth - SURFACE_TOLERANCE &&
      worldZ <= halfWidth + SURFACE_TOLERANCE &&
      worldY >= -SURFACE_TOLERANCE &&
      worldY <= roofHeight + SURFACE_TOLERANCE
    ) {
      bestPoint = d.vec3f(dir.x * distance, dir.y * distance, dir.z * distance);
      bestSurface = wallSurface;
    }
  }

  return d.vec4f(bestPoint.x, bestPoint.y, bestPoint.z, bestSurface);
}

/** Returns eye-relative surface point xyz and a ProjectionSurfaceCode in w. */
export function doubleGableCarrierUvToSurfaceKernel(
  uv: d.v2f,
  boxSize: d.v3f,
  observer: d.v3f,
  profile: PlanarRoofProfileKernel,
  roofBand: number,
  horizonBand: number,
  horizonHeight: number,
): d.v4f {
  "use gpu";
  if (uv.x < -KERNEL_EPSILON || uv.x > 1 + KERNEL_EPSILON || uv.y < -KERNEL_EPSILON || uv.y > 1 + KERNEL_EPSILON) {
    return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
  }
  const aspect = boxSize.x / std.max(boxSize.y, KERNEL_EPSILON);
  const carrierPoint = caveCarrierPointFromUvKernel(uv, aspect);
  const rho = carrierPoint.x;
  const perimeterFraction = carrierPoint.y;
  const wallBase = caveWallEyePointFromFractionKernel(perimeterFraction, boxSize, observer);
  if (rho <= roofBand + KERNEL_EPSILON) {
    const capPoint = squareShellCapPointKernel(rho, roofBand, wallBase);
    const roofHeight = planarHallRoofHeightKernel(observer.z + capPoint.y, boxSize, profile);
    return d.vec4f(capPoint.x, roofHeight - observer.y, capPoint.y, ProjectionSurfaceCode.GabledRoof);
  }

  const roofHeight = planarHallRoofHeightKernel(observer.z + wallBase.z, boxSize, profile);
  const physicalHorizon = horizonHeight / std.max(roofHeight, KERNEL_EPSILON);
  const wallT = squareShellCarrierWallToPhysicalKernel(rho, roofBand, horizonBand, physicalHorizon, true);
  const y = -observer.y + roofHeight * wallT;
  return d.vec4f(wallBase.x, y, wallBase.z, caveWallSurfaceCodeKernel(perimeterFraction, boxSize));
}

/** Returns u, v, valid and surface code. */
export function doubleGableSurfaceToCarrierUvKernel(
  point: d.v3f,
  surface: number,
  boxSize: d.v3f,
  observer: d.v3f,
  profile: PlanarRoofProfileKernel,
  roofBand: number,
  horizonBand: number,
  horizonHeight: number,
): d.v4f {
  "use gpu";
  const aspect = boxSize.x / std.max(boxSize.y, KERNEL_EPSILON);
  // TypeGPU requires WGSL-resolved locals to have explicit initializers.
  // eslint-disable-next-line no-useless-assignment
  let rho = d.f32(0);
  // eslint-disable-next-line no-useless-assignment
  let perimeterFraction = d.f32(0.125);
  if (surface === ProjectionSurfaceCode.GabledRoof) {
    const carrierPoint = squareShellCarrierPointFromCapKernel(d.vec2f(point.x, point.z), boxSize, observer, roofBand);
    rho = carrierPoint.x;
    perimeterFraction = carrierPoint.y;
  } else {
    perimeterFraction = caveWallFractionFromEyePointKernel(point, boxSize, observer);
    const roofHeight = planarHallRoofHeightKernel(observer.z + point.z, boxSize, profile);
    const wallT = std.clamp((point.y + observer.y) / std.max(roofHeight, KERNEL_EPSILON), 0, 1);
    const physicalHorizon = horizonHeight / std.max(roofHeight, KERNEL_EPSILON);
    rho = squareShellPhysicalWallToCarrierKernel(wallT, roofBand, horizonBand, physicalHorizon, true);
  }
  const uv = caveUvFromCarrierPointKernel(rho, perimeterFraction, aspect);
  return d.vec4f(uv.x, uv.y, 1, surface);
}

/** Returns direction xyz and validity in w. */
export function doubleGableCarrierUvToDirectionKernel(
  uv: d.v2f,
  boxSize: d.v3f,
  observer: d.v3f,
  profile: PlanarRoofProfileKernel,
  roofBand: number,
  horizonBand: number,
  horizonHeight: number,
): d.v4f {
  "use gpu";
  const point = doubleGableCarrierUvToSurfaceKernel(
    uv,
    boxSize,
    observer,
    profile,
    roofBand,
    horizonBand,
    horizonHeight,
  );
  if (point.w < 0.5) return d.vec4f(0, 0, 0, 0);
  const direction = safeNormalize3(point.xyz);
  return d.vec4f(direction.x, direction.y, direction.z, 1);
}

/** Returns u, v, validity and surface code. */
export function directionToDoubleGableCarrierUvKernel(
  direction: d.v3f,
  boxSize: d.v3f,
  observer: d.v3f,
  profile: PlanarRoofProfileKernel,
  roofBand: number,
  horizonBand: number,
  horizonHeight: number,
): d.v4f {
  "use gpu";
  const point = doubleGableSurfaceFromDirectionKernel(direction, boxSize, observer, profile);
  if (point.w < 0.5) return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
  return doubleGableSurfaceToCarrierUvKernel(
    point.xyz,
    point.w,
    boxSize,
    observer,
    profile,
    roofBand,
    horizonBand,
    horizonHeight,
  );
}
