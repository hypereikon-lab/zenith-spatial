import { describe, expect, test } from "vitest";
import { lookAtLH, normalize } from "../projection.js";
import {
  caveSurfacePointForPhysicalDirection,
  sourceCaveDirectionFromScreenPoint,
  sourceCaveDirectionToScreenPoint,
} from "./cave-view.js";
import type { CaveViewProjection } from "./cave-view.js";
import type { Vec3 } from "../projection.js";

const frontProjection: CaveViewProjection = {
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewMatrix: lookAtLH([0, 0, 6], [0, 0, 0], [0, 1, 0]),
  fovDegrees: 90,
  sourceRotationRadians: 0,
  domeTiltRadians: 0,
  mirror: false,
  sourceProjectionMode: "cave-270",
};

describe("CAVE view projection", () => {
  test("projects source horizon north to the front wall center", () => {
    const screen = sourceCaveDirectionToScreenPoint([0, 0, 1], frontProjection);

    expect(screen?.x).toBeCloseTo(50, 6);
    expect(screen?.y).toBeCloseTo(50, 6);
    expectVectorClose(sourceCaveDirectionFromScreenPoint(screen!, frontProjection), [0, 0, 1]);
  });

  test("rejects rays that leave through the missing ceiling", () => {
    expect(caveSurfacePointForPhysicalDirection([0, 1, 0])).toBeNull();
    expect(sourceCaveDirectionToScreenPoint([0, 1, 0], frontProjection)).toBeNull();
  });

  test("round-trips transformed CAVE source directions through screen projection", () => {
    const projection: CaveViewProjection = {
      ...frontProjection,
      sourceRotationRadians: Math.PI * 0.18,
      domeTiltRadians: -Math.PI * 0.11,
      mirror: true,
    };
    const source = normalize([0.24, -0.35, 0.91]);
    const screen = sourceCaveDirectionToScreenPoint(source, projection);
    if (!screen) throw new Error("Expected source direction to hit a CAVE face");

    expectVectorClose(sourceCaveDirectionFromScreenPoint(screen, projection), source);
  });

  test("round-trips CAVE source directions through orthographic screen projection", () => {
    const projection: CaveViewProjection = {
      ...frontProjection,
      projectionMode: "orthographic",
      orthographicViewHeight: 5,
    };
    const source = normalize([0.24, -0.35, 0.91]);
    const screen = sourceCaveDirectionToScreenPoint(source, projection);
    if (!screen) throw new Error("Expected source direction to hit a CAVE face");

    expectVectorClose(sourceCaveDirectionFromScreenPoint(screen, projection), source);
  });

  test("projects and raycasts through front/blocking CAVE faces when mask is enabled", () => {
    const centerScreen = { x: 50, y: 50 };

    // With mask disabled: center screen hit should be on the front wall (z = 1.1)
    const hitWithoutMask = sourceCaveDirectionFromScreenPoint(centerScreen, {
      ...frontProjection,
      showCaveMask: false,
    });
    expect(hitWithoutMask).not.toBeNull();
    expectVectorClose(hitWithoutMask, [0, 0, 1]);

    // With mask enabled: center screen hit should pass through front wall and hit back wall (z = -1.1)
    const hitWithMask = sourceCaveDirectionFromScreenPoint(centerScreen, {
      ...frontProjection,
      showCaveMask: true,
    });
    expect(hitWithMask).not.toBeNull();
    expectVectorClose(hitWithMask, [0, 0, -1]);
  });

  test("uses measured off-center observer bounds for box-room ray intersections", () => {
    const room = {
      width: 6,
      depth: 4,
      height: 3.5,
      eyeHeight: 1.4,
      eyeX: 0.75,
      eyeZ: -0.4,
    };

    expectVectorClose(caveSurfacePointForPhysicalDirection([1, 0, 0], room), [2.25, 0, 0]);
    expectVectorClose(caveSurfacePointForPhysicalDirection([0, 0, 1], room), [0, 0, 2.4]);

    const projection: CaveViewProjection = {
      ...frontProjection,
      room,
      projectionSurface: { kind: "box-room", ...room },
    };
    const source = normalize([0.18, -0.22, 0.96]);
    const screen = sourceCaveDirectionToScreenPoint(source, projection);
    if (!screen) throw new Error("Expected measured CAVE direction to hit the room");
    expectVectorClose(sourceCaveDirectionFromScreenPoint(screen, projection), source);
  });

  test.each(["cylinder-nadir", "cylinder-zenith"] as const)(
    "round-trips %s Volume Room directions through the measured cylinder",
    (sourceProjectionMode) => {
      const projection: CaveViewProjection = {
        ...frontProjection,
        sourceProjectionMode,
        projectionSurface: { kind: "cylinder", radius: 3.2, height: 5.5, eyeHeight: 1.65 },
      };
      const source = normalize([0.22, sourceProjectionMode === "cylinder-nadir" ? -0.18 : 0.18, 0.96]);
      const screen = sourceCaveDirectionToScreenPoint(source, projection);
      if (!screen) throw new Error("Expected cylinder direction to hit the measured surface");
      expectVectorClose(sourceCaveDirectionFromScreenPoint(screen, projection), source);
    },
  );

  test("round-trips the measured double-gable hall and leaves straight-down rays open", () => {
    const projection: CaveViewProjection = {
      ...frontProjection,
      viewMatrix: lookAtLH([0, 5, 30], [0, 4, 0], [0, 1, 0]),
      sourceProjectionMode: "hall-double-gable",
      projectionSurface: {
        kind: "double-gable-room",
        length: 22.55,
        width: 23.143,
        eaveHeight: 9.39,
        ridgeHeight: 12.93,
        valleyHeight: 9.39,
        ridgeInset: 23.143 / 4,
        eyeHeight: 1.65,
        eyeX: 0,
        eyeZ: 0,
      },
    };
    const source = normalize([0.22, 0.38, 0.96]);
    const screen = sourceCaveDirectionToScreenPoint(source, projection);
    if (!screen) throw new Error("Expected double-gable direction to hit the measured shell");
    expectVectorClose(sourceCaveDirectionFromScreenPoint(screen, projection), source);
    expect(sourceCaveDirectionToScreenPoint([0, -1, 0], projection)).toBeNull();
  });
});

function expectVectorClose(actual: Vec3 | null, expected: Vec3): void {
  expect(actual).not.toBeNull();
  const value = actual as Vec3;
  for (let index = 0; index < 3; index += 1) {
    expect(value[index]).toBeCloseTo(expected[index], 5);
  }
}
