import { d } from "typegpu";
import * as std from "typegpu/std";
import { KERNEL_EPSILON } from "./projection/constants.js";

export function safeNormalize3(value: d.v3f): d.v3f {
  "use gpu";
  const magnitude = std.length(value);
  if (magnitude <= KERNEL_EPSILON) return d.vec3f(0, 0, 0);
  return std.div(value, magnitude);
}

export function wrappedUnit(value: number): number {
  "use gpu";
  return value - std.floor(value);
}

export function piecewiseMap4(
  value: number,
  from0: number,
  from1: number,
  from2: number,
  from3: number,
  to0: number,
  to1: number,
  to2: number,
  to3: number,
): number {
  "use gpu";
  const source = std.clamp(value, from0, from3);
  if (source <= from1 + KERNEL_EPSILON) {
    const amount = (source - from0) / std.max(from1 - from0, KERNEL_EPSILON);
    return std.clamp(to0 + amount * (to1 - to0), to0, to3);
  }
  if (source <= from2 + KERNEL_EPSILON) {
    const amount = (source - from1) / std.max(from2 - from1, KERNEL_EPSILON);
    return std.clamp(to1 + amount * (to2 - to1), to0, to3);
  }
  const amount = (source - from2) / std.max(from3 - from2, KERNEL_EPSILON);
  return std.clamp(to2 + amount * (to3 - to2), to0, to3);
}
