import { describe, expect, test } from "vitest";
import {
  HALF_PI,
  angularDistance,
  domeDirectionToMotionUv,
  inverseMotionProjectionRadius,
  mapUvToDomeDirection,
  projectionRadiusForTheta,
  rotationRowsFromTo,
  slerpDirections,
} from "./projection.js";
import type { ProjectionProfile, Vec3 } from "./projection.js";

const profile: ProjectionProfile = {
  width: 2048,
  height: 2048,
  fisheyeScaleX: 0.5,
  fisheyeScaleY: 0.5,
  radiusPixels: 1024,
};

function expectCloseVector(actual: Vec3 | number[], expected: Vec3 | number[], precision = 8): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value: number, index: number) => {
    expect(value).toBeCloseTo(expected[index], precision);
  });
}

describe("fulldome projection math", () => {
  test("maps center UV to zenith direction and back", () => {
    const direction = mapUvToDomeDirection(0.5, 0.5, profile);

    expectCloseVector(direction, [0, 1, 0]);
    expect(domeDirectionToMotionUv(direction, profile)).toEqual({ u: 0.5, v: 0.5 });
  });

  test("maps horizon cardinal points consistently", () => {
    expectCloseVector(mapUvToDomeDirection(0.5, 0, profile), [0, 0, 1]);
    expectCloseVector(mapUvToDomeDirection(1, 0.5, profile), [1, 0, 0]);
    expectCloseVector(mapUvToDomeDirection(0.5, 1, profile), [0, 0, -1]);
    expectCloseVector(mapUvToDomeDirection(0, 0.5, profile), [-1, 0, 0]);
  });

  test("projection radius functions round-trip through the equidistant domemaster contract", () => {
    for (const theta of [0, HALF_PI * 0.1, HALF_PI * 0.45, HALF_PI * 0.85, HALF_PI]) {
      const radial = projectionRadiusForTheta(theta);
      expect(inverseMotionProjectionRadius(radial)).toBeCloseTo(theta, 8);
    }
  });

  test("maps source uv and dome directions round-trip for rectangular equidistant sources", () => {
    const rectangularProfile: ProjectionProfile = {
      ...profile,
      width: 2000,
      height: 1000,
      fisheyeScaleX: 0.25,
      fisheyeScaleY: 0.5,
      radiusPixels: 500,
    };
    const samples = [
      [0.5, 0.5],
      [0.5, 0.05],
      [0.72, 0.5],
      [0.5, 0.88],
      [0.34, 0.32],
    ];

    for (const [u, v] of samples) {
      const direction = mapUvToDomeDirection(u, v, rectangularProfile);
      if (!direction) throw new Error("Expected valid equidistant source uv");
      const roundTrip = domeDirectionToMotionUv(direction, rectangularProfile);
      expect(roundTrip?.u).toBeCloseTo(u, 8);
      expect(roundTrip?.v).toBeCloseTo(v, 8);
    }
  });

  test("slerp preserves angular midpoint on the dome", () => {
    const north = mapUvToDomeDirection(0.5, 0, profile);
    const east = mapUvToDomeDirection(1, 0.5, profile);
    const middle = slerpDirections(north, east, 0.5);

    expect(angularDistance(north, middle)).toBeCloseTo(angularDistance(middle, east), 8);
  });

  test("rotation rows align source and target directions", () => {
    const source: Vec3 = [0, 1, 0];
    const target: Vec3 = [1, 0, 0];
    const rows = rotationRowsFromTo(target, source);
    const rotated = [
      rows[0][0] * target[0] + rows[0][1] * target[1] + rows[0][2] * target[2],
      rows[1][0] * target[0] + rows[1][1] * target[1] + rows[1][2] * target[2],
      rows[2][0] * target[0] + rows[2][1] * target[1] + rows[2][2] * target[2],
    ];

    expectCloseVector(rotated, source);
  });
});
