import { describe, expect, test } from "vitest";
import { createFisheyeProjectionProfile, directionToFisheyeUv } from "./fisheye-projection.js";
import {
  CAVE_FACES,
  DEFAULT_CAVE_ROOM,
  caveContinuityDirectionFromSurfacePoint,
  caveFaceDirection,
  caveFacePoint,
  caveSurfacePointFromContinuityDirection,
  estimateCaveFaceCoverage,
  requiredFisheyeFieldOfViewDegrees,
} from "./cave-projection.js";
import type { Vec3 } from "../projection.js";

describe("CAVE projection geometry", () => {
  test("keeps adjacent wall edges continuous in ray space", () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expectVectorClose(
        caveFaceDirection("front", { u: 1, v }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("right", { u: 0, v }, DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveFaceDirection("right", { u: 1, v }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("back", { u: 0, v }, DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveFaceDirection("back", { u: 1, v }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("left", { u: 0, v }, DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveFaceDirection("left", { u: 1, v }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("front", { u: 0, v }, DEFAULT_CAVE_ROOM),
      );
    }
  });

  test("maps horizontal wall travel to even source azimuth around the room perimeter", () => {
    const samples = [
      ["front", 0, -45],
      ["front", 0.5, 0],
      ["front", 1, 45],
      ["right", 0.5, 90],
      ["back", 0.5, 180],
      ["left", 0.5, -90],
    ] as const;

    for (const [face, u, expectedDegrees] of samples) {
      const point = eyeRelativeCavePoint(face, { u, v: 0.5 });
      const direction = caveContinuityDirectionFromSurfacePoint(point, DEFAULT_CAVE_ROOM);
      expect((Math.atan2(direction[0], direction[2]) * 180) / Math.PI).toBeCloseTo(expectedDegrees, 6);
    }
  });

  test("round-trips wall continuity directions back to room surface points", () => {
    for (const face of ["front", "right", "back", "left"] as const) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const point = eyeRelativeCavePoint(face, { u, v: 0.35 });
        const direction = caveContinuityDirectionFromSurfacePoint(point, DEFAULT_CAVE_ROOM);
        const roundTrip = caveSurfacePointFromContinuityDirection(direction, DEFAULT_CAVE_ROOM);
        expectVectorClose(roundTrip!, point);
      }
    }
  });

  test("keeps wall bottoms continuous with the floor in continuity space", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expectVectorClose(
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("front", { u: t, v: 1 }), DEFAULT_CAVE_ROOM),
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("floor", { u: t, v: 0 }), DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("right", { u: t, v: 1 }), DEFAULT_CAVE_ROOM),
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("floor", { u: 1, v: t }), DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("back", { u: t, v: 1 }), DEFAULT_CAVE_ROOM),
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("floor", { u: 1 - t, v: 1 }), DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("left", { u: t, v: 1 }), DEFAULT_CAVE_ROOM),
        caveContinuityDirectionFromSurfacePoint(eyeRelativeCavePoint("floor", { u: 0, v: 1 - t }), DEFAULT_CAVE_ROOM),
      );
    }
  });

  test("round-trips floor continuity directions back to floor points", () => {
    for (const u of [0.2, 0.5, 0.8]) {
      for (const v of [0.2, 0.5, 0.8]) {
        const point = eyeRelativeCavePoint("floor", { u, v });
        const direction = caveContinuityDirectionFromSurfacePoint(point, DEFAULT_CAVE_ROOM);
        const roundTrip = caveSurfacePointFromContinuityDirection(direction, DEFAULT_CAVE_ROOM);
        expectVectorClose(roundTrip!, point, 5);
      }
    }
  });

  test("keeps floor edges continuous with wall bottoms", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expectVectorClose(
        caveFaceDirection("front", { u: t, v: 1 }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("floor", { u: t, v: 0 }, DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveFaceDirection("right", { u: t, v: 1 }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("floor", { u: 1, v: t }, DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveFaceDirection("back", { u: t, v: 1 }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("floor", { u: 1 - t, v: 1 }, DEFAULT_CAVE_ROOM),
      );
      expectVectorClose(
        caveFaceDirection("left", { u: t, v: 1 }, DEFAULT_CAVE_ROOM),
        caveFaceDirection("floor", { u: 0, v: 1 - t }, DEFAULT_CAVE_ROOM),
      );
    }
  });

  test("a centered cube without ceiling fits exactly in a CAVE 270 fisheye", () => {
    const nadir270 = createFisheyeProjectionProfile({
      width: 2048,
      height: 2048,
      center: "nadir",
      fieldOfViewDegrees: 270,
    });

    for (const face of CAVE_FACES) {
      expect(estimateCaveFaceCoverage(face, nadir270, DEFAULT_CAVE_ROOM, 17).ratio).toBe(1);
    }
  });

  test("a nadir 180 fisheye covers the floor but misses upper wall regions", () => {
    const nadir180 = createFisheyeProjectionProfile({
      width: 2048,
      height: 2048,
      center: "nadir",
      fieldOfViewDegrees: 180,
    });

    expect(estimateCaveFaceCoverage("floor", nadir180, DEFAULT_CAVE_ROOM, 17).ratio).toBe(1);
    expect(estimateCaveFaceCoverage("front", nadir180, DEFAULT_CAVE_ROOM, 17).ratio).toBeLessThan(1);
  });

  test("reports 270 degrees as the required nadir FOV for the default cube faces", () => {
    expect(requiredFisheyeFieldOfViewDegrees([0, -1, 0], DEFAULT_CAVE_ROOM, CAVE_FACES, 17)).toBeCloseTo(270, 6);
  });

  test("projects every default face sample into CAVE 270 uv space", () => {
    const nadir270 = createFisheyeProjectionProfile({
      width: 2048,
      height: 2048,
      center: "nadir",
      fieldOfViewDegrees: 270,
    });

    for (const face of CAVE_FACES) {
      for (const u of [0, 0.5, 1]) {
        for (const v of [0, 0.5, 1]) {
          expect(directionToFisheyeUv(caveFaceDirection(face, { u, v }, DEFAULT_CAVE_ROOM), nadir270)).not.toBeNull();
        }
      }
    }
  });
});

function expectVectorClose(actual: Vec3, expected: Vec3, precision = 6): void {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], precision);
  }
}

function eyeRelativeCavePoint(face: (typeof CAVE_FACES)[number], sample: { u: number; v: number }): Vec3 {
  const point = caveFacePoint(face, sample, DEFAULT_CAVE_ROOM);
  return [
    point[0] - (DEFAULT_CAVE_ROOM.eyeX || 0),
    point[1] - DEFAULT_CAVE_ROOM.eyeHeight,
    point[2] - (DEFAULT_CAVE_ROOM.eyeZ || 0),
  ];
}
