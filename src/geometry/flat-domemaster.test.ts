import { describe, expect, test } from "vitest";
import {
  clientPointToCanvasPoint,
  domeDirectionToFlatPoint,
  flatDisplayPointToDomeDirection,
  flatDisplayPointToDomePoint,
  sourceFlatToDisplayFlatPoint,
} from "./flat-domemaster.js";
import type { SourceProjectionMode } from "./source-projection.js";

describe("flat domemaster coordinate spaces", () => {
  test("maps viewport client points into canvas-local CSS pixels", () => {
    const point = clientPointToCanvasPoint(
      { x: 460, y: 190 },
      { left: 280, top: 40, width: 720, height: 720 },
      { width: 100, height: 100 },
    );

    expect(point.x).toBeCloseTo(25);
    expect(point.y).toBeCloseTo(20.833333);
  });

  test("undoes flat display rotation before reading dome azimuth", () => {
    const metrics = { cx: 50, cy: 50, radius: 50 };
    const sourceNorth = { x: 50, y: 25 };
    const displayedSouth = sourceFlatToDisplayFlatPoint(sourceNorth, 50, 50, Math.PI);
    if (!displayedSouth) throw new Error("Expected the rotated source point inside the display carrier");

    const point = flatDisplayPointToDomePoint(displayedSouth, metrics, { rotationRadians: Math.PI });
    const direction = flatDisplayPointToDomeDirection(displayedSouth, metrics, { rotationRadians: Math.PI });
    if (!point || !direction) throw new Error("Expected the rotated display point inside the carrier");

    expect(point).toEqual({ radius: 0.5, azimuth: 0 });
    expect(direction[0]).toBeCloseTo(0);
    expect(direction[1]).toBeCloseTo(Math.cos(Math.PI * 0.25));
    expect(direction[2]).toBeCloseTo(Math.sin(Math.PI * 0.25));
  });

  test("reads flat source radius as equidistant dome radius", () => {
    const metrics = { cx: 50, cy: 50, radius: 50 };
    const halfwayRight = { x: 75, y: 50 };

    const point = flatDisplayPointToDomePoint(halfwayRight, metrics);

    expect(point?.radius).toBeCloseTo(0.5);
    expect(point?.azimuth).toBeCloseTo(90);
  });

  test("projects dome directions through equidistant flat geometry", () => {
    const direction: [number, number, number] = [0.5, Math.sqrt(1 - 0.5 * 0.5), 0];
    const point = domeDirectionToFlatPoint(direction, 50, 50, 50);

    expect(point?.x).toBeCloseTo(50 + (Math.asin(0.5) / (Math.PI * 0.5)) * 50);
    expect(point?.y).toBeCloseTo(50);
  });

  test("round-trips source directions through flat display mapping", () => {
    const metrics = { cx: 120, cy: 96, radius: 72 };
    const sourceDirection = normalize([0.33, 0.72, 0.61]);
    const rotationRadians = Math.PI * 0.37;

    const sourcePoint = domeDirectionToFlatPoint(sourceDirection, metrics.cx, metrics.cy, metrics.radius);
    if (!sourcePoint) throw new Error("Expected the source direction inside the flat carrier");
    const displayPoint = sourceFlatToDisplayFlatPoint(sourcePoint, metrics.cx, metrics.cy, rotationRadians);
    if (!displayPoint) throw new Error("Expected equidistant display point");

    const roundTrip = flatDisplayPointToDomeDirection(displayPoint, metrics, {
      rotationRadians,
    });

    expectVectorClose(roundTrip, sourceDirection);
  });

  test("places the flat horizon or CAVE front-wall center at the correct carrier radius", () => {
    const modes: Array<[SourceProjectionMode, number]> = [
      ["zenith-180", 1],
      ["zenith-230", 18 / 23],
      ["nadir-180", 1],
      ["cave-270", 2 / 3],
    ];

    for (const [mode, expectedRadius] of modes) {
      const point = domeDirectionToFlatPoint([0, 0, 1], 50, 50, 40, mode);
      expect(point).not.toBeNull();
      const radius = Math.hypot(point!.x - 50, point!.y - 50) / 40;
      expect(radius).toBeCloseTo(expectedRadius, 6);
    }
  });
});

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function expectVectorClose(actual: [number, number, number] | null, expected: [number, number, number]): void {
  expect(actual).not.toBeNull();
  const value = actual as [number, number, number];
  for (let index = 0; index < 3; index += 1) {
    expect(value[index]).toBeCloseTo(expected[index], 6);
  }
}
