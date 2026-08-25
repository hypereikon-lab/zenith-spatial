import { describe, expect, test } from "vitest";
import { lookAtLH, normalize } from "../projection.js";
import {
  physicalDomeDirectionFromSourceDirection,
  domePointFromSourceDirection,
  sourceDirectionFromPhysicalDomeDirection,
  sourceDomeDirectionFromScreenPoint,
  sourceDomeDirectionToScreenPoint,
} from "./dome-view.js";
import type { DomeViewProjection } from "./dome-view.js";
import type { Vec3 } from "../projection.js";

const baseProjection: DomeViewProjection = {
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewMatrix: lookAtLH([0, 0, 3], [0, 0, 0], [0, 1, 0]),
  fovDegrees: 90,
  sourceRotationRadians: 0,
  domeTiltRadians: 0,
  mirror: false,
};

describe("dome view pointer projection", () => {
  test("round-trips a visible source direction through screen coordinates", () => {
    const screen = sourceDomeDirectionToScreenPoint([0, 0, 1], baseProjection);
    expect(screen).toEqual({ x: 50, y: 50 });

    const direction = sourceDomeDirectionFromScreenPoint(screen, baseProjection);
    expectVectorClose(direction, [0, 0, 1]);
  });

  test("round-trips off-center projected dome points", () => {
    const source = normalize([0.22, 0.18, 0.96]);

    const screen = sourceDomeDirectionToScreenPoint(source, baseProjection);
    expect(screen).not.toBeNull();
    const direction = sourceDomeDirectionFromScreenPoint(screen, baseProjection);

    expectVectorClose(direction, source);
  });

  test("round-trips visible dome points through orthographic screen projection", () => {
    const source = normalize([0.22, 0.18, 0.96]);
    const projection: DomeViewProjection = {
      ...baseProjection,
      projectionMode: "orthographic",
      orthographicViewHeight: 2.4,
    };

    const screen = sourceDomeDirectionToScreenPoint(source, projection);
    expect(screen).not.toBeNull();
    const direction = sourceDomeDirectionFromScreenPoint(screen!, projection);

    expectVectorClose(direction, source);
  });

  test("does not project the hidden back side through the front dome surface", () => {
    expect(sourceDomeDirectionToScreenPoint([0, 0, -1], baseProjection)).toBeNull();
  });

  test("maps source points through zenith and nadir projection modes", () => {
    expect(domePointFromSourceDirection([0, 1, 0], "zenith-180").radius).toBeCloseTo(0, 5);
    expect(domePointFromSourceDirection([0, -1, 0], "cave-270").radius).toBeCloseTo(0, 5);

    const nadirHorizon = domePointFromSourceDirection([0, 0, 1], "cave-270");
    expect(nadirHorizon.radius).toBeCloseTo(2 / 3, 5);
    expect(nadirHorizon.azimuth).toBeCloseTo(0, 5);
  });

  test("clips source directions outside the selected geometric projection", () => {
    expect(sourceDomeDirectionToScreenPoint([0, 1, 0], { ...baseProjection, sourceProjectionMode: "cave-270" })).toBeNull();
    expect(sourceDomeDirectionToScreenPoint([0, -1, 0], { ...baseProjection, sourceProjectionMode: "zenith-180" })).toBeNull();
  });

  test("clips tilted dome views in source space instead of raw physical latitude", () => {
    const source: Vec3 = [0, 0, -1];
    const transform = {
      sourceRotationRadians: 0,
      domeTiltRadians: Math.PI / 6,
      mirror: false,
    };
    const physical = physicalDomeDirectionFromSourceDirection(source, transform);
    expect(physical[1]).toBeLessThan(0);

    const projection: DomeViewProjection = {
      ...baseProjection,
      ...transform,
      sourceProjectionMode: "zenith-180",
      viewMatrix: lookAtLH([0, 0, 0], physical, [0, 1, 0]),
    };

    const screen = sourceDomeDirectionToScreenPoint(source, projection);
    if (!screen) throw new Error("Expected tilted source horizon to project to screen");
    expect(screen.x).toBeCloseTo(50, 6);
    expect(screen.y).toBeCloseTo(50, 6);
    expectVectorClose(sourceDomeDirectionFromScreenPoint(screen, projection), source);
  });

  test("supports inside-camera picking from the dome center", () => {
    const insideProjection: DomeViewProjection = {
      ...baseProjection,
      viewMatrix: lookAtLH([0, 0, 0], [0, 0, 1], [0, 1, 0]),
    };

    const screen = sourceDomeDirectionToScreenPoint([0, 0, 1], insideProjection);
    expect(screen).toEqual({ x: 50, y: 50 });
    const direction = sourceDomeDirectionFromScreenPoint(screen, insideProjection);

    expectVectorClose(direction, [0, 0, 1]);
  });

  test("clips projected edit handles against the cutaway opening", () => {
    const cutawayProjection: DomeViewProjection = {
      ...baseProjection,
      cutaway: true,
    };

    expect(sourceDomeDirectionToScreenPoint(normalize([-0.4, 0.2, 0.9]), cutawayProjection)).toBeNull();
    expect(sourceDomeDirectionToScreenPoint(normalize([0.4, 0.2, 0.9]), cutawayProjection)).not.toBeNull();
  });

  test("matches shader source transform for rotation, mirror, and tilt", () => {
    const projection = {
      sourceRotationRadians: Math.PI / 5,
      domeTiltRadians: -Math.PI / 9,
      mirror: true,
    };
    const source: Vec3 = normalize([0.42, 0.7, 0.57]);

    const physical = physicalDomeDirectionFromSourceDirection(source, projection);
    const roundTrip = sourceDirectionFromPhysicalDomeDirection(physical, projection);

    expectVectorClose(roundTrip, source);
  });

  test("round-trips source directions through inside, theater, and orbit screen projections", () => {
    const transform = {
      sourceRotationRadians: -Math.PI / 7,
      domeTiltRadians: Math.PI / 11,
      mirror: true,
    };
    const source: Vec3 = normalize([0.24, 0.62, 0.76]);
    const physical = physicalDomeDirectionFromSourceDirection(source, transform);
    const projections: DomeViewProjection[] = [
      {
        ...baseProjection,
        ...transform,
        viewMatrix: lookAtLH([0, 0, 0], physical, [0, 1, 0]),
        fovDegrees: 92,
      },
      {
        ...baseProjection,
        ...transform,
        viewMatrix: lookAtLH([0, -0.24, -0.58], physical, [0, 1, 0]),
        fovDegrees: 108,
      },
      {
        ...baseProjection,
        ...transform,
        viewMatrix: lookAtLH([physical[0] * 3, physical[1] * 3, physical[2] * 3], physical, [0, 1, 0]),
        fovDegrees: 84,
      },
    ];

    for (const projection of projections) {
      const screen = sourceDomeDirectionToScreenPoint(source, projection);
      if (!screen) throw new Error("Expected source direction to project to screen");
      const roundTrip = sourceDomeDirectionFromScreenPoint(screen, projection);
      expectVectorClose(roundTrip, source);
    }
  });

  test("projects and raycasts through front/blocking dome surface when mask is enabled", () => {
    const centerScreen = { x: 50, y: 50 };

    // With mask disabled: center screen hit should be on the front of the dome (physical [0, 0, 1])
    const hitWithoutMask = sourceDomeDirectionFromScreenPoint(centerScreen, {
      ...baseProjection,
      showCaveMask: false,
    });
    expect(hitWithoutMask).not.toBeNull();
    expectVectorClose(hitWithoutMask, [0, 0, 1]);

    // With mask enabled: center screen hit should pass through the front of the dome and hit the back interior (physical [0, 0, -1])
    const hitWithMask = sourceDomeDirectionFromScreenPoint(centerScreen, {
      ...baseProjection,
      showCaveMask: true,
    });
    expect(hitWithMask).not.toBeNull();
    expectVectorClose(hitWithMask, [0, 0, -1]);
  });
});

function expectVectorClose(received: Vec3 | null, expected: Vec3): void {
  expect(received).not.toBeNull();
  const value = received as Vec3;
  for (let index = 0; index < 3; index += 1) {
    expect(value[index]).toBeCloseTo(expected[index], 5);
  }
}
