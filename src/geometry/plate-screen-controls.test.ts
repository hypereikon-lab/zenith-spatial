import { describe, expect, test } from "vitest";
import { preparePlatePlacement } from "../plates/plate-placement.js";
import { directionFromPlateUv } from "../plates/plate-placement.js";
import { dot } from "../projection.js";
import { projectPlateScreenControls } from "./plate-screen-controls.js";

describe("projected plate screen controls", () => {
  test("uses only true projected resize and rotate handles", () => {
    const placement = preparePlatePlacement(
      {
        azimuth: 0,
        radius: 0.45,
        scale: 0.7,
        spin: 0,
        opacity: 1,
      },
      { aspect: 1 },
    );

    const controls = projectPlateScreenControls(
      placement,
      { minU: 0, minV: 0, maxU: 1, maxV: 1 },
      {
        projectSourceDirection: (direction) => (dot(direction, placement.center) > 0.9999 ? { x: 50, y: 50 } : null),
        projectPlateUv: (placement, u, v) =>
          dot(directionFromPlateUv(placement, u, v), placement.center) > 0.9999 ? { x: 50, y: 50 } : null,
      },
    );

    expect(controls).not.toBeNull();
    expect(controls?.scaleHandles).toHaveLength(0);
    expect(controls?.rotateHandle).toBeNull();
    expect(controls?.rotateAnchor).toBeNull();
  });

  test("does not mix projected corners with artificial screen-space fallback handles", () => {
    const placement = preparePlatePlacement(
      {
        azimuth: 0,
        radius: 0.45,
        scale: 0.7,
        spin: 0,
        opacity: 1,
      },
      { aspect: 1 },
    );

    const controls = projectPlateScreenControls(
      placement,
      { minU: 0, minV: 0, maxU: 1, maxV: 1 },
      {
        projectSourceDirection: (direction) => {
          const centerDot = dot(direction, placement.center);
          if (centerDot > 0.9999) return { x: 50, y: 50 };
          if (direction[0] < -0.01) return null;
          return { x: 50 + direction[0] * 30, y: 50 - direction[1] * 30 };
        },
        projectPlateUv: (placement, u, v) => {
          const direction = directionFromPlateUv(placement, u, v);
          if (direction[0] < -0.01) return null;
          return { x: 50 + direction[0] * 30, y: 50 - direction[1] * 30 };
        },
      },
    );

    expect(controls).not.toBeNull();
    expect(controls?.scaleHandles.length).toBeGreaterThan(0);
    expect(controls?.scaleHandles.length).toBeLessThan(4);
    for (const handle of controls?.scaleHandles || []) {
      expect(handle.x).toBeGreaterThanOrEqual(50);
    }
  });

  test("breaks projected outlines at hidden samples instead of joining across gaps", () => {
    const placement = preparePlatePlacement(
      {
        azimuth: 0,
        radius: 0.45,
        scale: 0.7,
        spin: 0,
        opacity: 1,
      },
      { aspect: 1 },
    );

    const controls = projectPlateScreenControls(
      placement,
      { minU: 0, minV: 0, maxU: 1, maxV: 1 },
      {
        projectSourceDirection: () => ({ x: 50, y: 50 }),
        projectPlateUv: (_placement, u, v) => {
          if (u > 0.42 && u < 0.58) return null;
          return { x: u * 100, y: v * 100 };
        },
      },
    );

    expect(controls).not.toBeNull();
    expect(controls?.outlineClosed).toBe(false);
    expect(controls?.outlineSegments.length).toBeGreaterThan(1);
    for (const segment of controls?.outlineSegments || []) {
      for (let index = 1; index < segment.length; index += 1) {
        expect(
          Math.hypot(segment[index].x - segment[index - 1].x, segment[index].y - segment[index - 1].y),
        ).toBeLessThan(12);
      }
    }
  });
});
