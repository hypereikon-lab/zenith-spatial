import tgpu, { d } from "typegpu";
import { describe, expect, test } from "vitest";
import { ProjectionTopologyCode } from "../projection/constants.js";
import { guideCarrierCoordinateKernel } from "./carrier.js";

describe("portable TypeGPU guide carrier kernel", () => {
  test("executes fisheye, square-perimeter, radial-cylinder, and wall coordinates on the CPU", () => {
    const fisheye = guideCarrierCoordinateKernel(d.vec2f(0.75, 0.5), ProjectionTopologyCode.Fisheye, d.vec2f(0.5, 0.5));
    expectVector(fisheye, [0.5, 0, 0.5, 1]);

    const cave = guideCarrierCoordinateKernel(d.vec2f(0.9, 0.7), ProjectionTopologyCode.CavePerimeter, d.vec2f(0.5));
    expectVector(cave, [0.8, -0.4, 0.8, 1]);

    const radial = guideCarrierCoordinateKernel(d.vec2f(1, 1), ProjectionTopologyCode.CylinderRadial, d.vec2f(0.5));
    expect(radial.z).toBeCloseTo(Math.SQRT2, 6);
    expect(radial.w).toBe(0);

    const wall = guideCarrierCoordinateKernel(d.vec2f(0.25, 0.8), ProjectionTopologyCode.CylinderWall, d.vec2f(0.5));
    expectVector(wall, [-0.5, -0.6, 0.2, 1]);
  });

  test("resolves the topology dispatch to WGSL without integerized float state", () => {
    const probe = () => {
      "use gpu";
      return guideCarrierCoordinateKernel(d.vec2f(0.5), ProjectionTopologyCode.Fisheye, d.vec2f(0.5));
    };
    const wgsl = tgpu.resolve([probe]);
    expect(wgsl).toContain("fn guideCarrierCoordinateKernel");
    expect(wgsl).not.toMatch(/var valid = 0i/);
    expect(wgsl).not.toContain("valid = i32");
  });
});

function expectVector(actual: { x: number; y: number; z: number; w: number }, expected: readonly number[]): void {
  expect(actual.x).toBeCloseTo(expected[0], 6);
  expect(actual.y).toBeCloseTo(expected[1], 6);
  expect(actual.z).toBeCloseTo(expected[2], 6);
  expect(actual.w).toBeCloseTo(expected[3], 6);
}
