import tgpu, { d } from "typegpu";
import { describe, expect, test } from "vitest";
import {
  directionFromPlateUv,
  directionToPlateLocal,
  plateLocalToWarpedUv,
  plateUvToLocal,
  preparePlatePlacement,
} from "../../plates/plate-placement.js";
import {
  directionFromPlateUvKernel,
  directionToPlateLocalKernel,
  plateLocalToWarpedUvKernel,
  plateSampleUvForDirectionKernel,
  plateWarpedUvToLocalKernel,
} from "./placement.js";

describe("portable TypeGPU plate placement kernel", () => {
  test("matches authored CPU placement, spherical mapping, and warp inversion", () => {
    const placement = preparePlatePlacement(
      {
        azimuth: 67,
        radius: 0.54,
        scale: 0.88,
        spin: -23,
        cornerOffsets: {
          nw: { x: 0.08, y: -0.05 },
          ne: { x: -0.14, y: 0.1 },
          se: { x: 0.07, y: -0.03 },
          sw: { x: -0.04, y: 0.12 },
        },
      },
      { aspect: 1.35 },
    );
    const angularSize = d.vec2f(placement.angularWidth, placement.angularHeight);
    const spin = d.vec2f(placement.spinSin, placement.spinCos);
    const warpNorth = d.vec4f(
      placement.cornerOffsets.nw.x,
      placement.cornerOffsets.nw.y,
      placement.cornerOffsets.ne.x,
      placement.cornerOffsets.ne.y,
    );
    const warpSouth = d.vec4f(
      placement.cornerOffsets.sw.x,
      placement.cornerOffsets.sw.y,
      placement.cornerOffsets.se.x,
      placement.cornerOffsets.se.y,
    );
    const uv = d.vec2f(0.72, 0.28);

    const cpuLocal = plateUvToLocal(placement, uv.x, uv.y);
    const kernelLocal = plateWarpedUvToLocalKernel(uv, angularSize, warpNorth, warpSouth);
    expectVectorClose(kernelLocal, cpuLocal);

    const cpuDirection = directionFromPlateUv(placement, uv.x, uv.y);
    const kernelDirection = directionFromPlateUvKernel(
      uv,
      d.vec3f(...placement.center),
      d.vec3f(...placement.right),
      d.vec3f(...placement.down),
      angularSize,
      spin,
      warpNorth,
      warpSouth,
    );
    expectVectorClose(kernelDirection, { x: cpuDirection[0], y: cpuDirection[1], z: cpuDirection[2] });

    const cpuDirectionLocal = directionToPlateLocal(cpuDirection, placement);
    const kernelDirectionLocal = directionToPlateLocalKernel(
      kernelDirection,
      d.vec3f(...placement.center),
      d.vec3f(...placement.right),
      d.vec3f(...placement.down),
      spin,
    );
    expect(cpuDirectionLocal).not.toBeNull();
    expectVectorClose(kernelDirectionLocal, { ...cpuDirectionLocal!, z: 1 });

    const cpuInverse = plateLocalToWarpedUv(cpuLocal, placement);
    const kernelInverse = plateLocalToWarpedUvKernel(
      d.vec2f(cpuLocal.x, cpuLocal.y),
      angularSize,
      warpNorth,
      warpSouth,
    );
    expect(cpuInverse).not.toBeNull();
    expect(kernelInverse.z).toBe(1);
    expect(kernelInverse.x).toBeCloseTo(cpuInverse!.x, 6);
    expect(kernelInverse.y).toBeCloseTo(cpuInverse!.y, 6);
  });

  test("resolves the complete compositor mapping and dependencies to WGSL without integerized float state", () => {
    const probe = () => {
      "use gpu";
      return plateSampleUvForDirectionKernel(
        d.vec3f(0, 1, 0),
        d.vec3f(0, 1, 0),
        d.vec3f(1, 0, 0),
        d.vec3f(0, 0, 1),
        d.vec2f(0.7, 0.5),
        d.vec2f(0, 1),
        1.4,
        0,
        0,
        0,
        0.02,
        d.vec4f(0),
        d.vec4f(0),
      );
    };

    const wgsl = tgpu.resolve([probe]);
    expect(wgsl).toContain("fn plateSampleUvForDirectionKernel");
    expect(wgsl).toContain("fn plateLocalToWarpedUvKernel");
    expect(wgsl).toContain("fn plateFitUvKernel");
    expect(wgsl).not.toMatch(/var (u|v|valid) = 0i/);
    expect(wgsl).not.toMatch(/\b(u|v|valid) = i32\(/);
  });
});

function expectVectorClose(
  actual: { x: number; y: number; z?: number },
  expected: { x: number; y: number; z?: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  if (actual.z !== undefined && expected.z !== undefined) expect(actual.z).toBeCloseTo(expected.z, 6);
}
