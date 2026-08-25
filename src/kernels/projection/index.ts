import { d } from "typegpu";
import * as std from "typegpu/std";
import type { PlanarRoofProfileKernel } from "../schemas.js";
import { piecewiseMap4 } from "../math.js";
import { directionToCaveCarrierUvKernel, caveCarrierUvToDirectionKernel } from "./cave.js";
import {
  cylinderRadialUvToDirectionKernel,
  cylinderWallUvToDirectionKernel,
  directionToCylinderRadialUvKernel,
  directionToCylinderWallUvKernel,
} from "./cylinder.js";
import { directionToFisheyeUvKernel, fisheyeUvToDirectionKernel } from "./fisheye.js";
import { directionToDoubleGableCarrierUvKernel, doubleGableCarrierUvToDirectionKernel } from "./double-gable.js";
import {
  KERNEL_EPSILON,
  ProjectionKernelFlag,
  ProjectionModeCode,
  ProjectionSurfaceCode,
  ProjectionTopologyCode,
} from "./constants.js";

/** Returns direction.xyz and validity in w. */
export function sourceUvToDirectionKernel(
  uv: d.v2f,
  mode: number,
  topology: number,
  flags: number,
  fisheyeScale: d.v2f,
  halfAngle: number,
  innerSplit: number,
  horizonSplit: number,
  physicalSemantic: number,
  physicalHorizon: number,
  centerAxis: d.v3f,
  imageRightAxis: d.v3f,
  imageUpAxis: d.v3f,
  boxSize: d.v3f,
  boxObserver: d.v3f,
  roofProfile: PlanarRoofProfileKernel,
  doubleGable: d.v4f,
  cylinder: d.v3f,
): d.v4f {
  "use gpu";
  if (topology === ProjectionTopologyCode.CavePerimeter) {
    return caveCarrierUvToDirectionKernel(uv, boxSize, boxObserver, innerSplit, horizonSplit, physicalHorizon);
  }
  if (topology === ProjectionTopologyCode.GabledShell) {
    return doubleGableCarrierUvToDirectionKernel(
      uv,
      boxSize,
      boxObserver,
      roofProfile,
      innerSplit,
      horizonSplit,
      physicalHorizon,
    );
  }
  if (topology === ProjectionTopologyCode.CylinderRadial) {
    return cylinderRadialUvToDirectionKernel(uv, mode, cylinder, innerSplit, horizonSplit, physicalHorizon);
  }
  if (topology === ProjectionTopologyCode.CylinderWall) {
    return cylinderWallUvToDirectionKernel(uv, cylinder, innerSplit, physicalHorizon);
  }
  if ((flags & ProjectionKernelFlag.RadialRemap) === 0) {
    return fisheyeUvToDirectionKernel(uv, centerAxis, imageRightAxis, imageUpAxis, fisheyeScale, halfAngle);
  }
  const normalizedX = (uv.x - 0.5) / std.max(fisheyeScale.x, KERNEL_EPSILON);
  const normalizedY = (0.5 - uv.y) / std.max(fisheyeScale.y, KERNEL_EPSILON);
  const carrierRadius = std.length(d.vec2f(normalizedX, normalizedY));
  if (carrierRadius > 1 + KERNEL_EPSILON) return d.vec4f(0, 0, 0, 0);
  if (carrierRadius <= KERNEL_EPSILON) return d.vec4f(centerAxis.x, centerAxis.y, centerAxis.z, 1);
  const physicalRadius = piecewiseMap4(
    carrierRadius,
    d.f32(0),
    innerSplit,
    horizonSplit,
    d.f32(1),
    d.f32(0),
    physicalSemantic,
    physicalHorizon,
    d.f32(1),
  );
  return fisheyeUvToDirectionKernel(
    d.vec2f(
      0.5 + (normalizedX / carrierRadius) * fisheyeScale.x * physicalRadius,
      0.5 - (normalizedY / carrierRadius) * fisheyeScale.y * physicalRadius,
    ),
    centerAxis,
    imageRightAxis,
    imageUpAxis,
    fisheyeScale,
    halfAngle,
  );
}

/** Returns u, v, valid, surface. */
export function sourceDirectionToUvKernel(
  direction: d.v3f,
  mode: number,
  topology: number,
  flags: number,
  fisheyeScale: d.v2f,
  halfAngle: number,
  innerSplit: number,
  horizonSplit: number,
  physicalSemantic: number,
  physicalHorizon: number,
  centerAxis: d.v3f,
  imageRightAxis: d.v3f,
  imageUpAxis: d.v3f,
  boxSize: d.v3f,
  boxObserver: d.v3f,
  roofProfile: PlanarRoofProfileKernel,
  doubleGable: d.v4f,
  cylinder: d.v3f,
): d.v4f {
  "use gpu";
  if (topology === ProjectionTopologyCode.CavePerimeter) {
    return directionToCaveCarrierUvKernel(direction, boxSize, boxObserver, innerSplit, horizonSplit, physicalHorizon);
  }
  if (topology === ProjectionTopologyCode.GabledShell) {
    return directionToDoubleGableCarrierUvKernel(
      direction,
      boxSize,
      boxObserver,
      roofProfile,
      innerSplit,
      horizonSplit,
      physicalHorizon,
    );
  }
  if (topology === ProjectionTopologyCode.CylinderRadial) {
    return directionToCylinderRadialUvKernel(direction, mode, cylinder, innerSplit, horizonSplit, physicalHorizon);
  }
  if (topology === ProjectionTopologyCode.CylinderWall) {
    return directionToCylinderWallUvKernel(direction, cylinder, innerSplit, physicalHorizon);
  }
  const uv = directionToFisheyeUvKernel(direction, centerAxis, imageRightAxis, imageUpAxis, fisheyeScale, halfAngle);
  if (uv.z < 0.5 || (flags & ProjectionKernelFlag.RadialRemap) === 0) return uv;

  const normalizedX = (uv.x - 0.5) / std.max(fisheyeScale.x, KERNEL_EPSILON);
  const normalizedY = (0.5 - uv.y) / std.max(fisheyeScale.y, KERNEL_EPSILON);
  const physicalRadius = std.length(d.vec2f(normalizedX, normalizedY));
  if (physicalRadius <= KERNEL_EPSILON) return uv;
  const carrierRadius = piecewiseMap4(
    physicalRadius,
    d.f32(0),
    physicalSemantic,
    physicalHorizon,
    d.f32(1),
    d.f32(0),
    innerSplit,
    horizonSplit,
    d.f32(1),
  );
  return d.vec4f(
    0.5 + (normalizedX / physicalRadius) * fisheyeScale.x * carrierRadius,
    0.5 - (normalizedY / physicalRadius) * fisheyeScale.y * carrierRadius,
    1,
    ProjectionSurfaceCode.Angular,
  );
}

export function sourceProjectionModeIsNadirKernel(mode: number): boolean {
  "use gpu";
  return mode === ProjectionModeCode.Nadir180 || mode === ProjectionModeCode.CylinderNadir;
}
