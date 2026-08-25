import { d } from "typegpu";
import * as std from "typegpu/std";
import { KERNEL_EPSILON, ProjectionTopologyCode } from "../projection/constants.js";

/**
 * Canonical guide-space coordinate for a carrier raster.
 *
 * x/y are the centered carrier coordinates, z is radial distance for radial
 * and perimeter carriers or bottom-to-top traversal for a wall unwrap, and w
 * is validity. The same function is CPU-callable for guide/mask inspection and
 * compiled into the handoff shader.
 */
export function guideCarrierCoordinateKernel(uv: d.v2f, topology: number, fisheyeScale: d.v2f): d.v4f {
  "use gpu";
  if (topology === ProjectionTopologyCode.CylinderWall) {
    let valid = d.f32(0);
    if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) valid = 1;
    return d.vec4f(uv.x * 2 - 1, 1 - uv.y * 2, 1 - uv.y, valid);
  }

  let local = d.vec2f((uv.x - 0.5) * 2, (0.5 - uv.y) * 2);
  if (topology === ProjectionTopologyCode.Fisheye) {
    local = d.vec2f(
      (uv.x - 0.5) / std.max(fisheyeScale.x, KERNEL_EPSILON),
      (0.5 - uv.y) / std.max(fisheyeScale.y, KERNEL_EPSILON),
    );
  }
  let radius = std.length(local);
  if (topology === ProjectionTopologyCode.CavePerimeter || topology === ProjectionTopologyCode.GabledShell) {
    radius = std.max(std.abs(local.x), std.abs(local.y));
  }
  let valid = d.f32(0);
  if (radius <= 1 + KERNEL_EPSILON) valid = 1;
  return d.vec4f(local.x, local.y, radius, valid);
}
