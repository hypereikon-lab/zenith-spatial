import { describe, expect, test } from "vitest";
import { sourceMapPointToDirection } from "../geometry/source-projection.js";
import {
  compensatePlatePlacementsForProjectionGeometryChange,
  shouldFlipPlateVerticallyForProjectionChange,
  type PlateProjectionGeometry,
} from "./plate-projection-compensation.js";
import type { Vec3 } from "../projection.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";

describe("plate projection geometry compensation", () => {
  test("preserves physical Dome positions when the semantic sky/horizon split moves", () => {
    const placements = [
      { azimuth: 12, radius: 0.24, spin: 35, flipY: false },
      { azimuth: -80, radius: 0.72, spin: -18, flipY: true },
    ];
    const previous = { mode: "zenith-180" as const, guideSplit: 1 / 3, horizonSplit: 1 };
    const next = { mode: "zenith-180" as const, guideSplit: 0.5, horizonSplit: 1 };

    const compensated = compensatePlatePlacementsForProjectionGeometryChange(placements, previous, next);

    expect(compensated[0].radius).not.toBeCloseTo(placements[0].radius, 6);
    expect(compensated.map((placement) => placement.flipY)).toEqual([false, true]);
    expect(compensated.map((placement) => placement.spin)).toEqual([35, -18]);
    for (let index = 0; index < placements.length; index += 1) {
      expectDirectionClose(directionFor(placements[index], previous), directionFor(compensated[index], next));
    }
  });

  test("leaves placements byte-for-byte stable for a no-op geometry update", () => {
    const placement = {
      radius: 0.4123456789,
      azimuth: -117.23456789,
      spin: 16,
      flipY: true,
    };
    const geometry = { mode: "zenith-180" as const, guideSplit: 0.38, horizonSplit: 1 };

    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange([placement], geometry, geometry);

    expect(compensated).toEqual(placement);
    expect(compensated).not.toBe(placement);
  });

  test("preserves physical Dome positions when the editable carrier horizon moves", () => {
    const placement = { azimuth: 40, radius: 0.71, flipY: false };
    const previous = { mode: "zenith-230" as const, guideSplit: 0.34, horizonSplit: 0.68 };
    const next = { mode: "zenith-230" as const, guideSplit: 0.34, horizonSplit: 0.82 };

    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange([placement], previous, next);

    expect(compensated.radius).not.toBeCloseTo(placement.radius, 6);
    expect(compensated.flipY).toBe(false);
    expectDirectionClose(directionFor(placement, previous), directionFor(compensated, next));
  });

  test("maps the physical horizon to the CAVE eye-level horizon and flips only vertically", () => {
    const placement = {
      azimuth: 0,
      radius: 1,
      spin: 27,
      flipX: true,
      flipY: false,
    };
    const previous = { mode: "zenith-180" as const, guideSplit: 1 / 3, horizonSplit: 1 };
    const next = { mode: "cave-270" as const, guideSplit: 0.36, horizonSplit: 0.64 };

    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange([placement], previous, next);

    expect(compensated.radius).toBeCloseTo(0.64, 3);
    expect(compensated.azimuth).toBeCloseTo(placement.azimuth, 6);
    expect(compensated.spin).toBe(27);
    expect(compensated.flipX).toBe(true);
    expect(compensated.flipY).toBe(true);
    expectDirectionClose(directionFor(placement, previous), directionFor(compensated, next));
  });

  test("uses a horizon-relative fallback outside the destination field of view", () => {
    const previous = { mode: "zenith-180" as const, guideSplit: 1 / 3, horizonSplit: 1 };
    const next = { mode: "cave-270" as const, guideSplit: 0.36, horizonSplit: 0.64 };

    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange(
      [{ azimuth: 20, radius: 0, flipY: true }],
      previous,
      next,
    );

    expect(compensated.radius).toBe(1);
    expect(compensated.azimuth).toBe(20);
    expect(compensated.flipY).toBe(false);
  });

  test("switching projection centers twice restores vertical orientation", () => {
    expect(shouldFlipPlateVerticallyForProjectionChange("zenith-180", "zenith-230")).toBe(false);
    expect(shouldFlipPlateVerticallyForProjectionChange("cave-270", "nadir-180")).toBe(false);
    expect(shouldFlipPlateVerticallyForProjectionChange("zenith-230", "cave-270")).toBe(true);

    const placements = [{ azimuth: 0, radius: 1, flipY: false }];
    const cave = compensatePlatePlacementsForProjectionGeometryChange(
      placements,
      { mode: "zenith-180", guideSplit: 1 / 3, horizonSplit: 1 },
      { mode: "cave-270", guideSplit: 1 / 3, horizonSplit: 2 / 3 },
    );
    const zenith = compensatePlatePlacementsForProjectionGeometryChange(
      cave,
      { mode: "cave-270", guideSplit: 1 / 3, horizonSplit: 2 / 3 },
      { mode: "zenith-180", guideSplit: 1 / 3, horizonSplit: 1 },
    );

    expect(zenith[0].flipY).toBe(false);
    expect(zenith[0].radius).toBeCloseTo(1, 6);
  });

  test("preserves physical cylinder placement when cap and horizon allocation changes", () => {
    const placement = { radius: 0.38, azimuth: 73, flipY: false };
    const previous = { mode: "cylinder-nadir" as const, guideSplit: 0.02, horizonSplit: 0.51 };
    const next = { mode: "cylinder-nadir" as const, guideSplit: 0.08, horizonSplit: 0.66 };
    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange([placement], previous, next);
    expect(compensated.radius).not.toBeCloseTo(placement.radius, 6);
    expect(compensated.flipY).toBe(false);
    expectDirectionClose(directionFor(placement, previous), directionFor(compensated, next));
  });

  test("flips vertically when the same cylinder wall direction moves between nadir and zenith carriers", () => {
    const nadir = { mode: "cylinder-nadir" as const, guideSplit: 0.02, horizonSplit: 0.51 };
    const zenith = { mode: "cylinder-zenith" as const, guideSplit: 0.02, horizonSplit: 0.51 };
    const placement = { radius: 0.51, azimuth: 120, flipY: false };
    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange([placement], nadir, zenith);
    expect(compensated.flipY).toBe(true);
    expectDirectionClose(directionFor(placement, nadir), directionFor(compensated, zenith));
  });

  test("preserves direction while measured off-centre box proportions change", () => {
    const previous = {
      mode: "cave-270" as const,
      guideSplit: 0.32,
      horizonSplit: 0.67,
      surface: {
        kind: "box-room" as const,
        width: 6,
        depth: 4,
        height: 3.5,
        eyeHeight: 1.4,
        eyeX: 0.75,
        eyeZ: -0.4,
      },
      raster: { width: 2560, height: 1440 },
    };
    const next = { ...previous, surface: { ...previous.surface, width: 8, depth: 5.5 } };
    const placement = { radius: 0.73, azimuth: 52, flipY: false };

    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange([placement], previous, next);

    expect(compensated.radius).not.toBeCloseTo(placement.radius, 6);
    expectDirectionClose(directionFor(placement, previous), directionFor(compensated, next));
  });

  test("preserves direction through measured cylinder and guide changes", () => {
    const previous = {
      mode: "cylinder-nadir" as const,
      guideSplit: 0.02,
      horizonSplit: 0.51,
      surface: { kind: "cylinder" as const, radius: 2.8, height: 4.2, eyeHeight: 1.35 },
      raster: { width: 2912, height: 1248 },
    };
    const next = {
      ...previous,
      guideSplit: 0.07,
      horizonSplit: 0.64,
      surface: { kind: "cylinder" as const, radius: 3.4, height: 5.1, eyeHeight: 1.6 },
    };
    const placement = { radius: 0.42, azimuth: -105, flipY: false };

    const [compensated] = compensatePlatePlacementsForProjectionGeometryChange([placement], previous, next);

    expectDirectionClose(directionFor(placement, previous), directionFor(compensated, next));
  });

  test("preserves represented wall directions when switching between radial and unwrapped cylinder carriers", () => {
    const radial = {
      mode: "cylinder-nadir" as const,
      guideSplit: 0.02,
      horizonSplit: 0.58,
      surface: { kind: "cylinder" as const, radius: 2.8, height: 4.2, eyeHeight: 1.35 },
    };
    const wall = {
      mode: "cylinder-wall" as const,
      guideSplit: 0.64,
      horizonSplit: 1,
      surface: radial.surface,
    };
    const placement = { radius: 0.72, azimuth: 133, flipY: false };
    const [unwrapped] = compensatePlatePlacementsForProjectionGeometryChange([placement], radial, wall);

    expect(unwrapped.flipY).toBe(false);
    expectDirectionClose(directionFor(placement, radial), directionFor(unwrapped, wall));
  });
});

function directionFor(
  placement: { radius?: number; azimuth?: number },
  geometry: PlateProjectionGeometry & { mode: SourceProjectionMode; guideSplit: number; horizonSplit: number },
): Vec3 | null {
  return sourceMapPointToDirection(
    { radius: placement.radius || 0, azimuth: placement.azimuth || 0 },
    geometry.mode,
    geometry.raster?.width || 2,
    geometry.raster?.height || 2,
    1,
    geometry.guideSplit,
    geometry.horizonSplit,
    geometry.surface,
  );
}

function expectDirectionClose(actual: Vec3 | null, expected: Vec3 | null): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  for (let index = 0; index < 3; index += 1) {
    expect((actual as Vec3)[index]).toBeCloseTo((expected as Vec3)[index], 6);
  }
}
