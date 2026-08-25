import tgpu, { d } from "typegpu";
import { describe, expect, test } from "vitest";
import { guideFieldAzimuthKernel, guideFieldColorKernel, profiledHallGuideFieldColorKernel } from "./field.js";

describe("continuous carrier guide field", () => {
  test("interpolates through authored anchors without discontinuities", () => {
    const colors = [d.vec3f(0, 1, 0), d.vec3f(0, 1, 0.8), d.vec3f(0.2, 0.5, 1), d.vec3f(0.1, 0.2, 0.7)] as const;
    expectVector(guideFieldColorKernel(0, 0.3, 0.7, ...colors), [0, 1, 0]);
    expectVector(guideFieldColorKernel(0.3, 0.3, 0.7, ...colors), [0, 1, 0.8]);
    expectVector(guideFieldColorKernel(0.7, 0.3, 0.7, ...colors), [0.2, 0.5, 1]);
    expectVector(guideFieldColorKernel(1, 0.3, 0.7, ...colors), [0.1, 0.2, 0.7]);
    const before = guideFieldColorKernel(0.2999, 0.3, 0.7, ...colors);
    const after = guideFieldColorKernel(0.3001, 0.3, 0.7, ...colors);
    expect(Math.abs(before.z - after.z)).toBeLessThan(0.001);
  });

  test("keeps its angular tint periodic at the carrier seam", () => {
    expect(guideFieldAzimuthKernel(0, 1)).toBeCloseTo(0.5, 6);
    expect(guideFieldAzimuthKernel(0.000001, -1)).toBeCloseTo(guideFieldAzimuthKernel(-0.000001, -1), 5);
  });

  test("shares one exact color across the profiled roof-to-wall anchor", () => {
    const roofColor = d.vec3f(0.08, 0.72, 0.91);
    const inside = profiledHallGuideFieldColorKernel(
      0.36 - 0.000_001,
      0.36,
      0.68,
      roofColor,
      d.vec3f(0, 1, 0.82),
      d.vec3f(0, 0.72, 0.6),
      0.9,
    );
    const outside = profiledHallGuideFieldColorKernel(
      0.36 + 0.000_001,
      0.36,
      0.68,
      roofColor,
      d.vec3f(0, 1, 0.82),
      d.vec3f(0, 0.72, 0.6),
      0.9,
    );
    expectVector(inside, [roofColor.x, roofColor.y, roofColor.z]);
    expect(Math.abs(outside.x - inside.x)).toBeLessThan(0.000_001);
    expect(Math.abs(outside.y - inside.y)).toBeLessThan(0.000_001);
    expect(Math.abs(outside.z - inside.z)).toBeLessThan(0.000_001);
  });

  test("resolves as portable TypeGPU math", () => {
    const probe = () => {
      "use gpu";
      return guideFieldColorKernel(0.5, 0.3, 0.7, d.vec3f(0), d.vec3f(0, 1, 0), d.vec3f(0, 0, 1), d.vec3f(0.1));
    };
    expect(tgpu.resolve([probe])).toContain("fn guideFieldColorKernel");
  });

  test("resolves the profiled hall boundary field through TypeGPU", () => {
    const probe = () => {
      "use gpu";
      return profiledHallGuideFieldColorKernel(
        0.5,
        0.36,
        0.68,
        d.vec3f(0, 0.7, 1),
        d.vec3f(0, 1, 0.8),
        d.vec3f(0, 0.7, 0.5),
        0.5,
      );
    };
    expect(tgpu.resolve([probe])).toContain("fn profiledHallGuideFieldColorKernel");
  });
});

function expectVector(actual: { x: number; y: number; z: number }, expected: readonly number[]): void {
  expect(actual.x).toBeCloseTo(expected[0], 6);
  expect(actual.y).toBeCloseTo(expected[1], 6);
  expect(actual.z).toBeCloseTo(expected[2], 6);
}
