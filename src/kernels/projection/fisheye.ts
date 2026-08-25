import { d } from "typegpu";
import * as std from "typegpu/std";
import { safeNormalize3 } from "../math.js";
import { KERNEL_EPSILON, ProjectionSurfaceCode } from "./constants.js";

/** Returns u, v, valid, surface. */
export function directionToFisheyeUvKernel(
  direction: d.v3f,
  centerAxis: d.v3f,
  imageRightAxis: d.v3f,
  imageUpAxis: d.v3f,
  fisheyeScale: d.v2f,
  halfAngle: number,
): d.v4f {
  "use gpu";
  const source = safeNormalize3(direction);
  const centerDot = std.clamp(std.dot(source, centerAxis), -1, 1);
  const theta = std.acos(centerDot);
  if (theta > halfAngle + KERNEL_EPSILON) return d.vec4f(0, 0, 0, ProjectionSurfaceCode.Invalid);
  if (theta <= KERNEL_EPSILON) return d.vec4f(0.5, 0.5, 1, ProjectionSurfaceCode.Angular);

  const tangent = safeNormalize3(std.sub(source, std.mul(centerAxis, centerDot)));
  const localX = std.dot(tangent, imageRightAxis);
  const localY = std.dot(tangent, imageUpAxis);
  const radial = std.clamp(theta / std.max(halfAngle, KERNEL_EPSILON), 0, 1);
  return d.vec4f(
    0.5 + localX * fisheyeScale.x * radial,
    0.5 - localY * fisheyeScale.y * radial,
    1,
    ProjectionSurfaceCode.Angular,
  );
}

/** Returns direction.xyz and validity in w. */
export function fisheyeUvToDirectionKernel(
  uv: d.v2f,
  centerAxis: d.v3f,
  imageRightAxis: d.v3f,
  imageUpAxis: d.v3f,
  fisheyeScale: d.v2f,
  halfAngle: number,
): d.v4f {
  "use gpu";
  const normalizedX = (uv.x - 0.5) / std.max(KERNEL_EPSILON, fisheyeScale.x);
  const normalizedY = (0.5 - uv.y) / std.max(KERNEL_EPSILON, fisheyeScale.y);
  const radial = std.length(d.vec2f(normalizedX, normalizedY));
  if (radial > 1 + KERNEL_EPSILON) return d.vec4f(0, 0, 0, 0);
  if (radial <= KERNEL_EPSILON) return d.vec4f(centerAxis.x, centerAxis.y, centerAxis.z, 1);

  const theta = std.clamp(radial, 0, 1) * halfAngle;
  const localX = normalizedX / radial;
  const localY = normalizedY / radial;
  const tangent = safeNormalize3(std.add(std.mul(imageRightAxis, localX), std.mul(imageUpAxis, localY)));
  const direction = safeNormalize3(std.add(std.mul(centerAxis, std.cos(theta)), std.mul(tangent, std.sin(theta))));
  return d.vec4f(direction.x, direction.y, direction.z, 1);
}
