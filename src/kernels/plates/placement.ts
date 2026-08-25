import { d } from "typegpu";
import * as std from "typegpu/std";
import { safeNormalize3 } from "../math.js";
import { KERNEL_EPSILON } from "../projection/constants.js";

const PI = Math.PI;
const WARP_DETERMINANT_EPSILON = 0.0000001;
const WARP_RESIDUAL_LIMIT = 0.004;

export const PlateCornerCode = {
  NorthWest: 0,
  NorthEast: 1,
  SouthEast: 2,
  SouthWest: 3,
} as const;

export const PlateFitCode = {
  Contain: 0,
  Cover: 1,
  Stretch: 2,
} as const;

export function plateCornerBaseLocalKernel(corner: number, angularSize: d.v2f): d.v2f {
  "use gpu";
  let x = -angularSize.x * 0.5;
  let y = -angularSize.y * 0.5;
  if (corner === PlateCornerCode.NorthEast || corner === PlateCornerCode.SouthEast) x = angularSize.x * 0.5;
  if (corner === PlateCornerCode.SouthEast || corner === PlateCornerCode.SouthWest) y = angularSize.y * 0.5;
  return d.vec2f(x, y);
}

export function plateCornerLocalKernel(corner: number, angularSize: d.v2f, warpNorth: d.v4f, warpSouth: d.v4f): d.v2f {
  "use gpu";
  const base = plateCornerBaseLocalKernel(corner, angularSize);
  let offset = d.vec2f(warpNorth.x, warpNorth.y);
  if (corner === PlateCornerCode.NorthEast) offset = d.vec2f(warpNorth.z, warpNorth.w);
  if (corner === PlateCornerCode.SouthEast) offset = d.vec2f(warpSouth.z, warpSouth.w);
  if (corner === PlateCornerCode.SouthWest) offset = d.vec2f(warpSouth.x, warpSouth.y);
  return d.vec2f(base.x + offset.x * angularSize.x, base.y + offset.y * angularSize.y);
}

export function plateWarpedUvToLocalKernel(uv: d.v2f, angularSize: d.v2f, warpNorth: d.v4f, warpSouth: d.v4f): d.v2f {
  "use gpu";
  const nw = plateCornerLocalKernel(PlateCornerCode.NorthWest, angularSize, warpNorth, warpSouth);
  const ne = plateCornerLocalKernel(PlateCornerCode.NorthEast, angularSize, warpNorth, warpSouth);
  const se = plateCornerLocalKernel(PlateCornerCode.SouthEast, angularSize, warpNorth, warpSouth);
  const sw = plateCornerLocalKernel(PlateCornerCode.SouthWest, angularSize, warpNorth, warpSouth);
  const top = lerp2(nw, ne, uv.x);
  const bottom = lerp2(sw, se, uv.x);
  return lerp2(top, bottom, uv.y);
}

/** Returns u, v, validity, and residual. */
export function plateLocalToWarpedUvKernel(
  local: d.v2f,
  angularSize: d.v2f,
  warpNorth: d.v4f,
  warpSouth: d.v4f,
): d.v4f {
  "use gpu";
  let uv = d.vec2f(
    local.x / std.max(angularSize.x, KERNEL_EPSILON) + 0.5,
    local.y / std.max(angularSize.y, KERNEL_EPSILON) + 0.5,
  );
  const nw = plateCornerLocalKernel(PlateCornerCode.NorthWest, angularSize, warpNorth, warpSouth);
  const ne = plateCornerLocalKernel(PlateCornerCode.NorthEast, angularSize, warpNorth, warpSouth);
  const se = plateCornerLocalKernel(PlateCornerCode.SouthEast, angularSize, warpNorth, warpSouth);
  const sw = plateCornerLocalKernel(PlateCornerCode.SouthWest, angularSize, warpNorth, warpSouth);

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const top = lerp2(nw, ne, uv.x);
    const bottom = lerp2(sw, se, uv.x);
    const point = lerp2(top, bottom, uv.y);
    const du = lerp2(std.sub(ne, nw), std.sub(se, sw), uv.y);
    const dv = lerp2(std.sub(sw, nw), std.sub(se, ne), uv.x);
    const error = std.sub(point, local);
    const determinant = du.x * dv.y - du.y * dv.x;
    if (std.abs(determinant) < WARP_DETERMINANT_EPSILON) return d.vec4f(uv.x, uv.y, 0, 1e30);
    const step = d.vec2f(
      (error.x * dv.y - error.y * dv.x) / determinant,
      (-error.x * du.y + error.y * du.x) / determinant,
    );
    uv = std.sub(uv, step);
    if (std.length(step) < KERNEL_EPSILON) break;
  }

  const projected = plateWarpedUvToLocalKernel(uv, angularSize, warpNorth, warpSouth);
  const residual = std.length(std.sub(projected, local));
  let valid = d.f32(0);
  if (residual <= WARP_RESIDUAL_LIMIT) valid = 1;
  return d.vec4f(uv.x, uv.y, valid, residual);
}

