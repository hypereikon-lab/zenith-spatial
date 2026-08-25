import { describe, expect, test } from "vitest";
import { angularDistance } from "../projection.js";
import {
  carrierWallRadiusToCylinderTraversal,
  createCylinderContinuityCarrierProfile,
  cylinderContinuitySurfacePointToUv,
  cylinderContinuityUvToDirection,
  cylinderContinuityUvToSurfacePoint,
  cylinderTraversalToCarrierWallRadius,
  directionToCylinderContinuityUv,
} from "./cylinder-continuity-carrier.js";
import type { Vec3 } from "../projection.js";
import {
  PROJECTION_F32_ANGULAR_TOLERANCE,
  PROJECTION_F32_COMPONENT_TOLERANCE,
} from "../kernels/projection/constants.js";

describe("cylinder continuity carrier", () => {
  test.each([["cylinder-nadir", -2, 2] as const, ["cylinder-zenith", 2, -2] as const])(
    "maps %s from a tiny axial cap through a complete continuous wall",
    (mode, capY, outerY) => {
      const profile = createCylinderContinuityCarrierProfile({ mode });
      expect(profile.capBand).toBeCloseTo(0.02, 8);
      expectVectorClose(cylinderContinuityUvToSurfacePoint(0.5, 0.5, profile), [0, capY, 0]);
      expectVectorClose(cylinderContinuityUvToSurfacePoint(0.5, 0.49, profile), [0, capY, 2]);
      expectVectorClose(cylinderContinuityUvToSurfacePoint(0.5, 0, profile), [0, outerY, 2]);
    },
  );

  test.each(["cylinder-nadir", "cylinder-zenith"] as const)("round-trips cap and wall points for %s", (mode) => {
    const profile = createCylinderContinuityCarrierProfile({ mode, capBand: 0.015, horizonBand: 0.57 });
    const capY = mode === "cylinder-nadir" ? -2 : 2;
    const points: Vec3[] = [
      [0, capY, 0],
      [1.2, capY, 0.8],
      [2, -1.2, 0],
      [0, 0, 2],
      [-2, 1.4, 0],
    ];
    for (const point of points) {
      const uv = cylinderContinuitySurfacePointToUv(point, profile);
      expect(uv).not.toBeNull();
      expectVectorClose(cylinderContinuityUvToSurfacePoint(uv!.u, uv!.v, profile), point);
    }
  });

  test.each(["cylinder-nadir", "cylinder-zenith"] as const)(
    "round-trips represented physical directions for %s",
    (mode) => {
      const profile = createCylinderContinuityCarrierProfile({ mode });
      for (const uv of [
        [0.5, 0.5],
        [0.5, 0.49],
        [0.5, 0.25],
        [0.75, 0.5],
        [0.5, 0.99],
      ] as const) {
        const direction = cylinderContinuityUvToDirection(uv[0], uv[1], profile);
        expect(direction).not.toBeNull();
        const roundTripUv = directionToCylinderContinuityUv(direction!, profile);
        expect(roundTripUv).not.toBeNull();
        const roundTrip = cylinderContinuityUvToDirection(roundTripUv!.u, roundTripUv!.v, profile);
        expect(angularDistance(direction!, roundTrip!)).toBeLessThan(PROJECTION_F32_ANGULAR_TOLERANCE);
      }
    },
  );

  test("pins the editable carrier horizon to physical eye level", () => {
    const profile = createCylinderContinuityCarrierProfile({
      mode: "cylinder-nadir",
      capBand: 0.02,
      horizonBand: 0.61,
    });
    expect(carrierWallRadiusToCylinderTraversal(0.61, profile)).toBeCloseTo(0.5, 8);
    expect(cylinderTraversalToCarrierWallRadius(0.5, profile)).toBeCloseTo(0.61, 8);
    expectVectorClose(cylinderContinuityUvToSurfacePoint(0.5, 0.5 - 0.61 * 0.5, profile), [0, 0, 2]);
  });

  test("keeps a positive minimum cap so the carrier never collapses to a singular center", () => {
    expect(createCylinderContinuityCarrierProfile({ capBand: 0 }).capBand).toBe(0.005);
    expect(createCylinderContinuityCarrierProfile({ capBand: 0.8 }).capBand).toBe(0.25);
  });
});

function expectVectorClose(actual: Vec3 | null, expected: Vec3, precision?: number): void {
  expect(actual).not.toBeNull();
  for (let index = 0; index < 3; index += 1) {
    if (precision !== undefined) {
      expect(actual![index]).toBeCloseTo(expected[index], precision);
    } else {
      expect(Math.abs(actual![index] - expected[index])).toBeLessThanOrEqual(PROJECTION_F32_COMPONENT_TOLERANCE);
    }
  }
}
