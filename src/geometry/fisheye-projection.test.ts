import { describe, expect, test } from "vitest";
import { mapUvToDomeDirection } from "../projection.js";
import {
  createFisheyeProjectionProfile,
  directionToFisheyeUv,
  fisheyeUvToDirection,
} from "./fisheye-projection.js";
import type { Vec3 } from "../projection.js";

const squareZenith = createFisheyeProjectionProfile({
  width: 2048,
  height: 2048,
  center: "zenith",
  fieldOfViewDegrees: 180,
});

describe("general equidistant fisheye projection", () => {
  test("matches the existing zenith 180 domemaster cardinal contract", () => {
    const samples = [
      [0.5, 0.5],
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ];

    for (const [u, v] of samples) {
      expectVectorClose(fisheyeUvToDirection(u, v, squareZenith), mapUvToDomeDirection(u, v, squareZenith));
    }
  });

  test("round-trips arbitrary CAVE 270 directions through uv", () => {
    const nadir270 = createFisheyeProjectionProfile({
      width: 1024,
      height: 1024,
      center: "nadir",
      fieldOfViewDegrees: 270,
    });
    const directions: Vec3[] = [
      [0, -1, 0],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0.42, 0.91],
      [-0.35, -0.4, -0.85],
    ];

    for (const direction of directions) {
      const uv = directionToFisheyeUv(direction, nadir270);
      expect(uv).not.toBeNull();
      const roundTrip = fisheyeUvToDirection(uv.u, uv.v, nadir270);
      expectVectorClose(roundTrip, normalize(direction));
    }
  });

  test("rejects directions outside a CAVE 270 source", () => {
    const nadir270 = createFisheyeProjectionProfile({
      width: 1024,
      height: 1024,
      center: "nadir",
      fieldOfViewDegrees: 270,
    });

    expect(directionToFisheyeUv([0, 1, 0], nadir270)).toBeNull();
  });

  test("places the horizon two thirds out from the center in CAVE 270", () => {
    const nadir270 = createFisheyeProjectionProfile({
      width: 1024,
      height: 1024,
      center: "nadir",
      fieldOfViewDegrees: 270,
    });

    expect(directionToFisheyeUv([0, -1, 0], nadir270)).toEqual({ u: 0.5, v: 0.5 });
    const northHorizon = directionToFisheyeUv([0, 0, 1], nadir270);
    expect(northHorizon?.u).toBeCloseTo(0.5, 8);
    expect(northHorizon?.v).toBeCloseTo(1 / 6, 8);
  });
});

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  return [value[0] / length, value[1] / length, value[2] / length];
}

function expectVectorClose(actual: Vec3 | null, expected: Vec3 | null): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  const actualValue = actual as Vec3;
  const expectedValue = expected as Vec3;
  for (let index = 0; index < 3; index += 1) {
    expect(actualValue[index]).toBeCloseTo(expectedValue[index], 6);
  }
}