export function directionFromPlateUvKernel(
  uv: d.v2f,
  center: d.v3f,
  right: d.v3f,
  down: d.v3f,
  angularSize: d.v2f,
  spin: d.v2f,
  warpNorth: d.v4f,
  warpSouth: d.v4f,
): d.v3f {
  "use gpu";
  const local = plateWarpedUvToLocalKernel(uv, angularSize, warpNorth, warpSouth);
  const mapX = local.x * spin.y - local.y * spin.x;
  const mapY = local.x * spin.x + local.y * spin.y;
  const angle = std.length(d.vec2f(mapX, mapY));
  if (angle <= KERNEL_EPSILON) return center;
  const tangent = safeNormalize3(std.add(std.mul(right, mapX), std.mul(down, mapY)));
  return safeNormalize3(std.add(std.mul(center, std.cos(angle)), std.mul(tangent, std.sin(angle))));
}

/** Returns local x, local y, and validity. */
export function directionToPlateLocalKernel(
  direction: d.v3f,
  center: d.v3f,
  right: d.v3f,
  down: d.v3f,
  spin: d.v2f,
): d.v3f {
  "use gpu";
  const cosine = std.clamp(std.dot(direction, center), -1, 1);
  const angle = std.acos(cosine);
  if (angle > PI - 0.0001) return d.vec3f(0, 0, 0);
  let map = d.vec2f(0, 0);
  if (angle > KERNEL_EPSILON) {
    const scale = angle / std.max(std.sin(angle), KERNEL_EPSILON);
    map = d.vec2f(std.dot(direction, right) * scale, std.dot(direction, down) * scale);
  }
  return d.vec3f(map.x * spin.y + map.y * spin.x, -map.x * spin.x + map.y * spin.y, 1);
}

/** Returns fitted u, fitted v, and validity. */
export function plateFitUvKernel(
  rawUv: d.v2f,
  sourceAspect: number,
  angularSize: d.v2f,
  fit: number,
  flipX: number,
  flipY: number,
): d.v3f {
  "use gpu";
  const imageAspect = std.max(sourceAspect, KERNEL_EPSILON);
  const domainAspect = std.max(angularSize.x / std.max(angularSize.y, KERNEL_EPSILON), KERNEL_EPSILON);
  let u = rawUv.x;
  let v = rawUv.y;

  if (fit === PlateFitCode.Contain) {
    if (imageAspect > domainAspect) {
      const fittedHeight = domainAspect / imageAspect;
      v = (rawUv.y - (1 - fittedHeight) * 0.5) / std.max(fittedHeight, KERNEL_EPSILON);
    } else {
      const fittedWidth = imageAspect / domainAspect;
      u = (rawUv.x - (1 - fittedWidth) * 0.5) / std.max(fittedWidth, KERNEL_EPSILON);
    }
  } else if (fit === PlateFitCode.Cover) {
    if (imageAspect > domainAspect) {
      const cropWidth = domainAspect / imageAspect;
      u = rawUv.x * cropWidth + (1 - cropWidth) * 0.5;
    } else {
      const cropHeight = imageAspect / domainAspect;
      v = rawUv.y * cropHeight + (1 - cropHeight) * 0.5;
    }
    u = std.clamp(u, 0, 1);
    v = std.clamp(v, 0, 1);
  }

  if (flipX !== 0) u = 1 - u;
  if (flipY !== 0) v = 1 - v;
  let valid = d.f32(0);
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) valid = 1;
  return d.vec3f(u, v, valid);
}

export function plateEdgeFadeKernel(rawUv: d.v2f, feather: number): number {
  "use gpu";
  if (feather <= 0) return 1;
  const edge = std.min(std.min(rawUv.x, 1 - rawUv.x), std.min(rawUv.y, 1 - rawUv.y));
  return std.clamp(edge / feather, 0, 1);
}

/** Returns fitted u, fitted v, validity, and edge fade. */
export function plateSampleUvForDirectionKernel(
  direction: d.v3f,
  center: d.v3f,
  right: d.v3f,
  down: d.v3f,
  angularSize: d.v2f,
  spin: d.v2f,
  sourceAspect: number,
  fit: number,
  flipX: number,
  flipY: number,
  feather: number,
  warpNorth: d.v4f,
  warpSouth: d.v4f,
): d.v4f {
  "use gpu";
  const local = directionToPlateLocalKernel(direction, center, right, down, spin);
  if (local.z < 0.5) return d.vec4f(0, 0, 0, 0);
  const warped = plateLocalToWarpedUvKernel(local.xy, angularSize, warpNorth, warpSouth);
  if (warped.z < 0.5 || warped.x < 0 || warped.x > 1 || warped.y < 0 || warped.y > 1) return d.vec4f(0, 0, 0, 0);
  const fitted = plateFitUvKernel(warped.xy, sourceAspect, angularSize, fit, flipX, flipY);
  if (fitted.z < 0.5) return d.vec4f(0, 0, 0, 0);
  return d.vec4f(fitted.x, fitted.y, 1, plateEdgeFadeKernel(warped.xy, feather));
}

function lerp2(start: d.v2f, end: d.v2f, amount: number): d.v2f {
  "use gpu";
  return std.add(start, std.mul(std.sub(end, start), amount));
}
