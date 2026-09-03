import { describe, expect, test } from "vitest";
import {
  createSourceUvToDirectionMapper,
  normalizeSourceProjectionMode,
  SOURCE_PROJECTION_MODES,
  sourceProjectionBeyondHorizonDegrees,
  sourceProjectionContainsDirection,
  sourceProjectionFieldOfViewDegrees,
  sourceProjectionGeometryRange,
  sourceProjectionHorizonRadius,
  sourceProjectionLabel,
  sourceProjectionProfileForMode,
  sourceProjectionSummary,
  sourceCarrierRadiusToPhysicalRadius,
  sourceDirectionToMapPoint,
  sourceDirectionToUv,
  sourceMapPointToDirection,
  sourceMapPointToUv,
  sourcePhysicalRadiusToCarrierRadius,
  sourceUvToMapPoint,
  sourceUvToDirection,
} from "./source-projection.js";
import { DEFAULT_CAVE_CONTINUITY_FLOOR_BAND } from "./cave-continuity-carrier.js";
import { directionToFisheyeUv } from "./fisheye-projection.js";
import type { BoxRoomProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { SourceProjectionMode } from "./source-projection.js";
import type { Vec3 } from "../projection.js";

describe("source projection modes", () => {
  test("round-trips representative directions for every source projection mode", () => {
    const samples: Record<SourceProjectionMode, Vec3[]> = {
      "zenith-180": [[0, 1, 0], [0, 0, 1], [1, 0, 0], normalize([0.35, 0.72, -0.6])],
      "zenith-230": [[0, 1, 0], [0, 0, 1], [1, 0, 0], normalize([0.16, -0.34, 0.93])],
      "nadir-180": [[0, -1, 0], [0, 0, 1], [1, 0, 0], normalize([-0.42, -0.76, 0.5])],
      "cave-270": [[0, -1, 0], [0, 0, 1], [1, 0, 0], normalize([-0.22, 0.58, 0.78])],
      "hall-double-gable": [[0, 1, 0], [0, 0, 1], [1, 0, 0], normalize([-0.22, 0.58, 0.78])],
      "cylinder-nadir": [[0, -1, 0], [0, 0, 1], [1, 0, 0], normalize([-0.22, 0.58, 0.78])],
      "cylinder-zenith": [[0, 1, 0], [0, 0, 1], [1, 0, 0], normalize([0.22, -0.58, 0.78])],
      "cylinder-wall": [[0, 0, 1], [1, 0, 0], normalize([-0.22, 0.58, 0.78])],
    };

    for (const mode of SOURCE_PROJECTION_MODES) {
      for (const direction of samples[mode]) {
        const uv = sourceDirectionToUv(direction, mode, 1024, 1024);
        expect(uv).not.toBeNull();
        const roundTrip = sourceUvToDirection(uv!.u, uv!.v, mode, 1024, 1024);
        expectVectorClose(roundTrip, direction);
      }
    }
  });

  test("keeps the dense precompiled UV mapper identical to the public point mapper", () => {
    const mapper = createSourceUvToDirectionMapper({
      mode: "zenith-230",
      width: 1920,
      height: 1920,
      innerGuideSplit: 0.38,
      carrierHorizonRadius: 0.77,
    });

    for (const [u, v] of [
      [0.5, 0.5],
      [0.5, 0.2],
      [0.8, 0.5],
      [0.1, 0.1],
    ]) {
      expect(mapper(u, v)).toEqual(sourceUvToDirection(u, v, "zenith-230", 1920, 1920, 1, 0.38, 0.77));
    }
  });

  test("places the horizon at the expected radius for every mode", () => {
    const expectedHorizonRadius: Record<SourceProjectionMode, number> = {
      "zenith-180": 1,
      "zenith-230": 18 / 23,
      "nadir-180": 1,
      "cave-270": DEFAULT_CAVE_CONTINUITY_FLOOR_BAND,
      "hall-double-gable": 0.36,
      "cylinder-nadir": 0.02,
      "cylinder-zenith": 0.02,
      "cylinder-wall": 0.5,
    };

    for (const mode of SOURCE_PROJECTION_MODES) {
      if (mode === "cave-270" || mode === "hall-double-gable" || mode.startsWith("cylinder-")) {
        expect(sourceProjectionHorizonRadius(mode)).toBeCloseTo(expectedHorizonRadius[mode], 8);
        continue;
      }
      const profile = sourceProjectionProfileForMode(mode, 1024, 1024);
      const uv = directionToFisheyeUv([0, 0, 1], profile);
      expect(uv).not.toBeNull();
      const radius = Math.hypot((uv!.u - 0.5) / profile.fisheyeScaleX, (uv!.v - 0.5) / profile.fisheyeScaleY);
      expect(radius).toBeCloseTo(expectedHorizonRadius[mode], 6);
      expect(sourceProjectionHorizonRadius(mode)).toBeCloseTo(expectedHorizonRadius[mode], 8);
    }
  });

  test("threads the live CAVE floor split through source UV conversion", () => {
    const floorEdgeDirection: Vec3 = normalize([0, -1, 1]);
    const defaultUv = sourceDirectionToUv(floorEdgeDirection, "cave-270");
    const wideFloorUv = sourceDirectionToUv(floorEdgeDirection, "cave-270", 2, 2, 1, 0.5);

    expect(defaultUv).not.toBeNull();
    expect(wideFloorUv).not.toBeNull();
    expect(defaultUv!.v).toBeCloseTo(0.5 - DEFAULT_CAVE_CONTINUITY_FLOOR_BAND * 0.5, 6);
    expect(wideFloorUv!.v).toBeCloseTo(0.25, 6);
    expectVectorClose(
      sourceUvToDirection(wideFloorUv!.u, wideFloorUv!.v, "cave-270", 2, 2, 1, 0.5),
      floorEdgeDirection,
    );
  });

  test("treats CAVE source-map points as square carrier coordinates", () => {
    const cornerUv = sourceMapPointToUv({ radius: 1, azimuth: 45 }, "cave-270");
    expect(cornerUv.u).toBeCloseTo(1, 8);
    expect(cornerUv.v).toBeCloseTo(0, 8);

    const cornerPoint = sourceUvToMapPoint(cornerUv.u, cornerUv.v, "cave-270");
    expect(cornerPoint).not.toBeNull();
    expect(cornerPoint!.radius).toBeCloseTo(1, 8);
    expect(cornerPoint!.azimuth).toBeCloseTo(45, 8);

    const floorEdge = sourceMapPointToDirection({ radius: 0.5, azimuth: 0 }, "cave-270", 2, 2, 1, 0.5);
    expect(floorEdge).not.toBeNull();
    const roundTripPoint = sourceDirectionToMapPoint(floorEdge!, "cave-270", 2, 2, 1, 0.5);
    expect(roundTripPoint).not.toBeNull();
    expect(roundTripPoint!.radius).toBeCloseTo(0.5, 8);
    expect(roundTripPoint!.azimuth).toBeCloseTo(0, 8);
  });

  test("keeps angular carriers circular in pixel space on non-square rasters", () => {
    const wideWidth = 2912;
    const wideHeight = 1248;
    const rightRim = sourceMapPointToUv({ radius: 1, azimuth: 90 }, "zenith-180", wideWidth, wideHeight);

    expect(rightRim.u).toBeCloseTo(0.5 + (wideHeight / wideWidth) * 0.5, 8);
    expect(rightRim.v).toBeCloseTo(0.5, 8);
    expect(sourceUvToMapPoint(rightRim.u, rightRim.v, "zenith-180", wideWidth, wideHeight)).toEqual({
      radius: expect.closeTo(1, 8),
      azimuth: expect.closeTo(90, 8),
    });

    const topRim = sourceMapPointToUv({ radius: 1, azimuth: 0 }, "zenith-180", wideWidth, wideHeight);
    expect(topRim).toEqual({ u: expect.closeTo(0.5, 8), v: expect.closeTo(0, 8) });
    expect(sourceUvToMapPoint(1, 0.5, "zenith-180", wideWidth, wideHeight)).toBeNull();
  });

  test("keeps CAVE and cylinder topology normalized over the complete carrier rectangle", () => {
    for (const mode of ["cave-270", "cylinder-nadir", "cylinder-zenith"] as const) {
      const rightRim = sourceMapPointToUv({ radius: 1, azimuth: 90 }, mode, 2912, 1248);
      expect(rightRim.u).toBeCloseTo(1, 8);
      expect(rightRim.v).toBeCloseTo(0.5, 8);
      const roundTrip = sourceUvToMapPoint(rightRim.u, rightRim.v, mode, 2912, 1248);
      expect(roundTrip).not.toBeNull();
      expect(roundTrip!.radius).toBeCloseTo(1, 8);
      expect(roundTrip!.azimuth).toBeCloseTo(90, 8);
    }
  });

  test("maps the unwrapped cylinder across the complete rectangle with an identified horizontal seam", () => {
    const front = sourceMapPointToUv({ radius: 0.5, azimuth: 0 }, "cylinder-wall", 2912, 1248);
    const seamLeft = sourceUvToDirection(0, 0.5, "cylinder-wall");
    const seamRight = sourceUvToDirection(1, 0.5, "cylinder-wall");
    expect(front).toEqual({ u: 0.5, v: 0.5 });
    expectVectorClose(seamLeft, seamRight);
    expect(sourceUvToMapPoint(0.25, 0.8, "cylinder-wall")).toEqual({
      radius: expect.closeTo(0.2, 8),
      azimuth: expect.closeTo(270, 8),
    });
  });

  test("remaps dome source-map carrier radius through the inner guide split", () => {
    const split = 1 / 3;
    const zenithMidSky: Vec3 = normalize([0, Math.SQRT1_2, Math.SQRT1_2]);
    const zenithMidUv = sourceDirectionToUv(zenithMidSky, "zenith-180", 2, 2, 1, split);

    expect(zenithMidUv).not.toBeNull();
    expect(zenithMidUv!.u).toBeCloseTo(0.5, 6);
    expect(zenithMidUv!.v).toBeCloseTo(0.5 - split * 0.5, 6);
    expectVectorClose(sourceUvToDirection(zenithMidUv!.u, zenithMidUv!.v, "zenith-180", 2, 2, 1, split), zenithMidSky);

    const carrierMid = sourcePhysicalRadiusToCarrierRadius(0.5, "zenith-180", split);
    const physicalMid = sourceCarrierRadiusToPhysicalRadius(split, "zenith-180", split);
    expect(carrierMid).toBeCloseTo(split, 8);
    expect(physicalMid).toBeCloseTo(0.5, 8);
  });

  test("keeps the zenith 230 physical horizon as a second carrier boundary", () => {
    const split = 1 / 3;
    const carrierHorizon = 0.68;
    const horizon = sourceProjectionHorizonRadius("zenith-230");
    const midSkyPhysical = horizon * 0.5;
    const horizonDirection: Vec3 = [0, 0, 1];
    const horizonUv = sourceDirectionToUv(horizonDirection, "zenith-230", 2, 2, 1, split, carrierHorizon);

    expect(sourcePhysicalRadiusToCarrierRadius(midSkyPhysical, "zenith-230", split, carrierHorizon)).toBeCloseTo(
      split,
      8,
    );
    expect(sourcePhysicalRadiusToCarrierRadius(horizon, "zenith-230", split, carrierHorizon)).toBeCloseTo(
      carrierHorizon,
      8,
    );
    expect(horizonUv).not.toBeNull();
    expect(horizonUv!.v).toBeCloseTo(0.5 - carrierHorizon * 0.5, 8);
    expectVectorClose(
      sourceUvToDirection(horizonUv!.u, horizonUv!.v, "zenith-230", 2, 2, 1, split, carrierHorizon),
      horizonDirection,
    );
  });

  test("maps CAVE eye level through the editable horizon carrier", () => {
    const eyeLevelFront: Vec3 = [0, 0, 1];
    const uv = sourceDirectionToUv(eyeLevelFront, "cave-270", 2, 2, 1, 1 / 3, 0.58);

    expect(uv).not.toBeNull();
    expect(uv!.u).toBeCloseTo(0.5, 6);
    expect(uv!.v).toBeCloseTo(0.5 - 0.58 * 0.5, 6);
    expectVectorClose(sourceUvToDirection(uv!.u, uv!.v, "cave-270", 2, 2, 1, 1 / 3, 0.58), eyeLevelFront);
  });

  test("round-trips a measured rectangular CAVE through the public source transforms", () => {
    const surface: BoxRoomProjectionSurface = {
      kind: "box-room",
      width: 6,
      depth: 4,
      height: 3.5,
      eyeHeight: 1.4,
      eyeX: 0.75,
      eyeZ: -0.4,
    };
    const direction = normalize([0.31, 0.18, 0.93]);
    const uv = sourceDirectionToUv(direction, "cave-270", 2688, 1152, 1, 0.3, 0.6, surface);
    const defaultUv = sourceDirectionToUv(direction, "cave-270", 2688, 1152, 1, 0.3, 0.6);

    expect(uv).not.toBeNull();
    expect(defaultUv).not.toBeNull();
    expect(Math.hypot(uv!.u - defaultUv!.u, uv!.v - defaultUv!.v)).toBeGreaterThan(0.01);
    expectVectorClose(sourceUvToDirection(uv!.u, uv!.v, "cave-270", 2688, 1152, 1, 0.3, 0.6, surface), direction);

    const point = { radius: 0.72, azimuth: 38 };
    const pointDirection = sourceMapPointToDirection(point, "cave-270", 2688, 1152, 1, 0.3, 0.6, surface);
    expect(pointDirection).not.toBeNull();
    const roundTripPoint = sourceDirectionToMapPoint(pointDirection!, "cave-270", 2688, 1152, 1, 0.3, 0.6, surface);
    expect(roundTripPoint).not.toBeNull();
    expect(roundTripPoint!.radius).toBeCloseTo(point.radius, 5);
    expect(roundTripPoint!.azimuth).toBeCloseTo(point.azimuth, 5);
  });

  test("summarizes projection profiles with production-facing geometry", () => {
    const expected: Record<SourceProjectionMode, { fov: number; beyondHorizon: number; center: "Zenith" | "Nadir" }> = {
      "zenith-180": { fov: 180, beyondHorizon: 0, center: "Zenith" },
      "zenith-230": { fov: 230, beyondHorizon: 25, center: "Zenith" },
      "nadir-180": { fov: 180, beyondHorizon: 0, center: "Nadir" },
      "cave-270": { fov: 270, beyondHorizon: 45, center: "Nadir" },
      "hall-double-gable": { fov: 360, beyondHorizon: 90, center: "Zenith" },
      "cylinder-nadir": { fov: 360, beyondHorizon: 90, center: "Nadir" },
      "cylinder-zenith": { fov: 360, beyondHorizon: 90, center: "Zenith" },
      "cylinder-wall": { fov: 360, beyondHorizon: 90, center: "Nadir" },
    };

    for (const mode of SOURCE_PROJECTION_MODES) {
      const summary = sourceProjectionSummary(mode);
      expect(summary.mode).toBe(mode);
      expect(summary.center).toBe(expected[mode].center);
      expect(summary.fieldOfViewDegrees).toBe(expected[mode].fov);
      expect(summary.halfAngleDegrees).toBe(expected[mode].fov * 0.5);
      expect(summary.beyondHorizonDegrees).toBe(expected[mode].beyondHorizon);
      expect(sourceProjectionFieldOfViewDegrees(mode)).toBe(expected[mode].fov);
      expect(sourceProjectionBeyondHorizonDegrees(mode)).toBe(expected[mode].beyondHorizon);
      expect(summary.horizonRadius).toBeCloseTo(sourceProjectionHorizonRadius(mode), 8);
    }
  });

  test("rejects directions outside each source cone", () => {
    const outside: Record<SourceProjectionMode, Vec3> = {
      "zenith-180": [0, -1, 0],
      "zenith-230": [0, -1, 0],
      "nadir-180": [0, 1, 0],
      "cave-270": [0, 1, 0],
      "hall-double-gable": [0, -1, 0],
      "cylinder-nadir": [0, 1, 0],
      "cylinder-zenith": [0, -1, 0],
      "cylinder-wall": [0, 1, 0],
    };

    for (const mode of SOURCE_PROJECTION_MODES) {
      expect(sourceProjectionContainsDirection(outside[mode], mode)).toBe(false);
    }
  });

  test("supports zenith 230 as a first-class projection mode", () => {
    expect(normalizeSourceProjectionMode("zenith-230")).toBe("zenith-230");
    expect(sourceProjectionLabel("zenith-230")).toBe("Zenith 230");
    expect(sourceProjectionHorizonRadius("zenith-230")).toBeCloseTo(18 / 23, 8);

    const range = sourceProjectionGeometryRange("zenith-230");
    expect(range.thetaStart).toBeCloseTo(0, 8);
    expect(range.thetaEnd).toBeCloseTo((Math.PI * 23) / 36, 8);
  });

  test("normalizes unknown source profiles to the default zenith source profile", () => {
    expect(normalizeSourceProjectionMode("not-a-current-source-profile")).toBe("zenith-180");
    expect(sourceProjectionLabel("cave-270")).toBe("CAVE · Perimeter Carrier");
  });

  test("maps zenith 230 horizon and 25-degree below-horizon band into the source circle", () => {
    const profile = sourceProjectionProfileForMode("zenith-230", 1024, 1024);
    const horizon = directionToFisheyeUv([0, 0, 1], profile);
    const lowerRim = directionToFisheyeUv([0, Math.cos((Math.PI * 23) / 36), Math.sin((Math.PI * 23) / 36)], profile);

    expect(horizon?.u).toBeCloseTo(0.5, 8);
    expect(horizon?.v).toBeCloseTo(5 / 46, 8);
    expect(lowerRim?.u).toBeCloseTo(0.5, 8);
    expect(lowerRim?.v).toBeCloseTo(0, 8);
    expect(directionToFisheyeUv([0, -1, 0], profile)).toBeNull();
  });
});

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function expectVectorClose(actual: Vec3 | null, expected: Vec3 | null): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  const value = actual as Vec3;
  const expectedValue = expected as Vec3;
  for (let index = 0; index < 3; index += 1) {
    // The authoritative kernel intentionally follows WebGPU f32 arithmetic on
    // both CPU and GPU execution paths.
    expect(value[index]).toBeCloseTo(expectedValue[index], 5);
  }
}
