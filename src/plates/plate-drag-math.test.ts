import { describe, expect, test } from "vitest";
import { angularDistance, normalize } from "../projection.js";
import { sourceMapPointToDirection, sourceProjectionProfileForMode } from "../geometry/source-projection.js";
import { fisheyeUvToDirection } from "../geometry/fisheye-projection.js";
import {
  cornerOffsetsFromSourceLocalDrag,
  hitPlateEditorHandle,
  moveDomePointBySourcePointerDrag,
  scaleFromSourceLocalDrag,
  sourceDirectionHitsPlatePlacement,
  spinFromSourceLocalRotateDrag,
} from "./plate-drag-math.js";
import { plateCornerLocal, preparePlatePlacement } from "./plate-placement.js";

describe("plate spherical drag math", () => {
  test("moves the plate center by the same source-sphere rotation as the pointer", () => {
    const startPointer = normalize([0, 1, 0]);
    const currentPointer = normalize([0, 0, 1]);
    const moved = moveDomePointBySourcePointerDrag(startPointer, startPointer, currentPointer, "zenith-180");

    expect(moved.azimuth).toBeCloseTo(0, 6);
    expect(moved.radius).toBeCloseTo(1, 6);
  });

  test("preserves the angular relation between pointer and plate center during orbit dragging", () => {
    const projection = sourceProjectionProfileForMode("zenith-180");
    const startPointer = fisheyeUvToDirection(0.5, 0.24, projection);
    const currentPointer = fisheyeUvToDirection(0.72, 0.38, projection);
    if (!startPointer || !currentPointer) throw new Error("Expected valid source pointer directions");

    const startPlacement = preparePlatePlacement({ azimuth: -24, radius: 0.42, scale: 0.55 }, { aspect: 1 }, "zenith-180");
    const moved = moveDomePointBySourcePointerDrag(startPlacement.center, startPointer, currentPointer, "zenith-180");
    const movedPlacement = preparePlatePlacement({ ...startPlacement, azimuth: moved.azimuth, radius: moved.radius }, { aspect: 1 }, "zenith-180");

    expect(angularDistance(startPlacement.center, startPointer)).toBeCloseTo(angularDistance(movedPlacement.center, currentPointer), 6);
  });

  test("uses the same source-direction drag model for flat and projected editor views", () => {
    const projection = sourceProjectionProfileForMode("zenith-180");
    const startPointer = fisheyeUvToDirection(0.5, 0.5, projection);
    const currentPointer = fisheyeUvToDirection(0.5, 0.0, projection);
    if (!startPointer || !currentPointer) throw new Error("Expected valid source pointer directions");

    const fromFlatMap = moveDomePointBySourcePointerDrag(startPointer, startPointer, currentPointer, "zenith-180");
    const fromProjectedDome = moveDomePointBySourcePointerDrag(startPointer, startPointer, currentPointer, "zenith-180");

    expect(fromFlatMap.azimuth).toBeCloseTo(fromProjectedDome.azimuth, 8);
    expect(fromFlatMap.radius).toBeCloseTo(fromProjectedDome.radius, 8);
    expect(fromFlatMap.radius).toBeCloseTo(1, 6);
  });

  test("returns CAVE source-map carrier coordinates after projected-view movement", () => {
    const direction = sourceMapPointToDirection({ radius: 1, azimuth: 45 }, "cave-270", 2, 2, 1, 0.5);
    if (!direction) throw new Error("Expected a valid CAVE source-map direction");

    const moved = moveDomePointBySourcePointerDrag(direction, direction, direction, "cave-270", 0.5);

    expect(moved.radius).toBeCloseTo(1, 6);
    expect(moved.azimuth).toBeCloseTo(45, 6);
  });

  test("scales from source-local coordinates", () => {
    const scale = scaleFromSourceLocalDrag(
      0.5,
      { x: 0.2, y: -0.2 },
      { x: 0.3, y: -0.22 },
      { x: 0.2, y: -0.2 },
      0.08,
      2.2,
    );

    expect(scale).toBeCloseTo(0.75, 6);
  });

  test("warps corner offsets from source-local coordinates", () => {
    const placement = preparePlatePlacement({ azimuth: 0, radius: 0.3, scale: 0.5 }, { aspect: 1 }, "zenith-180");
    const corner = "se";
    const startCorner = plateCornerLocal(placement, corner);
    const offsets = cornerOffsetsFromSourceLocalDrag(
      placement,
      corner,
      startCorner,
      { x: startCorner.x + placement.angularWidth * 0.2, y: startCorner.y - placement.angularHeight * 0.1 },
      placement.cornerOffsets,
    );

    expect(offsets).not.toBeNull();
    expect(offsets!.se.x).toBeCloseTo(0.2, 6);
    expect(offsets!.se.y).toBeCloseTo(-0.1, 6);
  });

  test("rotates from plate tangent-frame local coordinates instead of screen angle", () => {
    const spin = spinFromSourceLocalRotateDrag(10, { x: 0, y: -1 }, { x: 1, y: 0 });

    expect(spin).toBeCloseTo(100, 6);
  });

  test("hit tests plate editor handles with pure viewport math", () => {
    const handles = [
      { action: "rotate" as const, x: 120, y: 80 },
      { action: "scale" as const, corner: "ne" as const, x: 240, y: 160 },
    ];

    expect(hitPlateEditorHandle({ x: 124, y: 84 }, handles, 8)?.action).toBe("rotate");
    expect(hitPlateEditorHandle({ x: 250, y: 160 }, handles, 8)).toBeNull();
  });

  test("hit tests prepared plate bodies from source directions", () => {
    const placement = { azimuth: 0, radius: 0.3, scale: 0.5 };
    const plate = { aspect: 1 };
    const prepared = preparePlatePlacement(placement, plate, "zenith-180");
    const centerHit = sourceDirectionHitsPlatePlacement({
      direction: prepared.center,
      placement: prepared,
      plate,
      projectionMode: "zenith-180",
      plateFit: "contain",
      hitLocalPad: 0.012,
    });
    const miss = sourceDirectionHitsPlatePlacement({
      direction: sourceMapPointToDirection({ radius: 1, azimuth: 180 }, "zenith-180"),
      placement: prepared,
      plate,
      projectionMode: "zenith-180",
      plateFit: "contain",
      hitLocalPad: 0.012,
    });

    expect(centerHit).toBe(true);
    expect(miss).toBe(false);
  });
});
