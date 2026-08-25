import { d } from "typegpu";
import * as std from "typegpu/std";
import { KERNEL_EPSILON } from "../projection/constants.js";

export function guideFieldSmoothAmountKernel(value: number, start: number, end: number): number {
  "use gpu";
  const amount = std.clamp((value - start) / std.max(end - start, KERNEL_EPSILON), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

/**
 * Continuous four-stop guide field. The two authored carrier anchors are
 * color stops, not hard region selectors; endpoints keep the field defined
 * over the complete carrier.
 */
export function guideFieldColorKernel(
  value: number,
  firstAnchor: number,
  secondAnchor: number,
  startColor: d.v3f,
  firstColor: d.v3f,
  secondColor: d.v3f,
  endColor: d.v3f,
): d.v3f {
  "use gpu";
  const first = std.clamp(firstAnchor, KERNEL_EPSILON, 1 - KERNEL_EPSILON * 2);
  const second = std.clamp(secondAnchor, first + KERNEL_EPSILON, 1 - KERNEL_EPSILON);
  const coordinate = std.clamp(value, 0, 1);
  if (coordinate <= first) {
    return std.mix(startColor, firstColor, guideFieldSmoothAmountKernel(coordinate, d.f32(0), first));
  }
  if (coordinate <= second) {
    return std.mix(firstColor, secondColor, guideFieldSmoothAmountKernel(coordinate, first, second));
  }
  return std.mix(secondColor, endColor, guideFieldSmoothAmountKernel(coordinate, second, d.f32(1)));
}

/** Periodic, seam-continuous azimuth signal used as a tint rather than spokes. */
export function guideFieldAzimuthKernel(x: number, y: number): number {
  "use gpu";
  const angle = std.atan2(x, y);
  return 0.5 + std.sin(angle) * 0.5;
}

/**
 * Continuous profiled-hall field. The roof color is evaluated from physical
 * H(z) by the caller and becomes the shared roof/wall anchor color. Wall-only
 * azimuth tint fades in after that anchor so it cannot draw a false seam.
 */
export function profiledHallGuideFieldColorKernel(
  carrierRadius: number,
  roofAnchor: number,
  horizonAnchor: number,
  roofColor: d.v3f,
  lowerWallColor: d.v3f,
  lowerBoundaryColor: d.v3f,
  azimuthTint: number,
): d.v3f {
  "use gpu";
  const roof = std.clamp(roofAnchor, KERNEL_EPSILON, 1 - KERNEL_EPSILON * 2);
  const horizon = std.clamp(horizonAnchor, roof + KERNEL_EPSILON, 1 - KERNEL_EPSILON);
  if (carrierRadius <= roof) return d.vec3f(roofColor.x, roofColor.y, roofColor.z);
  const wallField = guideFieldColorKernel(
    carrierRadius,
    roof,
    horizon,
    roofColor,
    roofColor,
    lowerWallColor,
    lowerBoundaryColor,
  );
  const tintAmount = guideFieldSmoothAmountKernel(carrierRadius, roof, horizon);
  const directionalWash = std.mix(d.vec3f(0.97, 1, 0.99), d.vec3f(1.02, 0.97, 1.01), azimuthTint);
  return std.clamp(std.mul(wallField, std.mix(d.vec3f(1), directionalWash, tintAmount)), d.vec3f(0), d.vec3f(1));
}
