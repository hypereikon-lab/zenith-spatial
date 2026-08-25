import { describe, expect, test } from "vitest";
import { angularDistance } from "../projection.js";
import { DEFAULT_CAVE_ROOM, caveContinuityDirectionFromSurfacePoint } from "./cave-projection.js";
import {
  DEFAULT_CAVE_CONTINUITY_FLOOR_BAND,
  carrierWallRadiusToPhysicalWallT,
  caveContinuitySurfacePointToUv,
  caveContinuityUvToDirection,
  caveContinuityUvToSurfacePoint,
  createCaveContinuityCarrierProfile,
  directionToCaveContinuityUv,
  physicalWallTToCarrierWallRadius,
} from "./cave-continuity-carrier.js";
import type { Vec3 } from "../projection.js";
import {
  PROJECTION_F32_ANGULAR_TOLERANCE,
  PROJECTION_F32_COMPONENT_TOLERANCE,
} from "../kernels/projection/constants.js";

describe("CAVE continuity carrier", () => {
  const profile = createCaveContinuityCarrierProfile({ width: 2048, height: 2048 });

  test("maps image center to the CAVE floor center", () => {
    expectVectorClose(caveContinuityUvToSurfacePoint(0.5, 0.5, profile), [0, -2, 0]);
    expectVectorClose(caveContinuityUvToDirection(0.5, 0.5, profile), [0, -1, 0]);
  });

  test("maps the carrier floor band to wall bases", () => {
    expectVectorClose(
      caveContinuityUvToSurfacePoint(0.5, 0.5 - DEFAULT_CAVE_CONTINUITY_FLOOR_BAND * 0.5, profile),
      [0, -2, 2],
    );
    expectVectorClose(
      caveContinuityUvToSurfacePoint(0.5 + DEFAULT_CAVE_CONTINUITY_FLOOR_BAND * 0.5, 0.5, profile),
      [2, -2, 0],
    );
  });

  test("maps the outer image boundary to the upper CAVE edge", () => {
    expectVectorClose(caveContinuityUvToSurfacePoint(0.5, 0, profile), [0, 2, 2]);
    expectVectorClose(caveContinuityUvToSurfacePoint(1, 0.5, profile), [2, 2, 0]);
    expectVectorClose(caveContinuityUvToSurfacePoint(0.5, 1, profile), [0, 2, -2]);
  });

  test("maps an editable carrier horizon to physical eye level", () => {
    const compressed = createCaveContinuityCarrierProfile({ floorBand: 1 / 3, horizonBand: 0.58 });

    expectVectorClose(caveContinuityUvToSurfacePoint(0.5, 0.5 - compressed.horizonBand * 0.5, compressed), [0, 0, 2]);
    expect(carrierWallRadiusToPhysicalWallT(compressed.horizonBand, compressed)).toBeCloseTo(0.5, 8);
    expect(physicalWallTToCarrierWallRadius(0.5, compressed)).toBeCloseTo(0.58, 8);

    const eyeLevelUv = caveContinuitySurfacePointToUv([0, 0, 2], compressed);
    expect(eyeLevelUv).not.toBeNull();
    expect(eyeLevelUv!.v).toBeCloseTo(0.5 - 0.58 * 0.5, 6);
  });

  test("round-trips wall and floor surface points through the carrier", () => {
    const points: Vec3[] = [
      [0, -2, 0],
      [0, -2, 2],
      [1.2, -2, 0.8],
      [2, -1, 1],
      [0, 0.25, 2],
      [-2, 1.5, -0.8],
    ];

    for (const point of points) {
      const uv = caveContinuitySurfacePointToUv(point, profile);
      expect(uv).not.toBeNull();
      expectVectorClose(caveContinuityUvToSurfacePoint(uv!.u, uv!.v, profile), point);
    }
  });

  test("round-trips CAVE continuity directions through source uv", () => {
    const points: Vec3[] = [
      [0, -2, 0],
      [0, -2, 2],
      [2, -2, 0],
      [0, 0, 2],
      [-2, 1.25, 0],
    ];

    for (const point of points) {
      const direction = caveContinuityDirectionFromSurfacePoint(point, DEFAULT_CAVE_ROOM);
      const uv = directionToCaveContinuityUv(direction, profile);
      expect(uv).not.toBeNull();
      const roundTrip = caveContinuityUvToDirection(uv!.u, uv!.v, profile);
      expect(roundTrip).not.toBeNull();
      expect(angularDistance(direction, roundTrip!)).toBeLessThan(PROJECTION_F32_ANGULAR_TOLERANCE);
    }
  });

  test("supports non-square carriers without changing the center and boundary invariants", () => {
    const wide = createCaveContinuityCarrierProfile({ width: 2100, height: 900 });
    expectVectorClose(caveContinuityUvToSurfacePoint(0.5, 0.5, wide), [0, -2, 0]);
    expect(caveContinuityUvToSurfacePoint(0.5, 0, wide)?.[1]).toBeCloseTo(2, 6);
    expect(caveContinuityUvToSurfacePoint(1, 0.5, wide)?.[1]).toBeCloseTo(2, 6);
  });

  test("uses room aspect rather than raster aspect for perimeter allocation", () => {
    const landscape = createCaveContinuityCarrierProfile({ width: 2400, height: 900 });
    const portrait = createCaveContinuityCarrierProfile({ width: 900, height: 2400 });
    expect(landscape.aspect).toBe(1);
    expect(portrait.aspect).toBe(1);
    expectVectorClose(
      caveContinuityUvToDirection(0.82, 0.18, landscape),
      caveContinuityUvToDirection(0.82, 0.18, portrait)!,
    );
  });

  test("round-trips an off-center observer without silently reverting to a centered cube", () => {
    const offCenter = createCaveContinuityCarrierProfile({
      room: { width: 6, depth: 4, height: 3.5, eyeHeight: 1.6, eyeX: 0.7, eyeZ: -0.35 },
      floorBand: 0.31,
      horizonBand: 0.64,
    });
    const points: Vec3[] = [
      [0, -1.6, 0],
      [3 - 0.7, -1.6, 0.2],
      [-0.7, 0, 2 + 0.35],
      [-3 - 0.7, 1.2, -0.4],
    ];
    for (const point of points) {
      const direction = caveContinuityDirectionFromSurfacePoint(point, offCenter.room);
      const uv = directionToCaveContinuityUv(direction, offCenter);
      expect(uv).not.toBeNull();
      expectVectorClose(caveContinuityUvToDirection(uv!.u, uv!.v, offCenter), direction);
    }
    const centeredDirection = caveContinuityUvToDirection(0.5, 0.31 * 0.5, profile);
    const offsetDirection = caveContinuityUvToDirection(0.5, 0.31 * 0.5, offCenter);
    expect(angularDistance(centeredDirection!, offsetDirection!)).toBeGreaterThan(0.02);
  });
});

function expectVectorClose(actual: Vec3 | null, expected: Vec3, precision?: number): void {
  expect(actual).not.toBeNull();
  const value = actual as Vec3;
  for (let index = 0; index < 3; index += 1) {
    if (precision !== undefined) {
      expect(value[index]).toBeCloseTo(expected[index], precision);
    } else {
      expect(Math.abs(value[index] - expected[index])).toBeLessThanOrEqual(PROJECTION_F32_COMPONENT_TOLERANCE);
    }
  }
}
