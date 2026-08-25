import { d } from "typegpu";
import * as std from "typegpu/std";
import { safeNormalize3 } from "../math.js";

export function rotateXKernel(value: d.v3f, angle: number): d.v3f {
  "use gpu";
  const cosine = std.cos(angle);
  const sine = std.sin(angle);
  return d.vec3f(value.x, value.y * cosine - value.z * sine, value.y * sine + value.z * cosine);
}

export function sourceDirectionFromPhysicalKernel(
  physicalDirection: d.v3f,
  sourceRotationRadians: number,
  domeTiltRadians: number,
  mirror: number,
): d.v3f {
  "use gpu";
  const tilted = rotateXKernel(safeNormalize3(physicalDirection), domeTiltRadians);
  const theta = std.acos(std.clamp(tilted.y, -1, 1));
  const sinTheta = std.sin(theta);
  let azimuth = std.atan2(tilted.x, tilted.z);
  if (mirror > 0.5) azimuth = -azimuth;
  azimuth += sourceRotationRadians;
  return safeNormalize3(d.vec3f(sinTheta * std.sin(azimuth), std.cos(theta), sinTheta * std.cos(azimuth)));
}

export function physicalDirectionFromSourceKernel(
  sourceDirection: d.v3f,
  sourceRotationRadians: number,
  domeTiltRadians: number,
  mirror: number,
): d.v3f {
  "use gpu";
  const source = safeNormalize3(sourceDirection);
  const theta = std.acos(std.clamp(source.y, -1, 1));
  const sinTheta = std.sin(theta);
  let azimuth = std.atan2(source.x, source.z) - sourceRotationRadians;
  if (mirror > 0.5) azimuth = -azimuth;
  const tilted = d.vec3f(sinTheta * std.sin(azimuth), std.cos(theta), sinTheta * std.cos(azimuth));
  return safeNormalize3(rotateXKernel(tilted, -domeTiltRadians));
}
