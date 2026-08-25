import { describe, expect, test } from "vitest";
import {
  cornerOffsetFromLocal,
  directionFromPlateUv,
  directionToPlateLocal,
  normalizePlatePlacement,
  plateCornerBaseLocal,
  plateCornerLocal,
  plateLocalToWarpedUv,
  plateUvToLocal,
  preparePlatePlacement,
} from "./plate-placement.js";
import { SOURCE_PROJECTION_MODES, sourceMapPointToDirection } from "../geometry/source-projection.js";
import type { Vec3 } from "../projection.js";

describe("plate placement corner warp", () => {
  test("normalizes corner offsets with bounded defaults", () => {
    const placement = normalizePlatePlacement({
      cornerOffsets: {
        ne: { x: 1.5, y: -1.2 },
        sw: { x: 0.25 },
      },
    });

    expect(placement.cornerOffsets.nw).toEqual({ x: 0, y: 0 });
    expect(placement.cornerOffsets.ne).toEqual({ x: 0.85, y: -0.85 });
    expect(placement.cornerOffsets.sw).toEqual({ x: 0.25, y: 0 });
  });

  test("moves warped corners independently from the rectangular base", () => {
    const placement = preparePlatePlacement(
      {
        scale: 1,
        cornerOffsets: {
          ne: { x: -0.2, y: 0.3 },
        },
      },
      { aspect: 1 },
    );
    const base = plateCornerBaseLocal(placement, "ne");
    const warped = plateCornerLocal(placement, "ne");

    expect(warped.x).toBeLessThan(base.x);
    expect(warped.y).toBeGreaterThan(base.y);
  });

  test("round-trips warped uv through the local inverse", () => {
    const placement = preparePlatePlacement(
      {
        scale: 1,
        cornerOffsets: {
          nw: { x: 0.08, y: -0.05 },
          ne: { x: -0.18, y: 0.12 },
          se: { x: 0.09, y: -0.04 },
          sw: { x: -0.03, y: 0.16 },
        },
      },
      { aspect: 1.4 },
    );
    const local = plateUvToLocal(placement, 0.72, 0.28);
    const uv = plateLocalToWarpedUv(local, placement);

    expect(uv).not.toBeNull();
    expect(uv?.x).toBeCloseTo(0.72, 5);
    expect(uv?.y).toBeCloseTo(0.28, 5);
  });

  test("round-trips warped uv through spherical direction and local inverse", () => {
    const placement = preparePlatePlacement(
      {
        azimuth: 74,
        radius: 0.58,
        scale: 0.9,
        spin: -31,
        cornerOffsets: {
          nw: { x: 0.08, y: -0.05 },
          ne: { x: -0.14, y: 0.1 },
          se: { x: 0.07, y: -0.03 },
          sw: { x: -0.04, y: 0.12 },
        },
      },
      { aspect: 1.35 },
    );

    for (const [u, v] of [
      [0.5, 0.5],
      [0.22, 0.36],
      [0.74, 0.63],
    ]) {
      const direction = directionFromPlateUv(placement, u, v);
      const local = directionToPlateLocal(direction, placement);
      expect(local).not.toBeNull();
      const uv = plateLocalToWarpedUv(local!, placement);

      expect(uv).not.toBeNull();
      expect(uv?.x).toBeCloseTo(u, 5);
      expect(uv?.y).toBeCloseTo(v, 5);
    }
  });

  test("round-trips plate directions in every source projection mode", () => {
    for (const mode of SOURCE_PROJECTION_MODES) {
      const placement = preparePlatePlacement(
        {
          azimuth: -38,
          radius: 0.62,
          scale: 0.82,
          spin: 23,
          cornerOffsets: {
            nw: { x: 0.04, y: -0.03 },
            ne: { x: -0.1, y: 0.08 },
            se: { x: 0.06, y: -0.02 },
            sw: { x: -0.03, y: 0.09 },
          },
        },
        { aspect: 1.6 },
        mode,
      );

      for (const [u, v] of [
        [0.5, 0.5],
        [0.18, 0.24],
        [0.82, 0.76],
      ]) {
        const direction = directionFromPlateUv(placement, u, v);
        const local = directionToPlateLocal(direction, placement);
        expect(local).not.toBeNull();
        const uv = plateLocalToWarpedUv(local!, placement);

        expect(uv).not.toBeNull();
        expect(uv?.x).toBeCloseTo(u, 5);
        expect(uv?.y).toBeCloseTo(v, 5);
      }
    }
  });

  test("prepares CAVE plates from square source-map carrier coordinates", () => {
    const placement = preparePlatePlacement(
      {
        azimuth: 45,
        radius: 1,
        scale: 0.42,
      },
      { aspect: 1 },
      "cave-270",
      0.5,
    );
    const expectedDirection = sourceMapPointToDirection({ radius: 1, azimuth: 45 }, "cave-270", 2, 2, 1, 0.5);

    expectVectorClose(placement.center, expectedDirection);
    expect(placement.mapCenter[0]).toBeCloseTo(1, 8);
    expect(placement.mapCenter[1]).toBeCloseTo(-1, 8);
  });

  test("prepares dome plates from remapped source-map carrier coordinates", () => {
    const placement = preparePlatePlacement(
      {
        azimuth: 0,
        radius: 1 / 3,
        scale: 0.42,
      },
      { aspect: 1 },
      "zenith-180",
      1 / 3,
    );
    const expectedDirection = sourceMapPointToDirection({ radius: 1 / 3, azimuth: 0 }, "zenith-180", 2, 2, 1, 1 / 3);

    expectVectorClose(placement.center, expectedDirection);
    expect(placement.center[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(placement.center[2]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(placement.mapCenter[0]).toBeCloseTo(0, 8);
    expect(placement.mapCenter[1]).toBeCloseTo(-1 / 3, 8);
  });

  test("derives a bounded corner offset from a dragged local corner", () => {
    const placement = preparePlatePlacement({ scale: 1 }, { aspect: 1 });
    const base = plateCornerBaseLocal(placement, "se");
    const offset = cornerOffsetFromLocal(placement, "se", {
      x: base.x + placement.angularWidth * 0.4,
      y: base.y - placement.angularHeight * 0.2,
    });

    expect(offset.x).toBeCloseTo(0.4);
    expect(offset.y).toBeCloseTo(-0.2);
  });
});

function expectVectorClose(actual: Vec3, expected: Vec3 | null): void {
  expect(expected).not.toBeNull();
  const value = expected as Vec3;
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(value[index], 6);
  }
}
