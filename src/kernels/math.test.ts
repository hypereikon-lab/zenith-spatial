import tgpu, { d } from "typegpu";
import { describe, expect, test } from "vitest";
import { piecewiseMap4, safeNormalize3, wrappedUnit } from "./math.js";

describe("portable TypeGPU math kernel", () => {
  test("executes the same authored functions on the CPU", () => {
    const normalized = safeNormalize3(d.vec3f(3, 0, 4));
    expect(normalized.x).toBeCloseTo(0.6, 6);
    expect(normalized.y).toBe(0);
    expect(normalized.z).toBeCloseTo(0.8, 6);
    expect(wrappedUnit(-0.25)).toBe(0.75);
    expect(piecewiseMap4(0.375, 0, 0.25, 0.5, 1, 0, 0.1, 0.8, 1)).toBeCloseTo(0.45, 6);
  });

  test("resolves the CPU-callable kernel transitively into WGSL", () => {
    const probe = () => {
      "use gpu";
      return safeNormalize3(d.vec3f(wrappedUnit(-0.25), piecewiseMap4(0.5, 0, 0.25, 0.5, 1, 0, 0.1, 0.8, 1), 1));
    };

    const wgsl = tgpu.resolve([probe]);

    expect(wgsl).toContain("fn probe");
    expect(wgsl).toContain("fn safeNormalize3");
    expect(wgsl).toContain("fn wrappedUnit");
    expect(wgsl).toContain("fn piecewiseMap4");
  });
});
