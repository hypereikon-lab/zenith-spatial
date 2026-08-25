import { d } from "typegpu";
import type { Vec3 } from "../projection.js";
import {
  physicalDirectionFromSourceKernel,
  sourceDirectionFromPhysicalKernel,
} from "../kernels/projection/orientation.js";

export type SourceOrientationTransform = {
  sourceRotationRadians: number;
  domeTiltRadians: number;
  mirror: boolean;
};

export function sourceDirectionFromPhysicalDirection(
  physicalDirection: Vec3,
  transform: SourceOrientationTransform,
): Vec3 {
  const result = sourceDirectionFromPhysicalKernel(
    d.vec3f(physicalDirection[0], physicalDirection[1], physicalDirection[2]),
    transform.sourceRotationRadians,
    transform.domeTiltRadians,
    transform.mirror ? 1 : 0,
  );
  return [result.x, result.y, result.z];
}

export function physicalDirectionFromSourceDirection(
  sourceDirection: Vec3,
  transform: SourceOrientationTransform,
): Vec3 {
  const result = physicalDirectionFromSourceKernel(
    d.vec3f(sourceDirection[0], sourceDirection[1], sourceDirection[2]),
    transform.sourceRotationRadians,
    transform.domeTiltRadians,
    transform.mirror ? 1 : 0,
  );
  return [result.x, result.y, result.z];
}
