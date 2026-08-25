import { describe, expect, test } from "vitest";
import { angularDistance } from "../projection.js";
import type { Vec3 } from "../projection.js";
import {
  PROJECTION_F32_ANGULAR_TOLERANCE,
  PROJECTION_F32_COMPONENT_TOLERANCE,
} from "../kernels/projection/constants.js";
import {
  createCylinderWallCarrierProfile,
  cylinderWallCarrierToPhysicalTraversal,
  cylinderWallPhysicalToCarrierTraversal,
  cylinderWallSurfacePointToUv,
  cylinderWallUvToDirection,
  cylinderWallUvToSurfacePoint,
  directionToCylinderWallUv,
} from "./cylinder-wall-carrier.js";

describe("unwrapped cylinder wall carrier", () => {
  test("maps the full rectangle to wall azimuth and height", () => {
    const profile = createCylinderWallCarrierProfile();
    expectVectorClose(cylinderWallUvToSurfacePoint(0.5, 0.5, profile), [0, 0, 2]);
    expectVectorClose(cylinderWallUvToSurfacePoint(0.75, 0, profile), [2, 2, 0]);
    expectVectorClose(cylinderWallUvToSurfacePoint(0.25, 1, profile), [-2, -2, 0]);
  });

  test("identifies the left and right carrier edges as one physical seam", () => {
    const profile = createCylinderWallCarrierProfile();
    const left = cylinderWallUvToSurfacePoint(0, 0.37, profile);
    const right = cylinderWallUvToSurfacePoint(1, 0.37, profile);
    expectVectorClose(left, right!);
    expect(left?.[2]).toBeCloseTo(-2, 8);
  });

  test("round-trips represented wall points and directions", () => {
    const profile = createCylinderWallCarrierProfile({
      room: { radius: 3.2, height: 5.5, eyeHeight: 1.7 },
      horizonBand: 0.62,
    });
    for (const uv of [
      [0, 0.1],
      [0.17, 0.72],
      [0.5, 0.38],
      [0.83, 0.94],
      [1, 0.55],
    ] as const) {
      const point = cylinderWallUvToSurfacePoint(uv[0], uv[1], profile);
      const mapped = cylinderWallSurfacePointToUv(point!, profile);
      expect(mapped).not.toBeNull();
      const pointRoundTrip = cylinderWallUvToSurfacePoint(mapped!.u, mapped!.v, profile);
      expectVectorClose(pointRoundTrip, point!);

      const direction = cylinderWallUvToDirection(uv[0], uv[1], profile);
      const directionUv = directionToCylinderWallUv(direction!, profile);
      expect(directionUv).not.toBeNull();
      const directionRoundTrip = cylinderWallUvToDirection(directionUv!.u, directionUv!.v, profile);
      expect(angularDistance(direction!, directionRoundTrip!)).toBeLessThan(PROJECTION_F32_ANGULAR_TOLERANCE);
    }
  });

  test("keeps physical eye level fixed while reallocating carrier rows", () => {
    const compactLower = createCylinderWallCarrierProfile({ horizonBand: 0.35 });
    const expandedLower = createCylinderWallCarrierProfile({ horizonBand: 0.7 });
    expect(cylinderWallCarrierToPhysicalTraversal(0.35, compactLower)).toBeCloseTo(0.5, 8);
    expect(cylinderWallCarrierToPhysicalTraversal(0.7, expandedLower)).toBeCloseTo(0.5, 8);
    expect(cylinderWallPhysicalToCarrierTraversal(0.5, compactLower)).toBeCloseTo(0.35, 8);
    expect(cylinderWallPhysicalToCarrierTraversal(0.5, expandedLower)).toBeCloseTo(0.7, 8);
  });

  test("rejects the axis and directions that miss the bounded wall", () => {
    const profile = createCylinderWallCarrierProfile();
    expect(directionToCylinderWallUv([0, 1, 0], profile)).toBeNull();
    expect(directionToCylinderWallUv([0, -1, 0], profile)).toBeNull();
    expect(directionToCylinderWallUv([0, 0.95, 0.1], profile)).toBeNull();
  });
});

function expectVectorClose(actual: Vec3 | null, expected: Vec3): void {
  expect(actual).not.toBeNull();
  for (let index = 0; index < 3; index += 1) {
    expect(Math.abs(actual![index] - expected[index])).toBeLessThanOrEqual(PROJECTION_F32_COMPONENT_TOLERANCE);
  }
}
