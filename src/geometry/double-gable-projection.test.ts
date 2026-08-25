import { d } from "typegpu";
import { describe, expect, test } from "vitest";
import {
  squareShellCarrierWallToPhysicalKernel,
  squareShellPhysicalWallToCarrierKernel,
} from "../kernels/projection/cave.js";
import { doubleGableRoofBreakpointsKernel, doubleGableRoofSegmentKernel } from "../kernels/projection/double-gable.js";
import { normalize } from "../projection.js";
import { DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE } from "../lib/shared/contracts/projection-authoring.js";
import {
  doubleGableCarrierUvFromDirection,
  doubleGableDirectionFromCarrierUv,
  doubleGableRoofHeight,
  doubleGableSurfacePointFromDirection,
} from "./double-gable-projection.js";
import type { Point2D, Vec3 } from "../projection.js";

describe("double-gable projection", () => {
  test("is the top-cap inverse of the CAVE square-shell wall ordering", () => {
    const cap = 0.36;
    const horizon = 0.68;
    const physicalHorizon = 0.18;

    expect(squareShellCarrierWallToPhysicalKernel(cap, cap, horizon, physicalHorizon, false)).toBeCloseTo(0, 6);
    expect(squareShellCarrierWallToPhysicalKernel(horizon, cap, horizon, physicalHorizon, false)).toBeCloseTo(
      physicalHorizon,
      6,
    );
    expect(squareShellCarrierWallToPhysicalKernel(1, cap, horizon, physicalHorizon, false)).toBeCloseTo(1, 6);

    expect(squareShellCarrierWallToPhysicalKernel(cap, cap, horizon, physicalHorizon, true)).toBeCloseTo(1, 6);
    expect(squareShellCarrierWallToPhysicalKernel(horizon, cap, horizon, physicalHorizon, true)).toBeCloseTo(
      physicalHorizon,
      6,
    );
    expect(squareShellCarrierWallToPhysicalKernel(1, cap, horizon, physicalHorizon, true)).toBeCloseTo(0, 6);

    for (const rho of [cap, 0.47, horizon, 0.81, 1]) {
      const physical = squareShellCarrierWallToPhysicalKernel(rho, cap, horizon, physicalHorizon, true);
      expect(squareShellPhysicalWallToCarrierKernel(physical, cap, horizon, physicalHorizon, true)).toBeCloseTo(rho, 6);
    }
  });

  test("evaluates the complete eave-ridge-valley-ridge-eave roof profile", () => {
    const surface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE;
    const halfWidth = surface.width * 0.5;
    expect(doubleGableRoofHeight(-halfWidth)).toBeCloseTo(surface.eaveHeight, 6);
    expect(doubleGableRoofHeight(-halfWidth + surface.ridgeInset)).toBeCloseTo(surface.ridgeHeight, 6);
    expect(doubleGableRoofHeight(0)).toBeCloseTo(surface.valleyHeight, 6);
    expect(doubleGableRoofHeight(halfWidth - surface.ridgeInset)).toBeCloseTo(surface.ridgeHeight, 6);
    expect(doubleGableRoofHeight(halfWidth)).toBeCloseTo(surface.eaveHeight, 6);
  });

  test("governs all four W-profile roof planes from shared measured breakpoints", () => {
    const surface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE;
    const box = d.vec3f(surface.length, surface.width, surface.eaveHeight);
    const profile = d.vec4f(surface.ridgeHeight, surface.valleyHeight, surface.ridgeInset, 0);
    const points = doubleGableRoofBreakpointsKernel(box, profile);
    expect(points.x).toBeCloseTo(-surface.width * 0.5, 6);
    expect(points.y).toBeCloseTo(-surface.width * 0.5 + surface.ridgeInset, 6);
    expect(points.z).toBeCloseTo(surface.width * 0.5 - surface.ridgeInset, 6);
    expect(points.w).toBeCloseTo(surface.width * 0.5, 6);
    expect(doubleGableRoofSegmentKernel((points.x + points.y) * 0.5, box, profile)).toBe(0);
    expect(doubleGableRoofSegmentKernel(points.y * 0.5, box, profile)).toBe(1);
    expect(doubleGableRoofSegmentKernel(points.z * 0.5, box, profile)).toBe(2);
    expect(doubleGableRoofSegmentKernel((points.z + points.w) * 0.5, box, profile)).toBe(3);
  });

  test("keeps the bottom open while resolving roof and wall rays", () => {
    expect(doubleGableSurfacePointFromDirection([0, -1, 0])).toBeNull();
    expect(doubleGableSurfacePointFromDirection([0, 1, 0])).toEqual([
      0,
      expect.closeTo(
        DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE.valleyHeight - DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE.eyeHeight,
        5,
      ),
      0,
    ]);
    expect(doubleGableSurfacePointFromDirection([0, 0, 1])).toEqual([
      0,
      0,
      expect.closeTo(DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE.width * 0.5, 5),
    ]);
  });

  test.each([
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.2 },
    { x: 0.82, y: 0.31 },
    { x: 0.94, y: 0.68 },
    { x: 0.12, y: 0.88 },
  ] satisfies Point2D[])("round-trips carrier sample $x,$y through the measured shell", (uv) => {
    const direction = doubleGableDirectionFromCarrierUv(uv, 0.36, 0.68);
    expect(direction).not.toBeNull();
    const roundTrip = doubleGableCarrierUvFromDirection(direction!, 0.36, 0.68);
    expect(roundTrip).not.toBeNull();
    expect(roundTrip!.uv.x).toBeCloseTo(uv.x, 5);
    expect(roundTrip!.uv.y).toBeCloseTo(uv.y, 5);
  });

  test("preserves a ray toward a ridge point", () => {
    const surface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE;
    const ridgeZ = -surface.width * 0.5 + surface.ridgeInset;
    const direction: Vec3 = normalize([0, surface.ridgeHeight - surface.eyeHeight, ridgeZ]);
    const point = doubleGableSurfacePointFromDirection(direction);
    expect(point).not.toBeNull();
    expect(point![1]).toBeCloseTo(surface.ridgeHeight - surface.eyeHeight, 5);
    expect(point![2]).toBeCloseTo(ridgeZ, 5);
  });

  test("densely round-trips the continuous roof and wall carrier", () => {
    for (let y = 0.04; y < 1; y += 0.08) {
      for (let x = 0.04; x < 1; x += 0.08) {
        const uv = { x, y };
        const direction = doubleGableDirectionFromCarrierUv(uv, 0.36, 0.68);
        expect(direction, `direction at ${x},${y}`).not.toBeNull();
        const roundTrip = doubleGableCarrierUvFromDirection(direction!, 0.36, 0.68);
        expect(roundTrip, `inverse at ${x},${y}`).not.toBeNull();
        expect(roundTrip!.uv.x).toBeCloseTo(x, 4);
        expect(roundTrip!.uv.y).toBeCloseTo(y, 4);
      }
    }
  });

  test("round-trips a non-square hall from an off-center observer", () => {
    const surface = {
      ...DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
      length: 16,
      width: 7,
      eaveHeight: 5,
      ridgeHeight: 7.2,
      valleyHeight: 5.8,
      ridgeInset: 1.65,
      eyeHeight: 1.72,
      eyeX: 2.1,
      eyeZ: -1.15,
    };
    for (const uv of [
      { x: 0.5, y: 0.5 },
      { x: 0.22, y: 0.27 },
      { x: 0.74, y: 0.19 },
      { x: 0.91, y: 0.73 },
      { x: 0.13, y: 0.86 },
    ]) {
      const direction = doubleGableDirectionFromCarrierUv(uv, 0.31, 0.63, surface);
      expect(direction).not.toBeNull();
      const roundTrip = doubleGableCarrierUvFromDirection(direction!, 0.31, 0.63, surface);
      expect(roundTrip).not.toBeNull();
      expect(roundTrip!.uv.x).toBeCloseTo(uv.x, 5);
      expect(roundTrip!.uv.y).toBeCloseTo(uv.y, 5);
    }
  });

  test("supports an asymmetric seven-anchor roof as six exact planes", () => {
    const surface = {
      ...DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
      width: 20,
      roofProfile: [
        { id: "left-eave", position: 0, height: 8, role: "eave" as const },
        { id: "peak-a", position: 0.14, height: 12, role: "ridge" as const },
        { id: "valley-a", position: 0.31, height: 9.2, role: "valley" as const },
        { id: "peak-b", position: 0.48, height: 14.4, role: "ridge" as const },
        { id: "valley-b", position: 0.66, height: 10.1, role: "valley" as const },
        { id: "peak-c", position: 0.82, height: 12.6, role: "ridge" as const },
        { id: "right-eave", position: 1, height: 8.7, role: "eave" as const },
      ],
    };

    expect(doubleGableRoofHeight(-10, surface)).toBeCloseTo(8, 6);
    expect(doubleGableRoofHeight(-7.2, surface)).toBeCloseTo(12, 6);
    expect(doubleGableRoofHeight(-0.4, surface)).toBeCloseTo(14.4, 5);
    expect(doubleGableRoofHeight(10, surface)).toBeCloseTo(8.7, 6);
    expect(doubleGableRoofHeight(-8.6, surface)).toBeCloseTo(10, 6);

    for (const uv of [
      { x: 0.11, y: 0.24 },
      { x: 0.38, y: 0.18 },
      { x: 0.65, y: 0.29 },
      { x: 0.86, y: 0.72 },
    ]) {
      const direction = doubleGableDirectionFromCarrierUv(uv, 0.36, 0.68, surface);
      expect(direction).not.toBeNull();
      const roundTrip = doubleGableCarrierUvFromDirection(direction!, 0.36, 0.68, surface);
      expect(roundTrip?.uv.x).toBeCloseTo(uv.x, 4);
      expect(roundTrip?.uv.y).toBeCloseTo(uv.y, 4);
    }
  });
});
